package winbind

// Two of these binds on this computer, sending each other packets in batches: every one arrives, intact, in
// batches; more than the rings hold at once, too; closing ends a receive that's waiting.

import (
	"bytes"
	"encoding/binary"
	"net"
	"strconv"
	"sync"
	"testing"
	"time"

	"golang.zx2c4.com/wireguard/conn"
)

func open(t *testing.T) (conn.Bind, []conn.ReceiveFunc, uint16) {
	t.Helper()
	b := New()
	if _, ok := b.(*WinRingBind); !ok {
		t.Skip("no registered I/O here")
	}
	fns, port, err := b.Open(0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close() })
	return b, fns, port
}

func packet(i, size int) []byte {
	p := bytes.Repeat([]byte{byte(i)}, size)
	binary.BigEndian.PutUint32(p, uint32(i))
	return p
}

func TestBatches(t *testing.T) {
	a, _, _ := open(t)
	b, fns, port := open(t)
	to, err := a.ParseEndpoint(net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port))))
	if err != nil {
		t.Fatal(err)
	}
	const total = 5000 // (more than either ring holds)
	got := make(chan []int, 1)
	go func() {
		seen := map[int]bool{}
		var batches []int
		bufs := make([][]byte, b.BatchSize())
		for i := range bufs {
			bufs[i] = make([]byte, 2048)
		}
		sizes := make([]int, len(bufs))
		eps := make([]conn.Endpoint, len(bufs))
		deadline := time.Now().Add(10 * time.Second)
		for len(seen) < total && time.Now().Before(deadline) {
			n, err := fns[0](bufs, sizes, eps)
			if err != nil {
				break
			}
			batches = append(batches, n)
			for j := 0; j < n; j++ {
				p := bufs[j][:sizes[j]]
				i := int(binary.BigEndian.Uint32(p))
				if !bytes.Equal(p, packet(i, 100+i%1200)) {
					t.Errorf("packet %d came wrong (%d bytes)", i, len(p))
				}
				if eps[j].DstToString() == "" {
					t.Errorf("packet %d: no sender", i)
				}
				seen[i] = true
			}
		}
		batches = append(batches, -len(seen))
		got <- batches
	}()
	// (sent in batches of 64, slowly enough that the receiver's not swamped: UDP may drop what it can't take)
	for i := 0; i < total; i += Batch {
		var out [][]byte
		for j := i; j < min(i+Batch, total); j++ {
			out = append(out, packet(j, 100+j%1200))
		}
		if err := a.Send(out, to); err != nil {
			t.Fatal(err)
		}
		time.Sleep(time.Millisecond)
	}
	var batches []int
	select {
	case batches = <-got:
	case <-time.After(15 * time.Second):
		t.Fatal("receiving never ended")
	}
	received := -batches[len(batches)-1]
	most := 0
	for _, n := range batches[:len(batches)-1] {
		most = max(most, n)
	}
	t.Logf("%d of %d packets, in %d batches (at most %d at once)", received, total, len(batches)-1, most)
	if received < total*99/100 {
		t.Fatalf("only %d of %d packets", received, total)
	}
	if most < 2 {
		t.Fatalf("never more than %d packet at once", most)
	}
}

func TestClose(t *testing.T) {
	b, fns, _ := open(t)
	var wg sync.WaitGroup
	errs := make(chan error, len(fns))
	for _, fn := range fns {
		wg.Add(1)
		go func(fn conn.ReceiveFunc) {
			defer wg.Done()
			bufs := [][]byte{make([]byte, 2048)}
			_, err := fn(bufs, []int{0}, make([]conn.Endpoint, 1))
			errs <- err
		}(fn)
	}
	time.Sleep(200 * time.Millisecond)
	b.Close()
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("a receive still waiting after Close")
	}
	for range fns {
		if err := <-errs; err == nil {
			t.Fatal("a receive ended without an error")
		}
	}
}
