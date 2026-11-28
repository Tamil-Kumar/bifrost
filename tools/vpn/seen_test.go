package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const sampleTrace = `fl=12f34
h=www.cloudflare.com
ip=156.146.62.5
ts=1764300000.123
visit_scheme=https
uag=bifrost-vpn/dev
colo=NRT
sliver=none
http=http/1.1
loc=jp
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519MLKEM768
`

func TestParseTrace(t *testing.T) {
	s, err := parseTrace(sampleTrace)
	if err != nil {
		t.Fatal(err)
	}
	if s.IP != "156.146.62.5" || s.Loc != "JP" || s.Colo != "NRT" || s.Warp != "off" {
		t.Fatalf("%+v", s)
	}
	for _, bad := range []string{"", "<html>blocked</html>", "ip=1.2.3.4\nloc=XYZ\n"} {
		if _, err := parseTrace(bad); err == nil {
			t.Fatalf("%q: no error", bad)
		}
	}
}

// (the dialer the tunnel's would be: here, straight to the test server whatever name it's asked for)
type toServer struct{ addr string }

func (d toServer) DialContext(ctx context.Context, network, _ string) (net.Conn, error) {
	var nd net.Dialer
	return nd.DialContext(ctx, network, d.addr)
}

func TestTraceThroughDialer(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cdn-cgi/trace" {
			http.NotFound(w, r)
			return
		}
		fmt.Fprint(w, sampleTrace)
	}))
	defer srv.Close()
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	roots := &tls.Config{RootCAs: pool, ServerName: "example.com"}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s, err := trace(ctx, toServer{srv.Listener.Addr().String()}, "https://www.cloudflare.com/cdn-cgi/trace", roots)
	if err != nil {
		t.Fatal(err)
	}
	if s.Loc != "JP" || s.IP != "156.146.62.5" {
		t.Fatalf("%+v", s)
	}
	// (a page that isn't the trace page: an error, not a country)
	if _, err := trace(ctx, toServer{srv.Listener.Addr().String()}, "https://www.cloudflare.com/elsewhere", roots); err == nil {
		t.Fatal("a 404 taken for a trace")
	}
}
