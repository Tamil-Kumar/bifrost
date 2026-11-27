/* SPDX-License-Identifier: MIT
 *
 * Copyright (C) 2017-2025 WireGuard LLC. All Rights Reserved.
 */

// Package netstack is wireguard-go's tun/netstack (golang.zx2c4.com/wireguard, MIT), changed for Bifrost's VPN:
// the network stack's TCP set up for speed (Options), packets handed to WireGuard in batches, names looked up
// once for everyone asking and kept for as long as they may be (and asked of the next DNS server if one is slow
// to answer), and an address of the other kind tried too if the first is slow to connect. TCP and the DNS it
// needs only: what Bifrost's proxy uses.
package netstack

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.zx2c4.com/wireguard/tun"

	"golang.org/x/net/dns/dnsmessage"
	"gvisor.dev/gvisor/pkg/buffer"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/header"
	"gvisor.dev/gvisor/pkg/tcpip/link/channel"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv6"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
	"gvisor.dev/gvisor/pkg/tcpip/transport/tcp"
	"gvisor.dev/gvisor/pkg/tcpip/transport/udp"
)

// How the stack is set up. The zero value is wireguard-go's own.
type Options struct {
	NoRACK      bool // TCP's RACK loss detection off (gVisor's sends too much again: tailscale/tailscale#9707)
	RecvMax     int  // the most a TCP receive buffer grows to (gVisor: 4 MB; how far a download can get ahead)
	SendMax     int  // the most a TCP send buffer grows to (gVisor: 4 MB)
	Batch       int  // packets handed to WireGuard at once (1: one at a time)
	Queue       int  // packets the stack can have waiting for WireGuard (1024)
	DNSCache    bool // a name looked up once for everyone asking, kept for its TTL (15 s to 5 min)
	DNSStagger  time.Duration
	V4First     bool          // IPv4 addresses tried first (otherwise IPv6, when the tunnel has it)
	HappyAfter  time.Duration // the other kind of address tried too when the first hasn't connected by then (0: no)
	DNSCacheMax int
}

type netTun struct {
	ep             *channel.Endpoint
	stack          *stack.Stack
	events         chan tun.Event
	notifyHandle   *channel.NotificationHandle
	incomingPacket chan *buffer.View
	mtu            int
	dnsServers     []netip.Addr
	hasV4, hasV6   bool
	opts           Options
	ctx            context.Context
	cancel         context.CancelFunc

	dnsMu     sync.Mutex
	dnsCache  map[string]dnsEntry
	dnsFlight map[string]*dnsCall
}

type dnsEntry struct {
	addrs   []string
	expires time.Time
}

type dnsCall struct {
	done  chan struct{}
	addrs []string
	err   error
}

type Net netTun

func CreateNetTUN(localAddresses, dnsServers []netip.Addr, mtu int, o Options) (tun.Device, *Net, error) {
	opts := stack.Options{
		NetworkProtocols:   []stack.NetworkProtocolFactory{ipv4.NewProtocol, ipv6.NewProtocol},
		TransportProtocols: []stack.TransportProtocolFactory{tcp.NewProtocol, udp.NewProtocol},
		HandleLocal:        true,
	}
	if o.Batch < 1 {
		o.Batch = 1
	}
	if o.Queue < 1 {
		o.Queue = 1024
	}
	if o.DNSCacheMax < 1 {
		o.DNSCacheMax = 4096
	}
	dev := &netTun{
		ep:             channel.New(o.Queue, uint32(mtu), ""),
		stack:          stack.New(opts),
		events:         make(chan tun.Event, 10),
		incomingPacket: make(chan *buffer.View),
		dnsServers:     dnsServers,
		mtu:            mtu,
		opts:           o,
		dnsCache:       map[string]dnsEntry{},
		dnsFlight:      map[string]*dnsCall{},
	}
	dev.ctx, dev.cancel = context.WithCancel(context.Background())
	set := func(name string, opt tcpip.SettableTransportProtocolOption) error {
		if err := dev.stack.SetTransportProtocolOption(tcp.ProtocolNumber, opt); err != nil {
			return fmt.Errorf("could not set TCP's %s: %v", name, err)
		}
		return nil
	}
	sack := tcpip.TCPSACKEnabled(true) // TCP SACK is disabled by default
	if err := set("SACK", &sack); err != nil {
		return nil, nil, err
	}
	if o.NoRACK {
		recovery := tcpip.TCPRecovery(0)
		if err := set("loss recovery", &recovery); err != nil {
			return nil, nil, err
		}
	}
	if o.RecvMax > 0 {
		r := tcpip.TCPReceiveBufferSizeRangeOption{Min: tcp.MinBufferSize, Default: tcp.DefaultReceiveBufferSize, Max: o.RecvMax}
		if err := set("receive buffer", &r); err != nil {
			return nil, nil, err
		}
	}
	if o.SendMax > 0 {
		s := tcpip.TCPSendBufferSizeRangeOption{Min: tcp.MinBufferSize, Default: tcp.DefaultSendBufferSize, Max: o.SendMax}
		if err := set("send buffer", &s); err != nil {
			return nil, nil, err
		}
	}
	moderate := tcpip.TCPModerateReceiveBufferOption(true)
	if err := set("receive buffer tuning", &moderate); err != nil {
		return nil, nil, err
	}
	if o.Batch == 1 {
		dev.notifyHandle = dev.ep.AddNotify(dev)
	}
	if err := dev.stack.CreateNIC(1, dev.ep); err != nil {
		return nil, nil, fmt.Errorf("CreateNIC: %v", err)
	}
	for _, ip := range localAddresses {
		var protoNumber tcpip.NetworkProtocolNumber
		if ip.Is4() {
			protoNumber = ipv4.ProtocolNumber
		} else if ip.Is6() {
			protoNumber = ipv6.ProtocolNumber
		}
		protoAddr := tcpip.ProtocolAddress{
			Protocol:          protoNumber,
			AddressWithPrefix: tcpip.AddrFromSlice(ip.AsSlice()).WithPrefix(),
		}
		if err := dev.stack.AddProtocolAddress(1, protoAddr, stack.AddressProperties{}); err != nil {
			return nil, nil, fmt.Errorf("AddProtocolAddress(%v): %v", ip, err)
		}
		if ip.Is4() {
			dev.hasV4 = true
		} else if ip.Is6() {
			dev.hasV6 = true
		}
	}
	if dev.hasV4 {
		dev.stack.AddRoute(tcpip.Route{Destination: header.IPv4EmptySubnet, NIC: 1})
	}
	if dev.hasV6 {
		dev.stack.AddRoute(tcpip.Route{Destination: header.IPv6EmptySubnet, NIC: 1})
	}

	dev.events <- tun.EventUp
	return dev, (*Net)(dev), nil
}

func (tun *netTun) Name() (string, error) {
	return "go", nil
}

func (tun *netTun) File() *os.File {
	return nil
}

func (tun *netTun) Events() <-chan tun.Event {
	return tun.events
}

// Packets the stack sends, for WireGuard to send on: as many as are waiting (up to the batch), once there's one.
func (tun *netTun) Read(buf [][]byte, sizes []int, offset int) (int, error) {
	if tun.opts.Batch == 1 {
		var view *buffer.View
		select {
		case view = <-tun.incomingPacket:
		case <-tun.ctx.Done():
			return 0, os.ErrClosed
		}
		n, err := view.Read(buf[0][offset:])
		view.Release()
		if err != nil {
			return 0, err
		}
		sizes[0] = n
		return 1, nil
	}
	pkt := tun.ep.ReadContext(tun.ctx)
	if pkt == nil {
		return 0, os.ErrClosed
	}
	n := 0
	for pkt != nil {
		view := pkt.ToView()
		pkt.DecRef()
		size, err := view.Read(buf[n][offset:])
		view.Release()
		if err != nil {
			return n, err
		}
		sizes[n] = size
		n++
		if n == len(buf) {
			break
		}
		pkt = tun.ep.Read()
	}
	return n, nil
}

func (tun *netTun) Write(buf [][]byte, offset int) (int, error) {
	for _, buf := range buf {
		packet := buf[offset:]
		if len(packet) == 0 {
			continue
		}

		pkb := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(packet)})
		switch packet[0] >> 4 {
		case 4:
			tun.ep.InjectInbound(header.IPv4ProtocolNumber, pkb)
		case 6:
			tun.ep.InjectInbound(header.IPv6ProtocolNumber, pkb)
		default:
			pkb.DecRef()
			return 0, syscall.EAFNOSUPPORT
		}
		pkb.DecRef()
	}
	return len(buf), nil
}

func (tun *netTun) WriteNotify() {
	pkt := tun.ep.Read()
	if pkt == nil {
		return
	}

	view := pkt.ToView()
	pkt.DecRef()

	// (closed meanwhile: dropped, rather than sent on a closed channel as wireguard-go's can)
	select {
	case tun.incomingPacket <- view:
	case <-tun.ctx.Done():
		view.Release()
	}
}

func (tun *netTun) Close() error {
	tun.cancel()
	tun.stack.RemoveNIC(1)
	tun.stack.Close()
	if tun.notifyHandle != nil {
		tun.ep.RemoveNotify(tun.notifyHandle)
	}
	tun.ep.Close()

	if tun.events != nil {
		close(tun.events)
	}

	return nil
}

func (tun *netTun) MTU() (int, error) {
	return tun.mtu, nil
}

func (tun *netTun) BatchSize() int {
	return tun.opts.Batch
}

func convertToFullAddr(endpoint netip.AddrPort) (tcpip.FullAddress, tcpip.NetworkProtocolNumber) {
	var protoNumber tcpip.NetworkProtocolNumber
	if endpoint.Addr().Is4() {
		protoNumber = ipv4.ProtocolNumber
	} else {
		protoNumber = ipv6.ProtocolNumber
	}
	return tcpip.FullAddress{
		NIC:  1,
		Addr: tcpip.AddrFromSlice(endpoint.Addr().AsSlice()),
		Port: endpoint.Port(),
	}, protoNumber
}

func (net *Net) DialContextTCPAddrPort(ctx context.Context, addr netip.AddrPort) (*gonet.TCPConn, error) {
	fa, pn := convertToFullAddr(addr)
	return gonet.DialContextTCP(ctx, net.stack, fa, pn)
}

func (net *Net) DialUDPAddrPort(laddr, raddr netip.AddrPort) (*gonet.UDPConn, error) {
	var lfa, rfa *tcpip.FullAddress
	var pn tcpip.NetworkProtocolNumber
	if laddr.IsValid() || laddr.Port() > 0 {
		var addr tcpip.FullAddress
		addr, pn = convertToFullAddr(laddr)
		lfa = &addr
	}
	if raddr.IsValid() || raddr.Port() > 0 {
		var addr tcpip.FullAddress
		addr, pn = convertToFullAddr(raddr)
		rfa = &addr
	}
	return gonet.DialUDP(net.stack, lfa, rfa, pn)
}

var (
	errNoSuchHost                   = errors.New("no such host")
	errLameReferral                 = errors.New("lame referral")
	errCannotUnmarshalDNSMessage    = errors.New("cannot unmarshal DNS message")
	errCannotMarshalDNSMessage      = errors.New("cannot marshal DNS message")
	errServerMisbehaving            = errors.New("server misbehaving")
	errInvalidDNSResponse           = errors.New("invalid DNS response")
	errNoAnswerFromDNSServer        = errors.New("no answer from DNS server")
	errServerTemporarilyMisbehaving = errors.New("server misbehaving")
	errCanceled                     = errors.New("operation was canceled")
	errTimeout                      = errors.New("i/o timeout")
	errNumericPort                  = errors.New("port must be numeric")
	errNoSuitableAddress            = errors.New("no suitable address found")
	errMissingAddress               = errors.New("missing address")
)

func isDomainName(s string) bool {
	l := len(s)
	if l == 0 || l > 254 || l == 254 && s[l-1] != '.' {
		return false
	}
	last := byte('.')
	nonNumeric := false
	partlen := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		default:
			return false
		case 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || c == '_':
			nonNumeric = true
			partlen++
		case '0' <= c && c <= '9':
			partlen++
		case c == '-':
			if last == '.' {
				return false
			}
			partlen++
			nonNumeric = true
		case c == '.':
			if last == '.' || last == '-' {
				return false
			}
			if partlen > 63 || partlen == 0 {
				return false
			}
			partlen = 0
		}
		last = c
	}
	if last == '-' || partlen > 63 {
		return false
	}
	return nonNumeric
}

func randU16() uint16 {
	var b [2]byte
	_, err := rand.Read(b[:])
	if err != nil {
		panic(err)
	}
	return binary.LittleEndian.Uint16(b[:])
}

func newRequest(q dnsmessage.Question) (id uint16, udpReq, tcpReq []byte, err error) {
	id = randU16()
	b := dnsmessage.NewBuilder(make([]byte, 2, 514), dnsmessage.Header{ID: id, RecursionDesired: true})
	b.EnableCompression()
	if err := b.StartQuestions(); err != nil {
		return 0, nil, nil, err
	}
	if err := b.Question(q); err != nil {
		return 0, nil, nil, err
	}
	tcpReq, err = b.Finish()
	udpReq = tcpReq[2:]
	l := len(tcpReq) - 2
	tcpReq[0] = byte(l >> 8)
	tcpReq[1] = byte(l)
	return id, udpReq, tcpReq, err
}

func equalASCIIName(x, y dnsmessage.Name) bool {
	if x.Length != y.Length {
		return false
	}
	for i := 0; i < int(x.Length); i++ {
		a := x.Data[i]
		b := y.Data[i]
		if 'A' <= a && a <= 'Z' {
			a += 0x20
		}
		if 'A' <= b && b <= 'Z' {
			b += 0x20
		}
		if a != b {
			return false
		}
	}
	return true
}

func checkResponse(reqID uint16, reqQues dnsmessage.Question, respHdr dnsmessage.Header, respQues dnsmessage.Question) bool {
	if !respHdr.Response {
		return false
	}
	if reqID != respHdr.ID {
		return false
	}
	if reqQues.Type != respQues.Type || reqQues.Class != respQues.Class || !equalASCIIName(reqQues.Name, respQues.Name) {
		return false
	}
	return true
}

func dnsPacketRoundTrip(c net.Conn, id uint16, query dnsmessage.Question, b []byte) (dnsmessage.Parser, dnsmessage.Header, error) {
	if _, err := c.Write(b); err != nil {
		return dnsmessage.Parser{}, dnsmessage.Header{}, err
	}
	b = make([]byte, 512)
	for {
		n, err := c.Read(b)
		if err != nil {
			return dnsmessage.Parser{}, dnsmessage.Header{}, err
		}
		var p dnsmessage.Parser
		h, err := p.Start(b[:n])
		if err != nil {
			continue
		}
		q, err := p.Question()
		if err != nil || !checkResponse(id, query, h, q) {
			continue
		}
		return p, h, nil
	}
}

func dnsStreamRoundTrip(c net.Conn, id uint16, query dnsmessage.Question, b []byte) (dnsmessage.Parser, dnsmessage.Header, error) {
	if _, err := c.Write(b); err != nil {
		return dnsmessage.Parser{}, dnsmessage.Header{}, err
	}
	b = make([]byte, 1280)
	if _, err := io.ReadFull(c, b[:2]); err != nil {
		return dnsmessage.Parser{}, dnsmessage.Header{}, err
	}
	l := int(b[0])<<8 | int(b[1])
	if l > len(b) {
		b = make([]byte, l)
	}
	n, err := io.ReadFull(c, b[:l])
	if err != nil {
		return dnsmessage.Parser{}, dnsmessage.Header{}, err
	}
	var p dnsmessage.Parser
	h, err := p.Start(b[:n])
	if err != nil {
		return dnsmessage.Parser{}, dnsmessage.Header{}, errCannotUnmarshalDNSMessage
	}
	q, err := p.Question()
	if err != nil {
		return dnsmessage.Parser{}, dnsmessage.Header{}, errCannotUnmarshalDNSMessage
	}
	if !checkResponse(id, query, h, q) {
		return dnsmessage.Parser{}, dnsmessage.Header{}, errInvalidDNSResponse
	}
	return p, h, nil
}

func (tnet *Net) exchange(ctx context.Context, server netip.Addr, q dnsmessage.Question, timeout time.Duration) (dnsmessage.Parser, dnsmessage.Header, error) {
	q.Class = dnsmessage.ClassINET
	id, udpReq, tcpReq, err := newRequest(q)
	if err != nil {
		return dnsmessage.Parser{}, dnsmessage.Header{}, errCannotMarshalDNSMessage
	}

	for _, useUDP := range []bool{true, false} {
		ctx, cancel := context.WithDeadline(ctx, time.Now().Add(timeout))
		defer cancel()

		var c net.Conn
		var err error
		if useUDP {
			c, err = tnet.DialUDPAddrPort(netip.AddrPort{}, netip.AddrPortFrom(server, 53))
		} else {
			c, err = tnet.DialContextTCPAddrPort(ctx, netip.AddrPortFrom(server, 53))
		}

		if err != nil {
			return dnsmessage.Parser{}, dnsmessage.Header{}, err
		}
		if d, ok := ctx.Deadline(); ok && !d.IsZero() {
			err := c.SetDeadline(d)
			if err != nil {
				return dnsmessage.Parser{}, dnsmessage.Header{}, err
			}
		}
		var p dnsmessage.Parser
		var h dnsmessage.Header
		if useUDP {
			p, h, err = dnsPacketRoundTrip(c, id, q, udpReq)
		} else {
			p, h, err = dnsStreamRoundTrip(c, id, q, tcpReq)
		}
		c.Close()
		if err != nil {
			if err == context.Canceled {
				err = errCanceled
			} else if err == context.DeadlineExceeded {
				err = errTimeout
			}
			return dnsmessage.Parser{}, dnsmessage.Header{}, err
		}
		if err := p.SkipQuestion(); err != dnsmessage.ErrSectionDone {
			return dnsmessage.Parser{}, dnsmessage.Header{}, errInvalidDNSResponse
		}
		if h.Truncated {
			continue
		}
		return p, h, nil
	}
	return dnsmessage.Parser{}, dnsmessage.Header{}, errNoAnswerFromDNSServer
}

func checkHeader(p *dnsmessage.Parser, h dnsmessage.Header) error {
	if h.RCode == dnsmessage.RCodeNameError {
		return errNoSuchHost
	}
	_, err := p.AnswerHeader()
	if err != nil && err != dnsmessage.ErrSectionDone {
		return errCannotUnmarshalDNSMessage
	}
	if h.RCode == dnsmessage.RCodeSuccess && !h.Authoritative && !h.RecursionAvailable && err == dnsmessage.ErrSectionDone {
		return errLameReferral
	}
	if h.RCode != dnsmessage.RCodeSuccess && h.RCode != dnsmessage.RCodeNameError {
		if h.RCode == dnsmessage.RCodeServerFailure {
			return errServerTemporarilyMisbehaving
		}
		return errServerMisbehaving
	}
	return nil
}

func skipToAnswer(p *dnsmessage.Parser, qtype dnsmessage.Type) error {
	for {
		h, err := p.AnswerHeader()
		if err == dnsmessage.ErrSectionDone {
			return errNoSuchHost
		}
		if err != nil {
			return errCannotUnmarshalDNSMessage
		}
		if h.Type == qtype {
			return nil
		}
		if err := p.SkipAnswer(); err != nil {
			return errCannotUnmarshalDNSMessage
		}
	}
}

// One name of one type (A or AAAA) asked of the tunnel's DNS servers. wireguard-go asks them one after another
// and waits 5 s for each; here the next is asked too when one hasn't answered in DNSStagger, and the first good
// answer is used.
func (tnet *Net) tryOneName(ctx context.Context, name string, qtype dnsmessage.Type) (dnsmessage.Parser, string, error) {
	n, err := dnsmessage.NewName(name)
	if err != nil {
		return dnsmessage.Parser{}, "", errCannotMarshalDNSMessage
	}
	q := dnsmessage.Question{
		Name:  n,
		Type:  qtype,
		Class: dnsmessage.ClassINET,
	}
	if len(tnet.dnsServers) == 0 {
		return dnsmessage.Parser{}, "", &net.DNSError{Err: errNoAnswerFromDNSServer.Error(), Name: name}
	}
	stagger := tnet.opts.DNSStagger
	tries := 2 * len(tnet.dnsServers)
	if stagger <= 0 {
		stagger = time.Hour // one at a time, as wireguard-go does
	}
	type answer struct {
		p      dnsmessage.Parser
		h      dnsmessage.Header
		server string
		err    error
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	answers := make(chan answer, tries)
	asked, waiting := 0, 0
	ask := func() {
		server := tnet.dnsServers[asked%len(tnet.dnsServers)]
		asked++
		waiting++
		go func() {
			p, h, err := tnet.exchange(ctx, server, q, time.Second*5)
			answers <- answer{p, h, server.String(), err}
		}()
	}
	ask()
	timer := time.NewTimer(stagger)
	defer timer.Stop()
	var lastErr error
	for waiting > 0 {
		select {
		case <-ctx.Done():
			return dnsmessage.Parser{}, "", &net.DNSError{Err: errCanceled.Error(), Name: name, IsTimeout: true}
		case <-timer.C:
			if asked < tries {
				ask()
				timer.Reset(stagger)
			}
			continue
		case a := <-answers:
			waiting--
			p, h, err := a.p, a.h, a.err
			if err == nil {
				err = checkHeader(&p, h)
				if err == nil {
					if err = skipToAnswer(&p, qtype); err == nil {
						return p, a.server, nil
					}
				}
				if err == errNoSuchHost {
					return p, a.server, &net.DNSError{Err: err.Error(), Name: name, Server: a.server, IsNotFound: true}
				}
			}
			dnsErr := &net.DNSError{Err: err.Error(), Name: name, Server: a.server}
			if nerr, ok := err.(net.Error); ok && nerr.Timeout() {
				dnsErr.IsTimeout = true
			}
			if _, ok := err.(*net.OpError); ok || err == errServerTemporarilyMisbehaving {
				dnsErr.IsTemporary = true
			}
			lastErr = dnsErr
			// (that one's done with: the next now, rather than when the wait's up)
			if asked < tries && waiting == 0 {
				ask()
				timer.Reset(stagger)
			}
		}
	}
	return dnsmessage.Parser{}, "", lastErr
}

// The addresses for a name, and how long they may be kept (the shortest TTL among them).
func (tnet *Net) lookup(ctx context.Context, host string) ([]string, time.Duration, error) {
	type result struct {
		p      dnsmessage.Parser
		server string
		error
	}
	var addrsV4, addrsV6 []netip.Addr
	lanes := 0
	if tnet.hasV4 {
		lanes++
	}
	if tnet.hasV6 {
		lanes++
	}
	lane := make(chan result, lanes)
	var lastErr error
	if tnet.hasV4 {
		go func() {
			p, server, err := tnet.tryOneName(ctx, host+".", dnsmessage.TypeA)
			lane <- result{p, server, err}
		}()
	}
	if tnet.hasV6 {
		go func() {
			p, server, err := tnet.tryOneName(ctx, host+".", dnsmessage.TypeAAAA)
			lane <- result{p, server, err}
		}()
	}
	ttl := uint32(0)
	for l := 0; l < lanes; l++ {
		result := <-lane
		if result.error != nil {
			if lastErr == nil {
				lastErr = result.error
			}
			continue
		}

	loop:
		for {
			h, err := result.p.AnswerHeader()
			if err != nil && err != dnsmessage.ErrSectionDone {
				lastErr = &net.DNSError{
					Err:    errCannotMarshalDNSMessage.Error(),
					Name:   host,
					Server: result.server,
				}
			}
			if err != nil {
				break
			}
			switch h.Type {
			case dnsmessage.TypeA:
				a, err := result.p.AResource()
				if err != nil {
					lastErr = &net.DNSError{
						Err:    errCannotMarshalDNSMessage.Error(),
						Name:   host,
						Server: result.server,
					}
					break loop
				}
				addrsV4 = append(addrsV4, netip.AddrFrom4(a.A))

			case dnsmessage.TypeAAAA:
				aaaa, err := result.p.AAAAResource()
				if err != nil {
					lastErr = &net.DNSError{
						Err:    errCannotMarshalDNSMessage.Error(),
						Name:   host,
						Server: result.server,
					}
					break loop
				}
				addrsV6 = append(addrsV6, netip.AddrFrom16(aaaa.AAAA))

			default:
				if err := result.p.SkipAnswer(); err != nil {
					lastErr = &net.DNSError{
						Err:    errCannotMarshalDNSMessage.Error(),
						Name:   host,
						Server: result.server,
					}
					break loop
				}
				continue
			}
			if ttl == 0 || h.TTL < ttl {
				ttl = h.TTL
			}
		}
	}
	// We don't do RFC6724. Instead just put V6 addresses first if an IPv6 address is enabled
	var addrs []netip.Addr
	if tnet.hasV6 && !tnet.opts.V4First {
		addrs = append(addrsV6, addrsV4...)
	} else {
		addrs = append(addrsV4, addrsV6...)
	}

	if len(addrs) == 0 && lastErr != nil {
		return nil, 0, lastErr
	}
	saddrs := make([]string, 0, len(addrs))
	for _, ip := range addrs {
		saddrs = append(saddrs, ip.String())
	}
	return saddrs, time.Duration(ttl) * time.Second, nil
}

const (
	dnsKeepMin = 15 * time.Second
	dnsKeepMax = 5 * time.Minute
)

func (tnet *Net) LookupContextHost(ctx context.Context, host string) ([]string, error) {
	if host == "" || (!tnet.hasV6 && !tnet.hasV4) {
		return nil, &net.DNSError{Err: errNoSuchHost.Error(), Name: host, IsNotFound: true}
	}
	zlen := len(host)
	if strings.IndexByte(host, ':') != -1 {
		if zidx := strings.LastIndexByte(host, '%'); zidx != -1 {
			zlen = zidx
		}
	}
	if ip, err := netip.ParseAddr(host[:zlen]); err == nil {
		return []string{ip.String()}, nil
	}

	if !isDomainName(host) {
		return nil, &net.DNSError{Err: errNoSuchHost.Error(), Name: host, IsNotFound: true}
	}
	if !tnet.opts.DNSCache {
		addrs, _, err := tnet.lookup(ctx, host)
		return addrs, err
	}

	// Kept, or being looked up for someone else already: that. Otherwise looked up, for everyone who asks in the
	// meantime (not for this one only: it may go before the answer comes, the others not).
	key := strings.ToLower(strings.TrimSuffix(host, "."))
	now := time.Now()
	tnet.dnsMu.Lock()
	if e, ok := tnet.dnsCache[key]; ok && now.Before(e.expires) {
		tnet.dnsMu.Unlock()
		return e.addrs, nil
	}
	call, ok := tnet.dnsFlight[key]
	if !ok {
		call = &dnsCall{done: make(chan struct{})}
		tnet.dnsFlight[key] = call
		go func() {
			lctx, cancel := context.WithTimeout(tnet.ctx, 20*time.Second)
			addrs, ttl, err := tnet.lookup(lctx, host)
			cancel()
			tnet.dnsMu.Lock()
			delete(tnet.dnsFlight, key)
			if err == nil && len(addrs) > 0 {
				keep := min(max(ttl, dnsKeepMin), dnsKeepMax)
				if len(tnet.dnsCache) >= tnet.opts.DNSCacheMax {
					at := time.Now()
					for k, e := range tnet.dnsCache {
						if !at.Before(e.expires) {
							delete(tnet.dnsCache, k)
						}
					}
					// (still full of names in date: any one goes)
					for k := range tnet.dnsCache {
						if len(tnet.dnsCache) < tnet.opts.DNSCacheMax {
							break
						}
						delete(tnet.dnsCache, k)
					}
				}
				tnet.dnsCache[key] = dnsEntry{addrs, time.Now().Add(keep)}
			}
			call.addrs, call.err = addrs, err
			tnet.dnsMu.Unlock()
			close(call.done)
		}()
	}
	tnet.dnsMu.Unlock()
	select {
	case <-call.done:
		return call.addrs, call.err
	case <-ctx.Done():
		return nil, &net.DNSError{Err: errTimeout.Error(), Name: host, IsTimeout: true}
	}
}

// Forgets every name looked up (after the tunnel's moved, say).
func (tnet *Net) ForgetNames() {
	tnet.dnsMu.Lock()
	clear(tnet.dnsCache)
	tnet.dnsMu.Unlock()
}

func partialDeadline(now, deadline time.Time, addrsRemaining int) (time.Time, error) {
	if deadline.IsZero() {
		return deadline, nil
	}
	timeRemaining := deadline.Sub(now)
	if timeRemaining <= 0 {
		return time.Time{}, errTimeout
	}
	timeout := timeRemaining / time.Duration(addrsRemaining)
	const saneMinimum = 2 * time.Second
	if timeout < saneMinimum {
		if timeRemaining < saneMinimum {
			timeout = timeRemaining
		} else {
			timeout = saneMinimum
		}
	}
	return now.Add(timeout), nil
}

// A TCP connection through the tunnel to host:port, the name looked up with the tunnel's DNS. Its addresses are
// tried in turn; with HappyAfter, the first of the other kind (IPv4 or IPv6) is tried as well once the first
// hasn't connected by then, and whichever connects first is used.
func (tnet *Net) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if ctx == nil {
		panic("nil context")
	}
	acceptV4, acceptV6 := true, true
	switch network {
	case "tcp":
	case "tcp4":
		acceptV6 = false
	case "tcp6":
		acceptV4 = false
	default:
		return nil, &net.OpError{Op: "dial", Err: net.UnknownNetworkError(network)}
	}
	host, sport, err := net.SplitHostPort(address)
	if err != nil {
		return nil, &net.OpError{Op: "dial", Err: err}
	}
	port, err := strconv.Atoi(sport)
	if err != nil || port < 0 || port > 65535 {
		return nil, &net.OpError{Op: "dial", Err: errNumericPort}
	}
	allAddr, err := tnet.LookupContextHost(ctx, host)
	if err != nil {
		return nil, &net.OpError{Op: "dial", Err: err}
	}
	var addrs []netip.AddrPort
	for _, addr := range allAddr {
		ip, err := netip.ParseAddr(addr)
		if err == nil && ((ip.Is4() && acceptV4) || (ip.Is6() && acceptV6)) {
			addrs = append(addrs, netip.AddrPortFrom(ip, uint16(port)))
		}
	}
	if len(addrs) == 0 && len(allAddr) != 0 {
		return nil, &net.OpError{Op: "dial", Err: errNoSuitableAddress}
	}
	if len(addrs) == 0 {
		return nil, &net.OpError{Op: "dial", Err: errMissingAddress}
	}

	// The first kind's addresses, and the other's (tried alongside after HappyAfter).
	var primary, secondary []netip.AddrPort
	for _, a := range addrs {
		if a.Addr().Is4() == addrs[0].Addr().Is4() {
			primary = append(primary, a)
		} else {
			secondary = append(secondary, a)
		}
	}
	if tnet.opts.HappyAfter <= 0 || len(secondary) == 0 {
		return tnet.dialEach(ctx, addrs)
	}
	type dialed struct {
		c   net.Conn
		err error
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan dialed, 2)
	go func() {
		c, err := tnet.dialEach(ctx, primary)
		results <- dialed{c, err}
	}()
	started := 1
	timer := time.NewTimer(tnet.opts.HappyAfter)
	defer timer.Stop()
	startOther := func() {
		if started == 1 {
			started = 2
			go func() {
				c, err := tnet.dialEach(ctx, secondary)
				results <- dialed{c, err}
			}()
		}
	}
	var firstErr error
	for got := 0; got < started; {
		select {
		case <-timer.C:
			startOther()
		case r := <-results:
			got++
			if r.err == nil {
				// (the other one, if it connects too, isn't wanted)
				cancel()
				if got < started {
					go func() {
						if l := <-results; l.c != nil {
							l.c.Close()
						}
					}()
				}
				return r.c, nil
			}
			if firstErr == nil {
				firstErr = r.err
			}
			startOther()
		}
	}
	return nil, firstErr
}

func (tnet *Net) dialEach(ctx context.Context, addrs []netip.AddrPort) (net.Conn, error) {
	var firstErr error
	for i, addr := range addrs {
		select {
		case <-ctx.Done():
			err := ctx.Err()
			if err == context.Canceled {
				err = errCanceled
			} else if err == context.DeadlineExceeded {
				err = errTimeout
			}
			return nil, &net.OpError{Op: "dial", Err: err}
		default:
		}

		dialCtx := ctx
		if deadline, hasDeadline := ctx.Deadline(); hasDeadline {
			partialDeadline, err := partialDeadline(time.Now(), deadline, len(addrs)-i)
			if err != nil {
				if firstErr == nil {
					firstErr = &net.OpError{Op: "dial", Err: err}
				}
				break
			}
			if partialDeadline.Before(deadline) {
				var cancel context.CancelFunc
				dialCtx, cancel = context.WithDeadline(ctx, partialDeadline)
				defer cancel()
			}
		}

		c, err := tnet.DialContextTCPAddrPort(dialCtx, addr)
		if err == nil {
			return c, nil
		}
		if firstErr == nil {
			firstErr = err
		}
	}
	if firstErr == nil {
		firstErr = &net.OpError{Op: "dial", Err: errMissingAddress}
	}
	return nil, firstErr
}

func (tnet *Net) Dial(network, address string) (net.Conn, error) {
	return tnet.DialContext(context.Background(), network, address)
}
