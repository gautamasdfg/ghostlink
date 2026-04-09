# 👻 GhostLink

> Private, encrypted, ephemeral communication. No phone number. No email. Just your GhostID.

---

## Privacy Guarantees

| Feature | Status |
|---|---|
| End-to-end encryption | ✅ WebCrypto ECDH + AES-GCM |
| New keys per session | ✅ Ephemeral ECDH keypairs |
| No message storage | ✅ Messages never touch the database |
| No IP logging | ✅ Server never logs IPs |
| Ephemeral messages | ✅ Auto-delete after timer or on read |
| No phone/email required | ✅ Just GhostID + password |
| Tor friendly | ✅ Works over Tor browser |
| Minimal data stored | ✅ Only GhostID + Argon2 password hash |

---

## Features

- 🔒 **E2EE Direct Messages** — ECDH key exchange, AES-GCM encryption
- 💨 **Ephemeral Messages** — disappear after 30s / 5m / 1h / on read
- 👥 **Group Rooms** — invite code based, room-key encryption
- 🔍 **GhostID Search** — find friends by username
- ⌨️ **Typing Indicators** — privacy-respecting, ephemeral
- 📎 **File Sharing** — encrypted peer-to-peer file transfer
- 🟢 **Status Indicators** — online/offline (opt-in, session-only)
- 📞 **Voice Calls** — WebRTC peer-to-peer (server never hears calls)
- 📹 **Video Calls** — WebRTC peer-to-peer (server never sees video)
- 👥 **Group Calls** — up to 5 people via WebRTC mesh

---

## Project Structure

```
ghostlink/
├── server/           # Node.js + Socket.io backend
│   ├── index.js      # Main server
│   └── package.json
└── client/           # React frontend
    ├── src/
    │   ├── App.js
    │   ├── styles.css
    │   ├── context/
    │   │   ├── AuthContext.js
    │   │   └── SocketContext.js
    │   ├── pages/
    │   │   ├── AuthPage.js
    │   │   └── MainApp.js
    │   └── utils/
    │       ├── api.js
    │       └── crypto.js      ← All E2EE logic
    └── package.json
```

---

## Quick Start

### 1. Start the Server

```bash
cd server
npm install
npm start
# Server runs at http://localhost:4000
```

### 2. Start the Client

```bash
cd client
npm install
npm start
# App opens at http://localhost:3000
```

---

## Production Deployment

### Environment Variables (Server)

```env
JWT_SECRET=your-very-long-random-secret-here
PORT=4000
```

### Environment Variables (Client)

```env
REACT_APP_API_URL=https://your-server.com
REACT_APP_SERVER_URL=https://your-server.com
```

### Build Client for Production

```bash
cd client
npm run build
# Serve /build folder with any static file server
```

### Nginx Config Example

```nginx
server {
    listen 443 ssl;
    server_name ghostlink.yourdomain.com;

    # Frontend
    location / {
        root /var/www/ghostlink/client/build;
        try_files $uri /index.html;
    }

    # Backend API + WebSocket
    location /api {
        proxy_pass http://localhost:4000;
    }
    location /socket.io {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # NOTE: No IP logging — do not forward X-Real-IP
    }
}
```

---

## Production Hardening Checklist

- [ ] Change `JWT_SECRET` to a long random string
- [ ] Enable HTTPS (Let's Encrypt)
- [ ] Replace the simple "I am not a robot" checkbox with [hCaptcha](https://hcaptcha.com)
- [ ] Configure Nginx to NOT log IPs (set `access_log off`)
- [ ] Add TURN server for WebRTC NAT traversal (Coturn)
- [ ] Set up database backups for `ghostlink.db`
- [ ] Add rate limiting at Nginx level

---

## How E2EE Works

```
Alice generates ephemeral ECDH keypair (new every session)
Alice uploads public key to server

Bob generates ephemeral ECDH keypair
Bob uploads public key to server

Alice fetches Bob's public key → derives shared AES-256 key
Bob fetches Alice's public key → derives same shared AES-256 key

All messages encrypted with AES-GCM before leaving the browser
Server only sees: { from, to, encryptedBlob, timestamp }
Server NEVER stores any messages
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 |
| Encryption | WebCrypto API (ECDH P-256 + AES-GCM 256) |
| Realtime | Socket.io 4 |
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Passwords | Argon2id |
| Auth | JWT |
| Calls | WebRTC |

---

*GhostLink — Leave no trace.*
