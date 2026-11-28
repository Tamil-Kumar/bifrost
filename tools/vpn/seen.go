package main

// Where sites see you through the tunnel: Cloudflare's trace page (cdn-cgi/trace: the address it was asked from,
// that address's country, Cloudflare's data center, whether it came through WARP) fetched through it. run says
// so once the tunnel's up ({"seen": ...}); probe tries a configuration on its own (a file just added: does it
// answer, and where does it put you) and says so.

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
)

const traceURL = "https://www.cloudflare.com/cdn-cgi/trace"

type seenAt struct {
	IP   string `json:"ip"`
	Loc  string `json:"loc"`  // the address's country (ISO 3166 code), as Cloudflare has it
	Colo string `json:"colo"` // Cloudflare's data center that answered (an airport's code)
	Warp string `json:"warp"` // on: through Cloudflare WARP
}

// The trace page's "name=value" lines.
func parseTrace(body string) (seenAt, error) {
	var s seenAt
	sc := bufio.NewScanner(strings.NewReader(body))
	for sc.Scan() {
		k, v, ok := strings.Cut(strings.TrimSpace(sc.Text()), "=")
		if !ok {
			continue
		}
		switch k {
		case "ip":
			s.IP = v
		case "loc":
			s.Loc = strings.ToUpper(v)
		case "colo":
			s.Colo = v
		case "warp":
			s.Warp = v
		}
	}
	if s.IP == "" || len(s.Loc) != 2 {
		return s, fmt.Errorf("not a trace page")
	}
	return s, nil
}

// The trace page, fetched with d (the tunnel's dialer; roots: the system's).
func trace(ctx context.Context, d dialer, url string, roots *tls.Config) (seenAt, error) {
	tr := &http.Transport{
		DialContext:         d.DialContext,
		TLSClientConfig:     roots,
		TLSHandshakeTimeout: 8 * time.Second,
		DisableKeepAlives:   true,
	}
	defer tr.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return seenAt{}, err
	}
	req.Header.Set("User-Agent", "bifrost-vpn/"+version)
	res, err := (&http.Client{Transport: tr}).Do(req)
	if err != nil {
		return seenAt{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return seenAt{}, fmt.Errorf("the trace page answered %s", res.Status)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 8<<10))
	if err != nil {
		return seenAt{}, err
	}
	return parseTrace(string(b))
}

// Once there's been a handshake: where sites see you, said ({"seen": ...}); tried 3 times. Nothing said if it
// can't be found out (the tunnel itself is what counts).
func sayWhereSeen(d dialer, dev *device.Device) {
	if !waitHandshake(dev, 20*time.Second, 100*time.Millisecond) {
		return
	}
	for i, wait := range []time.Duration{0, 3 * time.Second, 10 * time.Second} {
		time.Sleep(wait)
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		s, err := trace(ctx, d, traceURL, nil)
		cancel()
		if err == nil {
			say(map[string]any{"seen": s})
			return
		}
		if i == 2 {
			fmt.Fprintln(os.Stderr, "where sites see you: "+err.Error())
		}
	}
}

// Whether the tunnel's had a handshake within that long (looked at every so often).
func waitHandshake(dev *device.Device, within, every time.Duration) bool {
	end := time.Now().Add(within)
	for time.Now().Before(end) {
		if hs, _, _ := stats(dev); hs > 0 {
			return true
		}
		time.Sleep(every)
	}
	return false
}

// probe: a configuration tried on its own, no proxy: its endpoint, how long its handshake took (ms), and where
// sites see you through it; or why not ({"error"}).
func probe(text string) {
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
	tdev, tnet, err := createTUN(c.localAddrs(), c.dns, c.mtu)
	if err != nil {
		fail(fmt.Errorf("the tunnel: %w", err))
	}
	logger := &device.Logger{Verbosef: func(string, ...any) {}, Errorf: func(string, ...any) {}}
	dev := device.NewDevice(tdev, conn.NewDefaultBind(), logger)
	defer dev.Close()
	if err := dev.IpcSet(c.uapi(resolved)); err != nil {
		fail(fmt.Errorf("the tunnel's settings: %w", err))
	}
	t0 := time.Now()
	if err := dev.Up(); err != nil {
		fail(fmt.Errorf("starting the tunnel: %w", err))
	}
	// (a handshake's asked for by sending something: the trace page's connection does)
	got := make(chan seenAt, 1)
	failed := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		s, err := trace(ctx, tnet, traceURL, nil)
		if err != nil {
			failed <- err
			return
		}
		got <- s
	}()
	if !waitHandshake(dev, 8*time.Second, 10*time.Millisecond) {
		fail(fmt.Errorf("no answer from %s", resolved[0]))
	}
	ms := time.Since(t0).Milliseconds()
	select {
	case s := <-got:
		say(map[string]any{"seen": s, "ms": ms, "endpoint": resolved[0]})
	case err := <-failed:
		say(map[string]any{"ms": ms, "endpoint": resolved[0], "warning": "connected, but where sites see you couldn't be found out: " + err.Error()})
	}
}
