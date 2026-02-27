package plugin

import (
	"io"
	"net"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WSConn wraps a WebSocket connection to implement net.Conn.
// This allows the WebSocket to be used as the transport layer for SSH connections.
type WSConn struct {
	ws     *websocket.Conn
	reader io.Reader
	mu     sync.Mutex // protects reader and ws.NextReader/Read
	wmu    sync.Mutex // protects ws.WriteMessage
}

// NewWSConn creates a new net.Conn wrapper around a WebSocket connection.
func NewWSConn(ws *websocket.Conn) *WSConn {
	return &WSConn{
		ws: ws,
	}
}

// Read reads data from the WebSocket connection.
func (c *WSConn) Read(b []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for {
		if c.reader == nil {
			messageType, reader, err := c.ws.NextReader()
			if err != nil {
				return 0, err
			}
			if messageType != websocket.BinaryMessage && messageType != websocket.TextMessage {
				continue
			}
			c.reader = reader
		}

		n, err := c.reader.Read(b)
		if err == io.EOF {
			c.reader = nil
			if n > 0 {
				return n, nil
			}
			continue
		}
		return n, err
	}
}

// Write writes data to the WebSocket connection as a binary message.
func (c *WSConn) Write(b []byte) (int, error) {
	c.wmu.Lock()
	defer c.wmu.Unlock()

	err := c.ws.WriteMessage(websocket.BinaryMessage, b)
	if err != nil {
		return 0, err
	}
	return len(b), nil
}

// Close closes the underlying WebSocket connection.
func (c *WSConn) Close() error {
	return c.ws.Close()
}

// LocalAddr returns the local network address (not applicable for WebSocket).
func (c *WSConn) LocalAddr() net.Addr {
	return c.ws.LocalAddr()
}

// RemoteAddr returns the remote network address.
func (c *WSConn) RemoteAddr() net.Addr {
	return c.ws.RemoteAddr()
}

// SetDeadline sets the read and write deadlines.
func (c *WSConn) SetDeadline(t time.Time) error {
	if err := c.ws.SetReadDeadline(t); err != nil {
		return err
	}
	return c.ws.SetWriteDeadline(t)
}

// SetReadDeadline sets the read deadline.
func (c *WSConn) SetReadDeadline(t time.Time) error {
	return c.ws.SetReadDeadline(t)
}

// SetWriteDeadline sets the write deadline.
func (c *WSConn) SetWriteDeadline(t time.Time) error {
	return c.ws.SetWriteDeadline(t)
}

// Ensure WSConn implements net.Conn at compile time.
var _ net.Conn = (*WSConn)(nil)
