package main

// Experiment build only: Windows' own settings (tuning.go).

import (
	"strconv"
	"strings"

	"golang.zx2c4.com/wireguard/conn"

	"bifrost/vpn/winbind"
)

// (true: the batching bind, so set)
func platformKnob(k string) bool {
	switch {
	case k == "std":
		newBind = conn.NewStdNetBind
		stdBind = true
	case strings.HasPrefix(k, "rx="):
		n, _ := strconv.Atoi(k[3:])
		winbind.RxPackets = uint32(n)
		return true
	case strings.HasPrefix(k, "sockbuf="):
		winbind.SocketBuffer, _ = strconv.Atoi(k[8:])
		return true
	}
	return false
}

var stdBind bool
