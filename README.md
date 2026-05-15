# VV Network / VV Pulse

> **Real-time field validation app for VV Hybrid Universe ecosystem**

[![Status](https://img.shields.io/badge/status-foundation_ready-blue)](#)
[![Stack](https://img.shields.io/badge/stack-Firebase_+_Vanilla_JS-orange)](#)
[![Platform](https://img.shields.io/badge/platform-Web_PWA-green)](#)

---

## Vision

**VV Pulse** is the field operations layer of VV Hybrid Universe — an offline-first, mobile-optimized mission management system built for real-world validation tasks.

> "Fast, reliable, always works — even without signal."

---

## Current Foundation (Implemented)

### Core Modules (`src/`)

| Module | File | Description |
|--------|------|-------------|
| Mission Logic | `vv-beta-app.js` | Mission cancel/approve, Firestore sync |
| Flow System | `vv-flow.js` | Liquid geometry, Smart Queue, offline sync |
| UI Patches | `vv-ui-patches.js` | iPhone X safe areas, touch optimization |

### Key Features ✅

- **Firebase Firestore** — real-time data sync
- **Offline Smart Queue** — tasks queued locally, synced on reconnect
- **iPhone X Safe Areas** — `env(safe-area-inset-*)` everywhere
- **Memory Guard** — localStorage overflow protection
- **VVhi Audit Logging** — every action logged to shadow AI
- **Leaflet Maps** — field location visualization
- **PIN Authentication** — glassmorphism login panel

### Planned Features 🔲

- Mission creation UI
- Photo capture & upload
- Real-time team tracking
- Analytics dashboard
- Push notifications (PWA)
- Multi-language support

---

## Architecture

```
VV Pulse
    │
    ├── vv-beta-app.js      ← Mission management (cancel, approve, sync)
    │       └── Firebase Firestore integration
    │       └── VVhi audit logging
    │
    ├── vv-flow.js          ← System resilience layer
    │       ├── Smart Queue (offline task queue)
    │       ├── Memory Guard (localStorage limiter)
    │       └── Sync Manager (auto-sync on reconnect)
    │
    └── vv-ui-patches.js    ← Mobile optimization
            ├── iPhone X safe areas
            ├── Touch target sizing (48px min)
            └── Pointer events fix (glassmorphism)
```

**Data Flow:**
```
User Action → vv-beta-app.js → Online? → Firebase
                                  ↓ No
                             Smart Queue → sync when online
                                  ↓
                            VVhi.log() (audit trail)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Firebase Firestore + Storage |
| Maps | Leaflet.js |
| UI | Vanilla JS + Glassmorphism CSS |
| Fonts | Inter (Google Fonts) |
| Icons | Font Awesome 6 |
| Auth | PIN-based (custom) |
| Offline | Smart Queue (custom) |
| Future | Service Worker PWA |

---

## Quick Start

### Prerequisites
- Firebase project (Firestore enabled)
- Modern browser (Chrome/Safari/Firefox)

### Setup

```bash
# 1. Clone repo
git clone https://github.com/vv-technologies/Network.git
cd Network

# 2. Configure Firebase
cp config/firebase-config.example.js firebase-config.js
# Edit firebase-config.js with your credentials

# 3. Open app
# No build step needed — vanilla JS
open index.html
```

### Firebase Config
Edit `firebase-config.js` (gitignored — never commit):
```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_ID",
  appId: "YOUR_APP_ID"
};
```

---

## Roadmap

| Phase | Status | Features |
|-------|--------|---------|
| **Phase 1: Foundation** | ✅ Done | Core modules, Firebase, offline sync, mobile patches |
| **Phase 2: MVP** | 🚧 Next | Mission UI, photo capture, basic workflow |
| **Phase 3: Scale** | 🔲 Future | Team features, analytics, multi-language |
| **Phase 4: Launch** | 🔲 Future | PWA install, push notifications, v1.0 |

---

## Security

**Never commit:**
- `firebase-config.js` (gitignored) — use `config/firebase-config.example.js` as template
- User mission data
- Private API keys

See [`.gitignore`](.gitignore) for full exclusion list.

---

## Integration with VV Ecosystem

```
VV Hybrid Universe
    │
    ├── vv-lea       ← AI Assistant (LEA talks to Pulse for field data)
    ├── vv-nexus     ← Platform hub (Pulse missions visible in Nexus)
    ├── vv-team      ← Team layer (Pulse operators = VV Team members)
    └── Network      ← THIS REPO: Field operations (VV Pulse)
```

- **VVhi**: Receives audit logs from every mission action
- **VV Aer**: User identity sync for field operators
- **VV Studios**: Mission planning workspace feeds into Pulse

---

## License

Proprietary — VV Technologies © 2026
All rights reserved. Internal use only.

---

*Part of [VV Hybrid Universe](https://github.com/vv-technologies) 🌌*
*Cosmin Toma, CEO — VV Technologies*