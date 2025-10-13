# Local PeerJS Signaling Server

## Overview

The collaborative live sessions feature uses PeerJS for peer-to-peer connections between presenters and attendees. Instead of relying on the free PeerJS cloud service (which can be unreliable), we run a local signaling server during development.

## Quick Start

### 1. Start the PeerJS Server

In one terminal:
```bash
npm run peerjs-server
```

You should see:
```
╔════════════════════════════════════════════════════════════╗
║  PeerJS Signaling Server for Grafana Pathfinder          ║
║  Running on: http://localhost:9000/pathfinder             ║
║  Status: Ready for connections                            ║
╚════════════════════════════════════════════════════════════╝
```

### 2. Start Grafana

In another terminal:
```bash
npm run server
```

### 3. Start the Plugin Dev Build

In a third terminal:
```bash
npm run dev
```

## How It Works

### Architecture
```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│  Presenter  │ ◄─────► │  PeerJS Server   │ ◄─────► │  Attendee   │
│   Browser   │         │  (localhost:9000)│         │   Browser   │
└─────────────┘         └──────────────────┘         └─────────────┘
                               ▲
                               │ Signaling only
                               │ (SDP exchange, ICE candidates)
                               │
                        Actual data flows P2P ───────────────────►
```

### What the Server Does
- **Signaling**: Facilitates the initial connection handshake between peers
- **Peer Discovery**: Allows attendees to find the presenter by peer ID
- **Connection Management**: Tracks active peers and cleans up disconnected ones

### What the Server Does NOT Do
- **Data Transfer**: All tutorial data flows directly peer-to-peer
- **Storage**: No session data is stored on the server
- **Authentication**: Simple key-based validation only

## Configuration

### Server Settings
File: `scripts/peerjs-server.js`

```javascript
{
  port: 9000,              // Server port
  path: '/pathfinder',     // API endpoint path
  key: 'pathfinder',       // Optional API key
  alive_timeout: 60000,    // Peer timeout (60 seconds)
  debug: true              // Enable debug logging
}
```

### Client Settings
File: `src/utils/collaboration/session-manager.ts`

```typescript
new Peer(peerId, {
  host: 'localhost',       // Server host
  port: 9000,              // Server port
  path: '/pathfinder',     // API endpoint path
  debug: 2,                // Debug level (0-3)
  config: {
    iceServers: [...]      // STUN/TURN servers for NAT traversal
  }
})
```

## Troubleshooting

### "Cannot connect to PeerJS server"
**Problem**: The server isn't running or isn't reachable.

**Solution**:
1. Check if `npm run peerjs-server` is running
2. Verify the port isn't in use: `lsof -i :9000`
3. Check browser console for connection errors

### "Peer connection failed"
**Problem**: P2P connection can't be established even though signaling works.

**Solution**:
1. Check your firewall settings
2. TURN server might be needed for restrictive networks
3. Try from incognito/private windows (different profiles)

### "Attendee can't find presenter"
**Problem**: Join code is valid but attendee can't connect.

**Solution**:
1. Ensure both presenter and attendee are connected to the same server
2. Check that the presenter's session is still active
3. Verify the peer ID hasn't expired (60s timeout)

### Connection drops frequently
**Problem**: Peers disconnect after a short time.

**Solution**:
1. Increase `alive_timeout` in server config
2. Check network stability
3. Look for errors in server logs

## Production Deployment

For production use, you should deploy the PeerJS server on a reliable host:

### Option 1: Cloud Deployment (Recommended)

Deploy to a cloud provider with high uptime:

```bash
# Install on server
npm install peer

# Create systemd service (Linux)
sudo nano /etc/systemd/system/peerjs-pathfinder.service
```

Service file:
```ini
[Unit]
Description=PeerJS Signaling Server for Pathfinder
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/pathfinder
ExecStart=/usr/bin/node /opt/pathfinder/peerjs-server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable peerjs-pathfinder
sudo systemctl start peerjs-pathfinder
```

### Option 2: Docker Deployment

Create `Dockerfile.peerjs`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
RUN npm install peer
COPY scripts/peerjs-server.js .
EXPOSE 9000
CMD ["node", "peerjs-server.js"]
```

Build and run:
```bash
docker build -f Dockerfile.peerjs -t peerjs-pathfinder .
docker run -d -p 9000:9000 --name peerjs-pathfinder peerjs-pathfinder
```

### Option 3: Use PeerJS Cloud (Not Recommended)

If you can't self-host, you can fall back to the cloud:

```typescript
// Remove host/port/path to use cloud
this.peer = new Peer(peerId, {
  debug: 2,
  config: { ... }
});
```

**Downsides**:
- Less reliable (shared infrastructure)
- Rate limits
- No control over uptime
- Privacy concerns (signaling data passes through third party)

## Server Logs

### Normal Operation
```
[PeerJS] Client connected: abc123
[PeerJS] Client connected: xyz789
[PeerJS] Client disconnected: abc123
```

### Connection Issues
```
[PeerJS] Server error: Error: Port 9000 already in use
```

### Debug Mode
Set `debug: true` in server config and `debug: 3` in client config for verbose logging.

## Security Considerations

### Development (Current Setup)
- Server runs on localhost
- No authentication required
- Suitable for local development only

### Production Recommendations
1. **Use HTTPS**: Deploy behind nginx/Apache with SSL
2. **Add Authentication**: Implement API key validation
3. **Rate Limiting**: Prevent abuse with connection limits
4. **CORS**: Restrict to your Grafana domain
5. **Monitoring**: Track connections and errors
6. **Backups**: Have fallback TURN servers configured

## Performance Tuning

### For Small Teams (< 10 concurrent sessions)
Default settings are fine.

### For Large Organizations (10+ concurrent sessions)
- Increase `alive_timeout` to 120000 (2 minutes)
- Add connection limits per IP
- Use a dedicated server instance
- Consider load balancing with multiple PeerJS servers

### Scaling Horizontally
PeerJS servers can't share state, so each presenter/attendee pair must use the same server. Use consistent hashing based on session ID for load balancing.

## Monitoring

### Health Check Endpoint
PeerJS doesn't provide a built-in health check. Add one to the server:

```javascript
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(9001);
```

### Metrics to Track
- Active peer connections
- Connection success rate
- Average connection time
- Disconnection reasons

## FAQ

**Q: Do I need to run this server for the plugin to work?**
A: Yes, for live sessions to work reliably. The feature won't work without a PeerJS server.

**Q: Can multiple developers share one PeerJS server?**
A: Yes! Just change `localhost` to the server's IP/domain in both presenter and attendee configs.

**Q: What's the latency?**
A: Signaling: ~50-100ms. P2P data transfer: ~10-50ms (local network) or ~100-300ms (internet).

**Q: How many concurrent sessions can one server handle?**
A: Depends on hardware, but typically 50-100+ concurrent sessions. Signaling is lightweight.

**Q: Can I use this with Grafana Cloud?**
A: Yes, but you'll need to deploy the PeerJS server on a publicly accessible host and update the `host` config.

## Resources

- [PeerJS Documentation](https://peerjs.com/docs/)
- [WebRTC Explainer](https://webrtc.org/getting-started/overview)
- [STUN/TURN Server List](https://gist.github.com/mondain/b0ec1cf5f60ae726202e)

