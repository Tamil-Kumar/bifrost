package main

// A WireGuard configuration file (wg-quick's format, as Proton VPN, Mullvad and others hand them out) read into
// what the tunnel needs, and what wireguard-go is told (its UAPI text).

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/netip"
	"strconv"
	"strings"
)

type peer struct {
	publicKey    []byte
	presharedKey []byte
	endpoint     string // host:port, as written
	allowedIPs   []netip.Prefix
	keepalive    int
}

type wgConf struct {
	privateKey []byte
	addresses  []netip.Prefix
	dns        []netip.Addr
	mtu        int
	peers      []peer
}

func key(s, what string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(s))
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("%s isn't a WireGuard key", what)
	}
	return b, nil
}

func list(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func parseConf(text string) (*wgConf, error) {
	c := &wgConf{}
	section := ""
	for n, raw := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line := raw
		if i := strings.IndexAny(line, "#;"); i >= 0 {
			line = line[:i]
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.TrimSpace(line[1 : len(line)-1]))
			if section == "peer" {
				c.peers = append(c.peers, peer{})
			}
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			return nil, fmt.Errorf("line %d isn't \"name = value\"", n+1)
		}
		name := strings.ToLower(strings.TrimSpace(line[:eq]))
		value := strings.TrimSpace(line[eq+1:])
		var err error
		switch section {
		case "interface":
			switch name {
			case "privatekey":
				c.privateKey, err = key(value, "PrivateKey")
			case "address":
				for _, a := range list(value) {
					p, e := netip.ParsePrefix(a)
					if e != nil {
						ip, e2 := netip.ParseAddr(a)
						if e2 != nil {
							return nil, fmt.Errorf("Address %q isn't an address", a)
						}
						p = netip.PrefixFrom(ip, ip.BitLen())
					}
					c.addresses = append(c.addresses, p)
				}
			case "dns":
				for _, a := range list(value) {
					// (names in DNS are search domains: not used here)
					if ip, e := netip.ParseAddr(a); e == nil {
						c.dns = append(c.dns, ip)
					}
				}
			case "mtu":
				c.mtu, err = strconv.Atoi(value)
				if err == nil && (c.mtu < 576 || c.mtu > 65535) {
					err = fmt.Errorf("MTU %d is out of range", c.mtu)
				}
			}
		case "peer":
			p := &c.peers[len(c.peers)-1]
			switch name {
			case "publickey":
				p.publicKey, err = key(value, "PublicKey")
			case "presharedkey":
				p.presharedKey, err = key(value, "PresharedKey")
			case "endpoint":
				p.endpoint = value
			case "allowedips":
				for _, a := range list(value) {
					pr, e := netip.ParsePrefix(a)
					if e != nil {
						return nil, fmt.Errorf("AllowedIPs %q isn't a range", a)
					}
					p.allowedIPs = append(p.allowedIPs, pr)
				}
			case "persistentkeepalive":
				if strings.EqualFold(value, "off") {
					p.keepalive = 0
				} else {
					p.keepalive, err = strconv.Atoi(value)
				}
			}
		}
		if err != nil {
			return nil, err
		}
	}
	if c.privateKey == nil {
		return nil, errors.New("no PrivateKey in [Interface]")
	}
	if len(c.addresses) == 0 {
		return nil, errors.New("no Address in [Interface]")
	}
	if len(c.peers) == 0 {
		return nil, errors.New("no [Peer]")
	}
	for i, p := range c.peers {
		if p.publicKey == nil {
			return nil, fmt.Errorf("[Peer] %d has no PublicKey", i+1)
		}
		if p.endpoint == "" {
			return nil, fmt.Errorf("[Peer] %d has no Endpoint", i+1)
		}
		if len(p.allowedIPs) == 0 {
			c.peers[i].allowedIPs = []netip.Prefix{netip.MustParsePrefix("0.0.0.0/0"), netip.MustParsePrefix("::/0")}
		}
	}
	if c.mtu == 0 {
		c.mtu = 1420
	}
	if len(c.dns) == 0 {
		c.dns = []netip.Addr{netip.MustParseAddr("1.1.1.1"), netip.MustParseAddr("1.0.0.1")}
	}
	return c, nil
}

// What wireguard-go is told: keys in hex, each peer's endpoint already an address (resolve gives one for each).
func (c *wgConf) uapi(resolved []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "private_key=%s\nreplace_peers=true\n", hex.EncodeToString(c.privateKey))
	for i, p := range c.peers {
		fmt.Fprintf(&b, "public_key=%s\n", hex.EncodeToString(p.publicKey))
		if p.presharedKey != nil {
			fmt.Fprintf(&b, "preshared_key=%s\n", hex.EncodeToString(p.presharedKey))
		}
		fmt.Fprintf(&b, "endpoint=%s\n", resolved[i])
		// (a handshake at once, and the way through the router kept open: so it's known straight away whether
		// the tunnel works, and it stays up while the browser's quiet)
		ka := p.keepalive
		if ka == 0 {
			ka = 25
		}
		fmt.Fprintf(&b, "persistent_keepalive_interval=%d\nreplace_allowed_ips=true\n", ka)
		for _, a := range p.allowedIPs {
			fmt.Fprintf(&b, "allowed_ip=%s\n", a.String())
		}
	}
	return b.String()
}

func (c *wgConf) localAddrs() []netip.Addr {
	out := make([]netip.Addr, 0, len(c.addresses))
	for _, p := range c.addresses {
		out = append(out, p.Addr())
	}
	return out
}
