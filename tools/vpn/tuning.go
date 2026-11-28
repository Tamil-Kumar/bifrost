package main

import (
	"time"

	"bifrost/vpn/netstack"
)

// How the tunnel's network stack is set up (netstack.Options; the zero value is wireguard-go's own). Measured on
// GitHub's Windows machines through Cloudflare WARP with tools/vpn/bench.mjs, each setting on and off, against
// wireguard-go's: what's here made it faster there; what didn't (packets handed to WireGuard in batches, a
// batching Windows UDP bind, bigger copies, an MTU of 1420, the garbage collector run less) isn't.
var stackOptions = netstack.Options{
	// Uploads 10 times faster or more (27 → 380 Mbit/s): gVisor's RACK loss detection resends and slows down when
	// it needn't (Tailscale's netstack has it off too: tailscale/tailscale#21946).
	NoRACK: true,
	// Downloads up to 70% faster, for less processor time: a connection's receive buffer can grow to 8 MB
	// (gVisor: 4 MB; Tailscale's grows to 8 too), so a fast server, or a faraway one, can get further ahead.
	RecvMax: 8 << 20,
	// A name looked up once for all the connections a page opens to it, and kept for its TTL (15 s to 5 min):
	// a connection to a site already open, a lookup's round trip sooner.
	DNSCache: true,
	// The next DNS server asked too when one hasn't answered in half a second (wireguard-go waits 5 s).
	DNSStagger: 500 * time.Millisecond,
	// A site's IPv4 address tried as well when IPv6 hasn't connected in 0.3 s (a network or a VPN where IPv6
	// doesn't get through: wireguard-go waits for it to time out).
	HappyAfter: 300 * time.Millisecond,
}
