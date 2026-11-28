package main

import (
	"time"

	"bifrost/vpn/netstack"
)

// How the tunnel's network stack is set up (netstack.Options; the zero value is wireguard-go's own). Measured on
// Windows through Cloudflare WARP with tools/vpn/bench.mjs, against wireguard-go's: what's here made a difference,
// or is there for networks and servers that need it; what made none there (bigger copies, a batching Windows UDP
// bind, a bigger MTU, the garbage collector run less) isn't. (Downloads through WARP topped out at 300-500 Mbit/s
// with all of them alike, the helper mostly waiting for packets and none dropped: that limit isn't the helper's.)
var stackOptions = netstack.Options{
	// Uploads several times faster: gVisor's RACK loss detection resends and slows down when it needn't
	// (Tailscale's netstack has it off too: tailscale/tailscale#21946).
	NoRACK: true,
	// A download's receive buffer can grow to 8 MB (gVisor: 4 MB; Tailscale's grows to 8 too): how far ahead a
	// fast, faraway server can get.
	RecvMax: 8 << 20,
	// Packets handed to WireGuard as many at a time as are waiting, not one by one.
	Batch: 32,
	// A name looked up once for all the connections a page opens to it, and kept for its TTL (15 s to 5 min):
	// a connection to a site already open, a lookup's round trip sooner.
	DNSCache: true,
	// The next DNS server asked too when one hasn't answered in half a second (wireguard-go waits 5 s).
	DNSStagger: 500 * time.Millisecond,
	// A site's IPv4 address tried as well when IPv6 hasn't connected in 0.3 s (a network or a VPN where IPv6
	// doesn't get through: wireguard-go waits for it to time out).
	HappyAfter: 300 * time.Millisecond,
}
