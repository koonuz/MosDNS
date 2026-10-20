// SPDX-License-Identifier: GPL-3.0-only

package cache

import (
	"bytes"
	"net"
	"testing"

	"github.com/miekg/dns"
)

func TestDumpKeepsRemainingTTL(t *testing.T) {
	const ttl = 3600
	q := new(dns.Msg)
	q.SetQuestion("example.com.", dns.TypeA)
	r := new(dns.Msg)
	r.SetReply(q)
	r.Answer = append(r.Answer, &dns.A{
		Hdr: dns.RR_Header{Name: "example.com.", Rrtype: dns.TypeA, Class: dns.ClassINET, Ttl: ttl},
		A:   net.IPv4(192, 0, 2, 1),
	})
	msgKey := getMsgKey(q)

	src := NewCache(&Args{Size: 1024, LazyCacheTTL: 86400}, Opts{})
	if !saveRespToCache(msgKey, r, src.backend, 86400) {
		t.Fatal("response was not cached")
	}
	buf := new(bytes.Buffer)
	if _, err := src.writeDump(buf); err != nil {
		t.Fatal(err)
	}

	dst := NewCache(&Args{Size: 1024, LazyCacheTTL: 86400}, Opts{})
	if n, err := dst.readDump(buf); err != nil || n != 1 {
		t.Fatalf("readDump got %d entries, err %v", n, err)
	}
	got, lazy := getRespFromCache(msgKey, dst.backend, true, expiredMsgTtl)
	if got == nil || lazy {
		t.Fatalf("restored entry missing or expired, resp %v lazy %v", got, lazy)
	}
	if v := got.Answer[0].Header().Ttl; v < ttl-60 || v > ttl {
		t.Fatalf("restored entry TTL is %d, want about %d", v, ttl)
	}
}
