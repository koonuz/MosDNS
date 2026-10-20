// SPDX-License-Identifier: GPL-3.0-only

package transport

import (
	"context"
	"io"
	"testing"
	"time"

	"github.com/miekg/dns"
)

// fastReplyConn is an upstream at its fastest: Write returns only after
// readLoop has handed the reply on, so the reply always arrives before
// the query starts to wait for it.
type fastReplyConn struct {
	replies   chan []byte
	delivered chan struct{}
	closed    chan struct{}
	handed    bool // only used by readLoop, through Read
}

func (c *fastReplyConn) Write(b []byte) (int, error) {
	q := new(dns.Msg)
	if err := q.Unpack(b); err != nil {
		return 0, err
	}
	r := new(dns.Msg)
	r.SetReply(q)
	p, err := r.Pack()
	if err != nil {
		return 0, err
	}
	c.replies <- p
	select {
	case <-c.delivered:
		return len(b), nil
	case <-c.closed:
		return 0, io.ErrClosedPipe
	}
}

// Read is called again by readLoop only after it handed the last reply on.
func (c *fastReplyConn) Read(b []byte) (int, error) {
	if c.handed {
		c.delivered <- struct{}{}
	}
	select {
	case p := <-c.replies:
		c.handed = true
		return copy(b, p), nil
	case <-c.closed:
		return 0, io.EOF
	}
}

func (c *fastReplyConn) Close() error {
	close(c.closed)
	return nil
}

func (c *fastReplyConn) SetDeadline(time.Time) error      { return nil }
func (c *fastReplyConn) SetReadDeadline(time.Time) error  { return nil }
func (c *fastReplyConn) SetWriteDeadline(time.Time) error { return nil }

func TestDnsConnKeepsReplyBeforeWait(t *testing.T) {
	dc := NewDnsConn(TraditionalDnsConnOpts{}, &fastReplyConn{
		replies:   make(chan []byte, 1),
		delivered: make(chan struct{}, 1),
		closed:    make(chan struct{}),
	})
	defer dc.Close()

	q := new(dns.Msg)
	q.SetQuestion("example.com.", dns.TypeA)
	b, err := q.Pack()
	if err != nil {
		t.Fatal(err)
	}
	// Shorter than the 1s UDP resend, so a lost reply is not recovered.
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if _, err := dc.exchange(ctx, b); err != nil {
		t.Fatalf("reply that arrived before the wait was lost, %v", err)
	}
}
