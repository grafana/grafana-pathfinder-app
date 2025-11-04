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

## Server Management

### Helper Script

A management script is available for easier server control:

```bash
# Check server status
./scripts/manage-peerjs.sh status

# Start server
./scripts/manage-peerjs.sh start

# Stop server
./scripts/manage-peerjs.sh stop

# Restart server (stops then starts)
./scripts/manage-peerjs.sh restart
```

### Troubleshooting Port Conflicts

If you get "port 9000 is already in use":

**Option 1: Use the helper script**
```bash
./scripts/manage-peerjs.sh restart
```

**Option 2: Manual cleanup**
```bash
# Find what's using port 9000
lsof -i:9000

# Kill the process
lsof -ti:9000 | xargs kill -9

# Start fresh
npm run peerjs-server
```

**Option 3: Use a different port**
```bash
# Edit scripts/peerjs-server.js and change port to 9001
# Then update plugin configuration to match
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
- Simple key-based validation only (`key: 'pathfinder'`)
- No encryption (plain HTTP/WS)
- Suitable for local development only
- **Never expose to internet without security hardening**

### Production Security Hardening

#### 1. Use Strong API Keys

Replace default key with cryptographically secure random string:

```javascript
// Generate secure key
const crypto = require('crypto');
const secureKey = crypto.randomBytes(32).toString('hex');

const server = PeerServer({
  key: secureKey, // Use this in production
  // ...
});
```

Update plugin configuration with same key.

#### 2. Enable HTTPS/WSS

**Why**: Browsers require HTTPS for WebRTC in production.

Deploy behind reverse proxy with SSL:

```nginx
server {
    listen 443 ssl http2;
    server_name peerjs.yourdomain.com;
    
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    
    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    location /pathfinder {
        proxy_pass http://localhost:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts for long-lived connections
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }
}
```

#### 3. Restrict CORS

Limit connections to your Grafana domains only:

```javascript
const server = PeerServer({
  port: 9000,
  path: '/pathfinder',
  key: process.env.PEERJS_KEY,
  allow_discovery: false, // Disable peer discovery
  corsOptions: {
    origin: [
      'https://yourgrafana.com',
      'https://*.yourgrafana.com'
    ],
    credentials: true
  }
});
```

#### 4. Implement Rate Limiting

Prevent abuse with connection limits:

```javascript
const rateLimit = require('express-rate-limit');
const express = require('express');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 connections per window
  message: 'Too many connections from this IP'
});

const app = express();
app.use('/pathfinder', limiter);

const server = PeerServer({
  port: 9000,
  path: '/pathfinder',
  // ... other config
});
```

#### 5. Connection Limits

Set maximum concurrent connections per peer:

```javascript
const MAX_CONNECTIONS_PER_PEER = 50;

server.on('connection', (client) => {
  const connections = Array.from(server._clients.values())
    .filter(c => c.getId() === client.getId()).length;
  
  if (connections > MAX_CONNECTIONS_PER_PEER) {
    console.warn(`Peer ${client.getId()} exceeded connection limit`);
    client.getSocket().close();
  }
});
```

#### 6. Logging and Monitoring

Log security events:

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'peerjs-security.log' })
  ]
});

server.on('connection', (client) => {
  logger.info('Peer connected', {
    peerId: client.getId(),
    ip: client.getSocket().remoteAddress,
    timestamp: new Date().toISOString()
  });
});

server.on('disconnect', (client) => {
  logger.info('Peer disconnected', {
    peerId: client.getId(),
    timestamp: new Date().toISOString()
  });
});
```

#### 7. Environment-Based Configuration

Use environment variables for sensitive config:

```javascript
require('dotenv').config();

const server = PeerServer({
  port: process.env.PEERJS_PORT || 9000,
  path: process.env.PEERJS_PATH || '/pathfinder',
  key: process.env.PEERJS_KEY, // Required in production
  alive_timeout: parseInt(process.env.ALIVE_TIMEOUT) || 60000,
  concurrent_limit: parseInt(process.env.CONCURRENT_LIMIT) || 5000
});

if (!process.env.PEERJS_KEY) {
  console.error('FATAL: PEERJS_KEY environment variable not set');
  process.exit(1);
}
```

### Production Deployment Checklist

Before deploying to production:

- [ ] Generate and use strong random API key
- [ ] Enable HTTPS/WSS with valid SSL certificate
- [ ] Configure CORS to restrict to your domains
- [ ] Implement rate limiting
- [ ] Set connection limits per peer
- [ ] Enable comprehensive logging
- [ ] Set up monitoring and alerts
- [ ] Configure automatic restart on crash
- [ ] Set up backup TURN servers
- [ ] Document emergency procedures
- [ ] Test failover scenarios
- [ ] Review and update firewall rules

### Security Best Practices

1. **Never use default key in production**
2. **Always use HTTPS/WSS** - Required for WebRTC
3. **Restrict CORS** - Limit to known Grafana domains
4. **Monitor actively** - Watch for unusual connection patterns
5. **Rotate keys periodically** - Update API keys regularly
6. **Backup plan** - Have fallback servers ready
7. **Keep updated** - Update PeerJS server regularly
8. **Audit logs** - Review security logs weekly

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

