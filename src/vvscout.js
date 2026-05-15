// vvscout.js — VVScout · Fratele lui VVEil
// Rol: Cauta entitati pe net, construieste baza de reguli pentru VVEil
// Arhitectura HIBRID:
//   - Layer 1: Firestore cloud  (sync intre dispozitive, CEO control)
//   - Layer 2: localStorage     (offline fallback, cache 6h)
//   - Layer 3: Free APIs        (Clearbit Logo + DuckDuckGo + Wikipedia + Google Favicon)
// Cost: $0

const VVScout = (function () {
  'use strict';

  const CEO_UID = 'PthU3uVY5WSPNx8d4XrdXEgszEo1';
  const FS_COLLECTION = 'vv_static_data';
  const FS_DOC = 'vvscout_config';
  const CACHE_KEY = 'vv_scout_rules';
  const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 ore

  let _db = null;
  let _auth = null;
  let _rules = [];
  let _ready = false;

  // ═══════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════

  async function init(db, auth) {
    _db = db;
    _auth = auth;
    await _loadRules();
    _ready = true;
    console.log('[VVScout] Ready · ' + _rules.length + ' reguli');
  }

  // ═══════════════════════════════════════════════════════
  // LOAD RULES — hibrid: localStorage imediat + Firestore sync
  // ═══════════════════════════════════════════════════════

  async function _loadRules() {
    const cached = _readCache();
    if (cached.length) _rules = cached;

    if (!_db) return;
    try {
      const snap = await _db.collection(FS_COLLECTION).doc(FS_DOC).get();
      if (snap.exists && snap.data().rules) {
        _rules = snap.data().rules;
        _writeCache(_rules);
      }
    } catch (e) {
      // offline — continuam din cache
    }
  }

  // ═══════════════════════════════════════════════════════
  // CACHE localStorage
  // ═══════════════════════════════════════════════════════

  function _readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return [];
      const p = JSON.parse(raw);
      if (Date.now() - (p.ts || 0) > CACHE_TTL) return [];
      return p.data || [];
    } catch { return []; }
  }

  function _writeCache(rules) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: rules }));
    } catch {}
  }

  // ═══════════════════════════════════════════════════════
  // PUBLIC — reguli pentru VVEil
  // ═══════════════════════════════════════════════════════

  function getRules() {
    return _rules.filter(r => r.active !== false);
  }

  function isReady() { return _ready; }

  // ═══════════════════════════════════════════════════════
  // FREE APIs — discovery gratuit
  // ═══════════════════════════════════════════════════════

  // Clearbit Logo API — gratuit, fara cheie, returneza logo PNG
  function getLogoUrl(domain) {
    if (!domain) return null;
    const d = domain.replace(/^https?:\/\//, '').split('/')[0];
    return 'https://logo.clearbit.com/' + d;
  }

  // Google Favicon — gratuit, fallback fiabil
  function getFaviconUrl(domain) {
    if (!domain) return null;
    const d = domain.replace(/^https?:\/\//, '').split('/')[0];
    return 'https://www.google.com/s2/favicons?domain=' + d + '&sz=128';
  }

  // DuckDuckGo Instant Answer API — gratuit, fara cheie, fara rate limit agresiv
  async function searchDDG(query) {
    try {
      const url = 'https://api.duckduckgo.com/?q='
        + encodeURIComponent(query)
        + '&format=json&no_redirect=1&no_html=1&skip_disambig=1';
      const r = await fetch(url, { mode: 'cors' });
      const d = await r.json();
      return {
        abstract: (d.AbstractText || d.Abstract || '').slice(0, 400),
        image: d.Image ? 'https://duckduckgo.com' + d.Image : '',
        url: d.AbstractURL || '',
        heading: d.Heading || ''
      };
    } catch { return null; }
  }

  // Wikipedia REST API — gratuit, fara cheie
  async function searchWiki(term) {
    try {
      const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
        + encodeURIComponent(term.replace(/ /g, '_'));
      const r = await fetch(url);
      const d = await r.json();
      if (d.type === 'disambiguation' || d.type === 'no-extract') return null;
      return {
        title: d.title || '',
        description: (d.description || '').slice(0, 100),
        extract: (d.extract || '').slice(0, 400),
        thumbnail: d.thumbnail ? d.thumbnail.source : null
      };
    } catch { return null; }
  }

  // ═══════════════════════════════════════════════════════
  // CEO — Adauga entitate (cu auto-discovery)
  // ═══════════════════════════════════════════════════════

  async function addEntity(opts) {
    if (!_isCEO()) return null;

    const entity = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: (opts.name || '').trim(),
      type: opts.type || 'brand',
      domain: opts.domain ? opts.domain.replace(/^https?:\/\//, '').split('/')[0] : null,
      blurMode: opts.blurMode || 'blur',
      active: true,
      addedAt: new Date().toISOString(),
      logoUrl: null,
      info: {}
    };

    if (!entity.name) return null;

    // Logo via Clearbit
    if (entity.domain) {
      entity.logoUrl = getLogoUrl(entity.domain);
    }

    // DuckDuckGo search
    const ddg = await searchDDG(entity.name);
    if (ddg) {
      entity.info.ddg = { abstract: ddg.abstract, url: ddg.url };
      if (!entity.logoUrl && ddg.image) entity.logoUrl = ddg.image;
    }

    // Wikipedia
    const wiki = await searchWiki(entity.name);
    if (wiki) {
      entity.info.wiki = { description: wiki.description, extract: wiki.extract };
      if (!entity.logoUrl && wiki.thumbnail) entity.logoUrl = wiki.thumbnail;
    }

    // Google favicon fallback
    if (!entity.logoUrl && entity.domain) {
      entity.logoUrl = getFaviconUrl(entity.domain);
    }

    _rules.push(entity);
    await _persist();
    return entity;
  }

  // ═══════════════════════════════════════════════════════
  // CEO — Remove / Toggle
  // ═══════════════════════════════════════════════════════

  async function removeEntity(id) {
    if (!_isCEO()) return;
    _rules = _rules.filter(r => r.id !== id);
    await _persist();
  }

  async function toggleEntity(id) {
    if (!_isCEO()) return;
    const r = _rules.find(r => r.id === id);
    if (r) { r.active = !r.active; await _persist(); }
  }

  // ═══════════════════════════════════════════════════════
  // PERSIST — Firestore + localStorage
  // ═══════════════════════════════════════════════════════

  async function _persist() {
    _writeCache(_rules);
    if (!_db) return;
    try {
      await _db.collection(FS_COLLECTION).doc(FS_DOC).set({
        rules: _rules,
        updatedAt: typeof firebase !== 'undefined'
          ? firebase.firestore.FieldValue.serverTimestamp()
          : new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.error('[VVScout] persist error:', e);
    }
  }

  // ═══════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════

  function _isCEO() {
    return _auth && _auth.currentUser && _auth.currentUser.uid === CEO_UID;
  }

  // ═══════════════════════════════════════════════════════
  // PANEL UI — CEO only, glassmorphism
  // ═══════════════════════════════════════════════════════

  function openPanel() {
    if (!_isCEO()) return;
    const ex = document.getElementById('vvscout-panel');
    if (ex) { ex.remove(); return; }
    _buildPanel();
  }

  function _buildPanel() {
    const el = document.createElement('div');
    el.id = 'vvscout-panel';
    el.style.cssText = [
      'position:fixed;inset:0;z-index:99998',
      'background:rgba(5,5,7,0.97)',
      'backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px)',
      'display:flex;flex-direction:column',
      'font-family:-apple-system,BlinkMacSystemFont,SF Pro Display,sans-serif',
      'color:#fff;overflow:hidden'
    ].join(';');

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:max(env(safe-area-inset-top,0px),20px) 20px 14px;
                  border-bottom:1px solid rgba(255,255,255,0.07);">
        <div>
          <span style="font-size:17px;font-weight:700;letter-spacing:-0.4px;">VVScout</span>
          <span style="font-size:11px;color:rgba(255,255,255,0.3);margin-left:10px;">Fratele lui VVEil</span>
        </div>
        <button onclick="document.getElementById('vvscout-panel').remove()"
          style="background:rgba(255,255,255,0.08);border:none;color:#fff;
                 width:30px;height:30px;border-radius:50%;font-size:17px;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;">×</button>
      </div>

      <div style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:10px;color:rgba(255,255,255,0.3);letter-spacing:0.8px;margin-bottom:10px;">
          ADAUGĂ ENTITATE DE PROTEJAT
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <input id="sc-name" placeholder="Nume (Nike, Coca-Cola, Ion Popescu...)"
            style="${_inp()}" />
          <input id="sc-domain" placeholder="Domain opțional (nike.com)"
            style="${_inp()}" />
          <select id="sc-type" style="${_inp()}">
            <option value="brand">Brand / Logo</option>
            <option value="person">Persoana</option>
            <option value="location">Locatie</option>
            <option value="competitor">Competitor</option>
            <option value="keyword">Keyword text</option>
          </select>
          <select id="sc-mode" style="${_inp()}">
            <option value="blur">Blur</option>
            <option value="pixelate">Pixelate</option>
            <option value="watermark">Watermark VV</option>
          </select>
          <button id="sc-btn" onclick="VVScout._panelAdd()"
            style="background:rgba(99,102,241,0.85);border:none;color:#fff;
                   border-radius:10px;padding:10px 16px;font-size:13px;
                   font-weight:600;cursor:pointer;white-space:nowrap;min-width:120px;">
            Scout &amp; Add
          </button>
        </div>
        <div id="sc-status"
          style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:8px;min-height:14px;"></div>
      </div>

      <div id="sc-list" style="flex:1;overflow-y:auto;padding:0 20px;">
        ${_renderList()}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:10px 20px;border-top:1px solid rgba(255,255,255,0.06);
                  padding-bottom:max(env(safe-area-inset-bottom,0px),10px);">
        <span style="font-size:10px;color:rgba(255,255,255,0.18);">
          Free: Clearbit · DuckDuckGo · Wikipedia · Firestore
        </span>
        <span style="font-size:10px;color:rgba(255,255,255,0.25);">
          ${_rules.filter(r => r.active !== false).length} active / ${_rules.length} total
        </span>
      </div>
    `;
    document.body.appendChild(el);
  }

  function _inp() {
    return [
      'flex:1;min-width:130px',
      'background:rgba(255,255,255,0.06)',
      'border:1px solid rgba(255,255,255,0.1)',
      'border-radius:10px;padding:10px 12px',
      'color:#fff;font-size:13px;outline:none'
    ].join(';');
  }

  function _renderList() {
    if (!_rules.length) {
      return `<div style="text-align:center;color:rgba(255,255,255,0.2);
                           padding:48px 0;font-size:13px;line-height:1.6;">
        Nicio entitate adăugată.<br>
        Adaugă branduri, persoane sau locații pe care VVEil să le protejeze.
      </div>`;
    }

    return _rules.slice().reverse().map(r => `
      <div style="display:flex;align-items:center;gap:12px;
                  padding:11px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="width:36px;height:36px;border-radius:8px;
                    background:rgba(255,255,255,0.07);flex-shrink:0;
                    overflow:hidden;display:flex;align-items:center;justify-content:center;">
          ${r.logoUrl
            ? `<img src="${r.logoUrl}" style="width:32px;height:32px;object-fit:contain;"
                   onerror="this.parentElement.innerHTML='<span style=font-size:15px;font-weight:700;>${_esc(r.name[0].toUpperCase())}</span>'" />`
            : `<span style="font-size:15px;font-weight:700;">${_esc(r.name[0].toUpperCase())}</span>`
          }
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${_esc(r.name)}
          </div>
          <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px;">
            ${_esc(r.type)}
            ${r.domain ? ' · ' + _esc(r.domain) : ''}
            ${r.info && r.info.wiki && r.info.wiki.description
              ? ' · ' + _esc(r.info.wiki.description.slice(0, 45))
              : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
          <span style="font-size:9px;padding:2px 7px;border-radius:20px;
                       background:${r.active !== false ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.05)'};
                       color:${r.active !== false ? '#34d399' : 'rgba(255,255,255,0.25)'};">
            ${_esc(r.blurMode)}
          </span>
          <button onclick="VVScout._panelToggle('${_esc(r.id)}')"
            style="background:rgba(255,255,255,0.06);border:none;color:rgba(255,255,255,0.55);
                   border-radius:6px;padding:4px 9px;font-size:10px;cursor:pointer;">
            ${r.active !== false ? 'off' : 'on'}
          </button>
          <button onclick="VVScout._panelRemove('${_esc(r.id)}')"
            style="background:rgba(239,68,68,0.1);border:none;color:#ef4444;
                   border-radius:6px;padding:4px 9px;font-size:10px;cursor:pointer;">✕</button>
        </div>
      </div>
    `).join('');
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function _panelAdd() {
    const nameEl = document.getElementById('sc-name');
    const domainEl = document.getElementById('sc-domain');
    const typeEl = document.getElementById('sc-type');
    const modeEl = document.getElementById('sc-mode');
    const btn = document.getElementById('sc-btn');

    const name = nameEl ? nameEl.value.trim() : '';
    const domain = domainEl ? domainEl.value.trim() : '';
    const type = typeEl ? typeEl.value : 'brand';
    const blurMode = modeEl ? modeEl.value : 'blur';

    if (!name) { _status('Introdu un nume.', '#ef4444'); return; }

    btn.textContent = 'Caut...';
    btn.disabled = true;
    _status('Scout activ: Clearbit · DuckDuckGo · Wikipedia...', 'rgba(255,255,255,0.35)');

    const entity = await addEntity({ name, domain: domain || null, type, blurMode });

    if (entity) {
      _status('✓ ' + entity.name + ' adăugat' + (entity.logoUrl ? ' cu logo' : '') + '.', '#34d399');
      if (nameEl) nameEl.value = '';
      if (domainEl) domainEl.value = '';
      const list = document.getElementById('sc-list');
      if (list) list.innerHTML = _renderList();
    } else {
      _status('Eroare la adăugare.', '#ef4444');
    }

    btn.textContent = 'Scout & Add';
    btn.disabled = false;
  }

  function _status(msg, color) {
    const el = document.getElementById('sc-status');
    if (el) { el.textContent = msg; el.style.color = color; }
  }

  async function _panelToggle(id) {
    await toggleEntity(id);
    const list = document.getElementById('sc-list');
    if (list) list.innerHTML = _renderList();
    const footer = document.querySelector('#vvscout-panel > div:last-child span:last-child');
    if (footer) footer.textContent = _rules.filter(r => r.active !== false).length + ' active / ' + _rules.length + ' total';
  }

  async function _panelRemove(id) {
    await removeEntity(id);
    const list = document.getElementById('sc-list');
    if (list) list.innerHTML = _renderList();
  }

  // ═══════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════

  return {
    init, getRules, isReady,
    addEntity, removeEntity, toggleEntity,
    getLogoUrl, getFaviconUrl, searchDDG, searchWiki,
    openPanel,
    _panelAdd, _panelToggle, _panelRemove
  };
})();
