// vv-mood.js — VV Mood · Pulsul Orașului
// Un tap pe zi. Harta live a energiei urbane.
// Arhitectura: personal pe device (localStorage) + anonim în cloud (Firestore geohash)
// Cost: $0 · Privacy: 100% · Premium feeling: Steve Jobs level

const VVMood = (function () {
  'use strict';

  const CEO_UID = 'PthU3uVY5WSPNx8d4XrdXEgszEo1';
  const FS_COL = 'vv_mood';
  const LOCAL_KEY = 'vv_mood_profile';
  const COINS_TAP = 1;
  const COINS_STREAK_7 = 10;
  const COINS_STREAK_30 = 50;
  const COINS_PREDICT = 3;

  const MOODS = {
    linis:     { id: 'linis',     label: 'Liniștit', emoji: '😌', color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
    aglomerat: { id: 'aglomerat', label: 'Aglomerat', emoji: '🔥', color: '#FF9F0A', bg: 'rgba(255,159,10,0.1)' },
    haos:      { id: 'haos',      label: 'Haos',      emoji: '🌪',  color: '#FF453A', bg: 'rgba(255,69,58,0.1)' }
  };

  const BADGES = {
    first:    { name: 'Prima Contribuție', icon: '🌱', desc: 'Primul tap la harta orașului' },
    streak7:  { name: 'Vocea Cartierului', icon: '🎙️', desc: '7 zile consecutive' },
    streak30: { name: 'Pulsul Orașului',   icon: '🌐', desc: '30 de zile consecutive' },
    sensor50: { name: 'Sensor Activ',      icon: '📡', desc: '50 de contribuții' },
    pioneer:  { name: 'Pionier',           icon: '🌟', desc: 'Primul care a mapat această zonă' }
  };

  let _db = null;
  let _lat = null;
  let _lng = null;
  let _geo = null;
  let _profile = null;
  let _ready = false;
  const _toastQueue = [];
  let _toastBusy = false;

  // ═══════════════════════════════════════════════
  // GEOHASH — standard algorithm, no library needed
  // precision 5 = ~5km² cell
  // ═══════════════════════════════════════════════

  function geo(lat, lng, p) {
    p = p || 5;
    const B = '0123456789bcdefghjkmnpqrstuvwxyz';
    let idx = 0, bit = 0, even = true, h = '';
    let laMin = -90, laMax = 90, loMin = -180, loMax = 180;
    while (h.length < p) {
      if (even) {
        const m = (loMin + loMax) / 2;
        if (lng >= m) { idx = idx * 2 + 1; loMin = m; }
        else { idx = idx * 2; loMax = m; }
      } else {
        const m = (laMin + laMax) / 2;
        if (lat >= m) { idx = idx * 2 + 1; laMin = m; }
        else { idx = idx * 2; laMax = m; }
      }
      even = !even;
      if (++bit === 5) { h += B[idx]; bit = 0; idx = 0; }
    }
    return h;
  }

  // ═══════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════

  async function init(db, auth, lat, lng) {
    _db = db;
    if (lat && lng) { _lat = lat; _lng = lng; _geo = geo(lat, lng); }
    _profile = _loadProfile();
    _flushOffline();
    await _checkPrediction();
    _ready = true;
  }

  function setLocation(lat, lng) {
    _lat = lat; _lng = lng; _geo = geo(lat, lng);
  }

  // ═══════════════════════════════════════════════
  // PROFILE — localStorage only, never leaves device
  // ═══════════════════════════════════════════════

  function _loadProfile() {
    try {
      const r = localStorage.getItem(LOCAL_KEY);
      return r ? JSON.parse(r) : _blank();
    } catch { return _blank(); }
  }

  function _blank() {
    return { streak: 0, lastDate: null, total: 0, coins: 0, badges: [], history: [], preds: [] };
  }

  function _save() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(_profile)); } catch {}
  }

  // ═══════════════════════════════════════════════
  // TAP — main action
  // ═══════════════════════════════════════════════

  async function tap(moodId) {
    if (!MOODS[moodId]) return null;
    const today = _d(0);
    if (_profile.lastDate === today) {
      toast('Ai contribuit deja azi. Revino mâine.', '⏰');
      return null;
    }

    _profile.streak = _profile.lastDate === _d(-1) ? _profile.streak + 1 : 1;
    _profile.lastDate = today;
    _profile.total++;

    _profile.history.unshift({ date: today, mood: moodId, geo: _geo });
    if (_profile.history.length > 30) _profile.history.pop();

    let bonus = 0;
    _profile.coins += COINS_TAP;
    if (_profile.streak === 7)  { bonus = COINS_STREAK_7;  _badge('streak7'); }
    if (_profile.streak === 30) { bonus = COINS_STREAK_30; _badge('streak30'); }
    if (_profile.total === 1)   _badge('first');
    if (_profile.total === 50)  _badge('sensor50');
    _profile.coins += bonus;
    _save();

    const isNewCell = await _aggregate(moodId);
    if (isNewCell) _badge('pioneer');

    document.dispatchEvent(new CustomEvent('vvmood:coins', { detail: { amount: COINS_TAP + bonus } }));

    return { mood: MOODS[moodId], streak: _profile.streak, coins: COINS_TAP + bonus };
  }

  // ═══════════════════════════════════════════════
  // FIRESTORE — only anonymous aggregates
  // ═══════════════════════════════════════════════

  async function _aggregate(moodId) {
    if (!_db || !_geo) return false;
    const ref = _db.collection(FS_COL).doc(_geo);
    const h = new Date().getHours();
    const dw = new Date().getDay();
    const inc = firebase.firestore.FieldValue.increment(1);
    try {
      const snap = await ref.get();
      const isNew = !snap.exists;
      await ref.set({
        [moodId]: inc,
        total: inc,
        [`h${h}_${moodId}`]: inc,
        [`dw${dw}_${moodId}`]: inc,
        ts: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      _checkAnomaly(snap, moodId);
      return isNew;
    } catch {
      _queueOffline(moodId);
      return false;
    }
  }

  // Mood → Pulse bridge: dominance ≥65% + min 15 taps → auto-mission
  async function _checkAnomaly(snap, moodId) {
    if (!_db || !_geo) return;
    const d = snap.data() || {};
    const total = (d.total || 0) + 1;
    if (total < 15) return;
    const moodCount = (d[moodId] || 0) + 1;
    if (moodCount / total < 0.65) return;
    const hourKey = 'vv_a_' + _geo + '_' + new Date().toISOString().slice(0, 13);
    if (localStorage.getItem(hourKey)) return;
    localStorage.setItem(hourKey, '1');
    _db.collection('missions').add({
      title: 'Anomalie ' + MOODS[moodId].label + ' · ' + _geo.toUpperCase(),
      type: 'auto',
      trigger: 'mood_anomaly',
      geohash: _geo,
      mood: moodId,
      ratio: Math.round(moodCount / total * 100),
      status: 'active',
      createdBy: 'vvmood_auto',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
    document.dispatchEvent(new CustomEvent('vvmood:anomaly', { detail: { geohash: _geo, mood: moodId } }));
  }

  function _queueOffline(moodId) {
    try {
      const q = JSON.parse(localStorage.getItem('vv_mood_q') || '[]');
      q.push({ moodId, geo: _geo, ts: Date.now() });
      localStorage.setItem('vv_mood_q', JSON.stringify(q.slice(-100)));
    } catch {}
  }

  async function _flushOffline() {
    if (!_db) return;
    try {
      const q = JSON.parse(localStorage.getItem('vv_mood_q') || '[]');
      if (!q.length) return;
      const inc = firebase.firestore.FieldValue.increment(1);
      for (const item of q) {
        _db.collection(FS_COL).doc(item.geo).set({ [item.moodId]: inc, total: inc }, { merge: true }).catch(() => {});
      }
      localStorage.removeItem('vv_mood_q');
    } catch {}
  }

  // ═══════════════════════════════════════════════
  // PREDICTION
  // ═══════════════════════════════════════════════

  function savePrediction(moodId) {
    const tomorrow = _d(1);
    _profile.preds = _profile.preds.filter(p => p.date !== tomorrow);
    _profile.preds.push({ date: tomorrow, pred: moodId, geo: _geo, actual: null });
    if (_profile.preds.length > 14) _profile.preds.shift();
    _save();
    toast('Predicție salvată · +' + COINS_PREDICT + ' VV mâine dacă ghicești', MOODS[moodId].emoji);
  }

  async function _checkPrediction() {
    const today = _d(0);
    const p = _profile.preds.find(x => x.date === today && !x.actual && x.geo === _geo);
    if (!p || !_db) return;
    try {
      const snap = await _db.collection(FS_COL).doc(_geo).get();
      if (!snap.exists) return;
      const d = snap.data();
      const dominant = ['linis', 'aglomerat', 'haos'].reduce((a, b) => (d[a] || 0) > (d[b] || 0) ? a : b);
      p.actual = dominant;
      if (p.pred === dominant) {
        _profile.coins += COINS_PREDICT;
        setTimeout(() => toast('Ai prezis corect! +' + COINS_PREDICT + ' VV Coins', '🎯', '#34d399'), 2000);
      }
      _save();
    } catch {}
  }

  // ═══════════════════════════════════════════════
  // BADGES — rare, meaningful
  // ═══════════════════════════════════════════════

  function _badge(id) {
    if (_profile.badges.includes(id)) return;
    _profile.badges.push(id);
    _save();
    const b = BADGES[id];
    if (b) setTimeout(() => _badgeAnim(b), 700);
  }

  function _badgeAnim(b) {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.7)',
      'z-index:99999;text-align:center',
      'background:rgba(12,12,16,0.97);border:0.5px solid rgba(255,255,255,0.1)',
      'border-radius:28px;padding:36px 44px',
      'backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px)',
      'transition:transform 0.45s cubic-bezier(0.34,1.56,0.64,1),opacity 0.35s ease',
      'opacity:0;font-family:-apple-system,sans-serif;color:#fff;pointer-events:none'
    ].join(';');
    el.innerHTML = `
      <div style="font-size:52px;margin-bottom:14px;line-height:1;">${b.icon}</div>
      <div style="font-size:10px;font-weight:600;letter-spacing:2.5px;color:rgba(147,197,253,0.65);text-transform:uppercase;margin-bottom:10px;">Badge Deblocat</div>
      <div style="font-size:22px;font-weight:700;margin-bottom:6px;letter-spacing:-0.3px;">${b.name}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.38);line-height:1.5;">${b.desc}</div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'translate(-50%,-50%) scale(1)';
      el.style.opacity = '1';
    });
    if (navigator.vibrate) navigator.vibrate([40, 25, 70]);
    setTimeout(() => {
      el.style.transform = 'translate(-50%,-50%) scale(0.96)';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 380);
    }, 3200);
  }

  // ═══════════════════════════════════════════════
  // TOAST — Apple pill, bottom, never intrusive
  // ═══════════════════════════════════════════════

  function toast(msg, icon, color) {
    icon = icon || '⬡'; color = color || 'rgba(255,255,255,0.9)';
    _toastQueue.push({ msg, icon, color });
    if (!_toastBusy) _nextToast();
  }

  function _nextToast() {
    if (!_toastQueue.length) { _toastBusy = false; return; }
    _toastBusy = true;
    const { msg, icon, color } = _toastQueue.shift();
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      'bottom:max(env(safe-area-inset-bottom,0px),20px)',
      'left:50%;transform:translateX(-50%) translateY(80px)',
      'z-index:99997',
      'background:rgba(24,24,26,0.96)',
      'border:0.5px solid rgba(255,255,255,0.09)',
      'border-radius:100px;padding:11px 20px',
      'backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)',
      'display:flex;align-items:center;gap:9px',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'white-space:nowrap;pointer-events:none',
      'transition:transform 0.38s cubic-bezier(0.34,1.56,0.64,1),opacity 0.3s ease',
      'opacity:0;max-width:calc(100vw - 48px)'
    ].join(';');
    el.innerHTML = `
      <span style="font-size:15px;">${icon}</span>
      <span style="font-size:13px;font-weight:500;color:#fff;">${_esc(msg)}</span>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = 'translateX(-50%) translateY(0)';
      el.style.opacity = '1';
    });
    setTimeout(() => {
      el.style.transform = 'translateX(-50%) translateY(60px)';
      el.style.opacity = '0';
      setTimeout(() => { el.remove(); setTimeout(_nextToast, 150); }, 300);
    }, 2800);
  }

  // ═══════════════════════════════════════════════
  // PANEL UI — iOS sheet, slide from bottom
  // ═══════════════════════════════════════════════

  function openPanel(lat, lng) {
    if (lat && lng) setLocation(lat, lng);
    const ex = document.getElementById('vvmood-panel');
    if (ex) { _closePanel(ex); return; }
    _buildPanel();
  }

  function _buildPanel() {
    const today = _d(0);
    const tapped = _profile.lastDate === today;
    const last = _profile.history[0];

    const overlay = document.createElement('div');
    overlay.id = 'vvmood-panel';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:99996',
      'background:rgba(0,0,0,0.55)',
      'display:flex;align-items:flex-end;justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,SF Pro Display,sans-serif'
    ].join(';');
    overlay.onclick = e => { if (e.target === overlay) _closePanel(overlay); };

    const sheet = document.createElement('div');
    sheet.id = 'vvmood-sheet';
    sheet.style.cssText = [
      'width:100%;max-width:480px',
      'background:rgba(16,16,18,0.99)',
      'border-radius:22px 22px 0 0',
      'border-top:0.5px solid rgba(255,255,255,0.09)',
      'transform:translateY(100%)',
      'transition:transform 0.42s cubic-bezier(0.25,0.46,0.45,0.94)',
      'overflow:hidden;padding-bottom:max(env(safe-area-inset-bottom,0px),20px)'
    ].join(';');

    const geoLabel = _geo ? _geo.toUpperCase() : '—';
    const streakStr = _profile.streak > 1
      ? `<span style="color:rgba(255,255,255,0.38);font-size:11px;letter-spacing:0.8px;">${_profile.streak} ZILE · ${_profile.total} CONTRIBUȚII</span>`
      : '';

    if (tapped) {
      const m = last ? MOODS[last.mood] : null;
      sheet.innerHTML = `
        ${_handle()}
        <div style="padding:24px 24px 0;text-align:center;">
          <div style="font-size:42px;margin-bottom:10px;">${m ? m.emoji : '✓'}</div>
          <div style="font-size:16px;font-weight:600;margin-bottom:5px;color:#fff;">Ai contribuit azi</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.35);margin-bottom:6px;">
            Zona <strong style="color:rgba(255,255,255,0.5);letter-spacing:1px;">${geoLabel}</strong>
            · <span style="color:${m ? m.color : '#fff'}">${m ? m.label : ''}</span>
          </div>
          ${streakStr}
        </div>
        <div style="padding:20px 20px 0;" id="vvmood-pred-wrap">
          ${_predSection()}
        </div>
      `;
    } else {
      sheet.innerHTML = `
        ${_handle()}
        <div style="padding:22px 22px 0;">
          <div style="font-size:16px;font-weight:600;color:#fff;margin-bottom:3px;">Cum e în zona ta acum?</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.28);margin-bottom:20px;letter-spacing:0.5px;">
            ZONA ${geoLabel}${_geo ? '' : ' · Activează GPS'}
          </div>
          <div style="display:flex;flex-direction:column;gap:9px;" id="mood-btns">
            ${Object.values(MOODS).map(m => `
              <button
                id="mdbtn-${m.id}"
                onclick="VVMood._tap('${m.id}')"
                style="width:100%;display:flex;align-items:center;gap:14px;padding:15px 16px;
                       background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.07);
                       border-radius:13px;cursor:pointer;color:#fff;
                       font-family:-apple-system,sans-serif;transition:background 0.15s,transform 0.1s;"
                ontouchstart="this.style.background='${m.bg}';this.style.borderColor='${m.color}40'"
                ontouchend="this.style.background='rgba(255,255,255,0.04)';this.style.borderColor='rgba(255,255,255,0.07)'">
                <span style="font-size:26px;width:34px;text-align:center;">${m.emoji}</span>
                <span style="font-size:15px;font-weight:500;">${m.label}</span>
                <span style="margin-left:auto;font-size:18px;color:rgba(255,255,255,0.2);">›</span>
              </button>
            `).join('')}
          </div>
          <div style="text-align:center;padding:14px 0 4px;">${streakStr}</div>
        </div>
      `;
    }

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { sheet.style.transform = 'translateY(0)'; });
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function _closePanel(overlay) {
    const sheet = document.getElementById('vvmood-sheet');
    if (sheet) sheet.style.transform = 'translateY(100%)';
    setTimeout(() => { if (overlay) overlay.remove(); }, 380);
  }

  function _handle() {
    return '<div style="width:34px;height:4px;background:rgba(255,255,255,0.18);border-radius:2px;margin:10px auto 0;"></div>';
  }

  function _predSection() {
    const tomorrow = _d(1);
    const ex = _profile.preds.find(p => p.date === tomorrow);
    if (ex) {
      const m = MOODS[ex.pred];
      return `<div style="padding:14px 16px;background:rgba(255,255,255,0.03);border:0.5px solid rgba(255,255,255,0.06);border-radius:14px;text-align:center;">
        <div style="font-size:10px;color:rgba(255,255,255,0.25);letter-spacing:1px;margin-bottom:6px;">PREDICȚIE MÂINE</div>
        <div style="font-size:22px;">${m.emoji}</div>
        <div style="font-size:12px;color:${m.color};margin-top:4px;">${m.label} · salvat</div>
      </div>`;
    }
    return `<div style="padding:14px 16px;background:rgba(255,255,255,0.02);border:0.5px solid rgba(255,255,255,0.07);border-radius:14px;">
      <div style="font-size:11px;color:rgba(255,255,255,0.28);margin-bottom:10px;letter-spacing:0.5px;">Cum crezi că va fi mâine? +${COINS_PREDICT} VV dacă ghicești</div>
      <div style="display:flex;gap:8px;">
        ${Object.values(MOODS).map(m => `
          <button onclick="VVMood._pred('${m.id}')"
            style="flex:1;padding:10px 0;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.07);
                   border-radius:10px;cursor:pointer;color:#fff;font-size:20px;
                   font-family:-apple-system,sans-serif;transition:background 0.15s;"
            ontouchstart="this.style.background='${m.bg}'"
            ontouchend="this.style.background='rgba(255,255,255,0.04)'">
            ${m.emoji}
          </button>
        `).join('')}
      </div>
    </div>`;
  }

  async function _tap(moodId) {
    const btns = document.getElementById('mood-btns');
    if (btns) {
      btns.querySelectorAll('button').forEach(b => { b.disabled = true; b.style.opacity = '0.35'; });
      const sel = document.getElementById('mdbtn-' + moodId);
      if (sel) {
        const m = MOODS[moodId];
        sel.style.opacity = '1';
        sel.style.background = m.bg;
        sel.style.borderColor = m.color + '50';
        sel.style.transform = 'scale(1.02)';
      }
    }
    if (navigator.vibrate) navigator.vibrate([25, 15, 45]);

    const result = await tap(moodId);
    if (!result) return;

    const overlay = document.getElementById('vvmood-panel');
    setTimeout(() => {
      _closePanel(overlay);
      const m = result.mood;
      toast('+' + result.coins + ' VV · Zona ta: ' + m.label, m.emoji, m.color);
      if (result.streak >= 3) {
        setTimeout(() => toast(result.streak + ' zile consecutive', '🔥', '#FF9F0A'), 1400);
      }
    }, 550);
  }

  function _pred(moodId) {
    savePrediction(moodId);
    const wrap = document.getElementById('vvmood-pred-wrap');
    if (wrap) wrap.innerHTML = _predSection();
    if (navigator.vibrate) navigator.vibrate(10);
  }

  // ═══════════════════════════════════════════════
  // CEO — read data (B2B ready)
  // ═══════════════════════════════════════════════

  async function getCellData(geohash) {
    if (!_db) return null;
    try { const s = await _db.collection(FS_COL).doc(geohash).get(); return s.exists ? s.data() : null; }
    catch { return null; }
  }

  async function getHeatmapData() {
    if (!_db) return [];
    try { const s = await _db.collection(FS_COL).limit(500).get(); return s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch { return []; }
  }

  function isCEO(auth) {
    return auth && auth.currentUser && auth.currentUser.uid === CEO_UID;
  }

  // ═══════════════════════════════════════════════
  // UTILS
  // ═══════════════════════════════════════════════

  function _d(offset) {
    const d = new Date(); d.setDate(d.getDate() + (offset || 0));
    return d.toISOString().slice(0, 10);
  }

  function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getProfile()     { return _profile; }
  function getBadges()      { return _profile.badges.map(id => ({ id, ...(BADGES[id] || {}) })); }
  function hasTappedToday() { return _profile.lastDate === _d(0); }
  function isReady()        { return _ready; }

  // ═══════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════

  return {
    init, setLocation, tap, savePrediction,
    openPanel, toast, geo,
    getCellData, getHeatmapData, isCEO,
    getProfile, getBadges, hasTappedToday, isReady,
    _tap, _pred
  };
})();
