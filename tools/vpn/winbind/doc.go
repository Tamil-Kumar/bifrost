// Package winbind is wireguard-go's Windows UDP bind (registered I/O, conn.WinRingBind; golang.zx2c4.com/wireguard,
// MIT) with packets taken in and sent out in batches: up to Batch received packets handed over at once, the
// receive requests put back and the sends made with one call to the kernel for the lot, where wireguard-go's does
// one packet, and one call, at a time ("TODO: implement batching in and out of the ring"). Windows only.
package winbind
