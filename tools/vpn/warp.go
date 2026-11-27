package main

// Signing up for Cloudflare WARP (free, no account): a new key, registered with Cloudflare's API, and the
// WireGuard configuration that comes back. As the WARP app does it, and as wgcf does
// (https://github.com/ViRb3/wgcf, MIT License, Copyright (c) 2020 ViRb3): the request and the TLS ClientHello
// below follow wgcf's cloudflare/api.go, which matches Cloudflare's Android app (Cloudflare turns away sign-ups
// that don't look like it, with 429 Too Many Requests).

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	utls "github.com/refraction-networking/utls"
)

const (
	warpAPI     = "https://api.cloudflareclient.com"
	warpVersion = "v0a5641"
	warpUA      = "1.1.1.1/6.38.9-5641 (Android 16.0.0)"
	warpClient  = "a-6.38.9-5641"
)

func warpHello() *utls.ClientHelloSpec {
	return &utls.ClientHelloSpec{
		TLSVersMin: utls.VersionTLS12,
		TLSVersMax: utls.VersionTLS12,
		CipherSuites: []uint16{
			utls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			utls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
		},
		CompressionMethods: []uint8{0},
		Extensions: []utls.TLSExtension{
			&utls.SNIExtension{},
			&utls.ExtendedMasterSecretExtension{},
			&utls.RenegotiationInfoExtension{Renegotiation: utls.RenegotiateNever},
			&utls.SupportedCurvesExtension{Curves: []utls.CurveID{utls.X25519, utls.CurveP256, utls.CurveP384}},
			&utls.SupportedPointsExtension{SupportedPoints: []uint8{0}},
			&utls.SessionTicketExtension{},
			&utls.ALPNExtension{AlpnProtocols: []string{"http/1.1"}},
			&utls.StatusRequestExtension{},
			&utls.SignatureAlgorithmsExtension{SupportedSignatureAlgorithms: []utls.SignatureScheme{
				utls.ECDSAWithP256AndSHA256,
				utls.PSSWithSHA256,
				utls.PKCS1WithSHA256,
				utls.ECDSAWithP384AndSHA384,
				utls.PSSWithSHA384,
				utls.PKCS1WithSHA384,
				utls.PSSWithSHA512,
				utls.PKCS1WithSHA512,
				utls.PKCS1WithSHA1,
			}},
			&utls.UtlsPaddingExtension{GetPaddingLen: utls.BoringPaddingStyle},
		},
	}
}

func dialWarpTLS(ctx context.Context, network, address string) (net.Conn, error) {
	d := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	raw, err := d.DialContext(ctx, network, address)
	if err != nil {
		return nil, err
	}
	host, _, _ := net.SplitHostPort(address)
	u := utls.UClient(raw, &utls.Config{ServerName: host, MinVersion: utls.VersionTLS12, MaxVersion: utls.VersionTLS12, NextProtos: []string{"http/1.1"}}, utls.HelloCustom)
	if err := u.ApplyPreset(warpHello()); err != nil {
		raw.Close()
		return nil, fmt.Errorf("TLS fingerprint: %w", err)
	}
	// (the Android app's TLS leaves the session ID empty on a new connection)
	u.HandshakeState.Hello.SessionId = nil
	if err := u.BuildHandshakeState(); err != nil {
		raw.Close()
		return nil, fmt.Errorf("TLS hello: %w", err)
	}
	hctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := u.HandshakeContext(hctx); err != nil {
		raw.Close()
		return nil, fmt.Errorf("TLS handshake: %w", err)
	}
	return u, nil
}

var warpHTTP = &http.Client{
	Timeout: 40 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12, MaxVersion: tls.VersionTLS12},
		DialTLSContext:      dialWarpTLS,
		ForceAttemptHTTP2:   false,
		TLSHandshakeTimeout: 10 * time.Second,
	},
}

type warpEndpoint struct {
	Host  string  `json:"host"`
	V4    string  `json:"v4"`
	V6    string  `json:"v6"`
	Ports []int32 `json:"ports"`
}

type warpDevice struct {
	ID          string `json:"id"`
	Token       string `json:"token"`
	WarpEnabled *bool  `json:"warp_enabled"`
	Account     struct {
		AccountType string `json:"account_type"`
		WarpPlus    bool   `json:"warp_plus"`
	} `json:"account"`
	Config *struct {
		Interface struct {
			Addresses struct {
				V4 string `json:"v4"`
				V6 string `json:"v6"`
			} `json:"addresses"`
		} `json:"interface"`
		Peers []struct {
			PublicKey string       `json:"public_key"`
			Endpoint  warpEndpoint `json:"endpoint"`
		} `json:"peers"`
	} `json:"config"`
}

func warpCall(method, path, token string, body any) (*warpDevice, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, warpAPI+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", warpUA)
	req.Header.Set("CF-Client-Version", warpClient)
	req.Header.Set("Connection", "Keep-Alive")
	if body != nil {
		req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := warpHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusTooManyRequests {
		return nil, errors.New("Cloudflare turned the sign-up away (429 Too Many Requests): try again later")
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		msg := strings.TrimSpace(string(data))
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return nil, fmt.Errorf("Cloudflare answered %d: %s", res.StatusCode, msg)
	}
	var d warpDevice
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("Cloudflare's answer: %w", err)
	}
	return &d, nil
}

func newKey() (priv, pub []byte, err error) {
	k := make([]byte, 32)
	if _, err = rand.Read(k); err != nil {
		return nil, nil, err
	}
	// (clamped, as wg genkey writes them)
	k[0] &= 248
	k[31] = (k[31] & 127) | 64
	pk, err := ecdh.X25519().NewPrivateKey(k)
	if err != nil {
		return nil, nil, err
	}
	return k, pk.PublicKey().Bytes(), nil
}

func endpointOf(e warpEndpoint) (string, error) {
	if e.Host != "" {
		if _, _, err := net.SplitHostPort(e.Host); err == nil {
			return e.Host, nil
		}
		return net.JoinHostPort(e.Host, "2408"), nil
	}
	h := e.V4
	if h == "" {
		h = e.V6
	}
	if h == "" {
		return "", errors.New("Cloudflare's answer has no endpoint")
	}
	if host, _, err := net.SplitHostPort(h); err == nil {
		h = host
	}
	port := 2408
	if len(e.Ports) > 0 {
		port = int(e.Ports[0])
	}
	return net.JoinHostPort(h, strconv.Itoa(port)), nil
}

type registered struct {
	Conf  string `json:"conf"`
	ID    string `json:"id"`
	Token string `json:"token"`
	// (what Cloudflare said about it)
	Enabled *bool  `json:"enabled,omitempty"`
	Account string `json:"account,omitempty"`
}

func register(model string) (*registered, error) {
	priv, pub, err := newKey()
	if err != nil {
		return nil, err
	}
	req := struct {
		FcmToken     string `json:"fcm_token"`
		InstallID    string `json:"install_id"`
		Key          string `json:"key"`
		Locale       string `json:"locale"`
		Model        string `json:"model"`
		Tos          string `json:"tos"`
		SerialNumber string `json:"serial_number"`
		OsVersion    string `json:"os_version"`
		KeyType      string `json:"key_type"`
		TunnelType   string `json:"tunnel_type"`
	}{"", "", base64.StdEncoding.EncodeToString(pub), "en_US", model, time.Now().Format(time.RFC3339Nano), "", "16.0.0", "curve25519", "wireguard"}
	d, err := warpCall("POST", "/"+warpVersion+"/reg", "", req)
	if err != nil {
		return nil, err
	}
	if d.Config == nil || len(d.Config.Peers) == 0 {
		// (the configuration on its own: what wgcf asks for)
		if d2, err2 := warpCall("GET", "/"+warpVersion+"/reg/"+d.ID, d.Token, nil); err2 == nil && d2.Config != nil {
			d.Config = d2.Config
		}
	}
	if d.Config == nil || len(d.Config.Peers) == 0 {
		return nil, errors.New("Cloudflare's answer has no WireGuard peer")
	}
	p := d.Config.Peers[0]
	ep, err := endpointOf(p.Endpoint)
	if err != nil {
		return nil, err
	}
	a := d.Config.Interface.Addresses
	addrs := []string{}
	if a.V4 != "" {
		addrs = append(addrs, a.V4+"/32")
	}
	if a.V6 != "" {
		addrs = append(addrs, a.V6+"/128")
	}
	if len(addrs) == 0 {
		return nil, errors.New("Cloudflare's answer has no address")
	}
	conf := fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = %s
DNS = 1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001
MTU = 1280

[Peer]
PublicKey = %s
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = %s
`, base64.StdEncoding.EncodeToString(priv), strings.Join(addrs, ", "), p.PublicKey, ep)
	return &registered{Conf: conf, ID: d.ID, Token: d.Token, Enabled: d.WarpEnabled, Account: d.Account.AccountType}, nil
}

// Forgetting a sign-up: the device taken off Cloudflare's list.
func unregister(id, token string) error {
	_, err := warpCall("DELETE", "/"+warpVersion+"/reg/"+id, token, nil)
	if err != nil && strings.Contains(err.Error(), "Cloudflare's answer:") {
		// (an empty answer to a DELETE is fine)
		return nil
	}
	return err
}
