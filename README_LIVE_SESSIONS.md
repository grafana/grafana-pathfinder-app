# Live Sessions Quick Start

## Setup (3 Terminals)

### Terminal 1: PeerJS Server
```bash
npm run peerjs-server
```

### Terminal 2: Grafana
```bash
npm run server
```

### Terminal 3: Plugin Dev Build
```bash
npm run dev
```

## Usage

1. **Enable Live Sessions**: Go to Configuration page, enable "Live Sessions (Experimental)"
2. **Start as Presenter**: Click "Start Live Session" button, share the join code
3. **Join as Attendee**: Click "Join Live Session", enter the code
4. **Present**: Click "Show Me" or "Do It" - attendees will see your actions!

## Modes

- **Guided Mode**: Attendees see highlights when you click "Show Me"
- **Follow Mode**: Attendees' Grafana mirrors your "Do It" actions automatically

## Need Help?

See `docs/LOCAL_PEERJS_SERVER.md` for detailed setup and troubleshooting.

