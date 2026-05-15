# VV Network — Architecture Document

> VV Pulse: Field operations layer for VV Hybrid Universe

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        VV PULSE (Network)                        │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                    ONLINE MODE                            │  │
│   │  Field Operator → VV Pulse UI → Firebase Firestore        │  │
│   │                                    ↓                      │  │
│   │                            Real-time sync                 │  │
│   │                            Admin panel visible            │  │
│   │                            VVhi logs updated              │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                    OFFLINE MODE                           │  │
│   │  Field Operator → VV Pulse UI → Smart Queue (local)       │  │
│   │                                    ↓                      │  │
│   │                            localStorage cache             │  │
│   │                            Memory Guard active            │  │
│   │                            Sync on reconnect              │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Modules

### 1. vv-beta-app.js — Mission Management

**Purpose:** Mission lifecycle management (create, approve, cancel, sync)

**Key Functions:**
```js
cancelMission(missionId)    // Safe mission cancellation
approveMission(missionId)   // Mission approval flow
syncToFirestore()           // Force sync to backend
```

**Dependencies:**
- Firebase Firestore (`firebase-compat.js`)
- VVhi logger (audit trail)

**Data Model:**
```js
mission = {
  id: string,
  status: 'pending' | 'active' | 'cancelled' | 'done',
  operator: userId,
  location: { lat, lng },
  created_at: timestamp,
  audit_log: []
}
```

---

### 2. vv-flow.js — System Resilience Layer

**Purpose:** Offline support, memory management, sync coordination

#### Smart Queue
```js
firestoreQueue = []           // Pending write operations

// Add to queue when offline
firestoreQueue.push({ type, data, timestamp })

// Process when online
window.addEventListener('online', processQueue)

function processQueue() {
  while (firestoreQueue.length > 0) {
    const op = firestoreQueue.shift()
    executeFirestoreOp(op)
  }
}
```

#### Memory Guard
```js
// Prevent localStorage overflow (5MB limit)
function guardedLocalStorage(key, value) {
  const usage = JSON.stringify(localStorage).length
  if (usage > 4.5 * 1024 * 1024) {
    // Evict oldest entries
    evictOldest()
  }
  localStorage.setItem(key, value)
}
```

#### Sync Manager
```js
// Auto-sync: listen for connection restore
navigator.connection?.addEventListener('change', syncCheck)
window.addEventListener('online', () => {
  processQueue()
  VVhi.log('sync.restored')
})
```

---

### 3. vv-ui-patches.js — Mobile Optimization

**Purpose:** iPhone X+ safe area support, touch optimization

#### iPhone X Safe Areas
```css
/* Applied via JS to dynamic elements */
padding-top: env(safe-area-inset-top)
padding-bottom: env(safe-area-inset-bottom)
padding-left: env(safe-area-inset-left)
padding-right: env(safe-area-inset-right)
```

#### Touch Target Sizing
```js
// Minimum 48x48px touch targets (Apple HIG compliance)
function patchTouchTargets() {
  document.querySelectorAll('[data-touch-target]')
    .forEach(el => el.style.minHeight = '48px')
}
```

#### Pointer Events Fix
```js
// Glassmorphism layers block pointer events
// Fix: explicit pointer-events rules
function fixPointerEvents(glassContainer) {
  glassContainer.style.pointerEvents = 'none'
  glassContainer.querySelectorAll('[data-interactive]')
    .forEach(el => el.style.pointerEvents = 'auto')
}
```

---

## Data Flow — Mission Cancel

```
1. User taps "Cancel Mission"
       ↓
2. vv-beta-app.js: validatePermission(user, mission)
       ↓
3. navigator.onLine check
   ├── YES (online):
   │     Firestore.update({ status: 'cancelled' })
   │     VVhi.logRejection(missionId, user, timestamp)
   │     UI.showSuccess("Mission cancelled")
   │
   └── NO (offline):
         firestoreQueue.push({ type: 'cancel', missionId })
         localStorage.set('pending_cancel_' + missionId, true)
         VVhi.logQueued(missionId)
         UI.showPending("Will sync when online")
```

---

## Security Model

### Firebase Security Rules (Firestore)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Missions: only creator or admin can delete
    match /missions/{missionId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow delete: if request.auth.uid == resource.data.operator
                    || request.auth.token.admin == true;
      allow update: if request.auth != null;
    }
    // Audit logs: write-only (append, no delete)
    match /audit/{logId} {
      allow read: if request.auth.token.admin == true;
      allow create: if request.auth != null;
      allow update, delete: if false;
    }
  }
}
```

### Client-Side Security
- No Firebase config in git (firebase-config.js is gitignored)
- PIN authentication for admin panel access
- No PII in localStorage
- Rate limiting on write operations

---

## Performance Targets

| Metric | Target | Strategy |
|--------|--------|---------|
| Initial Load | < 2s (3G) | Minimal deps, CDN assets |
| Offline Boot | < 500ms | localStorage cache |
| Sync Latency | < 1s | Queue + connection listener |
| Memory Usage | < 50MB | Memory Guard |
| Touch Response | < 100ms | Optimized event handlers |

---

## Integration Map

```
VVhi Intelligence Core
    ↑ audit logs
    │
VV Pulse (Network)
    │ mission data
    ↓
Firebase Firestore ←→ vv-nexus (admin view)
    │
    └── vv-team (operator profiles)
```

---

## Future Architecture (Phase 3+)

### Service Worker (PWA)
```
sw.js
├── Cache strategy: NetworkFirst for API, CacheFirst for assets
├── Background sync: SyncEvent for queue processing
└── Push notifications: mission updates
```

### IndexedDB Migration
```
Replace localStorage with IndexedDB for:
- Better performance (async)
- Larger storage (no 5MB limit)
- Structured queries
```

---

**Design Principle:** *"The app must work. Always. Everywhere."*

---
*VV Technologies — Architecture Document*
*Network / VV Pulse — 2026*