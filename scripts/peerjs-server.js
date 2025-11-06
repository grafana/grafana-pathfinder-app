#!/usr/bin/env node

/**
 * Local PeerJS Signaling Server
 *
 * Run this alongside Grafana during development for reliable peer connections.
 * Production: Consider deploying this on a dedicated server/cloud instance.
 *
 * Usage: npm run peerjs-server
 */

const { PeerServer } = require('peer');

const PORT = 9000;
const PATH = '/pathfinder';

const server = PeerServer({
  port: PORT,
  path: PATH,
  // Allow CORS for local development
  allow_discovery: true,
  // Log connection events
  debug: true,
  // Alive timeout (how long before considering a peer dead)
  alive_timeout: 60000,
  // Key (optional, for authentication)
  key: 'pathfinder',
});

server.on('connection', (client) => {
  console.log(`[PeerJS] Client connected: ${client.getId()}`);
});

server.on('disconnect', (client) => {
  console.log(`[PeerJS] Client disconnected: ${client.getId()}`);
});

server.on('error', (error) => {
  console.error('[PeerJS] Server error:', error);
});

console.log(`
╔════════════════════════════════════════════════════════════╗
║  PeerJS Signaling Server for Grafana Pathfinder          ║
║  Running on: http://localhost:${PORT}${PATH}                 ║
║  Status: Ready for connections                            ║
╚════════════════════════════════════════════════════════════╝

Waiting for peer connections...
Press Ctrl+C to stop the server.
`);
