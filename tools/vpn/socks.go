package main

// A SOCKS5 proxy on 127.0.0.1 whose connections go through the tunnel: what Bifrost points its browsing at
// (Chromium sends it names, not addresses, so names are looked up in the tunnel too, with the tunnel's DNS).
// CONNECT only: Chromium uses nothing else through a SOCKS proxy.

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

type dialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

func serveSocks(ln net.Listener, d dialer) {
	for {
		c, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			time.Sleep(50 * time.Millisecond)
			continue
		}
		go handleSocks(c, d)
	}
}

func reply(c net.Conn, code byte) {
	// (the bound address isn't used by Chromium: 0.0.0.0:0)
	c.Write([]byte{5, code, 0, 1, 0, 0, 0, 0, 0, 0})
}

func handleSocks(c net.Conn, d dialer) {
	defer func() {
		if r := recover(); r != nil {
			c.Close()
		}
	}()
	c.SetDeadline(time.Now().Add(30 * time.Second))
	head := make([]byte, 2)
	if _, err := io.ReadFull(c, head); err != nil || head[0] != 5 {
		c.Close()
		return
	}
	methods := make([]byte, int(head[1]))
	if _, err := io.ReadFull(c, methods); err != nil {
		c.Close()
		return
	}
	ok := false
	for _, m := range methods {
		if m == 0 {
			ok = true
		}
	}
	if !ok {
		c.Write([]byte{5, 0xff})
		c.Close()
		return
	}
	c.Write([]byte{5, 0})
	req := make([]byte, 4)
	if _, err := io.ReadFull(c, req); err != nil || req[0] != 5 {
		c.Close()
		return
	}
	if req[1] != 1 {
		reply(c, 7) // command not supported
		c.Close()
		return
	}
	var host string
	switch req[3] {
	case 1:
		b := make([]byte, 4)
		if _, err := io.ReadFull(c, b); err != nil {
			c.Close()
			return
		}
		host = net.IP(b).String()
	case 4:
		b := make([]byte, 16)
		if _, err := io.ReadFull(c, b); err != nil {
			c.Close()
			return
		}
		host = net.IP(b).String()
	case 3:
		n := make([]byte, 1)
		if _, err := io.ReadFull(c, n); err != nil {
			c.Close()
			return
		}
		b := make([]byte, int(n[0]))
		if _, err := io.ReadFull(c, b); err != nil {
			c.Close()
			return
		}
		host = string(b)
	default:
		reply(c, 8) // address type not supported
		c.Close()
		return
	}
	pb := make([]byte, 2)
	if _, err := io.ReadFull(c, pb); err != nil {
		c.Close()
		return
	}
	port := binary.BigEndian.Uint16(pb)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	remote, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(int(port))))
	cancel()
	if err != nil {
		reply(c, failure(err))
		c.Close()
		return
	}
	reply(c, 0)
	c.SetDeadline(time.Time{})
	pipe(c, remote)
}

func failure(err error) byte {
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "refused"):
		return 5
	case strings.Contains(s, "no such host"), strings.Contains(s, "no route"), strings.Contains(s, "unreachable"):
		return 4
	case strings.Contains(s, "timeout"), strings.Contains(s, "deadline"):
		return 4
	}
	return 1
}

type closeWriter interface{ CloseWrite() error }

// Both ways until both are done; each side's end of writing passed on to the other.
func pipe(a, b net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)
	half := func(dst, src net.Conn) {
		defer wg.Done()
		// (bigger pieces than io.Copy's 32 KB: fewer trips through the network stack; the types hidden, so
		// neither side's ReadFrom or WriteTo takes over with its own 32 KB)
		buf := make([]byte, copyBuffer)
		io.CopyBuffer(struct{ io.Writer }{dst}, struct{ io.Reader }{src}, buf)
		if cw, ok := dst.(closeWriter); ok {
			cw.CloseWrite()
		} else {
			dst.Close()
		}
	}
	go half(a, b)
	go half(b, a)
	wg.Wait()
	a.Close()
	b.Close()
}
