package netstack

// Two of these stacks wired to each other (what one sends, the other gets: no WireGuard in between), one with a
// web server and a DNS server, the other dialing it as Bifrost's proxy does.

import (
	"context"
	"io"
	"net"
	"net/netip"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
)

type pair struct {
	client, server *Net
	dropV6         atomic.Bool  // IPv6 packets lost on the way
	dropDNS        atomic.Int32 // DNS questions to lose
	questions      atomic.Int32 // DNS questions answered
	delay          time.Duration
	stop           func()
}

var (
	clientV4 = netip.MustParseAddr("10.9.0.1")
	serverV4 = netip.MustParseAddr("10.9.0.2")
	clientV6 = netip.MustParseAddr("fd00:9::1")
	serverV6 = netip.MustParseAddr("fd00:9::2")
)

func newPair(t testing.TB, o Options, delay time.Duration) *pair {
	t.Helper()
	cdev, cnet, err := CreateNetTUN([]netip.Addr{clientV4, clientV6}, []netip.Addr{serverV4}, 1280, o)
	if err != nil {
		t.Fatal(err)
	}
	sdev, snet, err := CreateNetTUN([]netip.Addr{serverV4, serverV6}, nil, 1280, Options{Batch: 32, RecvMax: 8 << 20, SendMax: 8 << 20})
	if err != nil {
		t.Fatal(err)
	}
	p := &pair{client: cnet, server: snet, delay: delay}
	var wg sync.WaitGroup
	done := make(chan struct{})
	carry := func(from, to interface {
		Read([][]byte, []int, int) (int, error)
		Write([][]byte, int) (int, error)
		BatchSize() int
	}) {
		defer wg.Done()
		n := from.BatchSize()
		bufs := make([][]byte, n)
		for i := range bufs {
			bufs[i] = make([]byte, 2048)
		}
		sizes := make([]int, n)
		// (delayed: in order, each when its time comes)
		type delayed struct {
			at   time.Time
			pkts [][]byte
		}
		later := make(chan delayed, 1<<16)
		if p.delay > 0 {
			go func() {
				for {
					select {
					case <-done:
						return
					case d := <-later:
						time.Sleep(time.Until(d.at))
						select {
						case <-done:
							return
						default:
							to.Write(d.pkts, 0)
						}
					}
				}
			}()
		}
		for {
			got, err := from.Read(bufs, sizes, 0)
			if err != nil {
				return
			}
			var out [][]byte
			for i := 0; i < got; i++ {
				pkt := bufs[i][:sizes[i]]
				if pkt[0]>>4 == 6 && p.dropV6.Load() {
					continue
				}
				out = append(out, append([]byte(nil), pkt...))
			}
			if len(out) == 0 {
				continue
			}
			if p.delay > 0 {
				later <- delayed{time.Now().Add(p.delay), out}
			} else {
				to.Write(out, 0)
			}
		}
	}
	wg.Add(2)
	go carry(cdev, sdev)
	go carry(sdev, cdev)

	// test.example: the server's addresses (TTL 60 s); gone.example: no such name.
	dns, err := gonet.DialUDP(snet.stack, &tcpip.FullAddress{NIC: 1, Addr: tcpip.AddrFromSlice(serverV4.AsSlice()), Port: 53}, nil, ipv4.ProtocolNumber)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		b := make([]byte, 1500)
		for {
			n, from, err := dns.ReadFrom(b)
			if err != nil {
				return
			}
			var m dnsmessage.Message
			if m.Unpack(b[:n]) != nil || len(m.Questions) != 1 {
				continue
			}
			if p.dropDNS.Add(-1) >= 0 {
				continue
			}
			p.questions.Add(1)
			q := m.Questions[0]
			m.Header.Response, m.Header.RecursionAvailable = true, true
			h := dnsmessage.ResourceHeader{Name: q.Name, Type: q.Type, Class: dnsmessage.ClassINET, TTL: 60}
			switch {
			case q.Name.String() != "test.example.":
				m.Header.RCode = dnsmessage.RCodeNameError
			case q.Type == dnsmessage.TypeA:
				m.Answers = []dnsmessage.Resource{{Header: h, Body: &dnsmessage.AResource{A: serverV4.As4()}}}
			case q.Type == dnsmessage.TypeAAAA:
				m.Answers = []dnsmessage.Resource{{Header: h, Body: &dnsmessage.AAAAResource{AAAA: serverV6.As16()}}}
			}
			out, _ := m.Pack()
			dns.WriteTo(out, from)
		}
	}()

	// :80 sends 8 bytes of length and that many bytes back; :81 echoes.
	for _, port := range []uint16{80, 81} {
		for _, ip := range []netip.Addr{serverV4, serverV6} {
			fa, pn := convertToFullAddr(netip.AddrPortFrom(ip, port))
			ln, err := gonet.ListenTCP(snet.stack, fa, pn)
			if err != nil {
				t.Fatal(err)
			}
			go func(port uint16) {
				for {
					c, err := ln.Accept()
					if err != nil {
						return
					}
					go func() {
						defer c.Close()
						if port == 81 {
							io.Copy(c, c)
							return
						}
						var n [8]byte
						if _, err := io.ReadFull(c, n[:]); err != nil {
							return
						}
						left := int64(0)
						for _, x := range n {
							left = left<<8 | int64(x)
						}
						chunk := make([]byte, 64<<10)
						for left > 0 {
							k := min(left, int64(len(chunk)))
							if _, err := c.Write(chunk[:k]); err != nil {
								return
							}
							left -= k
						}
					}()
				}
			}(port)
			t.Cleanup(func() { ln.Close() })
		}
	}
	p.stop = func() {
		close(done)
		dns.Close()
		cdev.Close()
		sdev.Close()
		wg.Wait()
	}
	t.Cleanup(p.stop)
	return p
}

func fetch(t testing.TB, d *Net, host string, size int64) time.Duration {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	t0 := time.Now()
	c, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, "80"))
	if err != nil {
		t.Fatalf("dialing %s: %v", host, err)
	}
	defer c.Close()
	var n [8]byte
	for i := range n {
		n[i] = byte(size >> (56 - 8*i))
	}
	c.Write(n[:])
	got, err := io.Copy(io.Discard, c)
	if err != nil || got != size {
		t.Fatalf("%s: %d bytes of %d (%v)", host, got, size, err)
	}
	return time.Since(t0)
}

var tuned = Options{NoRACK: true, RecvMax: 8 << 20, SendMax: 6 << 20, Batch: 32, Queue: 4096, DNSCache: true,
	DNSStagger: 500 * time.Millisecond, HappyAfter: 300 * time.Millisecond}

func TestFetches(t *testing.T) {
	for name, o := range map[string]Options{"as wireguard-go": {}, "tuned": tuned} {
		t.Run(name, func(t *testing.T) {
			p := newPair(t, o, 0)
			fetch(t, p.client, "test.example", 20<<20)
			fetch(t, p.client, serverV4.String(), 1<<20)
			fetch(t, p.client, serverV6.String(), 1<<20)
			// (many at once)
			var wg sync.WaitGroup
			for i := 0; i < 20; i++ {
				wg.Add(1)
				go func() { defer wg.Done(); fetch(t, p.client, "test.example", 2<<20) }()
			}
			wg.Wait()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if _, err := p.client.DialContext(ctx, "tcp", "gone.example:80"); err == nil {
				t.Fatal("gone.example: connected")
			} else if dnsErr := new(net.DNSError); !asDNS(err, dnsErr) || !dnsErr.IsNotFound {
				t.Fatalf("gone.example: %v (not \"no such host\")", err)
			}
		})
	}
}

func asDNS(err error, out *net.DNSError) bool {
	for err != nil {
		if d, ok := err.(*net.DNSError); ok {
			*out = *d
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}

func TestEcho(t *testing.T) {
	p := newPair(t, tuned, 0)
	c, err := p.client.DialContext(context.Background(), "tcp", "test.example:81")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	msg := make([]byte, 3<<20)
	for i := range msg {
		msg[i] = byte(i * 7)
	}
	go c.Write(msg)
	back := make([]byte, len(msg))
	if _, err := io.ReadFull(c, back); err != nil {
		t.Fatal(err)
	}
	for i := range msg {
		if back[i] != msg[i] {
			t.Fatalf("byte %d came back as %d, not %d", i, back[i], msg[i])
		}
	}
}

func TestNamesKept(t *testing.T) {
	p := newPair(t, tuned, 0)
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); fetch(t, p.client, "test.example", 1000) }()
	}
	wg.Wait()
	fetch(t, p.client, "TEST.example", 1000)
	if q := p.questions.Load(); q != 2 {
		t.Fatalf("%d DNS questions for 11 connections (2: A and AAAA, once)", q)
	}
	p.client.ForgetNames()
	fetch(t, p.client, "test.example", 1000)
	if q := p.questions.Load(); q != 4 {
		t.Fatalf("%d DNS questions after forgetting (4)", q)
	}

	plain := newPair(t, Options{}, 0)
	fetch(t, plain.client, "test.example", 1000)
	fetch(t, plain.client, "test.example", 1000)
	if q := plain.questions.Load(); q != 4 {
		t.Fatalf("not kept: %d DNS questions for 2 connections (4)", q)
	}
}

func TestSlowDNS(t *testing.T) {
	p := newPair(t, tuned, 0)
	p.dropDNS.Store(2) // (the first A and AAAA questions lost)
	if d := fetch(t, p.client, "test.example", 1000); d > 2500*time.Millisecond {
		t.Fatalf("%v with the first questions lost (asked again after 0.5 s: about 0.5 s)", d)
	}
}

func TestIPv6Lost(t *testing.T) {
	p := newPair(t, tuned, 0)
	p.dropV6.Store(true)
	if d := fetch(t, p.client, "test.example", 1000); d > 2*time.Second {
		t.Fatalf("%v with IPv6 lost (IPv4 tried after 0.3 s)", d)
	}
}

func TestBatches(t *testing.T) {
	cdev, _, err := CreateNetTUN([]netip.Addr{clientV4}, nil, 1280, Options{Batch: 8})
	if err != nil {
		t.Fatal(err)
	}
	if cdev.BatchSize() != 8 {
		t.Fatalf("batch %d", cdev.BatchSize())
	}
	// (closed while waiting for a packet: Read ends)
	done := make(chan error)
	go func() {
		bufs := [][]byte{make([]byte, 2048)}
		_, err := cdev.Read(bufs, []int{0}, 0)
		done <- err
	}()
	time.Sleep(100 * time.Millisecond)
	cdev.Close()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Read after Close: no error")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Read still waiting after Close")
	}
}

// go test -bench . -benchtime 3x ./netstack: how fast a download goes through the stack, at 0 and 50 ms away.
func BenchmarkDownload(b *testing.B) {
	for _, delay := range []time.Duration{0, 50 * time.Millisecond} {
		for name, o := range map[string]Options{"as-wireguard-go": {}, "tuned": tuned} {
			b.Run(name+"/"+delay.String(), func(b *testing.B) {
				p := newPair(b, o, delay)
				const size = 64 << 20
				b.SetBytes(size)
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					fetch(b, p.client, serverV4.String(), size)
				}
			})
		}
	}
}
