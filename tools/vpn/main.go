// bifrost-vpn: Bifrost's VPN. A WireGuard tunnel in user space (wireguard-go with gVisor's network stack: no
// driver, no administrator rights), and a SOCKS5 proxy on 127.0.0.1 into it, which Bifrost points its
// browsing at. Started by Bifrost (src/main/vpn.js); one JSON object a line both ways.
//
//	bifrost-vpn run [--listen 127.0.0.1:port]
//	                         stdin: {"conf": "<a WireGuard configuration>"}, then kept open (closed: it stops)
//	                         stdout: {"listening": "127.0.0.1:port"} at once (connections then wait for the
//	                         tunnel), {"socks": "127.0.0.1:port", "endpoint": "ip:port"} once it's up, then
//	                         {"handshake": unix seconds, "rx": bytes, "tx": bytes} as they change
//	bifrost-vpn register     signs up for Cloudflare WARP; stdout: {"conf", "id", "token"}
//	bifrost-vpn unregister   stdin: {"id", "token"}; takes that sign-up off Cloudflare's list
//
// Errors: {"error": "..."} on stdout, exit 1.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"
)

var version = "dev"

func say(v any) {
	b, _ := json.Marshal(v)
	os.Stdout.Write(append(b, '\n'))
}

func fail(err error) {
	say(map[string]string{"error": err.Error()})
	os.Exit(1)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "bifrost-vpn "+version+": run | register | unregister")
		os.Exit(2)
	}
	in := bufio.NewReaderSize(os.Stdin, 1<<16)
	switch os.Args[1] {
	case "version":
		fmt.Println(version)
	case "register":
		r, err := register("PC")
		if err != nil {
			fail(err)
		}
		say(r)
	case "unregister":
		var a struct{ ID, Token string }
		line, _ := in.ReadString('\n')
		if err := json.Unmarshal([]byte(line), &a); err != nil || a.ID == "" {
			fail(fmt.Errorf("no sign-up given"))
		}
		if err := unregister(a.ID, a.Token); err != nil {
			fail(err)
		}
		say(map[string]bool{"ok": true})
	case "run":
		addr := "127.0.0.1:0"
		if len(os.Args) > 3 && os.Args[2] == "--listen" {
			addr = os.Args[3]
		}
		// (only ever on this computer's loopback)
		if h, _, err := net.SplitHostPort(addr); err != nil || (h != "127.0.0.1" && h != "::1") {
			fail(fmt.Errorf("--listen %s isn't on 127.0.0.1", addr))
		}
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			fail(fmt.Errorf("the proxy: %w", err))
		}
		say(map[string]string{"listening": ln.Addr().String()})
		var a struct{ Conf string }
		line, err := in.ReadString('\n')
		if err != nil && line == "" {
			fail(fmt.Errorf("no configuration given"))
		}
		if err := json.Unmarshal([]byte(line), &a); err != nil {
			fail(fmt.Errorf("the configuration: %w", err))
		}
		run(a.Conf, in, ln)
	default:
		fmt.Fprintln(os.Stderr, "bifrost-vpn: unknown command "+os.Args[1])
		os.Exit(2)
	}
}

// host:port written in the configuration, as an address wireguard-go can send to (IPv4 first: more networks
// have it).
func resolve(hostport string) (string, error) {
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		return "", fmt.Errorf("Endpoint %q isn't host:port", hostport)
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		return netip.AddrPortFrom(ip, mustPort(port)).String(), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return "", fmt.Errorf("can't find %s: %v", host, err)
	}
	best := ips[0]
	for _, ip := range ips {
		if ip.Unmap().Is4() {
			best = ip.Unmap()
			break
		}
	}
	return netip.AddrPortFrom(best, mustPort(port)).String(), nil
}

func mustPort(s string) uint16 {
	n, _ := strconv.Atoi(s)
	return uint16(n)
}

func run(text string, in *bufio.Reader, ln net.Listener) {
	// (connections that come before the tunnel's up wait for it)
	wait := &waiting{ready: make(chan struct{})}
	go serveSocks(ln, wait)
	c, err := parseConf(text)
	if err != nil {
		fail(err)
	}
	resolved := make([]string, len(c.peers))
	for i, p := range c.peers {
		if resolved[i], err = resolve(p.endpoint); err != nil {
			fail(err)
		}
	}
	tun, tnet, err := netstack.CreateNetTUN(c.localAddrs(), c.dns, c.mtu)
	if err != nil {
		fail(fmt.Errorf("the tunnel: %w", err))
	}
	logger := &device.Logger{
		Verbosef: func(string, ...any) {},
		Errorf:   func(f string, a ...any) { fmt.Fprintf(os.Stderr, "wireguard: "+f+"\n", a...) },
	}
	// (BIFROST_VPN_DEBUG=1: everything WireGuard does, on stderr)
	if os.Getenv("BIFROST_VPN_DEBUG") != "" {
		logger.Verbosef = func(f string, a ...any) { fmt.Fprintf(os.Stderr, "wireguard: "+f+"\n", a...) }
	}
	dev := device.NewDevice(tun, conn.NewDefaultBind(), logger)
	if err := dev.IpcSet(c.uapi(resolved)); err != nil {
		fail(fmt.Errorf("the tunnel's settings: %w", err))
	}
	if err := dev.Up(); err != nil {
		fail(fmt.Errorf("starting the tunnel: %w", err))
	}
	wait.d = tnet
	close(wait.ready)
	say(map[string]any{"socks": ln.Addr().String(), "endpoint": resolved[0], "version": version})

	// Bifrost gone (stdin closed): stop.
	go func() {
		buf := make([]byte, 256)
		for {
			if _, err := in.Read(buf); err != nil {
				ln.Close()
				dev.Close()
				os.Exit(0)
			}
		}
	}()

	var last [3]int64
	for i := 0; ; i++ {
		hs, rx, tx := stats(dev)
		if hs != last[0] || i%5 == 0 && (rx != last[1] || tx != last[2]) {
			say(map[string]int64{"handshake": hs, "rx": rx, "tx": tx})
			last = [3]int64{hs, rx, tx}
		}
		time.Sleep(2 * time.Second)
	}
}

// The tunnel, once it's up; until then, connections wait for it (20 s at most).
type waiting struct {
	ready chan struct{}
	d     dialer
}

func (w *waiting) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	select {
	case <-w.ready:
		return w.d.DialContext(ctx, network, address)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// The newest handshake (unix seconds; 0: none yet) and the bytes in and out, over every peer.
func stats(dev *device.Device) (hs, rx, tx int64) {
	s, err := dev.IpcGet()
	if err != nil {
		return
	}
	for _, line := range strings.Split(s, "\n") {
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		n, _ := strconv.ParseInt(v, 10, 64)
		switch k {
		case "last_handshake_time_sec":
			if n > hs {
				hs = n
			}
		case "rx_bytes":
			rx += n
		case "tx_bytes":
			tx += n
		}
	}
	return
}
