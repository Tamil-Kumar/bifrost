package main

import (
	"strings"
	"testing"
)

const proton = `[Interface]
# Key for Bifrost
# Bouncing = 8
PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=
Address = 10.2.0.2/32
DNS = 10.2.0.1

[Peer]
# NL-FREE#1
PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=
AllowedIPs = 0.0.0.0/0
Endpoint = 185.107.56.1:51820
`

func TestProtonFile(t *testing.T) {
	c, err := parseConf(proton)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.addresses) != 1 || c.addresses[0].String() != "10.2.0.2/32" {
		t.Fatalf("addresses %v", c.addresses)
	}
	if len(c.dns) != 1 || c.dns[0].String() != "10.2.0.1" || c.mtu != 1420 {
		t.Fatalf("dns %v mtu %d", c.dns, c.mtu)
	}
	if len(c.peers) != 1 || c.peers[0].endpoint != "185.107.56.1:51820" || len(c.peers[0].allowedIPs) != 1 {
		t.Fatalf("peers %+v", c.peers)
	}
	u := c.uapi([]string{"185.107.56.1:51820"})
	for _, want := range []string{"private_key=c809f3e5317e95", "public_key=c5320103", "endpoint=185.107.56.1:51820", "persistent_keepalive_interval=25", "allowed_ip=0.0.0.0/0"} {
		if !strings.Contains(u, want) {
			t.Fatalf("uapi lacks %q:\n%s", want, u)
		}
	}
}

func TestWarpStyle(t *testing.T) {
	c, err := parseConf("[Interface]\r\nPrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\r\nAddress = 172.16.0.2/32, 2606:4700:110:8a36::1/128\r\nDNS = 1.1.1.1, 1.0.0.1, 2606:4700:4700::1111\r\nMTU = 1280\r\n[Peer]\r\nPublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=\r\nEndpoint = engage.cloudflareclient.com:2408\r\nPersistentKeepalive = 15\r\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(c.addresses) != 2 || c.mtu != 1280 || len(c.dns) != 3 {
		t.Fatalf("%+v", c)
	}
	// (no AllowedIPs: everything)
	if len(c.peers[0].allowedIPs) != 2 || c.peers[0].keepalive != 15 {
		t.Fatalf("%+v", c.peers[0])
	}
	if !strings.Contains(c.uapi([]string{"162.159.192.1:2408"}), "persistent_keepalive_interval=15") {
		t.Fatal("keepalive")
	}
}

func TestBadFiles(t *testing.T) {
	for _, bad := range []string{
		"",
		"[Interface]\nAddress = 10.0.0.2/32\n[Peer]\nPublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\nEndpoint = 1.2.3.4:5\n",
		"[Interface]\nPrivateKey = nope\nAddress = 10.0.0.2/32\n",
		"[Interface]\nPrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\nAddress = 10.0.0.2/32\n",
		"[Interface]\nPrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\nAddress = 10.0.0.2/32\n[Peer]\nPublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\n",
		"just some text",
	} {
		if _, err := parseConf(bad); err == nil {
			t.Fatalf("took %q", bad)
		}
	}
}
