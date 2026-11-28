package main

// Scratch branch only: BIFROST_VPN_EXP (a,b,...) turns tuning.go's settings off, for tools/vpn/bench.mjs to compare:
// -norack, -recv8, -batch, -dns (the DNS cache, staggered servers and IPv4 tried too), or stock (wireguard-go's).

import (
	"os"
	"strings"

	"bifrost/vpn/netstack"
)

func init() {
	for _, k := range strings.Split(os.Getenv("BIFROST_VPN_EXP"), ",") {
		switch strings.TrimSpace(k) {
		case "-norack":
			stackOptions.NoRACK = false
		case "-recv8":
			stackOptions.RecvMax = 0
		case "-batch":
			stackOptions.Batch = 0
		case "-dns":
			stackOptions.DNSCache, stackOptions.DNSStagger, stackOptions.HappyAfter = false, 0, 0
		case "stock":
			stackOptions = netstack.Options{}
		}
	}
}
