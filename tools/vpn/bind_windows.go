package main

import "bifrost/vpn/winbind"

// On Windows, WireGuard's packets go in and out in batches (winbind).
func init() { newBind = winbind.New }
