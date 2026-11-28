/* SPDX-License-Identifier: MIT
 *
 * Copyright (C) 2017-2025 WireGuard LLC. All Rights Reserved.
 */

package winbind

import (
	"encoding/binary"
	"io"
	"net"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"unsafe"

	"golang.org/x/sys/windows"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/conn/winrio"
)

// Packets handed over, and sent, at once at most.
const Batch = 64

// Receive requests kept posted (wireguard-go: 1024; a power of two), and the socket's own buffers (wireguard-go
// gives its other binds 7 MB; this one, the system's default): room for a burst of packets that come faster
// than they're taken.
var (
	RxPackets    uint32 = 2048
	SocketBuffer        = 7 << 20
)

const (
	packetsPerRing = 1024
	bytesPerPacket = 2048 - 32
	receiveSpins   = 15
)

type ringPacket struct {
	addr WinRingEndpoint
	data [bytesPerPacket]byte
}

type ringBuffer struct {
	size       uint32
	packets    uintptr
	head, tail uint32
	id         winrio.BufferId
	iocp       windows.Handle
	isFull     bool
	cq         winrio.Cq
	mu         sync.Mutex
	overlapped windows.Overlapped
}

func (rb *ringBuffer) Push() *ringPacket {
	for rb.isFull {
		panic("ring is full")
	}
	ret := (*ringPacket)(unsafe.Pointer(rb.packets + (uintptr(rb.tail%rb.size) * unsafe.Sizeof(ringPacket{}))))
	rb.tail += 1
	if rb.tail%rb.size == rb.head%rb.size {
		rb.isFull = true
	}
	return ret
}

func (rb *ringBuffer) Return(count uint32) {
	if rb.head%rb.size == rb.tail%rb.size && !rb.isFull {
		return
	}
	rb.head += count
	rb.isFull = false
}

type afWinRingBind struct {
	sock      windows.Handle
	rx, tx    ringBuffer
	rq        winrio.Rq
	mu        sync.Mutex
	blackhole bool
}

// WinRingBind uses Windows registered I/O for fast ring buffered networking.
type WinRingBind struct {
	v4, v6 afWinRingBind
	mu     sync.RWMutex
	isOpen atomic.Uint32 // 0, 1, or 2
}

// The batching bind; wireguard-go's own (one packet at a time, through Go's sockets) where registered I/O isn't
// there.
func New() conn.Bind {
	if !winrio.Initialize() {
		return conn.NewStdNetBind()
	}
	return new(WinRingBind)
}

type WinRingEndpoint struct {
	family uint16
	data   [30]byte
}

var (
	_ conn.Bind     = (*WinRingBind)(nil)
	_ conn.Endpoint = (*WinRingEndpoint)(nil)
)

func (*WinRingBind) ParseEndpoint(s string) (conn.Endpoint, error) {
	host, port, err := net.SplitHostPort(s)
	if err != nil {
		return nil, err
	}
	host16, err := windows.UTF16PtrFromString(host)
	if err != nil {
		return nil, err
	}
	port16, err := windows.UTF16PtrFromString(port)
	if err != nil {
		return nil, err
	}
	hints := windows.AddrinfoW{
		Flags:    windows.AI_NUMERICHOST,
		Family:   windows.AF_UNSPEC,
		Socktype: windows.SOCK_DGRAM,
		Protocol: windows.IPPROTO_UDP,
	}
	var addrinfo *windows.AddrinfoW
	err = windows.GetAddrInfoW(host16, port16, &hints, &addrinfo)
	if err != nil {
		return nil, err
	}
	defer windows.FreeAddrInfoW(addrinfo)
	if (addrinfo.Family != windows.AF_INET && addrinfo.Family != windows.AF_INET6) || addrinfo.Addrlen > unsafe.Sizeof(WinRingEndpoint{}) {
		return nil, windows.ERROR_INVALID_ADDRESS
	}
	var dst [unsafe.Sizeof(WinRingEndpoint{})]byte
	copy(dst[:], unsafe.Slice((*byte)(unsafe.Pointer(addrinfo.Addr)), addrinfo.Addrlen))
	return (*WinRingEndpoint)(unsafe.Pointer(&dst[0])), nil
}

func (*WinRingEndpoint) ClearSrc() {}

func (e *WinRingEndpoint) DstIP() netip.Addr {
	switch e.family {
	case windows.AF_INET:
		return netip.AddrFrom4(*(*[4]byte)(e.data[2:6]))
	case windows.AF_INET6:
		return netip.AddrFrom16(*(*[16]byte)(e.data[6:22]))
	}
	return netip.Addr{}
}

func (e *WinRingEndpoint) SrcIP() netip.Addr {
	return netip.Addr{} // not supported
}

func (e *WinRingEndpoint) DstToBytes() []byte {
	switch e.family {
	case windows.AF_INET:
		b := make([]byte, 0, 6)
		b = append(b, e.data[2:6]...)
		b = append(b, e.data[1], e.data[0])
		return b
	case windows.AF_INET6:
		b := make([]byte, 0, 18)
		b = append(b, e.data[6:22]...)
		b = append(b, e.data[1], e.data[0])
		return b
	}
	return nil
}

func (e *WinRingEndpoint) DstToString() string {
	switch e.family {
	case windows.AF_INET:
		return netip.AddrPortFrom(netip.AddrFrom4(*(*[4]byte)(e.data[2:6])), binary.BigEndian.Uint16(e.data[0:2])).String()
	case windows.AF_INET6:
		var zone string
		if scope := *(*uint32)(unsafe.Pointer(&e.data[22])); scope > 0 {
			zone = strconv.FormatUint(uint64(scope), 10)
		}
		return netip.AddrPortFrom(netip.AddrFrom16(*(*[16]byte)(e.data[6:22])).WithZone(zone), binary.BigEndian.Uint16(e.data[0:2])).String()
	}
	return ""
}

func (e *WinRingEndpoint) SrcToString() string {
	return ""
}

func (ring *ringBuffer) CloseAndZero() {
	if ring.cq != 0 {
		winrio.CloseCompletionQueue(ring.cq)
		ring.cq = 0
	}
	if ring.iocp != 0 {
		windows.CloseHandle(ring.iocp)
		ring.iocp = 0
	}
	if ring.id != 0 {
		winrio.DeregisterBuffer(ring.id)
		ring.id = 0
	}
	if ring.packets != 0 {
		windows.VirtualFree(ring.packets, 0, windows.MEM_RELEASE)
		ring.packets = 0
	}
	ring.head = 0
	ring.tail = 0
	ring.isFull = false
}

func (bind *afWinRingBind) CloseAndZero() {
	bind.rx.CloseAndZero()
	bind.tx.CloseAndZero()
	if bind.sock != 0 {
		windows.CloseHandle(bind.sock)
		bind.sock = 0
	}
	bind.blackhole = false
}

func (bind *WinRingBind) closeAndZero() {
	bind.isOpen.Store(0)
	bind.v4.CloseAndZero()
	bind.v6.CloseAndZero()
}

func (ring *ringBuffer) Open(size uint32) error {
	var err error
	ring.size = size
	packetsLen := unsafe.Sizeof(ringPacket{}) * uintptr(size)
	ring.packets, err = windows.VirtualAlloc(0, packetsLen, windows.MEM_COMMIT|windows.MEM_RESERVE, windows.PAGE_READWRITE)
	if err != nil {
		return err
	}
	ring.id, err = winrio.RegisterPointer(unsafe.Pointer(ring.packets), uint32(packetsLen))
	if err != nil {
		return err
	}
	ring.iocp, err = windows.CreateIoCompletionPort(windows.InvalidHandle, 0, 0, 0)
	if err != nil {
		return err
	}
	ring.cq, err = winrio.CreateIOCPCompletionQueue(size, ring.iocp, 0, &ring.overlapped)
	if err != nil {
		return err
	}
	return nil
}

func (bind *afWinRingBind) Open(family int32, sa windows.Sockaddr) (windows.Sockaddr, error) {
	var err error
	bind.sock, err = winrio.Socket(family, windows.SOCK_DGRAM, windows.IPPROTO_UDP)
	if err != nil {
		return nil, err
	}
	if SocketBuffer > 0 {
		_ = windows.SetsockoptInt(bind.sock, windows.SOL_SOCKET, windows.SO_RCVBUF, SocketBuffer)
		_ = windows.SetsockoptInt(bind.sock, windows.SOL_SOCKET, windows.SO_SNDBUF, SocketBuffer)
	}
	err = bind.rx.Open(RxPackets)
	if err != nil {
		return nil, err
	}
	err = bind.tx.Open(packetsPerRing)
	if err != nil {
		return nil, err
	}
	bind.rq, err = winrio.CreateRequestQueue(bind.sock, RxPackets, 1, packetsPerRing, 1, bind.rx.cq, bind.tx.cq, 0)
	if err != nil {
		return nil, err
	}
	err = windows.Bind(bind.sock, sa)
	if err != nil {
		return nil, err
	}
	sa, err = windows.Getsockname(bind.sock)
	if err != nil {
		return nil, err
	}
	return sa, nil
}

func (bind *WinRingBind) Open(port uint16) (recvFns []conn.ReceiveFunc, selectedPort uint16, err error) {
	bind.mu.Lock()
	defer bind.mu.Unlock()
	defer func() {
		if err != nil {
			bind.closeAndZero()
		}
	}()
	if bind.isOpen.Load() != 0 {
		return nil, 0, conn.ErrBindAlreadyOpen
	}
	var sa windows.Sockaddr
	sa, err = bind.v4.Open(windows.AF_INET, &windows.SockaddrInet4{Port: int(port)})
	if err != nil {
		return nil, 0, err
	}
	sa, err = bind.v6.Open(windows.AF_INET6, &windows.SockaddrInet6{Port: sa.(*windows.SockaddrInet4).Port})
	if err != nil {
		return nil, 0, err
	}
	selectedPort = uint16(sa.(*windows.SockaddrInet6).Port)
	for i := uint32(0); i < RxPackets; i++ {
		flags := uint32(winrio.MsgDefer)
		if i == RxPackets-1 {
			flags = 0
		}
		err = bind.v4.InsertReceiveRequest(flags)
		if err != nil {
			return nil, 0, err
		}
		err = bind.v6.InsertReceiveRequest(flags)
		if err != nil {
			return nil, 0, err
		}
	}
	bind.isOpen.Store(1)
	return []conn.ReceiveFunc{bind.receiveIPv4, bind.receiveIPv6}, selectedPort, err
}

func (bind *WinRingBind) Close() error {
	bind.mu.RLock()
	if bind.isOpen.Load() != 1 {
		bind.mu.RUnlock()
		return nil
	}
	bind.isOpen.Store(2)
	windows.PostQueuedCompletionStatus(bind.v4.rx.iocp, 0, 0, nil)
	windows.PostQueuedCompletionStatus(bind.v4.tx.iocp, 0, 0, nil)
	windows.PostQueuedCompletionStatus(bind.v6.rx.iocp, 0, 0, nil)
	windows.PostQueuedCompletionStatus(bind.v6.tx.iocp, 0, 0, nil)
	bind.mu.RUnlock()
	bind.mu.Lock()
	defer bind.mu.Unlock()
	bind.closeAndZero()
	return nil
}

// TODO: When all Binds handle IdealBatchSize, remove this dynamic function and
// rename the IdealBatchSize constant to BatchSize.
func (bind *WinRingBind) BatchSize() int {
	return Batch
}

func (bind *WinRingBind) SetMark(mark uint32) error {
	return nil
}

// (flags: winrio.MsgDefer, when more are to come and the last will hand them all to the kernel)
func (bind *afWinRingBind) InsertReceiveRequest(flags uint32) error {
	packet := bind.rx.Push()
	dataBuffer := &winrio.Buffer{
		Id:     bind.rx.id,
		Offset: uint32(uintptr(unsafe.Pointer(&packet.data[0])) - bind.rx.packets),
		Length: uint32(len(packet.data)),
	}
	addressBuffer := &winrio.Buffer{
		Id:     bind.rx.id,
		Offset: uint32(uintptr(unsafe.Pointer(&packet.addr)) - bind.rx.packets),
		Length: uint32(unsafe.Sizeof(packet.addr)),
	}
	bind.mu.Lock()
	defer bind.mu.Unlock()
	return winrio.ReceiveEx(bind.rq, dataBuffer, 1, nil, addressBuffer, nil, nil, flags, uintptr(unsafe.Pointer(packet)))
}

//go:linkname procyield runtime.procyield
func procyield(cycles uint32)

// Up to len(bufs) (and Batch) packets that have come, waiting for the first; the receive requests they used put
// back, with one call to the kernel for them all.
func (bind *afWinRingBind) Receive(bufs [][]byte, sizes []int, eps []conn.Endpoint, isOpen *atomic.Uint32) (int, error) {
	if isOpen.Load() != 1 {
		return 0, net.ErrClosed
	}
	bind.rx.mu.Lock()
	defer bind.rx.mu.Unlock()

	var results [Batch]winrio.Result
	most := min(len(bufs), Batch)
	var err error
	var count uint32
retry:
	count = 0
	for tries := 0; count == 0 && tries < receiveSpins; tries++ {
		if tries > 0 {
			if isOpen.Load() != 1 {
				return 0, net.ErrClosed
			}
			procyield(1)
		}
		count = winrio.DequeueCompletion(bind.rx.cq, results[:most])
	}
	if count == 0 {
		err = winrio.Notify(bind.rx.cq)
		if err != nil {
			return 0, err
		}
		var bytes uint32
		var key uintptr
		var overlapped *windows.Overlapped
		err = windows.GetQueuedCompletionStatus(bind.rx.iocp, &bytes, &key, &overlapped, windows.INFINITE)
		if err != nil {
			return 0, err
		}
		if isOpen.Load() != 1 {
			return 0, net.ErrClosed
		}
		count = winrio.DequeueCompletion(bind.rx.cq, results[:most])
		if count == 0 {
			return 0, io.ErrNoProgress
		}
	}
	n := 0
	var firstErr error
	for i := uint32(0); i < count; i++ {
		r := results[i]
		packet := (*ringPacket)(unsafe.Pointer(uintptr(r.RequestContext)))
		switch {
		// We limit the MTU well below the 65k max for practicality, but this means a remote host can still send
		// us huge packets: those are left out.
		case windows.Errno(r.Status) == windows.WSAEMSGSIZE:
		case r.Status != 0:
			if firstErr == nil {
				firstErr = windows.Errno(r.Status)
			}
		default:
			sizes[n] = copy(bufs[n], packet.data[:r.BytesTransferred])
			ep := packet.addr
			eps[n] = &ep
			n++
		}
	}
	bind.rx.Return(count)
	for i := uint32(0); i < count; i++ {
		flags := uint32(winrio.MsgDefer)
		if i == count-1 {
			flags = 0
		}
		if err = bind.InsertReceiveRequest(flags); err != nil {
			return 0, err
		}
	}
	if n == 0 {
		if firstErr != nil {
			return 0, firstErr
		}
		if isOpen.Load() != 1 {
			return 0, net.ErrClosed
		}
		goto retry
	}
	return n, nil
}

func (bind *WinRingBind) receiveIPv4(bufs [][]byte, sizes []int, eps []conn.Endpoint) (int, error) {
	bind.mu.RLock()
	defer bind.mu.RUnlock()
	return bind.v4.Receive(bufs, sizes, eps, &bind.isOpen)
}

func (bind *WinRingBind) receiveIPv6(bufs [][]byte, sizes []int, eps []conn.Endpoint) (int, error) {
	bind.mu.RLock()
	defer bind.mu.RUnlock()
	return bind.v6.Receive(bufs, sizes, eps, &bind.isOpen)
}

// These packets to nend, each but the last put in the send queue for later (winrio.MsgDefer) and the last
// sending them all: one call to the kernel for the lot. Whatever's queued is sent before waiting for room in the
// ring, or giving up.
func (bind *afWinRingBind) Send(bufs [][]byte, nend *WinRingEndpoint, isOpen *atomic.Uint32) error {
	if isOpen.Load() != 1 {
		return net.ErrClosed
	}
	bind.tx.mu.Lock()
	defer bind.tx.mu.Unlock()
	deferred := false
	commit := func() error {
		if !deferred {
			return nil
		}
		deferred = false
		bind.mu.Lock()
		defer bind.mu.Unlock()
		return winrio.SendEx(bind.rq, nil, 0, nil, nil, nil, nil, winrio.MsgCommitOnly, 0)
	}
	var results [packetsPerRing]winrio.Result
	for i, buf := range bufs {
		if len(buf) > bytesPerPacket {
			commit()
			return io.ErrShortBuffer
		}
		count := winrio.DequeueCompletion(bind.tx.cq, results[:])
		if count == 0 && bind.tx.isFull {
			if err := commit(); err != nil {
				return err
			}
			err := winrio.Notify(bind.tx.cq)
			if err != nil {
				return err
			}
			var bytes uint32
			var key uintptr
			var overlapped *windows.Overlapped
			err = windows.GetQueuedCompletionStatus(bind.tx.iocp, &bytes, &key, &overlapped, windows.INFINITE)
			if err != nil {
				return err
			}
			if isOpen.Load() != 1 {
				return net.ErrClosed
			}
			count = winrio.DequeueCompletion(bind.tx.cq, results[:])
			if count == 0 {
				return io.ErrNoProgress
			}
		}
		if count > 0 {
			bind.tx.Return(count)
		}
		packet := bind.tx.Push()
		packet.addr = *nend
		copy(packet.data[:], buf)
		dataBuffer := &winrio.Buffer{
			Id:     bind.tx.id,
			Offset: uint32(uintptr(unsafe.Pointer(&packet.data[0])) - bind.tx.packets),
			Length: uint32(len(buf)),
		}
		addressBuffer := &winrio.Buffer{
			Id:     bind.tx.id,
			Offset: uint32(uintptr(unsafe.Pointer(&packet.addr)) - bind.tx.packets),
			Length: uint32(unsafe.Sizeof(packet.addr)),
		}
		flags := uint32(0)
		if i < len(bufs)-1 {
			flags = winrio.MsgDefer
		}
		bind.mu.Lock()
		err := winrio.SendEx(bind.rq, dataBuffer, 1, nil, addressBuffer, nil, nil, flags, 0)
		bind.mu.Unlock()
		if err != nil {
			commit()
			return err
		}
		deferred = flags != 0
	}
	return commit()
}

func (bind *WinRingBind) Send(bufs [][]byte, endpoint conn.Endpoint) error {
	nend, ok := endpoint.(*WinRingEndpoint)
	if !ok {
		return conn.ErrWrongEndpointType
	}
	bind.mu.RLock()
	defer bind.mu.RUnlock()
	switch nend.family {
	case windows.AF_INET:
		if bind.v4.blackhole {
			return nil
		}
		return bind.v4.Send(bufs, nend, &bind.isOpen)
	case windows.AF_INET6:
		if bind.v6.blackhole {
			return nil
		}
		return bind.v6.Send(bufs, nend, &bind.isOpen)
	}
	return nil
}

func (bind *WinRingBind) BindSocketToInterface4(interfaceIndex uint32, blackhole bool) error {
	bind.mu.RLock()
	defer bind.mu.RUnlock()
	if bind.isOpen.Load() != 1 {
		return net.ErrClosed
	}
	err := bindSocketToInterface4(bind.v4.sock, interfaceIndex)
	if err != nil {
		return err
	}
	bind.v4.blackhole = blackhole
	return nil
}

func (bind *WinRingBind) BindSocketToInterface6(interfaceIndex uint32, blackhole bool) error {
	bind.mu.RLock()
	defer bind.mu.RUnlock()
	if bind.isOpen.Load() != 1 {
		return net.ErrClosed
	}
	err := bindSocketToInterface6(bind.v6.sock, interfaceIndex)
	if err != nil {
		return err
	}
	bind.v6.blackhole = blackhole
	return nil
}

func bindSocketToInterface4(handle windows.Handle, interfaceIndex uint32) error {
	const IP_UNICAST_IF = 31
	/* MSDN says for IPv4 this needs to be in net byte order, so that it's like an IP address with leading zeros. */
	var bytes [4]byte
	binary.BigEndian.PutUint32(bytes[:], interfaceIndex)
	interfaceIndex = *(*uint32)(unsafe.Pointer(&bytes[0]))
	err := windows.SetsockoptInt(handle, windows.IPPROTO_IP, IP_UNICAST_IF, int(interfaceIndex))
	if err != nil {
		return err
	}
	return nil
}

func bindSocketToInterface6(handle windows.Handle, interfaceIndex uint32) error {
	const IPV6_UNICAST_IF = 31
	return windows.SetsockoptInt(handle, windows.IPPROTO_IPV6, IPV6_UNICAST_IF, int(interfaceIndex))
}
