#!/bin/bash

# PeerJS Server Management Script
# Usage: ./scripts/manage-peerjs.sh [start|stop|restart|status]

PORT=9000
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$1" in
  start)
    echo "🚀 Starting PeerJS server on port $PORT..."
    
    # Check if already running
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "⚠️  Port $PORT is already in use"
      echo "   Run './scripts/manage-peerjs.sh stop' first, or use 'restart'"
      exit 1
    fi
    
    cd "$PROJECT_DIR"
    npm run peerjs-server
    ;;
    
  stop)
    echo "🛑 Stopping PeerJS server..."
    
    if lsof -ti:$PORT >/dev/null 2>&1; then
      lsof -ti:$PORT | xargs kill -9 2>/dev/null
      echo "✅ PeerJS server stopped"
    else
      echo "ℹ️  No PeerJS server running on port $PORT"
    fi
    ;;
    
  restart)
    echo "🔄 Restarting PeerJS server..."
    $0 stop
    sleep 1
    $0 start
    ;;
    
  status)
    echo "📊 PeerJS Server Status:"
    
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "✅ Server is RUNNING on port $PORT"
      echo ""
      echo "Process info:"
      lsof -Pi :$PORT -sTCP:LISTEN
      echo ""
      echo "Testing endpoint..."
      curl -s http://localhost:$PORT/pathfinder 2>&1 | head -1 || echo "Endpoint not responding"
    else
      echo "❌ Server is NOT running on port $PORT"
      echo ""
      echo "To start: ./scripts/manage-peerjs.sh start"
    fi
    ;;
    
  *)
    echo "PeerJS Server Management"
    echo ""
    echo "Usage: $0 {start|stop|restart|status}"
    echo ""
    echo "Commands:"
    echo "  start    - Start the PeerJS server"
    echo "  stop     - Stop the PeerJS server"
    echo "  restart  - Restart the PeerJS server"
    echo "  status   - Check if server is running"
    echo ""
    echo "Current status:"
    $0 status
    exit 1
    ;;
esac

