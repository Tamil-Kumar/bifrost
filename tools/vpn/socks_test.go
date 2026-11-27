package main

import (
	"context"
	"encoding/binary"
	"io"
	"net"
	"strconv"
	"testing"
	"time"
)

// (the tunnel stood in for by the machine's own network; names it doesn't know refused)
type direct struct{ dialed []string }

func (d *direct) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	d.dialed = append(d.dialed, address)
	var nd net.Dialer
	return nd.DialContext(ctx, network, address)
}

func socksConnect(t *testing.T, proxy string, host string, port int) (net.Conn, byte) {
	c, err := net.Dial("tcp", proxy)
	if err != nil {
		t.Fatal(err)
	}
	c.SetDeadline(time.Now().Add(5 * time.Second))
	c.Write([]byte{5, 1, 0})
	r := make([]byte, 2)
	if _, err := io.ReadFull(c, r); err != nil || r[1] != 0 {
		t.Fatalf("method: %v %v", r, err)
	}
	req := []byte{5, 1, 0, 3, byte(len(host))}
	req = append(req, host...)
	req = binary.BigEndian.AppendUint16(req, uint16(port))
	c.Write(req)
	rep := make([]byte, 10)
	if _, err := io.ReadFull(c, rep); err != nil {
		t.Fatalf("reply: %v", err)
	}
	return c, rep[1]
}

func TestSocks(t *testing.T) {
	// an echo server, upper-casing nothing: what it reads, back, then its end of writing
	echo, _ := net.Listen("tcp", "127.0.0.1:0")
	go func() {
		for {
			c, err := echo.Accept()
			if err != nil {
				return
			}
			go func() { io.Copy(c, c); c.(*net.TCPConn).CloseWrite() }()
		}
	}()
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	d := &direct{}
	go serveSocks(ln, d)
	port := echo.Addr().(*net.TCPAddr).Port
	c, code := socksConnect(t, ln.Addr().String(), "localhost", port)
	if code != 0 {
		t.Fatalf("connect: %d", code)
	}
	c.Write([]byte("hello through the tunnel"))
	c.(*net.TCPConn).CloseWrite()
	got, _ := io.ReadAll(c)
	if string(got) != "hello through the tunnel" {
		t.Fatalf("got %q", got)
	}
	if len(d.dialed) != 1 || d.dialed[0] != net.JoinHostPort("localhost", strconv.Itoa(port)) {
		t.Fatalf("dialed %v (the name should go to the tunnel as it is)", d.dialed)
	}
	// nothing listening: refused
	free, _ := net.Listen("tcp", "127.0.0.1:0")
	fp := free.Addr().(*net.TCPAddr).Port
	free.Close()
	if _, code := socksConnect(t, ln.Addr().String(), "127.0.0.1", fp); code != 5 {
		t.Fatalf("refused: %d", code)
	}
	// only "no authentication"
	c2, _ := net.Dial("tcp", ln.Addr().String())
	c2.Write([]byte{5, 1, 2})
	r := make([]byte, 2)
	io.ReadFull(c2, r)
	if r[1] != 0xff {
		t.Fatalf("auth: %v", r)
	}
}
