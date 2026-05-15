// ================= FIREBASE CONFIG =================
const firebaseConfig = {
    apiKey: "AIzaSyDGv4kEClO0RHCLvXVLOT-vyPHw6bsxYVc",
    authDomain: "vv-ep-beta.firebaseapp.com",
    projectId: "vv-ep-beta",
    storageBucket: "vv-ep-beta.firebasestorage.app"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

// ================= VARIABILE GLOBALE =================
let map = null;
let currentStream = null;
let targetMarker = null;
let currentUser = null;
let currentMissionId = null;
let selectedReward = 15;
let selectedTip = 0;
let capturedImageBlob = null;
let userCurrentLat = null;
let userCurrentLng = null;

// ================= HAVERSINE =================
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => deg * (Math.PI / 180);
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
              Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*
              Math.sin(dLon/2)*Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ================= BOOT =================
window.onload = function() {
    document.addEventListener('touchstart', function(e) {
        if (e.touches[0].clientX < 20 || e.touches[0].clientX > window.innerWidth - 20) {
            e.preventDefault();
        }
    }, { passive: false });

    document.body.addEventListener('touchmove', function(e) {
        if (e.target === document.body || e.target === document.documentElement) {
            e.preventDefault();
        }
    }, { passive: false });

    try {
        auth.signInAnonymously().catch(function(err) {
            console.log('[VV] signInAnonymously err:', err.code);
        });
    } catch(e) { console.log('[VV] auth err:', e); }

    try {
        auth.onAuthStateChanged(function(user) {
            if (user) {
                currentUser = user;
                var tutorialDone = localStorage.getItem('vv_premium_tutorial_done');
                var accessKey = localStorage.getItem('vv_access_key');
                if (tutorialDone === 'DA' && accessKey) {
                    document.getElementById('splash-screen').style.display = 'none';
                    document.getElementById('tutorial-screen').style.display = 'none';
                    showApp();
                    loadUserData();
                } else {
                    document.getElementById('splash-screen').style.display = 'flex';
                }
            }
        });
    } catch(e) { console.log('[VV] auth listener err:', e); }
};

function toggleAcceptButton() {}

async function startBootSequence() {
    const key = document.getElementById('access-key').value.trim().toUpperCase();
    const btn = document.getElementById('btn-accept');
    const cb = document.getElementById('tc-checkbox');

    const existingError = document.getElementById('key-error-msg');
    if (existingError) existingError.remove();

    if (!cb || !cb.checked) { showKeyError('Trebuie să accepți regulamentul mai întâi.'); return; }
    if (!key) { showKeyError('Introdu cheia de acces.'); return; }

    btn.textContent = 'SE VERIFICĂ...';
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';

    try {
        const snap = await db.collection('access_keys')
            .where('key', '==', key).where('active', '==', true).get();

        if (snap.empty) {
            const snap2 = await db.collection('access_keys').where('key', '==', key).get();
            throw new Error(snap2.empty ? 'Cheie invalidă: ' + key : 'Cheie dezactivată. Cere una nouă.');
        }

        localStorage.setItem('vv_access_key', key);

        if (!currentUser) {
            btn.textContent = 'SE CONECTEAZĂ...';
            const cred = await auth.signInAnonymously();
            currentUser = cred.user;
        }

        btn.textContent = 'ACCES ACORDAT ✓';
        btn.style.background = 'rgba(52,199,89,0.9)';
        btn.style.color = '#000';
        btn.style.opacity = '1';

        setTimeout(() => {
            document.getElementById('splash-screen').style.display = 'none';
            document.getElementById('alias-screen').style.display = 'flex';
        }, 500);

    } catch(err) {
        btn.textContent = 'DECRIPTEZ & INTRU';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.style.background = '';
        btn.style.color = '';
        showKeyError('❌ ' + (err.message || JSON.stringify(err)));
    }
}

function showKeyError(msg) {
    const existing = document.getElementById('key-error-msg');
    if (existing) existing.remove();
    const err = document.createElement('div');
    err.id = 'key-error-msg';
    err.style.cssText = 'color:#ff3b30;font-size:14px;text-align:center;margin-top:10px;margin-bottom:10px;font-weight:700;width:100%;max-width:390px;padding:10px 14px;background:rgba(255,59,48,0.1);border:1px solid rgba(255,59,48,0.3);border-radius:10px;line-height:1.4;word-break:break-all;';
    err.textContent = '⚠️ ' + msg;
    const keyInput = document.getElementById('access-key');
    if (keyInput && keyInput.parentNode) keyInput.parentNode.insertBefore(err, keyInput.nextSibling);
}

// ================= CONFIRMARE ALIAS =================
function confirmAlias() {
    const alias = document.getElementById('user-alias-input').value.trim();
    if (!alias || alias.length < 2) { showToast('Introdu un nume de cod valid!'); return; }

    localStorage.setItem('vv_alias', alias);

    auth.signInAnonymously().then(async cred => {
        currentUser = cred.user;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const generateKey = () => Array.from({length: 6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
        const userKeys = [generateKey(), generateKey(), generateKey()];

        await db.collection('users').doc(cred.user.uid).set({
            alias: alias, balance: 100, rating: 5,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
            accessKey: localStorage.getItem('vv_access_key'),
            inviteKeys: userKeys, keysBalance: 3
        });

        const batch = db.batch();
        userKeys.forEach(key => {
            const ref = db.collection('access_keys').doc();
            batch.set(ref, { key, active: true, generatedBy: cred.user.uid, generatedByAlias: alias,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(), used: false });
        });
        await batch.commit();
        return Promise.resolve();
    }).then(() => {
        document.getElementById('alias-screen').style.display = 'none';
        document.getElementById('tutorial-screen').style.display = 'flex';
    }).catch(err => {
        document.getElementById('alias-screen').style.display = 'none';
        document.getElementById('tutorial-screen').style.display = 'flex';
    });
}

// ================= TUTORIAL =================
function nextTutorial(step) {
    document.querySelectorAll('.tutorial-card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById('tut-' + step);
    if (card) card.classList.add('active');
}

function finishTutorial() {
    localStorage.setItem('vv_premium_tutorial_done', 'DA');
    document.getElementById('tutorial-screen').style.display = 'none';
    showApp();
    loadUserData();
}

// ================= SHOW APP =================
function showApp() {
    const app = document.getElementById('app-container');
    const dock = document.getElementById('main-dock');
    app.style.display = 'block';
    dock.style.display = 'flex';
    setTimeout(() => { app.style.opacity = '1'; }, 50);
    initMap();
    setTimeout(function() { maybeStartProximity(); }, 3000);
    setTimeout(function() { startRemoteConfigListener(); }, 1500);
}

let lastActiveUpdated = false;

function silentLogin() {
    const current = auth.currentUser;
    if (current) {
        currentUser = current;
        if (!lastActiveUpdated) {
            lastActiveUpdated = true;
            db.collection('users').doc(current.uid).update({ lastActive: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
        }
        loadUserData();
        return;
    }
    auth.signInAnonymously().then(cred => {
        currentUser = cred.user;
        if (!lastActiveUpdated) {
            lastActiveUpdated = true;
            db.collection('users').doc(cred.user.uid).update({ lastActive: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
        }
        loadUserData();
    }).catch(err => console.log('Silent login err:', err));
}

// ================= LOAD USER DATA =================
let userDataListener = null;

function loadUserData() {
    const alias = localStorage.getItem('vv_alias') || 'INSIDER';
    var nameEl = document.getElementById('profile-main-name');
    if (nameEl) nameEl.textContent = alias;
    var hudEl = document.getElementById('hud-balance');
    if (hudEl && hudEl.textContent === '— VV') hudEl.textContent = '... VV';

    if (!currentUser) { setTimeout(loadUserData, 1000); return; }

    var uid = currentUser.uid;
    var userRef = db.collection('users').doc(uid);

    userRef.get().then(function(doc) {
        if (!doc.exists) {
            return userRef.set({ alias, balance: 100, rating: 5,
                joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
                accessKey: localStorage.getItem('vv_access_key') || '',
                lastActive: firebase.firestore.FieldValue.serverTimestamp() });
        }
    }).then(function() {
        if (userDataListener) { userDataListener(); userDataListener = null; }
        userDataListener = userRef.onSnapshot(function(doc) {
            if (!doc.exists) return;
            var data = doc.data();
            var balance = typeof data.balance === 'number' ? data.balance : 0;
            var lei = (balance * 0.5).toFixed(2);
            var hudEl2 = document.getElementById('hud-balance');
            var vvEl = document.getElementById('profile-vv-val');
            var leiEl = document.getElementById('profile-lei-val');
            var nameEl2 = document.getElementById('profile-main-name');
            if (hudEl2) hudEl2.textContent = balance + ' VV';
            if (vvEl) vvEl.textContent = balance;
            if (leiEl) leiEl.textContent = lei;
            if (nameEl2) nameEl2.textContent = data.alias || alias;
            updateOnyxProgress(balance);
            // Incarca founder data daca exista
            if (data.isFounder && !_founderData) loadFounderData(data);
        }, function(err) {
            if (err.code === 'permission-denied') setTimeout(loadUserData, 3000);
        });
    }).catch(function(err) { setTimeout(loadUserData, 2000); });

    listenInbox();
    loadInviteKeys();
    loadLeaderboard();
}

// ================= LEADERBOARD =================
function loadLeaderboard() {
    db.collection('users').limit(20).onSnapshot(function(snap) {
        const container = document.getElementById('leaderboard-container');
        if (!container) return;
        var users = [];
        snap.forEach(function(doc) {
            var u = doc.data();
            var totalRatings = u.totalRatings || 0;
            var ratingSum = u.ratingSum || 0;
            var avgStars = totalRatings > 0 ? (ratingSum / totalRatings) : 0;
            users.push({ id: doc.id, alias: u.alias || 'INSIDER', avgStars, totalRatings, balance: u.balance || 0 });
        });
        users.sort(function(a, b) { return b.avgStars - a.avgStars; });
        users = users.slice(0, 5);
        container.innerHTML = '';
        if (users.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:24px;font-size:13px;color:rgba(255,255,255,0.25);">Niciun Insider evaluat încă.</div>';
            return;
        }
        var medals = ['👑','🥈','🥉','⭐','⭐'];
        users.forEach(function(u, i) {
            var isMe = u.id === (currentUser ? currentUser.uid : null);
            var starsDisplay = '';
            var fullStars = Math.round(u.avgStars);
            for (var s = 1; s <= 5; s++) starsDisplay += '<span style="color:' + (s <= fullStars ? '#D4AF37' : 'rgba(255,255,255,0.12)') + ';font-size:12px;">★</span>';
            container.innerHTML += '<div style="display:flex;align-items:center;gap:12px;padding:13px 16px;background:' + (isMe ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)') + ';border:1px solid ' + (isMe ? 'rgba(212,175,55,0.25)' : 'rgba(255,255,255,0.06)') + ';border-radius:14px;margin-bottom:8px;">' +
                '<span style="font-size:20px;width:28px;text-align:center;">' + medals[i] + '</span>' +
                '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:' + (isMe ? '#D4AF37' : '#fff') + ';">' + u.alias + (isMe ? ' · Tu' : '') + '</div>' +
                '<div style="margin-top:3px;">' + starsDisplay + (u.totalRatings > 0 ? '<span style="font-size:10px;color:rgba(255,255,255,0.25);margin-left:5px;">(' + u.totalRatings + ')</span>' : '') + '</div></div>' +
                '<div style="font-size:11px;font-weight:700;font-family:monospace;color:rgba(255,255,255,0.3);">' + (u.avgStars > 0 ? u.avgStars.toFixed(1) : '—') + '</div></div>';
        });
    });
}

// ================= CHEI INVITATIE =================
function loadInviteKeys() {
    if (!currentUser) return;
    db.collection('users').doc(currentUser.uid).get().then(doc => {
        if (!doc.exists) return;
        const keys = doc.data().inviteKeys || [];
        const container = document.getElementById('invite-keys-container');
        if (!container) return;
        if (keys.length === 0) { container.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.3);">Nicio cheie disponibilă.</div>'; return; }
        container.innerHTML = keys.map(key => '<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 16px;margin-bottom:8px;"><span style="font-family:monospace;font-size:16px;font-weight:700;color:#fff;letter-spacing:2px;">' + key + '</span><button onclick="copyKey(\'' + key + '\')" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:6px 12px;color:rgba(255,255,255,0.6);font-size:11px;font-weight:700;cursor:pointer;letter-spacing:1px;">COPIAZĂ</button></div>').join('');
    });
}

function copyKey(key) {
    navigator.clipboard.writeText(key).then(() => showToast('Cheie copiată! Trimite-o unui prieten 🎯')).catch(() => showToast('Cheie: ' + key));
}

// ================= ONYX PROGRESS =================
function updateOnyxProgress(balance) {
    const milestones = [500, 1000, 1500];
    const nextMilestone = milestones.find(m => balance < m) || 1500;
    const prevMilestone = nextMilestone === 500 ? 0 : milestones[milestones.indexOf(nextMilestone) - 1];
    const progress = Math.min(((balance - prevMilestone) / (nextMilestone - prevMilestone)) * 100, 100);
    const bar = document.getElementById('onyx-progress-bar');
    const label = document.getElementById('onyx-progress-label');
    if (bar) bar.style.width = progress + '%';
    if (label) label.textContent = balance + ' / ' + nextMilestone + ' VV';
    milestones.forEach(m => {
        const check = document.getElementById('check-' + m);
        const milestone = document.getElementById('milestone-' + m);
        if (!check || !milestone) return;
        if (balance >= m) { check.textContent = '✅'; check.style.color = '#34c759'; milestone.style.opacity = '1'; }
        else if (m === nextMilestone) { check.textContent = Math.round(progress) + '%'; check.style.color = '#D4AF37'; milestone.style.opacity = '1'; }
        else { check.textContent = '—'; check.style.color = 'rgba(212,175,55,0.3)'; milestone.style.opacity = '0.5'; }
    });
    if (balance === 500 || balance === 1000 || balance === 1500) {
        const months = balance === 500 ? 1 : balance === 1000 ? 2 : 3;
        showToast('🎉 Felicitări! Ai câștigat ' + months + ' ' + (months === 1 ? 'lună' : 'luni') + ' ONYX gratuit!');
    }
}

// ================= HARTA =================
function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false }).setView([44.4325, 26.1038], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '', maxZoom: 19, detectRetina: true }).addTo(map);
    const romaniaBounds = L.latLngBounds(L.latLng(43.5, 20.0), L.latLng(48.5, 30.5));
    map.setMaxBounds(romaniaBounds);
    map.options.minZoom = 6;
    map.locate({ setView: false, enableHighAccuracy: true, watch: true });
    let userMarker = null;
    map.on('locationfound', e => {
        userCurrentLat = e.latlng.lat;
        userCurrentLng = e.latlng.lng;
        if (!userMarker) {
            userMarker = L.circleMarker(e.latlng, { radius: 8, fillColor: "#fff", color: "rgba(255,255,255,0.25)", weight: 10, opacity: 1, fillOpacity: 1 }).addTo(map);
        } else { userMarker.setLatLng(e.latlng); }
    });
    map.on('click', async e => {
        if (targetMarker) map.removeLayer(targetMarker);
        const crosshairIcon = L.divIcon({ className: 'target-crosshair', html: '<div class="crosshair-center"></div>', iconSize: [40,40], iconAnchor: [20,20] });
        targetMarker = L.marker(e.latlng, { icon: crosshairIcon }).addTo(map);
        targetMarker.bindPopup('<div style="text-align:center;padding:4px;min-width:160px;"><div style="font-size:10px;color:rgba(255,255,255,0.3);letter-spacing:2px;font-weight:700;">SE SCANEAZĂ...</div></div>', { closeButton: false, className: 'dark-popup' }).openPopup();
        let locationName = 'Locație necunoscută';
        try {
            const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + e.latlng.lat + '&lon=' + e.latlng.lng, { headers: { 'Accept-Language': 'ro' } });
            const data = await res.json();
            if (data && data.address) locationName = data.address.road || data.address.pedestrian || data.address.neighbourhood || data.address.suburb || data.display_name || 'Locație necunoscută';
        } catch(err) {}
        targetMarker.getPopup().setContent('<div style="text-align:center;padding:4px;min-width:160px;"><div style="font-size:9px;color:rgba(255,255,255,0.35);margin-bottom:5px;font-weight:700;letter-spacing:2px;">ZONĂ ȚINTĂ</div><div style="font-size:13px;color:#fff;font-weight:800;margin-bottom:10px;line-height:1.3;">' + locationName + '</div><button onclick="map.closePopup();openCreateMissionModal(' + e.latlng.lat + ',' + e.latlng.lng + ');" style="background:rgba(255,255,255,0.92);color:#000;border:none;padding:11px 16px;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;width:100%;letter-spacing:0.5px;">LANSEAZĂ CONTRACT</button></div>');
    });
    loadMissionsOnMap();
    initSearchBar();
    setTimeout(() => { if (map) map.invalidateSize(); }, 400);
}

// ================= SEARCH BAR =================
let searchDebounceTimer = null;

function initSearchBar() {
    const input = document.getElementById('vv-search-input');
    const clearBtn = document.getElementById('vv-search-clear');
    if (!input) return;
    input.addEventListener('input', function() {
        const query = this.value.trim();
        if (clearBtn) clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
        clearTimeout(searchDebounceTimer);
        if (query.length < 3) { hideSearchResults(); return; }
        searchDebounceTimer = setTimeout(() => searchNominatim(query), 400);
    });
    document.addEventListener('click', function(e) {
        const container = document.getElementById('vv-search-container');
        if (container && !container.contains(e.target)) hideSearchResults();
    });
}

async function searchNominatim(query) {
    const resultsEl = document.getElementById('vv-search-results');
    const loadingEl = document.getElementById('vv-search-loading');
    if (!resultsEl) return;
    resultsEl.style.display = 'none';
    loadingEl.style.display = 'block';
    try {
        const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query) + '&limit=5&countrycodes=ro&addressdetails=1&accept-language=ro', { headers: { 'Accept-Language': 'ro' } });
        const data = await res.json();
        loadingEl.style.display = 'none';
        if (!data || data.length === 0) { resultsEl.innerHTML = '<div style="padding:20px;text-align:center;font-size:12px;color:rgba(255,255,255,0.3);">Nicio locație găsită</div>'; resultsEl.style.display = 'block'; return; }
        resultsEl.innerHTML = data.map(item => {
            const name = item.address ? (item.address.road || item.address.pedestrian || item.address.neighbourhood || item.name || item.display_name.split(',')[0]) : item.display_name.split(',')[0];
            const address = item.display_name.split(',').slice(0,3).join(',');
            return '<div class="vv-search-result-item" onclick="selectSearchResult(' + item.lat + ',' + item.lon + ',\'' + name.replace(/'/g,"\\'") + '\')"><div class="vv-search-result-icon"><i class="fas fa-map-pin"></i></div><div class="vv-search-result-text"><div class="vv-search-result-name">' + name + '</div><div class="vv-search-result-address">' + address + '</div></div></div>';
        }).join('');
        resultsEl.style.display = 'block';
    } catch(err) {
        loadingEl.style.display = 'none';
        resultsEl.innerHTML = '<div style="padding:20px;text-align:center;font-size:12px;color:rgba(255,255,255,0.3);">Eroare conexiune. Încearcă din nou.</div>';
        resultsEl.style.display = 'block';
    }
}

function selectSearchResult(lat, lng, name) {
    hideSearchResults();
    const input = document.getElementById('vv-search-input');
    if (input) input.value = name;
    const clearBtn = document.getElementById('vv-search-clear');
    if (clearBtn) clearBtn.style.display = 'flex';
    if (targetMarker) map.removeLayer(targetMarker);
    map.flyTo([lat, lng], 17, { duration: 1.5, easeLinearity: 0.25 });
    setTimeout(() => {
        const crosshairIcon = L.divIcon({ className: 'target-crosshair', html: '<div class="crosshair-center"></div>', iconSize: [40,40], iconAnchor: [20,20] });
        targetMarker = L.marker([lat, lng], { icon: crosshairIcon }).addTo(map);
        targetMarker.bindPopup('<div style="text-align:center;padding:4px;min-width:160px;"><div style="font-size:9px;color:rgba(255,255,255,0.35);margin-bottom:5px;font-weight:700;letter-spacing:2px;">ZONĂ ȚINTĂ</div><div style="font-size:13px;color:#fff;font-weight:800;margin-bottom:10px;line-height:1.3;">' + name + '</div><button onclick="map.closePopup();openCreateMissionModal(' + lat + ',' + lng + ');" style="background:rgba(255,255,255,0.92);color:#000;border:none;padding:11px 16px;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;width:100%;letter-spacing:0.5px;">LANSEAZĂ CONTRACT AICI</button></div>', { closeButton: false, className: 'dark-popup' }).openPopup();
    }, 1600);
}

function clearSearch() {
    const input = document.getElementById('vv-search-input');
    const clearBtn = document.getElementById('vv-search-clear');
    if (input) input.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    hideSearchResults();
}

function hideSearchResults() {
    const resultsEl = document.getElementById('vv-search-results');
    const loadingEl = document.getElementById('vv-search-loading');
    if (resultsEl) resultsEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'none';
}

// ================= MISIUNI PE HARTĂ =================
let missionMarkers = {};
let missionsListenerActive = false;

function loadMissionsOnMap() {
    if (!map || missionsListenerActive) return;
    missionsListenerActive = true;
    const now = new Date();
    db.collection('missions').where('status', '==', 'open').onSnapshot(snap => {
        snap.docChanges().forEach(change => {
            const doc = change.doc;
            const m = doc.data();
            if (change.type === 'removed') {
                if (missionMarkers[doc.id]) { try { map.removeLayer(missionMarkers[doc.id]); } catch(e) {} delete missionMarkers[doc.id]; }
                return;
            }
            if (change.type === 'modified') {
                if (missionMarkers[doc.id]) { try { map.removeLayer(missionMarkers[doc.id]); } catch(e) {} delete missionMarkers[doc.id]; }
            }
            if (m.status !== 'open') return;
            if (!m.lat || !m.lng) return;
            updateMissionProximityCache(doc.id, m);
            if (m.expiresAt && m.expiresAt.toDate() < now) return;
            const minsLeft = m.expiresAt ? Math.max(0, Math.round((m.expiresAt.toDate() - now) / 60000)) : null;
            const isFounderMission = m.createdByFounder || false;
            const icon = L.divIcon({
                className: '',
                html: '<div style="background:' + (isFounderMission ? 'rgba(255,255,255,0.85)' : 'rgba(255,59,48,0.85)') + ';backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:2px solid ' + (isFounderMission ? 'rgba(255,255,255,0.6)' : 'rgba(255,100,80,0.6)') + ';border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:' + (isFounderMission ? '18px' : '16px') + ';box-shadow:0 0 16px ' + (isFounderMission ? 'rgba(255,255,255,0.4)' : 'rgba(255,59,48,0.4)') + ';animation:missionPulse 2s infinite;">' + (isFounderMission ? '⬡' : '🎯') + '</div>',
                iconSize: [38,38], iconAnchor: [19,19]
            });
            const marker = L.marker([m.lat, m.lng], { icon, zIndexOffset: 1000 }).addTo(map);
            const isMyMission = m.createdBy === (currentUser ? currentUser.uid : null);
            if (isMyMission) {
                marker.bindPopup('<div style="padding:4px;min-width:200px;"><div style="font-size:10px;color:#D4AF37;margin-bottom:5px;letter-spacing:2px;font-weight:700;">MISIUNEA TA</div><div style="font-size:14px;color:#fff;font-weight:800;margin-bottom:6px;">' + (m.description||'Misiune') + '</div><div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="font-size:12px;color:rgba(255,255,255,0.5);">Recompensă</span><span style="font-size:13px;color:#fff;font-weight:900;">' + m.reward + ' VV</span></div><button onclick="map.closePopup();cancelMyMission(\'' + doc.id + '\',' + m.reward + ');" style="background:rgba(255,59,48,0.1);color:#ff3b30;border:1px solid rgba(255,59,48,0.3);padding:10px;border-radius:10px;font-weight:700;font-size:12px;cursor:pointer;width:100%;">ANULEAZĂ & RECUPEREAZĂ ' + m.reward + ' VV</button></div>', { closeButton: false, className: 'dark-popup' });
            } else {
                marker.bindPopup('<div style="padding:4px;min-width:190px;"><div style="font-size:10px;color:rgba(255,59,48,0.8);margin-bottom:6px;letter-spacing:2px;font-weight:700;">CONTRACT ACTIV</div><div style="font-size:14px;color:#fff;font-weight:800;margin-bottom:8px;">' + (m.description||'Misiune') + '</div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><span style="font-size:13px;color:#fff;font-weight:900;">' + m.reward + ' VV</span>' + (minsLeft !== null ? '<span style="font-size:11px;color:rgba(255,255,255,0.4);">⏱ ' + minsLeft + ' min</span>' : '') + '</div><button onclick="map.closePopup();acceptMission(\'' + doc.id + '\');" style="background:rgba(255,255,255,0.92);color:#000;border:none;padding:12px;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;width:100%;">ACCEPTĂ MISIUNEA</button></div>', { closeButton: false, className: 'dark-popup' });
            }
            missionMarkers[doc.id] = marker;
        });
    });
}

// ================= MODAL CREATE MISSION =================
let missionLat = null, missionLng = null;

function openCreateMissionModal(lat, lng) { missionLat = lat; missionLng = lng; openModal('create-mission-modal'); }

// Config niveluri
const REWARD_CONFIG = {
    5:  { expiryMin: 25, radiusM: 100, label: 'STANDARD', prioritySec: 0 },
    15: { expiryMin: 15, radiusM: 150, label: 'RAPID',    prioritySec: 0 },
    25: { expiryMin: 5,  radiusM: 250, label: 'PRIORITY', prioritySec: 10 }
};
function getRewardConfig(r) { return REWARD_CONFIG[r] || REWARD_CONFIG[15]; }

const PULSE_25_KEY = 'vv_pulse_25_uses';
(function(){ var old = localStorage.getItem('vv_beta_25_uses'); if(old && !localStorage.getItem('vv_pulse_25_uses')){ localStorage.setItem('vv_pulse_25_uses', old); localStorage.removeItem('vv_beta_25_uses'); }})();
const PULSE_25_MAX = 5;
function getPulse25Uses() { return parseInt(localStorage.getItem(PULSE_25_KEY) || '0'); }
function incrementPulse25Uses() { localStorage.setItem(PULSE_25_KEY, String(getPulse25Uses() + 1)); }
function canUse25() { return getPulse25Uses() < PULSE_25_MAX; }

function selectReward(val) {
    selectedReward = val;
    document.querySelectorAll('.reward-btn[id^="rew-btn"]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('rew-btn-' + val);
    if (btn) btn.classList.add('active');
    const cfg = getRewardConfig(val);
    const infoEl = document.getElementById('reward-info-bar');
    if (infoEl) {
        infoEl.style.display = 'block';
        if (val === 25) {
            const usesLeft = PULSE_25_MAX - getPulse25Uses();
            infoEl.innerHTML = '<span style="color:#D4AF37;font-weight:700">⚡ PRIORITY</span> · Rază ' + cfg.radiusM + 'm · Expiră în ' + cfg.expiryMin + ' min · <span style="color:rgba(255,149,0,0.8)">' + usesLeft + '/' + PULSE_25_MAX + ' rămase azi</span>';
        } else {
            infoEl.innerHTML = 'Rază <b>' + cfg.radiusM + 'm</b> · Expiră în <b>' + cfg.expiryMin + ' min</b>';
        }
    }
}

async function submitPinpointMission() {
    const desc = document.getElementById('mission-desc').value.trim();
    if (!desc) { showToast('Descrie misiunea!'); return; }
    if (selectedReward === 25 && !canUse25()) { showToast('⚠️ Ai epuizat cele ' + PULSE_25_MAX + ' PRIORITY de azi.'); return; }
    if (!currentUser) { try { const c = await auth.signInAnonymously(); currentUser = c.user; } catch(e) { showToast('Eroare reconectare.'); return; } }
    const launchBtn = document.getElementById('btn-launch-radar');
    launchBtn.textContent = 'SE VERIFICĂ...'; launchBtn.style.opacity = '0.6';
    const cfg = getRewardConfig(selectedReward);
    try {
        const freshPos = await new Promise((resolve, reject) => {
            if (navigator.geolocation) navigator.geolocation.getCurrentPosition(pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }), err => userCurrentLat !== null ? resolve({ lat: userCurrentLat, lng: userCurrentLng }) : reject(err), { enableHighAccuracy: true, timeout: 5000 });
            else if (userCurrentLat !== null) resolve({ lat: userCurrentLat, lng: userCurrentLng });
            else reject(new Error('GPS indisponibil'));
        });
        const dist = haversineDistance(freshPos.lat, freshPos.lng, parseFloat(missionLat)||44.4325, parseFloat(missionLng)||26.1038);
        if (dist < 100) { showToast('⚠️ Prea aproape! Minim 100m. (' + Math.round(dist) + 'm acum)'); launchBtn.textContent = 'LANSEAZĂ CONTRACTUL'; launchBtn.style.opacity = '1'; return; }
    } catch(e) {}
    launchBtn.textContent = 'SE LANSEAZĂ...';
    const expiresAt = new Date(Date.now() + cfg.expiryMin * 60 * 1000);
    db.collection('users').doc(currentUser.uid).get().then(doc => {
        const balance = (doc.data() ? doc.data().balance : 0) || 0;
        if (balance < selectedReward) { showToast('VV insuficienți! Ai ' + balance + ' VV.'); launchBtn.textContent = 'LANSEAZĂ CONTRACTUL'; launchBtn.style.opacity = '1'; return; }
        const batch = db.batch();
        const missionRef = db.collection('missions').doc();
        lastCreatedMissionId = missionRef.id;
        batch.set(missionRef, { description: desc, reward: selectedReward, rewardLabel: cfg.label, radiusM: cfg.radiusM, lat: missionLat||44.4325, lng: missionLng||26.1038, createdBy: currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp(), expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt), expiryMinutes: cfg.expiryMin, priorityBoostSec: cfg.prioritySec, status: 'open' });
        batch.update(db.collection('users').doc(currentUser.uid), { balance: firebase.firestore.FieldValue.increment(-selectedReward) });
        return batch.commit();
    }).then(() => {
        if (selectedReward === 25) { incrementPulse25Uses(); showToast('⚡ PRIORITY lansat! ' + (PULSE_25_MAX - getPulse25Uses()) + ' rămase azi.'); }
        closeModal('create-mission-modal');
        document.getElementById('mission-desc').value = '';
        const infoEl = document.getElementById('reward-info-bar');
        if (infoEl) infoEl.style.display = 'none';
        launchBtn.textContent = 'LANSEAZĂ CONTRACTUL'; launchBtn.style.opacity = '1';
        showInsiderSearch(selectedReward);
    }).catch(() => { showToast('Eroare. Încearcă din nou.'); launchBtn.textContent = 'LANSEAZĂ CONTRACTUL'; launchBtn.style.opacity = '1'; });
}

// ================= LISTA MISIUNI =================
function openMissionsList() {
    openModal('missions-list-modal');
    const container = document.getElementById('missions-container');
    container.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:30px;font-size:13px;">Se încarcă...</div>';
    db.collection('missions').where('status', '==', 'open').limit(20).get().then(snap => {
        if (snap.empty) { container.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:30px;font-size:13px;">Nicio misiune activă momentan.</div>'; return; }
        container.innerHTML = '';
        const now = new Date();
        snap.forEach(doc => {
            const m = doc.data();
            if (m.expiresAt && m.expiresAt.toDate() < now) return;
            if (currentUser && m.createdBy === currentUser.uid) return;
            const div = document.createElement('div');
            div.style.cssText = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;margin-bottom:12px;cursor:pointer;';
            div.innerHTML = '<div style="font-size:13px;color:#fff;font-weight:700;margin-bottom:6px;">' + (m.description||'Misiune') + '</div><div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:12px;color:rgba(255,255,255,0.4);">Recompensă</span><span style="font-size:14px;color:#fff;font-weight:800;">' + m.reward + ' VV</span></div>';
            div.onclick = () => acceptMission(doc.id);
            container.appendChild(div);
        });
    }).catch(() => { container.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:30px;">Eroare de conexiune.</div>'; });
}

// ================= ANULEAZĂ MISIUNEA =================
var isCancelling = false;
var lastCreatedMissionId = null;

async function cancelMyMission(missionId, reward) {
    if (!currentUser || isCancelling) return;
    if (!confirm('Anulezi misiunea și recuperezi ' + reward + ' VV?')) return;
    isCancelling = true;
    try {
        const missionSnap = await db.collection('missions').doc(missionId).get();
        if (!missionSnap.exists || missionSnap.data().status !== 'open') {
            showToast('Misiunea nu mai poate fi anulata.');
            return;
        }
        const batch = db.batch();
        batch.update(db.collection('missions').doc(missionId), { status: 'cancelled', cancelledAt: firebase.firestore.FieldValue.serverTimestamp() });
        batch.update(db.collection('users').doc(currentUser.uid), { balance: firebase.firestore.FieldValue.increment(reward) });
        await batch.commit();
        if (missionMarkers[missionId]) { try { map.removeLayer(missionMarkers[missionId]); } catch(e) {} delete missionMarkers[missionId]; }
        showToast('Misiune anulata! +' + reward + ' VV recuperati.');
    } catch(e) {
        var msg = e.code === 'permission-denied' ? 'Permisiune refuzata. Reconecteaza-te.' :
                  e.code === 'not-found' ? 'Misiunea nu mai exista.' :
                  'Eroare: ' + (e.message || e.code || 'necunoscuta');
        showToast(msg);
    } finally { isCancelling = false; }
}

async function openMissionResult(missionId) {
    try {
        const snap = await db.collection('inbox').where('missionId', '==', missionId).limit(1).get();
        const modal = document.createElement('div');
        modal.id = 'mission-result-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;';
        let photoHtml = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:30px;">Poza se procesează...</div>';
        if (!snap.empty) {
            const data = snap.docs[0].data();
            if (data.photoUrl) photoHtml = '<div style="position:relative;"><img src="' + data.photoUrl + '" style="width:100%;border-radius:12px;display:block;"/><div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(8px);padding:10px 14px;border-radius:0 0 12px 12px;"><div style="font-size:11px;color:#fff;font-weight:800;">VV PROOF</div><div style="font-size:10px;color:rgba(255,255,255,0.5);">de ' + (data.alias||'INSIDER') + '</div></div></div>';
        }
        modal.innerHTML = '<div style="background:rgba(10,10,14,0.98);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:24px;width:90%;max-width:360px;"><div style="font-size:10px;color:rgba(255,255,255,0.3);letter-spacing:3px;margin-bottom:8px;">VV PROOF</div><div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:16px;">Rezultatul Misiunii</div>' + photoHtml + '<button onclick="document.getElementById(\'mission-result-modal\').remove();" style="width:100%;margin-top:16px;padding:14px;border-radius:12px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);border:1px solid rgba(255,255,255,0.08);font-weight:700;font-size:13px;cursor:pointer;">ÎNCHIDE</button></div>';
        document.body.appendChild(modal);
    } catch(e) { showToast('Eroare: ' + e.message); }
}

// ================= ACCEPTĂ MISIUNEA =================
async function acceptMission(missionId) {
    if (!currentUser) { showToast('Nu ești conectat!'); return; }
    if (currentMissionId) { showToast('⚠️ Termină misiunea activă mai întâi!'); return; }
    try {
        const missionDoc = await db.collection('missions').doc(missionId).get();
        if (!missionDoc.exists) { showToast('Misiunea nu mai există.'); return; }
        const m = missionDoc.data();
        if (m.createdBy === currentUser.uid) { showToast('❌ Nu poți accepta propriile misiuni!'); return; }
        const radiusM = m.radiusM || 100;
        if (userCurrentLat !== null && m.lat && m.lng) {
            const dist = haversineDistance(userCurrentLat, userCurrentLng, m.lat, m.lng);
            if (dist > radiusM) { showToast('📍 Ești la ' + Math.round(dist) + 'm. Trebuie să fii în raza de ' + radiusM + 'm.'); return; }
        }
    } catch(e) {}
    currentMissionId = missionId;
    closeModal('missions-list-modal');
    showToast('Misiune acceptată! Trimite dovada 📸');
    openCamera();
}

// ================= INBOX =================
function openInbox() { openModal('inbox-modal'); updateIntelligenceInboxCard(); }

function getInboxTypeConfig(msg) {
    var type = msg.type || '';
    var configs = {
        rejection_dsa:    { icon:'❌', label:'DOVADĂ RESPINSĂ',    color:'#ff3b30', bg:'rgba(255,59,48,0.08)',   border:'rgba(255,59,48,0.2)' },
        official_warning: { icon:'⚠️', label:'AVERTISMENT OFICIAL', color:'#ff9500', bg:'rgba(255,149,0,0.08)',  border:'rgba(255,149,0,0.2)' },
        ban_notice:       { icon:'🚫', label:'CONT SUSPENDAT',      color:'#ff3b30', bg:'rgba(255,59,48,0.08)',  border:'rgba(255,59,48,0.2)' },
        unban_notice:     { icon:'✅', label:'ACCES RESTAURAT',     color:'#34c759', bg:'rgba(52,199,89,0.08)',  border:'rgba(52,199,89,0.2)' },
        reward_notification: { icon:'⭐', label:'RECOMPENSĂ PRIMITĂ', color:'#D4AF37', bg:'rgba(212,175,55,0.08)', border:'rgba(212,175,55,0.2)' },
        support_resolved: { icon:'💬', label:'SUPORT REZOLVAT',    color:'#0A84FF', bg:'rgba(10,132,255,0.08)', border:'rgba(10,132,255,0.2)' }
    };
    if (configs[type]) return configs[type];
    if (msg.reward) return { icon:'📦', label:'MISIUNE PRIMITĂ', color:'rgba(255,255,255,0.6)', bg:'rgba(255,255,255,0.05)', border:'rgba(255,255,255,0.1)' };
    return { icon:'📩', label:'MESAJ VV', color:'rgba(255,255,255,0.4)', bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.08)' };
}

function listenInbox() {
    if (!currentUser) return;
    db.collection('inbox').where('to', '==', currentUser.uid).limit(50).onSnapshot(function(snap) {
        var badge = document.getElementById('inbox-badge');
        var intelBadge = document.getElementById('intel-inbox-badge');
        var unread = 0;
        var container = document.getElementById('inbox-container');
        container.innerHTML = '';
        var docs = [];
        snap.forEach(function(doc) { docs.push(doc); });
        docs.sort(function(a, b) { var ta = a.data().createdAt ? a.data().createdAt.toMillis() : 0; var tb = b.data().createdAt ? b.data().createdAt.toMillis() : 0; return tb - ta; });
        if (docs.length === 0) {
            container.innerHTML = '<div style="color:rgba(255,255,255,0.3);text-align:center;padding:30px;font-size:13px;">Niciun mesaj primit.</div>';
            if (badge) { badge.textContent = '0'; badge.style.display = 'none'; }
            if (intelBadge) intelBadge.style.display = 'none';
            return;
        }
        docs.forEach(function(doc) {
            var msg = doc.data();
            if (msg.status === 'reported') return;
            if (!msg.read) unread++;
            var cfg = getInboxTypeConfig(msg);
            var timeStr = msg.createdAt ? msg.createdAt.toDate().toLocaleString('ro-RO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
            var div = document.createElement('div');
            div.style.cssText = 'background:' + cfg.bg + ';border:1px solid ' + cfg.border + ';border-radius:14px;padding:16px;margin-bottom:10px;';
            var inner = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div style="display:flex;align-items:center;gap:6px;"><span style="font-size:14px;">' + cfg.icon + '</span><span style="font-size:9px;color:' + cfg.color + ';letter-spacing:2px;font-weight:800;">' + cfg.label + '</span>' + (!msg.read ? '<span style="width:6px;height:6px;background:' + cfg.color + ';border-radius:50%;display:inline-block;"></span>' : '') + '</div><span style="font-size:10px;color:rgba(255,255,255,0.2);">' + timeStr + '</span></div><div style="font-size:13px;color:rgba(255,255,255,0.82);line-height:1.6;margin-bottom:' + (msg.reward || msg.photoUrl ? '12px' : '0') + ';">' + (msg.message||'') + '</div>';
            if (msg.photoUrl) inner += '<img src="' + msg.photoUrl + '" style="width:100%;border-radius:10px;margin-bottom:10px;"/>';
            div.innerHTML = inner + '</div>';
            if (msg.reward && !msg.type) {
                var btnApprove = document.createElement('button');
                btnApprove.style.cssText = 'background:rgba(255,255,255,0.9);color:#000;border:none;padding:12px;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;width:100%;margin-bottom:6px;min-height:44px;';
                btnApprove.textContent = 'APROBĂ +' + msg.reward + ' VV';
                (function(id, reward, from) { btnApprove.onclick = function() { openPremiumFeedback(id, reward, from); }; })(doc.id, msg.reward, msg.from);
                div.appendChild(btnApprove);
                var btnReport = document.createElement('button');
                btnReport.className = 'btn-report-fake';
                btnReport.textContent = '🚩 RAPORTEAZĂ FAKE';
                (function(id, reward) { btnReport.onclick = function() { reportIntel(id, reward); }; })(doc.id, msg.reward);
                div.appendChild(btnReport);
            }
            container.appendChild(div);
            doc.ref.update({ read: true });
        });
        if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? 'flex' : 'none'; }
        if (intelBadge) { intelBadge.textContent = unread > 0 ? unread : ''; intelBadge.style.display = unread > 0 ? 'flex' : 'none'; }
        updateIntelligenceInboxCard();
    });
}

function updateIntelligenceInboxCard() {
    if (!currentUser) return;
    var previewEl = document.getElementById('intel-inbox-preview');
    if (!previewEl) return;
    db.collection('inbox').where('to', '==', currentUser.uid).limit(10).get().then(function(snap) {
        if (snap.empty) { previewEl.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px;text-align:center;padding:10px;">Niciun mesaj primit încă.</div>'; return; }
        previewEl.innerHTML = '';
        snap.forEach(function(doc) {
            var msg = doc.data();
            if (msg.status === 'reported') return;
            var cfg = getInboxTypeConfig(msg);
            var preview = (msg.message||'').substring(0, 60) + ((msg.message||'').length > 60 ? '...' : '');
            previewEl.innerHTML += '<div style="display:flex;align-items:flex-start;gap:8px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><span style="font-size:16px;flex-shrink:0;">' + cfg.icon + '</span><div style="flex:1;min-width:0;"><div style="font-size:10px;color:' + cfg.color + ';letter-spacing:1.5px;font-weight:700;margin-bottom:2px;">' + cfg.label + '</div><div style="font-size:12px;color:rgba(255,255,255,0.55);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + preview + '</div></div>' + (!msg.read ? '<div style="width:6px;height:6px;background:' + cfg.color + ';border-radius:50%;flex-shrink:0;margin-top:4px;"></div>' : '') + '</div>';
        });
    });
}

async function reportIntel(inboxId, reward) {
    if (!currentUser) return;
    if (!confirm('Raportezi această dovadă ca FAKE?\n\nVei primi înapoi ' + reward + ' VV și cazul va fi investigat.')) return;
    try {
        const batch = db.batch();
        batch.update(db.collection('users').doc(currentUser.uid), { balance: firebase.firestore.FieldValue.increment(reward) });
        batch.update(db.collection('inbox').doc(inboxId), { status: 'reported', reportedAt: firebase.firestore.FieldValue.serverTimestamp(), reportedBy: currentUser.uid, reward: 0 });
        await batch.commit();
        showToast('🚩 Raportat! +' + reward + ' VV recuperați.');
    } catch(e) { showToast('Eroare la raportare: ' + e.message); }
}

function selectTip(val) {
    selectedTip = val;
    document.querySelectorAll('.reward-btn[id^="tip-btn"]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('tip-btn-' + val);
    if (btn) btn.classList.add('active');
}

function finalizeApprovalWithTips() {
    const customTip = parseInt(document.getElementById('custom-tip').value) || selectedTip;
    showToast('Plată de ' + customTip + ' VV trimisă!');
    closeModal('tips-modal');
}

function sendFeedback() {
    var ta = document.getElementById('support-msg-input') || document.getElementById('feedback-msg-input');
    var msg = ta ? ta.value.trim() : '';
    if (!msg) { showToast('Scrie un mesaj!'); return; }
    db.collection('feedback').add({ message: msg, uid: (currentUser ? currentUser.uid : null) || 'anonim', alias: localStorage.getItem('vv_alias') || 'INSIDER', createdAt: firebase.firestore.FieldValue.serverTimestamp() }).then(function() { showToast('Mesaj trimis! Mulțumim. ✅'); if (ta) { ta.value = ''; ta.blur(); } closeModal('modal-support-career'); }).catch(function() { showToast('Eroare trimitere.'); });
}

function sendSupport() {
    var ta = document.getElementById('support-msg-input');
    if (!ta || !ta.value.trim()) { showToast('Scrie un mesaj!'); return; }
    db.collection('feedback').add({ message: ta.value.trim(), uid: (currentUser ? currentUser.uid : null) || 'anonim', alias: localStorage.getItem('vv_alias') || 'INSIDER', createdAt: firebase.firestore.FieldValue.serverTimestamp() }).then(function() { showToast('Mesaj trimis! ✅'); ta.value = ''; ta.blur(); closeModal('modal-support-career'); }).catch(function() { showToast('Eroare la trimitere.'); });
}

// ================= CAMERA =================
// openCamera e apelata direct — VVeil e in Setari
function openCamera() {
    const cam = document.getElementById('camera-screen');
    cam.style.display = 'flex';
    document.getElementById('post-photo-menu').style.display = 'none';
    document.getElementById('shutter-container').style.display = 'flex';
    capturedImageBlob = null;
    capturedGPS = null;
    var oldPreview = document.getElementById('preview-img');
    if (oldPreview) oldPreview.remove();
    var video = document.getElementById('real-camera-video');
    if (video) video.style.display = 'block';
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(pos => { capturedGPS = { lat: pos.coords.latitude, lng: pos.coords.longitude }; }, () => { capturedGPS = null; });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(stream => { currentStream = stream; document.getElementById('real-camera-video').srcObject = stream; }).catch(err => { showToast('Cameră indisponibilă: ' + err.message); cam.style.display = 'none'; });
}

function closeCamera() {
    document.getElementById('camera-screen').style.display = 'none';
    if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
}

let capturedGPS = null;

function applyVVeil(canvas, ctx) {
    const width = canvas.width, height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const blockSize = 20;
    let facesFound = 0;
    for (let y = 0; y < height; y += blockSize) {
        for (let x = 0; x < width; x += blockSize) {
            let skinCount = 0, total = 0;
            for (let by = 0; by < blockSize && y+by < height; by++) {
                for (let bx = 0; bx < blockSize && x+bx < width; bx++) {
                    const idx = ((y+by)*width + (x+bx)) * 4;
                    const r = data[idx], g = data[idx+1], b = data[idx+2];
                    if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r-g) > 15) skinCount++;
                    total++;
                }
            }
            if (skinCount/total > 0.4) {
                ctx.save(); ctx.filter = 'blur(15px)';
                ctx.drawImage(canvas, x, y, blockSize*3, blockSize*3, x, y, blockSize*3, blockSize*3);
                ctx.filter = 'none'; ctx.restore();
                facesFound++;
            }
        }
    }
    return facesFound;
}

function takePicture() {
    const video = document.getElementById('real-camera-video');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const vveilChoice = localStorage.getItem('vv_vveil_consent') || 'auto';
    let facesFound = 0;
    if (vveilChoice === 'auto') facesFound = applyVVeil(canvas, ctx);
    const now = new Date();
    const gpsStr = capturedGPS ? capturedGPS.lat.toFixed(5) + ', ' + capturedGPS.lng.toFixed(5) : 'GPS N/A';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height - 70, canvas.width, 70);
    ctx.font = 'bold 15px -apple-system'; ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
    ctx.fillText('VV PROOF', 14, canvas.height - 46);
    ctx.font = '12px -apple-system'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.shadowBlur = 0;
    ctx.fillText('📍 ' + gpsStr, 14, canvas.height - 28);
    ctx.fillText('🕐 ' + now.toLocaleString('ro-RO'), 14, canvas.height - 10);
    canvas.toBlob(blob => {
        capturedImageBlob = blob;
        const url = URL.createObjectURL(blob);
        document.getElementById('real-camera-video').style.display = 'none';
        const preview = document.createElement('img');
        preview.src = url; preview.style.cssText = 'width:100%;height:100%;object-fit:cover;'; preview.id = 'preview-img';
        document.querySelector('.cam-viewfinder').appendChild(preview);
        if (facesFound > 0) showToast('🛡 VVeil: ' + facesFound + ' zone protejate automat');
    }, 'image/jpeg', 0.92);
    document.getElementById('shutter-container').style.display = 'none';
    document.getElementById('post-photo-menu').style.display = 'block';
}

function retakePhoto() {
    capturedImageBlob = null;
    const preview = document.getElementById('preview-img');
    if (preview) preview.remove();
    document.getElementById('real-camera-video').style.display = 'block';
    document.getElementById('shutter-container').style.display = 'flex';
    document.getElementById('post-photo-menu').style.display = 'none';
}

async function uploadPhotoToCEO() {
    if (!capturedImageBlob) { showToast('Nu ai capturat nicio poză!'); return; }
    if (!currentUser) { try { const cred = await auth.signInAnonymously(); currentUser = cred.user; } catch(e) { showToast('Eroare reconectare.'); return; } }
    var msg = document.getElementById('photo-msg').value.trim();
    var sendBtn = document.getElementById('send-btn');
    function resetBtn() { sendBtn.textContent = 'TRIMITE RAPORT'; sendBtn.style.opacity = '1'; sendBtn.style.pointerEvents = 'auto'; }
    sendBtn.textContent = 'SE VERIFICĂ...'; sendBtn.style.opacity = '0.6'; sendBtn.style.pointerEvents = 'none';
    if (currentMissionId) {
        try {
            const missionDoc = await db.collection('missions').doc(currentMissionId).get();
            if (missionDoc.exists) {
                const mData = missionDoc.data();
                const freshPos = await new Promise((resolve, reject) => {
                    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }), err => capturedGPS ? resolve(capturedGPS) : userCurrentLat !== null ? resolve({ lat: userCurrentLat, lng: userCurrentLng }) : reject(err), { enableHighAccuracy: true, timeout: 5000 });
                    else if (capturedGPS) resolve(capturedGPS);
                    else if (userCurrentLat !== null) resolve({ lat: userCurrentLat, lng: userCurrentLng });
                    else reject(new Error('GPS indisponibil'));
                });
                const distToMission = haversineDistance(freshPos.lat, freshPos.lng, mData.lat, mData.lng);
                if (distToMission > 50) { showToast('📍 Ești prea departe! Maxim 50m.'); resetBtn(); return; }
            }
        } catch(e) {}
    }
    sendBtn.textContent = 'SE TRIMITE...';
    var fileName = 'proofs/' + currentUser.uid + '_' + Date.now() + '.jpg';
    var ref = storage.ref(fileName);
    try {
        await ref.put(capturedImageBlob);
        var url = await ref.getDownloadURL();
        var alias = localStorage.getItem('vv_alias') || 'INSIDER';
        var uid = currentUser.uid || '';
        var missionId = currentMissionId || null;
        var now = firebase.firestore.FieldValue.serverTimestamp();
        var batch = db.batch();
        batch.set(db.collection('inbox').doc(), { to: 'CEO', from: uid, alias, message: msg || 'Captură trimisă', photoUrl: url, missionId, reward: selectedReward || 0, read: false, createdAt: now });
        batch.set(db.collection('photos').doc(), { url, message: msg || 'Captură VV', agentId: uid, alias, missionId, gpsLat: capturedGPS ? capturedGPS.lat : null, gpsLng: capturedGPS ? capturedGPS.lng : null, timestamp: Date.now(), createdAt: now, flagged: false, approved: false });
        if (missionId) {
            try {
                var missionDoc = await db.collection('missions').doc(missionId).get();
                if (missionDoc.exists) {
                    var missionData = missionDoc.data();
                    var creatorId = missionData.createdBy || '';
                    if (creatorId && creatorId !== uid) {
                        batch.set(db.collection('inbox').doc(), { to: creatorId, from: uid, alias, message: msg || 'Insider a completat misiunea ta!', photoUrl: url, missionId, reward: missionData.reward || 0, read: false, type: 'mission_result', createdAt: now });
                        batch.update(db.collection('missions').doc(missionId), { status: 'completed', photoUrl: url, solverId: uid, solvedAt: now });
                    }
                }
            } catch(e) {}
        }
        await batch.commit();
        resetBtn();
        showToast('Raport trimis! ✅');
        document.getElementById('photo-msg').value = '';
        currentMissionId = null; capturedImageBlob = null; capturedGPS = null;
        closeCamera();
        // Edge Profile — oferta dupa prima misiune
        setTimeout(maybeOfferEdgeProfile, 2000);
        setTimeout(function() { switchTab('map'); }, 1500);
    } catch(err) { showToast('Eroare: ' + (err.message || 'necunoscută')); }
    finally { resetBtn(); }
}

// ================= SETTINGS =================
function openSettings() {
    openModal('settings-modal');
    // Actualizeaza label VVeil
    var label = document.getElementById('vveil-status-label');
    if (label) {
        var v = localStorage.getItem('vv_vveil_consent') || 'auto';
        var names = { auto: 'Blur automat · Activ', watermark: 'Vizibil cu watermark VV', none: 'Fără protecție' };
        label.textContent = names[v] || 'Blur automat · Activ';
    }
}

function logoutAgent() {
    localStorage.removeItem('vv_premium_tutorial_done');
    localStorage.removeItem('vv_access_key');
    localStorage.removeItem('vv_alias');
    auth.signOut().then(() => location.reload());
}

// ================= SWITCH TAB =================
function switchTab(tab) {
    const mapView = document.getElementById('map-view');
    const profileView = document.getElementById('profile-screen');
    const tabMap = document.getElementById('tab-map');
    const tabProfile = document.getElementById('tab-profile');
    if (tab === 'map') {
        mapView.style.display = 'block'; profileView.style.display = 'none';
        tabMap.classList.add('active'); tabProfile.classList.remove('active');
        setTimeout(() => { if (map) map.invalidateSize(); }, 100);
    } else {
        mapView.style.display = 'none'; profileView.style.display = 'block';
        tabMap.classList.remove('active'); tabProfile.classList.add('active');
    }
}

// ================= MODAL HELPERS =================
function openModal(id) { const modal = document.getElementById(id); if (modal) modal.style.display = 'flex'; }
function closeModal(id) { const modal = document.getElementById(id); if (modal) modal.style.display = 'none'; }

// ================= VVEIL SETARI =================
function openVVeilSettings() {
    var old = document.getElementById('vveil-settings-modal');
    if (old) old.remove();
    var current = localStorage.getItem('vv_vveil_consent') || 'auto';
    var modal = document.createElement('div');
    modal.id = 'vveil-settings-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;align-items:flex-end;justify-content:center;';
    var options = [
        { id: 'auto',      icon: '🛡', title: 'Blur automat', desc: 'Fețele detectate sunt estompate. Maxim anonim.' },
        { id: 'watermark', icon: '⬡', title: 'Vizibil cu watermark VV', desc: 'Fața ta apare cu marca VV·PROOF.' },
        { id: 'none',      icon: '✕', title: 'Fără protecție', desc: 'Ești responsabil pentru ce apare în imagini.' }
    ];
    var optionsHtml = options.map(function(o) {
        var isActive = current === o.id;
        return '<div onclick="setVVeilFromSettings(\'' + o.id + '\')" style="display:flex;align-items:flex-start;gap:14px;padding:14px 16px;background:' + (isActive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)') + ';border:1px solid ' + (isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)') + ';border-radius:14px;margin-bottom:8px;cursor:pointer;"><div style="width:36px;height:36px;background:rgba(255,255,255,0.05);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">' + o.icon + '</div><div style="flex:1;"><div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:3px;">' + o.title + (isActive ? ' ✓' : '') + '</div><div style="font-size:11px;color:rgba(255,255,255,0.35);line-height:1.5;">' + o.desc + '</div></div></div>';
    }).join('');
    modal.innerHTML = '<div style="width:100%;max-width:430px;background:rgba(14,14,18,0.98);border:1px solid rgba(255,255,255,0.09);border-radius:26px 26px 0 0;padding:28px 22px calc(28px + env(safe-area-inset-bottom,0px));"><div style="width:32px;height:3px;background:rgba(255,255,255,0.12);border-radius:2px;margin:0 auto 22px;"></div><div style="font-size:9px;color:rgba(255,255,255,0.3);letter-spacing:3px;font-weight:700;margin-bottom:8px;">VVeil · PROTECȚIE IDENTITATE</div><div style="font-size:17px;font-weight:800;color:#fff;margin-bottom:8px;">Cum apari în VV?</div><div style="font-size:12px;color:rgba(255,255,255,0.35);line-height:1.6;margin-bottom:18px;">Alege cum camera VV gestionează fețele din imagini.</div>' + optionsHtml + '<div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:14px;line-height:1.6;text-align:center;">Conform GDPR · UE 679/2016 · Poți schimba oricând</div><button onclick="document.getElementById(\'vveil-settings-modal\').remove();" style="width:100%;padding:14px;background:rgba(255,255,255,0.06);border:none;border-radius:14px;color:rgba(255,255,255,0.4);font-weight:700;font-size:13px;margin-top:14px;cursor:pointer;font-family:inherit;">ÎNCHIDE</button></div>';
    document.body.appendChild(modal);
}

function setVVeilFromSettings(choice) {
    localStorage.setItem('vv_vveil_consent', choice);
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('users').doc(currentUser.uid).update({ vveilConsent: choice, vveilConsentAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(function(){});
    }
    var modal = document.getElementById('vveil-settings-modal');
    if (modal) modal.remove();
    showToast('VVeil actualizat ✓');
    // Redeschide setarile actualizate
    setTimeout(openVVeilSettings, 100);
}

// ================= FOUNDER DATA =================
var _founderData = null;

function loadFounderData(userData) {
    if (!userData || !userData.isFounder) return;
    _founderData = {
        isFounder: true,
        founderNum: userData.founderNum || null,
        vvCoreId:   userData.vvCoreId   || null,
        vvId:       userData.vvId       || null,
        alias:      userData.alias      || localStorage.getItem('vv_alias') || 'INSIDER'
    };
    injectFounderSection();
}

function injectFounderSection() {
    if (!_founderData) return;
    if (document.getElementById('vv-founder-section')) return;

    // Badge lângă nume
    var nameEl = document.getElementById('profile-main-name');
    if (nameEl && !nameEl.querySelector('.founder-dot')) {
        var dot = document.createElement('span');
        dot.className = 'founder-dot';
        dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:#fff;border:1px solid rgba(255,255,255,0.4);box-shadow:0 0 0 2px rgba(255,255,255,0.08);margin-left:7px;vertical-align:middle;flex-shrink:0;';
        dot.title = 'Fondator #' + (_founderData.founderNum || '—');
        nameEl.appendChild(dot);
    }

    // Founder card
    var section = document.createElement('div');
    section.id = 'vv-founder-section';
    section.style.cssText = 'background:rgba(255,255,255,0.04);backdrop-filter:blur(30px) saturate(1.2);-webkit-backdrop-filter:blur(30px) saturate(1.2);border:1px solid rgba(255,255,255,0.09);border-radius:22px;padding:24px 22px;margin-bottom:16px;position:relative;overflow:hidden;';
    section.innerHTML = [
        '<div style="position:absolute;top:0;left:15%;right:15%;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent);"></div>',
        // Header
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">',
            '<div>',
                '<div style="font-size:9px;color:rgba(255,255,255,0.22);letter-spacing:2.5px;font-weight:700;margin-bottom:4px;">PIONEER · INNER CIRCLE</div>',
                '<div style="font-size:16px;font-weight:800;color:rgba(255,255,255,0.85);">' + _founderData.alias + '</div>',
            '</div>',
            '<div style="text-align:right;">',
                '<div style="font-size:9px;color:rgba(255,255,255,0.22);letter-spacing:2px;font-weight:700;margin-bottom:2px;">FONDATOR</div>',
                '<div style="font-size:22px;font-weight:900;color:rgba(255,255,255,0.7);">#' + (_founderData.founderNum||'—') + '</div>',
            '</div>',
        '</div>',
        '<div style="height:1px;background:rgba(255,255,255,0.06);margin-bottom:16px;"></div>',
        // VV CORE ID
        '<div style="font-size:9px;color:rgba(255,255,255,0.22);letter-spacing:2.5px;font-weight:700;margin-bottom:4px;">VV·CORE·ID</div>',
        '<div style="font-family:Courier New,monospace;font-size:15px;font-weight:700;color:rgba(255,255,255,0.75);letter-spacing:1px;margin-bottom:14px;">' + (_founderData.vvCoreId||'VV·CORE·----') + '</div>',
        // VV ID
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">',
            '<div>',
                '<div style="font-size:9px;color:rgba(255,255,255,0.22);letter-spacing:2.5px;font-weight:700;margin-bottom:4px;">VV·ID</div>',
                '<div style="font-family:Courier New,monospace;font-size:13px;color:rgba(255,255,255,0.45);letter-spacing:1px;">' + (_founderData.vvId||'VV·ID·------') + '</div>',
            '</div>',
            // Buton salvare card ↓
            '<div onclick="openFounderCardSave()" style="width:36px;height:36px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.45);font-size:14px;-webkit-tap-highlight-color:transparent;">↓</div>',
        '</div>',
        '<div style="font-size:10px;color:rgba(255,255,255,0.18);line-height:1.5;">Identitatea se formează din activitate în ecosistemul VV.</div>',
    ].join('');

    var ref = document.getElementById('onyx-progress-card');
    var profile = document.getElementById('profile-screen');
    if (ref && profile) profile.insertBefore(section, ref);
}

// Salvare card fondator
function openFounderCardSave() {
    if (!_founderData) return;
    var overlay = document.getElementById('vv-founder-save-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'vv-founder-save-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:999999;display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:16px;';
        overlay.innerHTML = '<div id="founder-spinner" style="width:36px;height:36px;border:1.5px solid rgba(255,255,255,0.1);border-top-color:rgba(255,255,255,0.6);border-radius:50%;animation:spin .7s linear infinite;"></div><img id="founder-save-img" src="" style="display:none;width:100%;max-width:320px;border-radius:20px;-webkit-user-select:none;user-select:none;"><div id="founder-save-msg" style="font-size:13px;color:rgba(255,255,255,0.4);text-align:center;line-height:1.7;max-width:260px;">Se generează cardul...</div><button onclick="this.parentElement.style.display=\'none\';" style="padding:11px 32px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:rgba(255,255,255,0.3);font-size:12px;cursor:pointer;font-family:inherit;display:none;min-height:44px;">✕ Închide</button>';
        document.body.appendChild(overlay);
    }
    var img = overlay.querySelector('#founder-save-img');
    var spinner = overlay.querySelector('#founder-spinner');
    var msg = overlay.querySelector('#founder-save-msg');
    var closeBtn = overlay.querySelector('button');
    img.style.display='none'; img.src=''; spinner.style.display='block';
    msg.textContent='Se generează cardul...'; closeBtn.style.display='none';
    overlay.style.display='flex';
    setTimeout(function() { generateFounderCardCanvas(img, spinner, msg, closeBtn); }, 100);
}

function generateFounderCardCanvas(imgEl, spinnerEl, msgEl, closeBtn) {
    var W=1080,H=1920; var cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    var cx=cv.getContext('2d');
    var bg=cx.createLinearGradient(0,0,W,H); bg.addColorStop(0,'#03030a'); bg.addColorStop(.5,'#07070f'); bg.addColorStop(1,'#03030a');
    cx.fillStyle=bg; cx.fillRect(0,0,W,H);
    var CX=80,CY=500,CW=W-160,CH=920,CR=48;
    function rr(x,y,w,h,r){cx.beginPath();cx.moveTo(x+r,y);cx.lineTo(x+w-r,y);cx.quadraticCurveTo(x+w,y,x+w,y+r);cx.lineTo(x+w,y+h-r);cx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);cx.lineTo(x+r,y+h);cx.quadraticCurveTo(x,y+h,x,y+h-r);cx.lineTo(x,y+r);cx.quadraticCurveTo(x,y,x+r,y);cx.closePath();}
    var cbg=cx.createLinearGradient(CX,CY,CX+CW,CY+CH); cbg.addColorStop(0,'rgba(255,255,255,0.07)'); cbg.addColorStop(1,'rgba(255,255,255,0.03)');
    rr(CX,CY,CW,CH,CR); cx.fillStyle=cbg; cx.fill();
    rr(CX,CY,CW,CH,CR); cx.strokeStyle='rgba(255,255,255,0.1)'; cx.lineWidth=1.5; cx.stroke();
    var PL=CX+64,y=CY+90;
    cx.font='900 110px -apple-system,sans-serif'; cx.fillStyle='#fff'; cx.letterSpacing='16px'; cx.fillText('VV',PL,y); y+=28;
    cx.font='700 22px -apple-system,sans-serif'; cx.fillStyle='rgba(255,255,255,0.35)'; cx.letterSpacing='5px'; cx.fillText('HYBRID UNIVERS  ·  INNER CIRCLE',PL,y); y+=64;
    cx.font='700 20px -apple-system,sans-serif'; cx.fillStyle='rgba(255,255,255,0.25)'; cx.letterSpacing='5px'; cx.fillText('IDENTITATE FONDATOR',PL,y); y+=54;
    cx.font='700 52px Courier New,monospace'; cx.fillStyle='rgba(255,255,255,0.85)'; cx.letterSpacing='3px'; cx.fillText(_founderData.vvCoreId||'VV·CORE·----',PL,y); y+=36;
    cx.font='600 22px -apple-system,sans-serif'; cx.fillStyle='rgba(255,255,255,0.35)'; cx.letterSpacing='3px'; cx.fillText('FONDATOR #'+(_founderData.founderNum||'—')+' DIN 100',PL,y); y+=44;
    cx.font='700 38px -apple-system,sans-serif'; cx.fillStyle='rgba(255,255,255,0.8)'; cx.letterSpacing='1px'; cx.fillText(_founderData.alias||'INSIDER',PL,y); y+=52;
    cx.font='400 22px -apple-system,sans-serif'; cx.fillStyle='rgba(255,255,255,0.3)'; cx.letterSpacing='0'; cx.fillText(_founderData.vvId||'VV·ID·------',PL,y);
    cx.strokeStyle='rgba(255,255,255,0.06)'; cx.lineWidth=1; cx.beginPath(); cx.moveTo(CX+40,CY+CH-50); cx.lineTo(CX+CW-40,CY+CH-50); cx.stroke();
    cx.font='400 18px -apple-system,sans-serif'; cx.fillStyle='rgba(255,255,255,0.1)'; cx.fillText('vv-technologies.github.io',PL,CY+CH-18);
    var dataUrl=cv.toDataURL('image/png');
    imgEl.src=dataUrl; imgEl.style.display='block'; spinnerEl.style.display='none';
    var isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
    if(isIOS){ msgEl.innerHTML='<strong style="color:rgba(255,255,255,0.75);display:block;font-size:15px;margin-bottom:5px;">Ține apăsat pe imagine ↑</strong>apoi „Adaugă în Poze"'; }
    else { var a=document.createElement('a'); a.download='VV-CORE-'+(_founderData.vvCoreId||'card')+'.png'; a.href=dataUrl; document.body.appendChild(a); a.click(); document.body.removeChild(a); msgEl.textContent='✓ Salvat în galerie!'; }
    closeBtn.style.display='block';
}

// ================= CAREER — SCOASA =================
function switchCareerTab(tab) {
    // Carieră scoasă — doar Suport rămâne
    showToast('Folosește secțiunea Suport pentru mesaje.');
}
async function submitCareerApplication(e) {
    showToast('Această secțiune nu mai este disponibilă.');
}

// ================= TOAST =================
function showToast(msg) {
    let toast = document.getElementById('vv-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'vv-toast';
        toast.style.cssText = 'position:fixed;bottom:110px;left:50%;transform:translateX(-50%) translateY(10px);background:rgba(255,255,255,0.12);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:12px 22px;border-radius:30px;font-size:13px;font-weight:600;z-index:999999;opacity:0;transition:all .3s cubic-bezier(0.16,1,0.3,1);white-space:nowrap;pointer-events:none;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(10px)'; }, 2800);
}

// ================= INSIDER SEARCH =================
let insiderSearchTimer = null;

async function showInsiderSearch(reward) {
    const bar = document.getElementById('insider-search-bar');
    if (!bar) return;
    bar.style.display = 'flex'; bar.style.opacity = '0';
    setTimeout(() => { bar.style.transition = 'opacity 0.3s ease'; bar.style.opacity = '1'; }, 50);
    const rewardText = document.getElementById('insider-reward-text');
    if (rewardText) rewardText.textContent = reward + ' VV';
    const messages = ['SE CAUTĂ INSIDER...', 'SE SCANEAZĂ ZONA...', 'CONNECTING TO NETWORK...', 'INSIDER GĂSIT! 🎯'];
    let msgIndex = 0;
    const msgTimer = setInterval(() => {
        const searchText = document.getElementById('insider-search-text');
        if (searchText && msgIndex < messages.length - 1) { msgIndex++; searchText.textContent = messages[msgIndex]; } else clearInterval(msgTimer);
    }, 1200);
    clearTimeout(insiderSearchTimer);
    insiderSearchTimer = setTimeout(() => hideInsiderSearch(), 6000);
}

async function cancelFromSearchOverlay() {
    hideInsiderSearch();
    if (!lastCreatedMissionId) { showToast('Nicio misiune activă de anulat.'); return; }
    var missionIdToCancel = lastCreatedMissionId;
    lastCreatedMissionId = null;
    try {
        var missionDoc = await db.collection('missions').doc(missionIdToCancel).get();
        var reward = selectedReward;
        if (missionDoc.exists) reward = missionDoc.data().reward || selectedReward;
        var batch = db.batch();
        batch.delete(db.collection('missions').doc(missionIdToCancel));
        batch.update(db.collection('users').doc(currentUser.uid), { balance: firebase.firestore.FieldValue.increment(reward) });
        await batch.commit();
        if (missionMarkers[missionIdToCancel]) { try { map.removeLayer(missionMarkers[missionIdToCancel]); } catch(e) {} delete missionMarkers[missionIdToCancel]; }
        showToast('✅ Contract anulat! +' + reward + ' VV recuperați.');
    } catch(e) { showToast('Eroare la anulare: ' + e.message); }
}

function hideInsiderSearch() {
    const bar = document.getElementById('insider-search-bar');
    if (!bar) return;
    bar.style.transition = 'opacity 0.3s ease'; bar.style.opacity = '0';
    setTimeout(() => { bar.style.display = 'none'; }, 300);
    clearTimeout(insiderSearchTimer);
}

// ================= PROXIMITATE =================
let proximityNotifSent = {};
let proximityInterval = null;
let activeMissionsForProximity = {};

function updateMissionProximityCache(missionId, data) {
    if (data && data.status === 'open' && data.lat && data.lng) activeMissionsForProximity[missionId] = { lat: data.lat, lng: data.lng, reward: data.reward||0, description: data.description||'Misiune activă' };
    else delete activeMissionsForProximity[missionId];
}

function startProximityCheck() {
    if (proximityInterval) return;
    proximityInterval = setInterval(checkNearbyMissions, 15000);
}

function checkNearbyMissions() {
    if (userCurrentLat === null || userCurrentLng === null) return;
    db.collection('missions').where('status', '==', 'open').get().then(function(snap) {
        snap.forEach(function(doc) {
            var m = doc.data();
            if (!m.lat || !m.lng) return;
            if (m.createdBy === (currentUser && currentUser.uid)) return;
            var dist = haversineDistance(userCurrentLat, userCurrentLng, m.lat, m.lng);
            if (dist >= 50 && dist <= 500 && !proximityNotifSent[doc.id]) { proximityNotifSent[doc.id] = true; showProximityNotif(dist, m.reward||0, doc.id); }
            if (dist > 600) delete proximityNotifSent[doc.id];
        });
    }).catch(function() {});
}

function showProximityNotif(distMetri, reward, missionId) {
    var notif = document.createElement('div');
    notif.id = 'proximity-notif-' + missionId;
    notif.style.cssText = 'position:fixed;top:90px;left:16px;right:16px;z-index:99999;background:rgba(18,18,22,0.96);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:18px;padding:16px 18px;display:flex;align-items:center;gap:14px;cursor:pointer;';
    notif.innerHTML = '<div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="font-size:18px;">📍</span></div><div style="flex:1;min-width:0;"><div style="font-size:11px;letter-spacing:2px;color:rgba(255,255,255,0.6);font-weight:700;margin-bottom:3px;">MISIUNE APROAPE</div><div style="font-size:13px;color:#fff;font-weight:600;line-height:1.4;">Mai ai <span style="font-weight:800;">' + Math.round(distMetri) + 'm</span> · Recompensă: <span style="font-weight:800;">+' + reward + ' VV</span></div></div><div style="color:rgba(255,255,255,0.2);font-size:18px;">›</div>';
    notif.onclick = function() { if (notif.parentNode) notif.parentNode.removeChild(notif); };
    document.body.appendChild(notif);
    setTimeout(function() { if (notif.parentNode) notif.parentNode.removeChild(notif); }, 6000);
}

var _proximityStarted = false;
function maybeStartProximity() { if (_proximityStarted) return; _proximityStarted = true; startProximityCheck(); }

// ================= PREMIUM FEEDBACK =================
var pfmCurrentInboxId = null, pfmCurrentReward = 0, pfmCurrentFromUid = null, pfmSelectedStar = 0, pfmSelectedTip = 0;

function openPremiumFeedback(inboxId, reward, fromUid, insiderAlias, missionTitle) {
    pfmCurrentInboxId = inboxId; pfmCurrentReward = reward; pfmCurrentFromUid = fromUid; pfmSelectedStar = 0; pfmSelectedTip = 0;
    document.querySelectorAll('.vv-star').forEach(function(s) { s.style.filter = 'grayscale(1) opacity(0.3)'; s.style.color = '#fff'; });
    ['tip-vv-3','tip-vv-6','tip-vv-9'].forEach(function(id) { var btn = document.getElementById(id); if (btn) { btn.style.background = 'rgba(255,255,255,0.05)'; btn.style.border = '1px solid rgba(255,255,255,0.08)'; btn.style.color = 'rgba(255,255,255,0.5)'; } });
    var nameEl = document.getElementById('pfm-insider-name'), missionEl = document.getElementById('pfm-mission-name');
    if (nameEl) nameEl.textContent = insiderAlias || 'INSIDER';
    if (missionEl) missionEl.textContent = missionTitle || '';
    var modal = document.getElementById('premium-feedback-modal'), box = document.getElementById('pfm-box');
    if (modal && box) { modal.style.display = 'flex'; setTimeout(function() { box.style.transform = 'translateY(0)'; }, 10); }
}

function closePremiumFeedback() {
    var modal = document.getElementById('premium-feedback-modal'), box = document.getElementById('pfm-box');
    if (box) box.style.transform = 'translateY(100%)';
    setTimeout(function() { if (modal) modal.style.display = 'none'; }, 400);
}

function selectStar(val) {
    pfmSelectedStar = val;
    document.querySelectorAll('.vv-star').forEach(function(s) {
        var sv = parseInt(s.getAttribute('data-val'));
        if (sv <= val) { s.style.filter = 'none'; s.style.color = '#D4AF37'; s.style.textShadow = '0 0 12px rgba(212,175,55,0.5)'; }
        else { s.style.filter = 'grayscale(1) opacity(0.3)'; s.style.color = '#fff'; s.style.textShadow = 'none'; }
    });
}

function selectTipPremium(val) {
    pfmSelectedTip = (pfmSelectedTip === val) ? 0 : val;
    ['tip-vv-3','tip-vv-6','tip-vv-9'].forEach(function(id) {
        var btn = document.getElementById(id); if (!btn) return;
        var btnVal = parseInt(id.replace('tip-vv-',''));
        if (btnVal === pfmSelectedTip) { btn.style.background = 'rgba(212,175,55,0.12)'; btn.style.border = '1px solid rgba(212,175,55,0.35)'; btn.style.color = '#D4AF37'; }
        else { btn.style.background = 'rgba(255,255,255,0.05)'; btn.style.border = '1px solid rgba(255,255,255,0.08)'; btn.style.color = 'rgba(255,255,255,0.5)'; }
    });
}

async function submitPremiumFeedback() {
    if (!currentUser || !pfmCurrentInboxId) return;
    var btn = document.getElementById('pfm-confirm-btn');
    if (btn) { btn.textContent = 'SE PROCESEAZĂ...'; btn.disabled = true; }
    try {
        var batch = db.batch();
        var totalReward = pfmCurrentReward + pfmSelectedTip;
        batch.update(db.collection('users').doc(pfmCurrentFromUid), { balance: firebase.firestore.FieldValue.increment(totalReward) });
        batch.update(db.collection('inbox').doc(pfmCurrentInboxId), { status: 'approved', reward: 0, tipAmount: pfmSelectedTip, ratingGiven: pfmSelectedStar, approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
        if (pfmSelectedStar > 0) batch.update(db.collection('users').doc(pfmCurrentFromUid), { totalRatings: firebase.firestore.FieldValue.increment(1), ratingSum: firebase.firestore.FieldValue.increment(pfmSelectedStar) });
        await batch.commit();
        closePremiumFeedback();
        var tipText = pfmSelectedTip > 0 ? ' + ' + pfmSelectedTip + ' VV tip' : '';
        var starText = pfmSelectedStar > 0 ? ' · ' + pfmSelectedStar + '★' : '';
        showToast('✅ +' + pfmCurrentReward + ' VV trimis' + tipText + starText);
    } catch(e) { showToast('Eroare: ' + e.message); if (btn) { btn.textContent = 'CONFIRMĂ'; btn.disabled = false; } }
}

// ================= EXPIRARE MISIUNI =================
async function checkExpiredMissions() {
    if (!currentUser) return;
    const now = new Date();
    try {
        const snap = await db.collection('missions').where('createdBy', '==', currentUser.uid).where('status', '==', 'open').get();
        for (const doc of snap.docs) {
            const m = doc.data();
            if (!m.expiresAt || m.expiresAt.toDate() > now) continue;
            if (missionMarkers[doc.id]) { try { map.removeLayer(missionMarkers[doc.id]); } catch(e) {} delete missionMarkers[doc.id]; }
            const batch = db.batch();
            batch.update(doc.ref, { status: 'expired' });
            batch.update(db.collection('users').doc(currentUser.uid), { balance: firebase.firestore.FieldValue.increment(m.reward||0) });
            batch.set(db.collection('inbox').doc(), { to: currentUser.uid, type: 'mission_expired_no_photo', message: 'Misiunea "' + (m.description||'Misiune') + '" a expirat. +' + (m.reward||0) + ' VV returnați.', missionId: doc.id, reward: 0, read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            await batch.commit();
            showToast('⏱ Misiune expirată — +' + (m.reward||0) + ' VV returnați.');
        }
    } catch(e) {}
}

setInterval(checkExpiredMissions, 2*60*1000);
setTimeout(checkExpiredMissions, 15000);

// ================================================================
// AUTO-APROBARE MISIUNI — după 24h fără respingere
// Moderare Charter ART-3 — flaguri roșii merg la CEO
// ================================================================
var BLOCKED_AUTO_APPROVE = ['porn','sex','drog','arma','bomba','secta','frauda','hack','ura','rasism'];

function isContentSafe(text) {
    if (!text) return true;
    var lower = text.toLowerCase();
    return !BLOCKED_AUTO_APPROVE.some(function(k){ return lower.includes(k); });
}

async function checkAutoApproveMissions() {
    if (!currentUser) return;
    var now = new Date();
    var threshold = new Date(now.getTime() - 24*60*60*1000); // 24 ore in urma
    try {
        // Cauta inbox-uri cu poze trimise de useri care asteapta aprobare
        var snap = await db.collection('inbox')
            .where('to', '==', 'CEO')
            .where('read', '==', false)
            .get();

        for (var i = 0; i < snap.docs.length; i++) {
            var doc = snap.docs[i];
            var msg = doc.data();
            if (!msg.photoUrl) continue;
            if (!msg.createdAt) continue;
            var createdAt = msg.createdAt.toDate();
            if (createdAt > threshold) continue; // Nu a trecut 24h

            // Moderare automata Charter ART-3
            var textToCheck = (msg.message || '') + ' ' + (msg.description || '');
            if (!isContentSafe(textToCheck)) {
                // Flagat — trimite la CEO pentru verificare manuala
                await db.collection('inbox').doc(doc.id).update({
                    flagged: true,
                    flagReason: 'charter_art3',
                    read: true
                });
                // Notifica CEO
                await db.collection('inbox').add({
                    to: currentUser.uid,
                    from: 'SISTEM',
                    alias: 'VV Charter',
                    type: 'official_warning',
                    message: '🚨 Conținut flagat de Charter ART-3. Necesită verificare manuală.',
                    missionId: msg.missionId || null,
                    read: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                continue;
            }

            // CONTINUT SIGUR — auto-aproba
            var reward = msg.reward || 0;
            var fromUid = msg.from || null;
            var missionId = msg.missionId || null;

            try {
                var batch = db.batch();
                // Plateste userul
                if (fromUid && reward > 0) {
                    batch.update(db.collection('users').doc(fromUid), {
                        balance: firebase.firestore.FieldValue.increment(reward)
                    });
                }
                // Marcheaza misiunea ca rezolvata
                if (missionId) {
                    batch.update(db.collection('missions').doc(missionId), {
                        status: 'completed',
                        autoApproved: true,
                        autoApprovedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
                // Marcheaza inbox CEO ca citit
                batch.update(db.collection('inbox').doc(doc.id), {
                    read: true,
                    status: 'auto_approved',
                    reward: 0
                });
                // Notifica userul
                if (fromUid) {
                    batch.set(db.collection('inbox').doc(), {
                        to: fromUid,
                        from: 'SISTEM',
                        alias: 'VV Sistem',
                        type: 'reward_notification',
                        message: '✅ Misiunea ta a fost validată automat după 24h. +' + reward + ' VV Coins adăugați.',
                        missionId: missionId,
                        reward: reward,
                        read: false,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
                // Bon digital automat
                if (fromUid && reward > 0) {
                    var txChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                    var txId = 'VV-TX-';
                    for (var j = 0; j < 8; j++) txId += txChars[Math.floor(Math.random()*txChars.length)];
                    batch.set(db.collection('transactions').doc(), {
                        txId: txId,
                        uid: fromUid,
                        alias: msg.alias || 'INSIDER',
                        amount: reward,
                        source: 'AUTO_APPROVED_MISSION',
                        missionId: missionId,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                        expiresAt: firebase.firestore.Timestamp.fromDate(new Date(Date.now()+90*24*60*60*1000))
                    });
                }
                await batch.commit();
                // XP pentru misiune completata
                if (fromUid === currentUser.uid) {
                    updateVVhiCoreStats('mission_done');
                }
            } catch(e) { console.warn('[AutoApprove]', e); }
        }
    } catch(e) {}
}

// Ruleaza la fiecare 30 minute
setInterval(checkAutoApproveMissions, 30*60*1000);
setTimeout(checkAutoApproveMissions, 30000);

// ================= REMOTE CONFIG =================
var _localVersion = localStorage.getItem('vv_app_version') || '1.0.0';
var _remoteConfigActive = false;
var _updateToastShown = false;

function startRemoteConfigListener() {
    if (_remoteConfigActive) return;
    _remoteConfigActive = true;
    db.collection('system').doc('app_config').onSnapshot(function(doc) {
        if (!doc.exists) return;
        var cfg = doc.data();
        if (cfg.maintenanceMode) { showMaintenanceScreen(cfg.updateMessage || 'Revenim imediat.'); return; }
        else hideMaintenanceScreen();
        var serverVersion = cfg.version || '1.0.0';
        _localVersion = localStorage.getItem('vv_app_version') || '1.0.0';
        if (!_updateToastShown && isNewerVersion(serverVersion, _localVersion)) {
            _updateToastShown = true;
            if (cfg.silentUpdate) { setTimeout(function() { window.location.reload(); }, 3000); return; }
            if (cfg.forceUpdate) showForceUpdateScreen(serverVersion, cfg.updateMessage);
            else showUpdateToast(serverVersion, cfg.updateMessage || 'Experiența VV a fost îmbunătățită.');
        }
    });
}

function isNewerVersion(server, local) {
    try { var s = server.split('.').map(Number), l = local.split('.').map(Number); for (var i = 0; i < 3; i++) { if ((s[i]||0) > (l[i]||0)) return true; if ((s[i]||0) < (l[i]||0)) return false; } } catch(e) {}
    return false;
}

function showUpdateToast(version, message) {
    var old = document.getElementById('vv-update-toast'); if (old) old.remove();
    var el = document.createElement('div'); el.id = 'vv-update-toast';
    el.style.cssText = 'position:fixed;bottom:calc(88px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);z-index:999998;width:calc(100% - 32px);max-width:380px;background:rgba(10,10,18,0.96);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border:1px solid rgba(10,132,255,0.3);border-radius:22px;padding:18px 20px;';
    el.innerHTML = '<div style="font-size:10px;color:rgba(10,132,255,0.7);letter-spacing:3px;font-weight:700;margin-bottom:8px;">SISTEM ACTUALIZAT · v' + version + '</div><div style="font-size:13px;color:rgba(255,255,255,0.85);margin-bottom:14px;">' + message + '</div><div style="display:flex;gap:8px;"><button onclick="doAppRefresh()" style="flex:1;padding:11px;border:none;border-radius:12px;background:rgba(10,132,255,0.9);color:#fff;font-weight:800;font-size:13px;cursor:pointer;min-height:44px;font-family:inherit;">ACTUALIZEAZĂ ACUM</button><button onclick="var el=document.getElementById(\'vv-update-toast\');if(el)el.remove();" style="padding:11px 14px;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:transparent;color:rgba(255,255,255,0.35);font-size:12px;cursor:pointer;min-height:44px;font-family:inherit;">Mai târziu</button></div>';
    document.body.appendChild(el);
}

function doAppRefresh() {
    db.collection('system').doc('app_config').get().then(function(doc) { if (doc.exists && doc.data().version) localStorage.setItem('vv_app_version', doc.data().version); }).finally(function() { if ('caches' in window) { caches.keys().then(function(names) { names.forEach(function(name) { caches.delete(name); }); }).finally(function() { window.location.reload(true); }); } else window.location.reload(true); });
}

function showForceUpdateScreen(version, message) {
    var old = document.getElementById('vv-force-update'); if (old) old.remove();
    var el = document.createElement('div'); el.id = 'vv-force-update';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999999;background:#050507;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 28px;text-align:center;';
    el.innerHTML = '<div style="font-size:64px;font-weight:900;color:#fff;letter-spacing:-4px;margin-bottom:6px;">VV</div><div style="font-size:11px;color:rgba(10,132,255,0.6);letter-spacing:4px;font-weight:700;margin-bottom:48px;">HYBRID UNIVERS</div><div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:10px;">VV se îmbunătățește.</div><div style="font-size:14px;color:rgba(255,255,255,0.45);line-height:1.6;max-width:300px;margin-bottom:36px;">' + (message||'O nouă versiune este disponibilă.') + '</div><button onclick="doAppRefresh()" style="padding:18px 48px;border:none;border-radius:18px;background:rgba(255,255,255,0.95);color:#000;font-weight:900;font-size:15px;cursor:pointer;min-height:56px;font-family:inherit;">ACTUALIZEAZĂ ACUM</button>';
    document.body.appendChild(el);
}

function showMaintenanceScreen(message) {
    if (document.getElementById('vv-maintenance')) return;
    var el = document.createElement('div'); el.id = 'vv-maintenance';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999999;background:#050507;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 28px;text-align:center;';
    el.innerHTML = '<div style="font-size:64px;font-weight:900;color:#fff;letter-spacing:-4px;margin-bottom:6px;">VV</div><div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:10px;">Revenim imediat.</div><div style="font-size:14px;color:rgba(255,255,255,0.45);line-height:1.6;max-width:300px;">' + message + '</div>';
    document.body.appendChild(el);
}

function hideMaintenanceScreen() {
    var el = document.getElementById('vv-maintenance');
    if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.5s'; setTimeout(function() { el.remove(); }, 500); }
}

// ================================================================
// NEXUS — Sistem de Intenție Urban
// ================================================================
var _nexusGPS = null;
var _nexusOpen = false;

function openNexus() {
    _nexusOpen = true;
    var modal = document.getElementById('nexus-modal');
    var sheet = document.getElementById('nexus-sheet');
    if (!modal || !sheet) return;
    modal.style.display = 'flex';
    setTimeout(function() { sheet.style.transform = 'translateY(0)'; }, 10);
    // Activam GPS in fundal imediat
    activateNexusGPS();
    // Focus pe input
    setTimeout(function() {
        var inp = document.getElementById('nexus-input');
        if (inp) inp.focus();
    }, 400);
}

function closeNexus() {
    _nexusOpen = false;
    var sheet = document.getElementById('nexus-sheet');
    var modal = document.getElementById('nexus-modal');
    if (sheet) sheet.style.transform = 'translateY(100%)';
    setTimeout(function() { if (modal) modal.style.display = 'none'; }, 400);
    // Reset
    var inp = document.getElementById('nexus-input');
    var resp = document.getElementById('nexus-response');
    var btn = document.getElementById('nexus-send-btn');
    if (inp) inp.value = '';
    if (resp) resp.style.display = 'none';
    if (btn) { btn.textContent = '⬡ LANSEAZĂ MISIUNEA'; btn.disabled = false; btn.style.opacity = '1'; }
}

function activateNexusGPS() {
    var dot = document.getElementById('nexus-gps-dot');
    var txt = document.getElementById('nexus-gps-text');
    if (dot) dot.style.background = 'rgba(255,149,0,0.8)';
    if (txt) txt.textContent = 'Se obține locația...';
    if (!navigator.geolocation) {
        if (txt) txt.textContent = 'GPS indisponibil';
        return;
    }
    navigator.geolocation.getCurrentPosition(function(pos) {
        _nexusGPS = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (dot) { dot.style.background = '#34c759'; dot.style.boxShadow = '0 0 6px rgba(52,199,89,0.8)'; }
        if (txt) txt.textContent = 'Locație: ' + _nexusGPS.lat.toFixed(4) + ', ' + _nexusGPS.lng.toFixed(4);
        // Update global
        userCurrentLat = _nexusGPS.lat;
        userCurrentLng = _nexusGPS.lng;
    }, function() {
        if (dot) dot.style.background = '#ff3b30';
        if (txt) txt.textContent = 'GPS indisponibil — misiunea va fi generală';
        if (userCurrentLat) _nexusGPS = { lat: userCurrentLat, lng: userCurrentLng };
    }, { enableHighAccuracy: true, timeout: 8000 });
}

function nexusInputChange(el) {
    var btn = document.getElementById('nexus-send-btn');
    if (!btn) return;
    btn.style.opacity = el.value.trim().length > 0 ? '1' : '0.5';
}

function nexusSuggest(text) {
    var inp = document.getElementById('nexus-input');
    if (inp) {
        inp.value = text;
        nexusInputChange(inp);
        inp.focus();
    }
}

async function submitNexus() {
    var inp = document.getElementById('nexus-input');
    var query = inp ? inp.value.trim() : '';
    if (!query) { showToast('Scrie ce vrei să afli!'); return; }

    var btn = document.getElementById('nexus-send-btn');
    var resp = document.getElementById('nexus-response');
    var respText = document.getElementById('nexus-response-text');
    var actionBtns = document.getElementById('nexus-action-btns');

    if (btn) { btn.textContent = 'NEXUS PROCESEAZĂ...'; btn.disabled = true; btn.style.opacity = '0.6'; }

    // ── Moderare locala inainte de orice ──
    var blocked = ['porn','sex explicit','drog','cocain','heroina','arma','bomba','secta','frauda','hack'];
    var lower = query.toLowerCase();
    var isBlocked = blocked.some(function(k){ return lower.includes(k); });
    if (isBlocked) {
        if (btn) { btn.textContent = '⬡ LANSEAZĂ MISIUNEA'; btn.disabled = false; btn.style.opacity = '1'; }
        showToast('Această cerere nu este permisă în ecosistemul VV.');
        return;
    }

    // ── Gaseste locatie relevanta via Nominatim ──
    var locationContext = '';
    var suggestedLat = null, suggestedLng = null, suggestedName = '';
    if (_nexusGPS) {
        try {
            var searchTerms = extractSearchTerm(query);
            if (searchTerms) {
                var nomRes = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(searchTerms) + '&limit=3&countrycodes=ro&viewbox=' + (_nexusGPS.lng-0.05) + ',' + (_nexusGPS.lat+0.05) + ',' + (_nexusGPS.lng+0.05) + ',' + (_nexusGPS.lat-0.05) + '&bounded=1&accept-language=ro');
                var nomData = await nomRes.json();
                if (nomData && nomData.length > 0) {
                    suggestedLat = parseFloat(nomData[0].lat);
                    suggestedLng = parseFloat(nomData[0].lon);
                    suggestedName = nomData[0].display_name.split(',')[0];
                    locationContext = suggestedName;
                }
            }
        } catch(e) {}
    }

    // ── Construieste raspunsul Nexus ──
    var nexusReply = buildNexusReply(query, locationContext, suggestedName);

    if (resp) resp.style.display = 'block';
    if (respText) respText.textContent = nexusReply;

    // ── Butoane de actiune ──
    if (actionBtns) {
        actionBtns.style.display = 'flex';
        actionBtns.innerHTML = '';

        if (suggestedLat && suggestedName) {
            // Buton lansare misiune directa
            var btnM = document.createElement('button');
            btnM.style.cssText = 'flex:1;padding:12px;background:rgba(255,255,255,0.92);color:#000;border:none;border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;min-height:44px;';
            btnM.textContent = '⬡ Lansează misiunea';
            (function(lat,lng,name,q){
                btnM.onclick = function() {
                    closeNexus();
                    missionLat = lat; missionLng = lng;
                    setTimeout(function(){
                        document.getElementById('mission-desc').value = q;
                        openModal('create-mission-modal');
                        // Zboara harta la locatie
                        if (map) map.flyTo([lat,lng],16,{duration:1.5});
                    }, 300);
                    // Log VVhi
                    logNexusAction(q, name, lat, lng);
                };
            })(suggestedLat, suggestedLng, suggestedName, query);
            actionBtns.appendChild(btnM);

            // Buton navigare hibrida
            var btnN = document.createElement('button');
            btnN.style.cssText = 'padding:12px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:rgba(255,255,255,0.6);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px;white-space:nowrap;';
            btnN.textContent = '🗺 Navighează';
            (function(lat,lng){
                btnN.onclick = function() {
                    var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
                    if (isIOS) {
                        window.location.href = 'maps://maps.apple.com/?daddr=' + lat + ',' + lng + '&dirflg=w';
                    } else {
                        window.open('https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=walking','_blank');
                    }
                };
            })(suggestedLat, suggestedLng);
            actionBtns.appendChild(btnN);
        } else {
            // Fara locatie gasita — misiune generala
            var btnG = document.createElement('button');
            btnG.style.cssText = 'width:100%;padding:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:12px;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;min-height:44px;';
            btnG.textContent = '⬡ Lansează ca misiune generală';
            btnG.onclick = function() {
                closeNexus();
                document.getElementById('mission-desc').value = query;
                openModal('create-mission-modal');
            };
            actionBtns.appendChild(btnG);
        }
    }

    if (btn) { btn.textContent = '⬡ LANSEAZĂ MISIUNEA'; btn.disabled = false; btn.style.opacity = '1'; }

    // ── Update VVhi Core Stats ──
    updateVVhiCoreStats('nexus_query');
}

function extractSearchTerm(query) {
    var keywords = {
        'supermarket': 'supermarket', 'kaufland': 'Kaufland', 'lidl': 'Lidl',
        'penny': 'Penny Market', 'profi': 'Profi', 'mega': 'Mega Image',
        'teren': 'teren fotbal', 'fotbal': 'teren fotbal sport', 'sport': 'sala sport',
        'parcare': 'parcare auto', 'parc': 'parc', 'cafenea': 'cafenea coffee',
        'restaurant': 'restaurant', 'pizza': 'pizza', 'farmacie': 'farmacie',
        'spital': 'spital', 'benzinarie': 'benzinarie', 'atm': 'bancomat ATM',
        'piata': 'piata agroalimentara', 'mall': 'mall centru comercial',
        'club': 'club', 'bar': 'bar pub'
    };
    var lower = query.toLowerCase();
    for (var key in keywords) {
        if (lower.includes(key)) return keywords[key];
    }
    // Fallback — primele 3 cuvinte
    return query.split(' ').slice(0,3).join(' ');
}

function getNexusLevel() {
    if (!_vvhiCoreStats) return 1;
    return _vvhiCoreStats.experience_level || 1;
}

function getNexusMode() {
    var lvl = getNexusLevel();
    if (lvl >= 16) return 'vision';
    if (lvl >= 11) return 'sense_pro';
    if (lvl >= 6)  return 'sense';
    return 'base';
}

var _sparkUsedToday = false;
var SPARK_MOMENTS = [
    'Stiu ca esti la inceput. Incearca sa cauti ceva ce chiar ai nevoie acum.',
    'Fiecare misiune pe care o lansezi ma face sa inteleg mai bine orasul tau.',
    'La Level 6 voi simti contextul diferit. Dar si acum — ce anume vrei sa stii?',
    'Suntem la inceput. Tu construiesti Nexus-ul tau prin fiecare cerere.'
];

function maybeInsertSpark(reply) {
    var lvl = getNexusLevel();
    if (lvl >= 6) return reply;
    if (_sparkUsedToday) return reply;
    if (Math.random() < 0.25) {
        _sparkUsedToday = true;
        var spark = SPARK_MOMENTS[Math.floor(Math.random() * SPARK_MOMENTS.length)];
        return reply + '\n\n— ' + spark;
    }
    return reply;
}

function buildNexusReply(query, locationFound, locationName) {
    var lower = query.toLowerCase();
    var mode = getNexusMode();
    var lvl = getNexusLevel();
    var edge = getEdgeContextForNexus();

    if (mode === 'sense' || mode === 'sense_pro' || mode === 'vision') {
        var prefix = mode === 'vision' ? '⧆ Nexus Vision · Level ' + lvl + '\n'
                   : mode === 'sense_pro' ? '⧆ Nexus Sense Pro · Level ' + lvl + '\n'
                   : '⧆ Nexus Sense · Level ' + lvl + '\n';
        var contextExtra = '';
        if ((mode === 'sense_pro' || mode === 'vision') && locationFound) {
            var ora = new Date().getHours();
            var oraTip = ora >= 6 && ora < 12 ? 'dimineata' : ora >= 12 && ora < 18 ? 'dupa-amiaza' : ora >= 18 && ora < 22 ? 'seara' : 'noaptea';
            contextExtra = ' La aceasta ora (' + oraTip + '), zona tinde sa fie ' + (Math.random() > 0.5 ? 'mai aglomerata.' : 'mai linistita.');
        }
        var edgeSuffix = '';
        if (edge) {
            if (edge.isActiveTime) edgeSuffix = ' Esti in intervalul tau preferat.';
            if (edge.isConnector && !locationFound) edgeSuffix += ' Verific si Insideri activi in zona.';
            if (edge.isAnalyst) edgeSuffix += ' Analiza completa dupa confirmare fizica.';
        }
        if (locationFound) return prefix + 'Am identificat ' + locationName + ' in proximitatea ta.' + contextExtra + edgeSuffix + ' Lanseaza misiunea.';
        if (lower.includes('coada') || lower.includes('aglomerat') || lower.includes('liber')) return prefix + 'Inteleg intentia. Lansez misiunea in zona ta.' + edgeSuffix;
        if (lower.includes('cum e') || lower.includes('atmosfer') || lower.includes('vibe')) return prefix + 'Atmosfera se citeste prin prezenta. Lansez misiunea.' + edgeSuffix;
        return prefix + 'Cererea ta e inregistrata. Lansez misiunea in zona ta.' + edgeSuffix;
    }

    var baseReply;
    if (locationFound) baseReply = 'Am gasit ' + locationName + ' in zona ta. Lanseaza o misiune si un Insider verifica in timp real.';
    else if (lower.includes('coada') || lower.includes('aglomerat') || lower.includes('liber')) baseReply = 'Misiunea ta va fi lansata in zona ta. Un Insider va verifica si va trimite dovada.';
    else if (lower.includes('cum e') || lower.includes('atmosfer') || lower.includes('vibe')) baseReply = 'Atmosfera se valideaza prin prezenta fizica. Lanseaza si primesti VV PROOF in cateva minute.';
    else baseReply = 'Inteles. Lansez misiunea in zona ta. Vei primi dovada in Intelligence Inbox.';
    if (edge && edge.isActiveTime) baseReply += ' Esti activ la ora ta preferata.';
    return maybeInsertSpark(baseReply);
}

function logNexusAction(query, locationName, lat, lng) {
    if (typeof db === 'undefined' || !currentUser) return;
    db.collection('vvhi_dataset').add({
        action: 'NEXUS_QUERY',
        context: {
            query: query.substring(0,100),
            location: locationName,
            lat: lat ? parseFloat(lat.toFixed(3)) : null,
            lng: lng ? parseFloat(lng.toFixed(3)) : null,
            uid: currentUser.uid,
            hour: new Date().getHours()
        },
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function(){});
}

// ================================================================
// VVhi CORE STATS — Evoluția Personală
// ================================================================
var _vvhiCoreStats = null;

function initVVhiCoreStats(userData) {
    if (!userData) return;
    _vvhiCoreStats = userData.vvhi_core_stats || {
        experience_level: 1,
        total_xp: 0,
        specialization: 'explorer',
        missions_done: 0,
        pulses_done: 0,
        nexus_queries: 0
    };
    renderVVhiCoreLevel();
}

function updateVVhiCoreStats(action) {
    if (!currentUser || !_vvhiCoreStats) return;
    // ── XP MULTI-SURSA (ART-13 — Accesibilitate Universala) ──
    var xpGain = {
        // Fizic — actiune in oras
        'mission_done':    15,
        'pulse_connect':   10,
        'nexus_query':      3,
        // Digital — contributie din casa
        'inbox_validate':   8,  // aproba o dovada din inbox
        'bug_report':       5,  // raporteaza un bug
        'feedback_sent':    3,  // trimite feedback
        // Social — cresti reteaua
        'invite_activated': 20, // prietenul tau a folosit cheia
        'mission_created':   5, // lansezi o misiune (nu trebuie sa fii fizic acolo)
        // Temporal — loialitate
        'daily_login':       2  // intri in aplicatie in zile consecutive
    };
    var gain = xpGain[action] || 5;
    _vvhiCoreStats.total_xp = (_vvhiCoreStats.total_xp || 0) + gain;
    if (action === 'mission_done') _vvhiCoreStats.missions_done = (_vvhiCoreStats.missions_done || 0) + 1;
    if (action === 'pulse_connect') _vvhiCoreStats.pulses_done = (_vvhiCoreStats.pulses_done || 0) + 1;
    if (action === 'nexus_query') _vvhiCoreStats.nexus_queries = (_vvhiCoreStats.nexus_queries || 0) + 1;
    // Level up la fiecare 100 XP
    var newLevel = Math.floor(_vvhiCoreStats.total_xp / 100) + 1;
    var levelUp = newLevel > (_vvhiCoreStats.experience_level || 1);
    _vvhiCoreStats.experience_level = newLevel;
    // Specialization bazata pe actiuni
    var m = _vvhiCoreStats.missions_done || 0;
    var p = _vvhiCoreStats.pulses_done || 0;
    var n = _vvhiCoreStats.nexus_queries || 0;
    if (m >= p && m >= n) _vvhiCoreStats.specialization = 'explorer';
    else if (p >= m && p >= n) _vvhiCoreStats.specialization = 'connector';
    else _vvhiCoreStats.specialization = 'analyst';
    // Salveaza in Firebase
    db.collection('users').doc(currentUser.uid).update({
        vvhi_core_stats: _vvhiCoreStats
    }).catch(function(){});
    if (levelUp) {
        showToast('⬡ VVhi Core Level ' + newLevel + '! +' + gain + ' XP');
    }
    renderVVhiCoreLevel();
}

function renderVVhiCoreLevel() {
    var el = document.getElementById('vvhi-core-widget');
    if (!el || !_vvhiCoreStats) return;
    var specs = { explorer: '🗺 Explorer', connector: '⬡ Connector', analyst: '🧠 Analyst', ghost: '👁 Ghost' };
    el.innerHTML = [
        '<div style="font-size:9px;color:rgba(255,255,255,0.25);letter-spacing:3px;font-weight:700;margin-bottom:6px;">VVhi CORE</div>',
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">',
            '<div style="font-size:13px;font-weight:700;color:#fff;">Level ' + (_vvhiCoreStats.experience_level||1) + '</div>',
            '<div style="font-size:11px;color:rgba(255,255,255,0.4);">' + (specs[_vvhiCoreStats.specialization]||'Explorer') + '</div>',
        '</div>',
        '<div style="background:rgba(255,255,255,0.06);border-radius:6px;height:4px;overflow:hidden;">',
            '<div style="height:100%;border-radius:6px;background:rgba(255,255,255,0.6);width:' + ((_vvhiCoreStats.total_xp % 100)) + '%;transition:width .5s;"></div>',
        '</div>',
        '<div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:4px;">' + (_vvhiCoreStats.total_xp||0) + ' XP total</div>',
    ].join('');
}

// ================================================================
// BON DIGITAL — Istoric tranzactii in profil user
// ================================================================
async function loadUserTransactions() {
    if (!currentUser) return;
    var el = document.getElementById('user-transactions-list');
    if (!el) return;

    try {
        var snap = await db.collection('transactions')
            .where('uid', '==', currentUser.uid)
            .orderBy('timestamp', 'desc')
            .limit(10)
            .get();

        if (snap.empty) {
            el.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.25);text-align:center;padding:10px;">Nicio tranzacție încă.</div>';
            return;
        }

        var html = '';
        snap.forEach(function(doc) {
            var t = doc.data();
            var date = t.timestamp ? t.timestamp.toDate().toLocaleString('ro-RO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
            var isPlus = t.amount > 0;
            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">';
            html += '<div><div style="font-size:12px;color:rgba(255,255,255,0.7);font-weight:600;">' + (t.source||'VV Sistem') + '</div>';
            html += '<div style="font-size:10px;color:rgba(255,255,255,0.2);">' + date + '</div></div>';
            html += '<div style="font-size:14px;font-weight:900;color:' + (isPlus?'#34c759':'#ff3b30') + '">' + (isPlus?'+':'') + t.amount + ' VV</div>';
            html += '</div>';
        });
        el.innerHTML = html;
    } catch(e) {}
}

// ================================================================
// PATCH loadUserData — integreaza VVhi Core + Bon Digital
// ================================================================
var _vvOrigLoadUserData2 = typeof loadUserData === 'function' ? loadUserData : null;
if (_vvOrigLoadUserData2) {
    loadUserData = function() {
        _vvOrigLoadUserData2.apply(this, arguments);
        if (typeof currentUser !== 'undefined' && currentUser) {
            db.collection('users').doc(currentUser.uid).get().then(function(doc) {
                if (doc.exists) {
                    var data = doc.data();
                    // VVhi Core
                    initVVhiCoreStats(data);
                    // Founder
                    if (data.isFounder && typeof loadFounderData === 'function') loadFounderData(data);
                }
            }).catch(function(){});
            // Tranzactii
            setTimeout(loadUserTransactions, 2000);
        }
    };
}

// ── Inchide Nexus la click pe backdrop ───────────────────────
document.addEventListener('click', function(e) {
    var modal = document.getElementById('nexus-modal');
    var sheet = document.getElementById('nexus-sheet');
    if (modal && modal.style.display === 'flex' && e.target === modal) {
        closeNexus();
    }
});

// ── Update VVhi la actiuni existente ─────────────────────────
var _origAwardVVPulseBonus = typeof awardVVPulseBonus === 'function' ? awardVVPulseBonus : null;
if (_origAwardVVPulseBonus) {
    awardVVPulseBonus = function() {
        var result = _origAwardVVPulseBonus.apply(this, arguments);
        updateVVhiCoreStats('pulse_connect');
        return result;
    };
}

// ================================================================
// VOICE INPUT — Nexus ascultă
// ================================================================
var _voiceRecognition = null;
var _voiceActive = false;

function toggleVoiceInput() {
    var micBtn = document.getElementById('nexus-mic-btn');
    var statusEl = document.getElementById('nexus-voice-status');
    var inp = document.getElementById('nexus-input');
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        showToast('Voice input indisponibil pe acest browser.'); return;
    }
    if (_voiceActive) { stopVoiceInput(); return; }
    _voiceActive = true;
    if (micBtn) { micBtn.style.background='rgba(255,59,48,0.2)'; micBtn.style.border='1px solid rgba(255,59,48,0.4)'; micBtn.textContent='⏹'; }
    if (statusEl) statusEl.style.display='block';
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    _voiceRecognition = new SR();
    _voiceRecognition.lang='ro-RO'; _voiceRecognition.continuous=false; _voiceRecognition.interimResults=true; _voiceRecognition.maxAlternatives=1;
    _voiceRecognition.onresult = function(event) {
        var transcript = event.results[event.results.length-1][0].transcript;
        if (inp) { inp.value=transcript; nexusInputChange(inp); }
        if (event.results[event.results.length-1].isFinal) stopVoiceInput();
    };
    _voiceRecognition.onerror = function(e) {
        stopVoiceInput();
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            showToast('Permite accesul la microfon in setarile browserului.');
        } else if (e.error === 'network') {
            showToast('Eroare retea - Voice Search necesita internet.');
        } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
            showToast('Microfon indisponibil: ' + e.error);
        }
    };
    _voiceRecognition.onend = function() { stopVoiceInput(); };
    try { _voiceRecognition.start(); } catch(e) { stopVoiceInput(); }
}

function stopVoiceInput() {
    _voiceActive = false;
    var micBtn=document.getElementById('nexus-mic-btn'); var statusEl=document.getElementById('nexus-voice-status');
    if(micBtn){micBtn.style.background='rgba(255,255,255,0.06)';micBtn.style.border='1px solid rgba(255,255,255,0.1)';micBtn.textContent='🎙';}
    if(statusEl) statusEl.style.display='none';
    if(_voiceRecognition){try{_voiceRecognition.stop();}catch(e){}_voiceRecognition=null;}
}

// ================================================================
// GHOST MODE — Invizibil pe VV Pulse 30 min
// ================================================================
function isGhostModeActive() {
    return Date.now() < parseInt(localStorage.getItem('vv_ghost_expires')||'0');
}

function toggleGhostMode() {
    if (isGhostModeActive()) {
        localStorage.removeItem('vv_ghost_expires');
        updateGhostModeUI(false);
        showToast('👁 Ghost Mode dezactivat.');
    } else {
        localStorage.setItem('vv_ghost_expires', String(Date.now()+30*60*1000));
        updateGhostModeUI(true);
        showToast('👁 Ghost Mode activ — 30 minute.');
        if (currentUser) db.collection('vv_pulse').doc(currentUser.uid).delete().catch(function(){});
        setTimeout(function(){ localStorage.removeItem('vv_ghost_expires'); updateGhostModeUI(false); showToast('👁 Ghost Mode expirat.'); }, 30*60*1000);
    }
}

function updateGhostModeUI(active) {
    var toggle=document.getElementById('ghost-toggle'); var dot=document.getElementById('ghost-toggle-dot');
    var label=document.getElementById('ghost-mode-label'); var row=document.getElementById('ghost-mode-row');
    if(active){
        if(toggle) toggle.style.background='rgba(255,255,255,0.7)';
        if(dot){dot.style.background='#000';dot.style.left='21px';}
        if(label){label.textContent='ACTIV · Ești invizibil pe Pulse';label.style.color='rgba(255,255,255,0.6)';}
        if(row) row.style.borderColor='rgba(255,255,255,0.2)';
    } else {
        if(toggle) toggle.style.background='rgba(255,255,255,0.1)';
        if(dot){dot.style.background='rgba(255,255,255,0.4)';dot.style.left='3px';}
        if(label){label.textContent='Invizibil pe VV Pulse · 30 min';label.style.color='rgba(255,255,255,0.3)';}
        if(row) row.style.borderColor='rgba(255,255,255,0.08)';
    }
}

var _origOpenSettings = typeof openSettings==='function'?openSettings:null;
if(_origOpenSettings){ openSettings=function(){ _origOpenSettings.apply(this,arguments); updateGhostModeUI(isGhostModeActive()); }; }

var _origStartVVPulse = typeof startVVPulse==='function'?startVVPulse:null;
if(_origStartVVPulse){ startVVPulse=function(){ if(isGhostModeActive()){showToast('👁 Ghost Mode activ — Pulse dezactivat.');return;} return _origStartVVPulse.apply(this,arguments); }; }

// ================================================================
// PULSE ECHO — Memoria intersectiilor
// ================================================================
function savePulseEcho(targetAlias, targetLevel, targetSpec) {
    if (!currentUser) return;
    var now=new Date();
    var timeStr=now.toLocaleString('ro-RO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
    db.collection('vvhi_dataset').add({
        action:'PULSE_ECHO',
        context:{ uid:currentUser.uid, myAlias:localStorage.getItem('vv_alias')||'INSIDER', targetAlias:targetAlias||'INSIDER', targetLevel:targetLevel||1, targetSpec:targetSpec||'explorer', timeStr, lat:userCurrentLat?parseFloat(userCurrentLat.toFixed(3)):null, lng:userCurrentLng?parseFloat(userCurrentLng.toFixed(3)):null },
        timestamp:firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function(){});
    var echos=[];
    try{echos=JSON.parse(localStorage.getItem('vv_pulse_echos')||'[]');}catch(e){}
    echos.unshift({alias:targetAlias,level:targetLevel,spec:targetSpec,time:timeStr});
    localStorage.setItem('vv_pulse_echos',JSON.stringify(echos.slice(0,10)));
    renderPulseEchos();
}

function renderPulseEchos() {
    var el=document.getElementById('pulse-echo-list'); if(!el) return;
    var echos=[];
    try{echos=JSON.parse(localStorage.getItem('vv_pulse_echos')||'[]');}catch(e){}
    var specs={explorer:'🗺',connector:'⬡',analyst:'🧠',ghost:'👁'};
    if(echos.length===0){el.innerHTML='<div style="font-size:12px;color:rgba(255,255,255,0.25);text-align:center;padding:10px;">Nicio intersecție înregistrată.</div>';return;}
    el.innerHTML=echos.map(function(e){return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><div style="width:32px;height:32px;background:rgba(10,132,255,0.1);border:1px solid rgba(10,132,255,0.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;">'+(specs[e.spec]||'⬡')+'</div><div style="flex:1;min-width:0;"><div style="font-size:12px;color:rgba(255,255,255,0.7);font-weight:600;">Insider '+(e.spec||'Explorer')+' · Level '+(e.level||1)+'</div><div style="font-size:10px;color:rgba(255,255,255,0.25);margin-top:1px;">'+(e.time||'—')+'</div></div><div style="font-size:9px;color:rgba(10,132,255,0.5);font-weight:700;letter-spacing:1px;">ECHO</div></div>';}).join('');
}

setTimeout(renderPulseEchos, 2500);

// ── DAILY LOGIN XP ────────────────────────────────────────────
function checkDailyLoginXP() {
    var today = new Date().toISOString().split('T')[0];
    var lastLogin = localStorage.getItem('vv_last_login');
    if (lastLogin !== today) {
        localStorage.setItem('vv_last_login', today);
        setTimeout(function() { updateVVhiCoreStats('daily_login'); }, 3000);
    }
}
setTimeout(checkDailyLoginXP, 2000);

// Detecteaza Insideri in raza de 50m prin GPS + Firebase
// Legal 100%, fara permisiuni extra, functioneaza pe orice iPhone
// ================================================================
var _vvPulseActive = false;
var _vvPulseTimer = null;
var VV_PULSE_RADIUS = 0.0005;   // ~50m in grade lat/lng
var VV_PULSE_MAX_PER_DAY = 3;   // max 3 pulse-uri pe zi
var VV_PULSE_BONUS = [10, 7, 5]; // VV Coins per pulse (1st, 2nd, 3rd)
var VV_PULSE_TIMEOUT = 60000;   // 60 secunde timeout
var VV_PULSE_CONFIRM_TIMEOUT = 30000; // 30 sec pentru handshake

// ── INJECTEAZA BUTON ⬡ in sidebar ────────────────────────────
function injectVVNodButton() {
    var sidebar = document.getElementById('action-hub');
    if (!sidebar || document.getElementById('fab-vv-nod')) return;
    var btn = document.createElement('div');
    btn.id = 'fab-vv-nod';
    btn.className = 'fab-btn';
    btn.title = 'VV Pulse';
    btn.innerHTML = '<span style="font-size:18px;color:rgba(255,255,255,0.8);line-height:1;">⬡</span>';
    btn.onclick = function() { startVVPulse(); };
    sidebar.insertBefore(btn, sidebar.firstChild);
}

// ── VERIFICA LIMITA ZILNICA ───────────────────────────────────
function getVVPulseUsesToday() {
    var key = 'vv_pulse_' + new Date().toISOString().split('T')[0];
    return parseInt(localStorage.getItem(key) || '0');
}
function incrementVVPulseUses() {
    var key = 'vv_pulse_' + new Date().toISOString().split('T')[0];
    localStorage.setItem(key, String(getVVPulseUsesToday() + 1));
}
function canUseVVPulse() {
    return getVVPulseUsesToday() < VV_PULSE_MAX_PER_DAY;
}

// ── START VV PULSE ────────────────────────────────────────────
async function startVVPulse() {
    if (_vvPulseActive) return;

    // Verifica limita zilnica
    if (!canUseVVPulse()) {
        showToast('⬡ Ai folosit cele ' + VV_PULSE_MAX_PER_DAY + ' Pulse-uri de azi. Revin mâine.');
        return;
    }

    // Verifica GPS
    if (!navigator.geolocation) {
        showToast('GPS indisponibil pe acest dispozitiv.');
        return;
    }

    _vvPulseActive = true;
    showVVPulseOverlay('scanning');

    // Obtine GPS proaspat
    var pos;
    try {
        pos = await new Promise(function(resolve, reject) {
            navigator.geolocation.getCurrentPosition(
                function(p) { resolve(p); },
                function(e) { reject(e); },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        });
    } catch(e) {
        _vvPulseActive = false;
        showVVPulseOverlay('remove');
        showToast('GPS indisponibil. Activeaza locatia.');
        return;
    }

    var myLat = parseFloat(pos.coords.latitude.toFixed(4));  // rotunjit pt privacy
    var myLng = parseFloat(pos.coords.longitude.toFixed(4));
    var alias = localStorage.getItem('vv_alias') || 'INSIDER';
    var uid = currentUser ? currentUser.uid : null;
    if (!uid) { _vvPulseActive = false; showVVPulseOverlay('remove'); return; }

    // Scrie pozitia in Firebase cu TTL de 90 secunde
    var pulseRef = db.collection('vv_pulse').doc(uid);
    var expiresAt = new Date(Date.now() + 90000);
    try {
        await pulseRef.set({
            uid: uid,
            alias: alias,
            lat: myLat,
            lng: myLng,
            activatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt),
            vveilConsent: localStorage.getItem('vv_vveil_consent') || 'auto'
        });
    } catch(e) {
        _vvPulseActive = false;
        showVVPulseOverlay('remove');
        showToast('Eroare conexiune. Incearca din nou.');
        return;
    }

    // Cauta alti Insideri in raza
    searchNearbyInsiders(myLat, myLng, uid, alias);

    // Timeout global
    _vvPulseTimer = setTimeout(function() {
        endVVPulse(uid, false);
    }, VV_PULSE_TIMEOUT);
}

// ── CAUTA INSIDERI IN RAZA ────────────────────────────────────
async function searchNearbyInsiders(myLat, myLng, myUid, myAlias) {
    try {
        var now = new Date();
        var snap = await db.collection('vv_pulse')
            .where('expiresAt', '>', firebase.firestore.Timestamp.fromDate(now))
            .get();

        var nearby = [];
        snap.forEach(function(doc) {
            var d = doc.data();
            if (doc.id === myUid) return;
            var latDiff = Math.abs(d.lat - myLat);
            var lngDiff = Math.abs(d.lng - myLng);
            if (latDiff < VV_PULSE_RADIUS && lngDiff < VV_PULSE_RADIUS) {
                nearby.push({ uid: doc.id, alias: d.alias || 'INSIDER' });
            }
        });

        if (nearby.length === 0) {
            // Continua sa scaneze la 5 secunde
            setTimeout(function() {
                if (_vvPulseActive) searchNearbyInsiders(myLat, myLng, myUid, myAlias);
            }, 5000);
            return;
        }

        // ── CONFIRMARE AUTOMATA ──
        // Daca ambii sunt in Firebase cu GPS in raza → asta e confirmarea
        var target = nearby[0];
        showVVPulseOverlay('found', target.alias);

        // Asteptam 2 secunde ca sa fie sigur ca si celalalt a detectat
        setTimeout(function() {
            if (_vvPulseActive) {
                clearTimeout(_vvPulseTimer);
                awardVVPulseBonus(myUid, target);
            }
        }, 2000);

    } catch(e) {
        console.warn('[VV Pulse]', e);
        if (_vvPulseActive) {
            setTimeout(function() {
                if (_vvPulseActive) searchNearbyInsiders(myLat, myLng, myUid, myAlias);
            }, 5000);
        }
    }
}


// ── ACORDA BONUS VV COINS ─────────────────────────────────────
async function awardVVPulseBonus(myUid, target) {
    var usesAzi = getVVPulseUsesToday();
    var bonus = VV_PULSE_BONUS[Math.min(usesAzi, VV_PULSE_BONUS.length - 1)];
    incrementVVPulseUses();

    try {
        var batch = db.batch();
        // Bonus pentru amandoi
        batch.update(db.collection('users').doc(myUid), {
            balance: firebase.firestore.FieldValue.increment(bonus)
        });
        batch.update(db.collection('users').doc(target.uid), {
            balance: firebase.firestore.FieldValue.increment(bonus)
        });
        // Log in vvhi_dataset
        batch.set(db.collection('vvhi_dataset').doc(), {
            action: 'VV_PULSE_CONNECT',
            context: {
                userA: myUid,
                userB: target.uid,
                aliasA: localStorage.getItem('vv_alias') || 'INSIDER',
                aliasB: target.alias,
                bonus: bonus
            },
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
    } catch(e) { console.warn('[VV Pulse bonus]', e); }

    showVVPulseOverlay('connected', target.alias, bonus);
    // Salveaza Pulse Echo cu level si specializare target
    var targetLevel = 1, targetSpec = 'explorer';
    if (typeof _vvhiCoreStats !== 'undefined' && _vvhiCoreStats) {
        // Incercam sa citim stats din Firebase pentru target
        db.collection('users').doc(target.uid).get().then(function(doc) {
            if (doc.exists && doc.data().vvhi_core_stats) {
                targetLevel = doc.data().vvhi_core_stats.experience_level || 1;
                targetSpec = doc.data().vvhi_core_stats.specialization || 'explorer';
            }
            savePulseEcho(target.alias, targetLevel, targetSpec);
        }).catch(function() { savePulseEcho(target.alias, 1, 'explorer'); });
    } else {
        savePulseEcho(target.alias, 1, 'explorer');
    }
    endVVPulse(myUid, true);
}

// ── END PULSE ─────────────────────────────────────────────────
async function endVVPulse(uid, success) {
    _vvPulseActive = false;
    clearTimeout(_vvPulseTimer);
    // Sterge pozitia din Firebase
    try { await db.collection('vv_pulse').doc(uid).delete(); } catch(e) {}
    if (!success) {
        setTimeout(function() { showVVPulseOverlay('remove'); }, 1500);
    } else {
        setTimeout(function() { showVVPulseOverlay('remove'); }, 3000);
    }
}

// ── OVERLAY VV PULSE ─────────────────────────────────────────
function showVVPulseOverlay(phase, targetAlias, bonus) {
    var old = document.getElementById('vv-pulse-overlay');
    if (old && phase === 'remove') { old.remove(); return; }
    if (old) { updateVVPulseOverlay(phase, targetAlias, bonus); return; }

    var remaining = VV_PULSE_MAX_PER_DAY - getVVPulseUsesToday();
    var overlay = document.createElement('div');
    overlay.id = 'vv-pulse-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;';
    overlay.innerHTML = [
        '<style>',
        '@keyframes vpFadeIn{from{opacity:0}to{opacity:1}}',
        '@keyframes vpRing1{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.12);opacity:.15}}',
        '@keyframes vpRing2{0%,100%{transform:scale(1);opacity:.4}50%{transform:scale(1.18);opacity:.1}}',
        '@keyframes vpRing3{0%,100%{transform:scale(1);opacity:.3}50%{transform:scale(1.24);opacity:.06}}',
        '@keyframes vpCore{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0.2)}50%{box-shadow:0 0 0 14px rgba(255,255,255,0)}}',
        '@keyframes vpScan{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}',
        '</style>',
        // Radar
        '<div style="position:relative;width:220px;height:220px;margin-bottom:40px;">',
            '<div style="position:absolute;inset:-44px;border-radius:50%;border:1px solid rgba(255,255,255,0.04);animation:vpRing3 2.4s ease-in-out infinite .9s;"></div>',
            '<div style="position:absolute;inset:-22px;border-radius:50%;border:1px solid rgba(255,255,255,0.07);animation:vpRing2 2.4s ease-in-out infinite .6s;"></div>',
            '<div style="position:absolute;inset:0;border-radius:50%;border:1px solid rgba(255,255,255,0.1);animation:vpRing1 2.4s ease-in-out infinite .3s;"></div>',
            // Linie scan
            '<div style="position:absolute;inset:0;border-radius:50%;overflow:hidden;">',
                '<div style="position:absolute;top:50%;left:50%;width:50%;height:1px;transform-origin:left center;background:linear-gradient(90deg,rgba(255,255,255,0.4),transparent);animation:vpScan 2s linear infinite;"></div>',
            '</div>',
            // Core
            '<div id="vvp-core" style="position:absolute;inset:44px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;animation:vpCore 2s infinite;">',
                '<span style="font-size:28px;color:rgba(255,255,255,0.9);">⬡</span>',
            '</div>',
            '<div id="vvp-dots" style="position:absolute;inset:0;border-radius:50%;pointer-events:none;"></div>',
        '</div>',
        // Text
        '<div style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:4px;font-weight:700;margin-bottom:10px;text-align:center;">VV PULSE</div>',
        '<div id="vvp-status" style="font-size:17px;font-weight:800;color:#fff;letter-spacing:.5px;margin-bottom:8px;text-align:center;min-height:26px;">Se scanează zona...</div>',
        '<div id="vvp-sub" style="font-size:12px;color:rgba(255,255,255,0.3);text-align:center;line-height:1.6;max-width:260px;margin-bottom:32px;">Detectare GPS · Raza ~50m</div>',
        // Progress
        '<div style="width:200px;height:2px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;margin-bottom:32px;">',
            '<div id="vvp-progress" style="height:100%;width:0%;border-radius:2px;background:rgba(255,255,255,0.6);transition:width .5s linear;"></div>',
        '</div>',
        // Pulsuri ramase
        '<div style="font-size:10px;color:rgba(255,255,255,0.2);margin-bottom:20px;letter-spacing:1px;">' + remaining + ' Pulse-uri rămase azi</div>',
        // Anuleaza
        '<div id="vvp-cancel-btn" onclick="cancelVVPulse()" style="padding:12px 32px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-size:12px;color:rgba(255,255,255,0.3);cursor:pointer;letter-spacing:1px;font-weight:600;-webkit-tap-highlight-color:transparent;">ANULEAZĂ</div>',
        // Legal
        '<div style="position:absolute;bottom:calc(20px + env(safe-area-inset-bottom,0px));font-size:9px;color:rgba(255,255,255,0.12);text-align:center;letter-spacing:1px;max-width:280px;line-height:1.6;">Detectare GPS anonimizată · Coordonate rotunjite · GDPR</div>',
    ].join('');

    document.body.appendChild(overlay);
    // Animeaza progress
    var pct = 0;
    var pi = setInterval(function() {
        pct += 100/60; // 60 secunde
        var p = document.getElementById('vvp-progress');
        if (p) p.style.width = Math.min(pct,100) + '%';
        if (pct >= 100 || !_vvPulseActive) clearInterval(pi);
    }, 1000);
}

function updateVVPulseOverlay(phase, targetAlias, bonus) {
    var status = document.getElementById('vvp-status');
    var sub = document.getElementById('vvp-sub');
    var core = document.getElementById('vvp-core');
    var cancelBtn = document.getElementById('vvp-cancel-btn');
    var dots = document.getElementById('vvp-dots');

    if (phase === 'found') {
        if (status) status.textContent = 'Insider detectat ⬡';
        if (sub) sub.innerHTML = '<strong style="color:#fff;">' + (targetAlias||'INSIDER') + '</strong> e în proximitate<br>Confirmare în curs...';
        if (core) { core.style.background = 'rgba(255,255,255,0.15)'; core.style.border = '1px solid rgba(255,255,255,0.5)'; }
        // Adauga dot
        if (dots) {
            var dot = document.createElement('div');
            var angle = Math.random() * Math.PI * 2;
            var r = 70 + Math.random() * 20;
            dot.style.cssText = 'position:absolute;width:10px;height:10px;border-radius:50%;background:#fff;box-shadow:0 0 14px rgba(255,255,255,0.7);left:' + (110+Math.cos(angle)*r-5) + 'px;top:' + (110+Math.sin(angle)*r-5) + 'px;';
            dots.appendChild(dot);
        }
    } else if (phase === 'connected') {
        if (status) { status.textContent = 'Conectat! +' + bonus + ' VV ⬡'; status.style.color = '#fff'; }
        if (sub) sub.innerHTML = 'Conexiune cu <strong style="color:#fff;">' + (targetAlias||'INSIDER') + '</strong> confirmată!';
        if (core) { core.style.background = 'rgba(255,255,255,0.2)'; core.style.border = '1px solid rgba(255,255,255,0.7)'; }
        if (cancelBtn) cancelBtn.style.display = 'none';
    } else if (phase === 'timeout') {
        if (status) status.textContent = 'Niciun Insider în rază';
        if (sub) sub.textContent = 'Încearcă în zone cu mai mulți Insideri VV';
    }
}

function cancelVVPulse() {
    _vvPulseActive = false;
    clearTimeout(_vvPulseTimer);
    if (currentUser) {
        db.collection('vv_pulse').doc(currentUser.uid).delete().catch(function(){});
    }
    showVVPulseOverlay('remove');
}

// Alias pentru compatibilitate cu HTML
function startVVNodScan() { startVVPulse(); }
function stopVVNodScan() { cancelVVPulse(); }

setTimeout(injectVVNodButton, 2500);

// ================================================================
// EDGE PROFILE — Personalizare Nexus dupa prima misiune
// Date stocate DOAR local — zero transmisie identificabila
// ================================================================
function getEdgeProfile() {
    try { return JSON.parse(localStorage.getItem('vv_edge_profile') || 'null'); } catch(e) { return null; }
}

function maybeOfferEdgeProfile() {
    // Nu oferi daca e deja configurat
    if (getEdgeProfile()) return;
    // Nu oferi daca e prima sesiune — verifica daca a facut cel putin o misiune
    var missionsDone = parseInt(localStorage.getItem('vv_missions_sent') || '0');
    var newCount = missionsDone + 1;
    localStorage.setItem('vv_missions_sent', String(newCount));
    // Oferta dupa prima misiune
    if (newCount >= 1) {
        setTimeout(showEdgeProfileOffer, 1500);
    }
}

function showEdgeProfileOffer() {
    if (getEdgeProfile()) return;
    var old = document.getElementById('edge-profile-modal');
    if (old) return;

    var modal = document.createElement('div');
    modal.id = 'edge-profile-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;align-items:flex-end;justify-content:center;';

    modal.innerHTML = '<div id="edge-sheet" style="width:100%;max-width:430px;background:rgba(6,6,10,0.98);border:1px solid rgba(255,255,255,0.1);border-radius:28px 28px 0 0;padding:28px 22px calc(32px + env(safe-area-inset-bottom,0px));transform:translateY(100%);transition:transform .4s cubic-bezier(0.16,1,0.3,1);">' +
        '<div style="width:36px;height:3px;background:rgba(255,255,255,0.15);border-radius:2px;margin:0 auto 24px;"></div>' +
        '<div style="text-align:center;margin-bottom:28px;">' +
            '<div style="font-size:28px;margin-bottom:12px;">⬡</div>' +
            '<div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:8px;">Nexus vrea să te cunoască</div>' +
            '<div style="font-size:13px;color:rgba(255,255,255,0.4);line-height:1.6;">3 întrebări. Răspunsurile rămân pe telefonul tău.<br>Niciodată pe serverele VV.</div>' +
        '</div>' +
        '<div id="edge-step-1">' +
            '<div style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:3px;font-weight:700;text-align:center;margin-bottom:16px;">CÂND EȘTI ACTIV?</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                edgeOptionBtn('time', 'morning', '🌅', 'Dimineața', '6:00 - 12:00') +
                edgeOptionBtn('time', 'afternoon', '☀️', 'După-amiaza', '12:00 - 18:00') +
                edgeOptionBtn('time', 'evening', '🌆', 'Seara', '18:00 - 22:00') +
                edgeOptionBtn('time', 'night', '🌙', 'Noaptea', '22:00 - 6:00') +
            '</div>' +
        '</div>' +
        '<div id="edge-step-2" style="display:none;">' +
            '<div style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:3px;font-weight:700;text-align:center;margin-bottom:16px;">CE TE INTERESEAZĂ?</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                edgeOptionBtn('interest', 'locations', '📍', 'Locații & Vibe', 'Atmosfera orașului') +
                edgeOptionBtn('interest', 'missions', '⬡', 'Misiuni', 'Recompense VV') +
                edgeOptionBtn('interest', 'pulse', '🔵', 'Conexiuni', 'Pulse & Insideri') +
                edgeOptionBtn('interest', 'all', '🌆', 'Tot', 'Totul mă interesează') +
            '</div>' +
        '</div>' +
        '<div id="edge-step-3" style="display:none;">' +
            '<div style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:3px;font-weight:700;text-align:center;margin-bottom:16px;">CUM TE AJUT?</div>' +
            '<div style="display:flex;flex-direction:column;gap:10px;">' +
                edgeOptionBtnFull('style', 'finder', '🔍', 'Găsitor', 'Găsește-mi locuri și verifică situații') +
                edgeOptionBtnFull('style', 'connector', '⬡', 'Conector', 'Ajută-mă să conectez cu Insideri') +
                edgeOptionBtnFull('style', 'analyst', '🧠', 'Analist', 'Explică-mi ce se întâmplă în oraș') +
            '</div>' +
        '</div>' +
        '<button onclick="skipEdgeProfile()" style="width:100%;padding:14px;background:transparent;border:none;color:rgba(255,255,255,0.2);font-size:12px;cursor:pointer;font-family:inherit;margin-top:16px;">Nu acum</button>' +
    '</div>';

    document.body.appendChild(modal);
    setTimeout(function() {
        var sheet = document.getElementById('edge-sheet');
        if (sheet) sheet.style.transform = 'translateY(0)';
    }, 10);
}

function edgeOptionBtn(type, value, icon, title, desc) {
    return '<div onclick="selectEdgeOption(\'' + type + '\',\'' + value + '\',this)" style="padding:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;cursor:pointer;text-align:center;transition:all .15s;-webkit-tap-highlight-color:transparent;" data-type="' + type + '" data-value="' + value + '">' +
        '<div style="font-size:22px;margin-bottom:6px;">' + icon + '</div>' +
        '<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:2px;">' + title + '</div>' +
        '<div style="font-size:10px;color:rgba(255,255,255,0.3);">' + desc + '</div>' +
    '</div>';
}

function edgeOptionBtnFull(type, value, icon, title, desc) {
    return '<div onclick="selectEdgeOption(\'' + type + '\',\'' + value + '\',this)" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent;" data-type="' + type + '" data-value="' + value + '">' +
        '<div style="font-size:22px;flex-shrink:0;">' + icon + '</div>' +
        '<div><div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:2px;">' + title + '</div>' +
        '<div style="font-size:11px;color:rgba(255,255,255,0.35);">' + desc + '</div></div>' +
    '</div>';
}

var _edgeAnswers = {};
var _edgeCurrentStep = 1;

function selectEdgeOption(type, value, el) {
    // Highlight selectat
    var container = el.parentElement;
    container.querySelectorAll('[data-type="' + type + '"]').forEach(function(btn) {
        btn.style.background = 'rgba(255,255,255,0.04)';
        btn.style.borderColor = 'rgba(255,255,255,0.08)';
    });
    el.style.background = 'rgba(255,255,255,0.12)';
    el.style.borderColor = 'rgba(255,255,255,0.3)';
    _edgeAnswers[type] = value;

    // Avans automat la pasul urmator dupa 400ms
    setTimeout(function() { advanceEdgeStep(); }, 400);
}

function advanceEdgeStep() {
    _edgeCurrentStep++;
    if (_edgeCurrentStep === 2) {
        document.getElementById('edge-step-1').style.display = 'none';
        document.getElementById('edge-step-2').style.display = 'block';
    } else if (_edgeCurrentStep === 3) {
        document.getElementById('edge-step-2').style.display = 'none';
        document.getElementById('edge-step-3').style.display = 'block';
    } else {
        saveEdgeProfile();
    }
}

function saveEdgeProfile() {
    var profile = {
        time: _edgeAnswers.time || 'evening',
        interest: _edgeAnswers.interest || 'all',
        style: _edgeAnswers.style || 'finder',
        configuredAt: new Date().toISOString()
    };
    localStorage.setItem('vv_edge_profile', JSON.stringify(profile));

    // Trimite DOAR flag-uri anonime la Firebase — fara UID, fara identificare
    if (typeof db !== 'undefined') {
        db.collection('vvhi_dataset').add({
            action: 'EDGE_PROFILE_SET',
            context: {
                pref_time: profile.time,
                pref_interest: profile.interest,
                pref_style: profile.style
                // intentionat fara uid — anonim complet
            },
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function(){});
    }

    // Inchide modal cu animatie
    var sheet = document.getElementById('edge-sheet');
    if (sheet) sheet.style.transform = 'translateY(100%)';
    setTimeout(function() {
        var modal = document.getElementById('edge-profile-modal');
        if (modal) modal.remove();
        showToast('⬡ Nexus te cunoaște acum. Experiența ta e personalizată.');
        // XP social pentru configurare
        updateVVhiCoreStats('feedback_sent');
    }, 400);
}

function skipEdgeProfile() {
    localStorage.setItem('vv_edge_profile_skipped', 'true');
    var sheet = document.getElementById('edge-sheet');
    if (sheet) sheet.style.transform = 'translateY(100%)';
    setTimeout(function() {
        var modal = document.getElementById('edge-profile-modal');
        if (modal) modal.remove();
    }, 400);
}

// ── Nexus citeste Edge Profile la fiecare query ───────────────
function getEdgeContextForNexus() {
    var profile = getEdgeProfile();
    if (!profile) return null;
    var ora = new Date().getHours();
    var oraCurenta = ora >= 6 && ora < 12 ? 'morning' : ora >= 12 && ora < 18 ? 'afternoon' : ora >= 18 && ora < 22 ? 'evening' : 'night';
    return {
        profile: profile,
        isActiveTime: profile.time === oraCurenta,
        wantsVibe: profile.interest === 'locations' || profile.interest === 'all',
        wantsMissions: profile.interest === 'missions' || profile.interest === 'all',
        wantsPulse: profile.interest === 'pulse' || profile.interest === 'all',
        isFinder: profile.style === 'finder',
        isConnector: profile.style === 'connector',
        isAnalyst: profile.style === 'analyst'
    };
}
