package main

// Experiment build only (the scratch branch): how the tunnel's network stack is set up, from BIFROST_VPN_EXP
// (a,b,c), for tools/vpn/bench.mjs to compare.

import (
	"net/netip"
	"os"
	"runtime/debug"
	"runtime/pprof"
	"strconv"
	"strings"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/tun"
	wgnetstack "golang.zx2c4.com/wireguard/tun/netstack"

	"bifrost/vpn/netstack"
)

var stackOptions netstack.Options
var copyBuffer = 32 << 10

func init() {
	// (BIFROST_VPN_PROFILE=file: the processor's profile for its first BIFROST_VPN_PROFILE_SECS seconds)
	if f := os.Getenv("BIFROST_VPN_PROFILE"); f != "" {
		if out, err := os.Create(f); err == nil && pprof.StartCPUProfile(out) == nil {
			secs, _ := strconv.Atoi(os.Getenv("BIFROST_VPN_PROFILE_SECS"))
			go func() {
				time.Sleep(time.Duration(max(secs, 5)) * time.Second)
				pprof.StopCPUProfile()
				out.Close()
			}()
		}
	}
	mtu := 0
	stock := false
	batched := false
	for _, k := range strings.Split(os.Getenv("BIFROST_VPN_EXP"), ",") {
		switch {
		case k == "norack":
			stackOptions.NoRACK = true
		case k == "buf8":
			stackOptions.RecvMax, stackOptions.SendMax = 8<<20, 6<<20
		case k == "recv8":
			stackOptions.RecvMax = 8 << 20
		case k == "buf16":
			stackOptions.RecvMax, stackOptions.SendMax = 16<<20, 8<<20
		case k == "batch":
			stackOptions.Batch = 32
		case k == "q4096":
			stackOptions.Queue = 4096
		case k == "dns":
			stackOptions.DNSCache, stackOptions.DNSStagger = true, 500*time.Millisecond
		case k == "v4":
			stackOptions.V4First = true
		case k == "happy":
			stackOptions.HappyAfter = 300 * time.Millisecond
		case k == "copy":
			copyBuffer = 256 << 10
		case k == "gc":
			debug.SetGCPercent(400)
		case strings.HasPrefix(k, "mtu="):
			mtu, _ = strconv.Atoi(k[4:])
		case k == "stock":
			stock = true
		case k == "riobatch":
			batched = true
		default:
			if platformKnob(k) {
				batched = true
			}
		}
	}
	if !batched && !stdBind {
		newBind = conn.NewDefaultBind
	}
	inner := createTUN
	createTUN = func(addrs, dns []netip.Addr, m int) (tun.Device, dialer, error) {
		if mtu > 0 {
			m = mtu
		}
		if stock {
			return wgnetstack.CreateNetTUN(addrs, dns, m)
		}
		return inner(addrs, dns, m)
	}
}
