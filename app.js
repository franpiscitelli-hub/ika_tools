// ═══════════════════════════════════════════════
// app.js — UI fullscreen + intercettazione JSON
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  function log(...a) { console.log('[IkApp]', ...a); }

  // ── STATO ───────────────────────────────────
  let panelOpen  = false;
  let activeTab  = 'timers';
  let sessionCount = 0;
  let mapIslands = [];
  let mapView    = { x: 0, y: 0, scale: 2 };
  let mapDrag    = null;
  let mapCanvas, mapCtx;
  let timerInterval = null;

  // ── INTERCETTAZIONE XHR ──────────────────────
  const rawOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) {
    this._url = url; return rawOpen.apply(this, arguments);
  };
  const rawSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try { onData(this._url, this.responseText); } catch {}
    });
    return rawSend.apply(this, arguments);
  };

  // ── INTERCETTAZIONE FETCH ────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    try { res.clone().text().then(t => onData(url, t)).catch(() => {}); } catch {}
    return res;
  };

  // ── ON DATA ─────────────────────────────────
  const lastSeen = {};
  async function onData(url, rawText) {
    if (!rawText || rawText.length < 10) return;
    const t = rawText.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return;
    const key = (() => { try { return new URL(url).pathname; } catch { return url; } })();
    if ((Date.now() - (lastSeen[key] || 0)) < 2000) return;
    lastSeen[key] = Date.now();

    let parsed;
    try { parsed = JSON.parse(rawText); } catch { return; }

    sessionCount++;
    updateBadge();

    if (window.IkParsers) {
      const result = await window.IkParsers.parse(url, parsed);
      log(`#${sessionCount} [${result.type}] parsed:${result.parsed}`);
    }
    if (panelOpen) refreshActiveTab();
  }

  // ── BUILD UI ─────────────────────────────────
  function buildUI() {
    if (!document.body) { setTimeout(buildUI, 300); return; }

    // FAB
    const fab = document.createElement('div');
    fab.id = 'ikp-fab';
    fab.innerHTML = `⚓<span id="ikp-fab-badge"></span>`;
    fab.onclick = toggle;
    document.body.appendChild(fab);

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'ikp-overlay';
    overlay.onclick = toggle;
    document.body.appendChild(overlay);

    // Pannello fullscreen
    const panel = document.createElement('div');
    panel.id = 'ikp-panel';
    panel.innerHTML = `
      <div id="ikp-header">
        <div id="ikp-title">⚓ IKARIAM<span>COMPANION v3.0</span></div>
        <button id="ikp-close-btn" onclick="window.IkApp.toggle()">✕</button>
      </div>

      <div id="ikp-statusbar">
        <div class="ikp-stat-pill">📥 <b id="ikp-s-captured">0</b> catturati</div>
        <div class="ikp-stat-pill">🗄 <b id="ikp-s-total">0</b> record</div>
        <div class="ikp-stat-pill">🏝 <b id="ikp-s-islands">0</b> isole</div>
        <div class="ikp-stat-pill">⏰ <b id="ikp-s-timers">0</b> timer</div>
      </div>

      <div id="ikp-tabs">
        <div class="ikp-tab active" data-tab="timers">⏰ Timer</div>
        <div class="ikp-tab" data-tab="resources">💰 Risorse</div>
        <div class="ikp-tab" data-tab="islands">🏝 Isole</div>
        <div class="ikp-tab" data-tab="map">🗺 Mappa</div>
        <div class="ikp-tab" data-tab="db">🗄 Dati</div>
        <div class="ikp-tab" data-tab="settings">⚙</div>
      </div>

      <div id="ikp-body">

        <!-- ── TIMER ── -->
        <div class="ikp-section active" id="ikp-tab-timers">
          <div class="ikp-card">
            <div class="ikp-card-title">⏰ Timer attivi</div>
            <div id="ikp-timer-list">
              <div class="ikp-empty">
                <div class="ikp-empty-icon">⏳</div>
                <p>Nessun timer attivo.<br>I timer appaiono automaticamente<br>quando giochi.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- ── RISORSE ── -->
        <div class="ikp-section" id="ikp-tab-resources">
          <div id="ikp-cities-list">
            <div class="ikp-empty">
              <div class="ikp-empty-icon">🏛</div>
              <p>Nessuna città rilevata.<br>Apri una città nel gioco.</p>
            </div>
          </div>
        </div>

        <!-- ── ISOLE ── -->
        <div class="ikp-section" id="ikp-tab-islands">
          <div class="ikp-card">
            <div class="ikp-card-title">🏝 Isole (<span id="ikp-isl-count">0</span>)</div>
            <input class="ikp-input" id="ikp-isl-search"
              placeholder="Cerca per nome o coordinate..."
              style="margin-bottom:10px"
              oninput="window.IkApp.refreshIslands()">
            <div id="ikp-isl-list" style="max-height:55vh;overflow-y:auto">
              <div class="ikp-empty">
                <div class="ikp-empty-icon">🗺</div>
                <p>Nessuna isola nel DB.<br>Visita <b>ikalogs.ru</b> con Tampermonkey attivo.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- ── MAPPA ── -->
        <div class="ikp-section" id="ikp-tab-map">
          <div class="ikp-card" style="padding:10px">
            <div class="ikp-map-controls">
              <input class="ikp-input" id="ikp-map-search"
                placeholder="Cerca isola..."
                style="flex:1;min-width:0"
                oninput="window.IkApp.drawMap()">
              <button class="ikp-btn" onclick="window.IkApp.mapReset()">⌂</button>
              <button class="ikp-btn" onclick="window.IkApp.mapZoom(1.3)">＋</button>
              <button class="ikp-btn" onclick="window.IkApp.mapZoom(0.77)">－</button>
            </div>
            <canvas id="ikp-map-canvas" height="420"></canvas>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;font-size:11px;color:var(--text-muted)">
              <span>🔵 Neutra</span><span>🟡 Trovata</span>
            </div>
          </div>
        </div>

        <!-- ── DB ── -->
        <div class="ikp-section" id="ikp-tab-db">
          <div class="ikp-card">
            <div class="ikp-card-title">
              📋 Ultimi JSON ricevuti
              <button class="ikp-btn danger" onclick="window.IkApp.clearDB()">🗑 Svuota</button>
            </div>
            <div id="ikp-db-list"></div>
          </div>
        </div>

        <!-- ── SETTINGS ── -->
        <div class="ikp-section" id="ikp-tab-settings">
          <div class="ikp-card">
            <div class="ikp-card-title">🔔 Notifiche</div>
            <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px">
              Abilita le notifiche per ricevere avvisi fuori dal gioco.
            </p>
            <button class="ikp-btn success" onclick="window.IkApp.askNotifPerm()">
              🔔 Abilita notifiche
            </button>
            <span id="ikp-notif-status" style="font-size:12px;color:var(--text-muted);margin-left:10px"></span>
          </div>

          <div class="ikp-card">
            <div class="ikp-card-title">📥 Import file JSON</div>
            <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px">
              Importa file JSON catturati manualmente.
            </p>
            <input type="file" id="ikp-file-in" accept="*/*" multiple style="display:none"
              onchange="window.IkApp.importFiles(this)">
            <button class="ikp-btn" onclick="document.getElementById('ikp-file-in').click()">
              📂 Scegli file
            </button>
          </div>

          <div class="ikp-card">
            <div class="ikp-card-title">💾 Storage</div>
            <div id="ikp-storage-info" style="font-size:13px;color:var(--text-dim)">
              Calcolo in corso...
            </div>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="ikp-btn" onclick="window.IkApp.pruneOld()">🧹 Pulizia vecchi dati</button>
            </div>
          </div>

          <div class="ikp-card">
            <div class="ikp-card-title">ℹ️ Info</div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.8">
              <div>Script: <b style="color:var(--gold)">v3.0.0</b></div>
              <div>DB: <b style="color:var(--gold)">IndexedDB locale</b></div>
              <div>Bridge: <b style="color:var(--gold)">XHR + fetch hook</b></div>
            </div>
          </div>
        </div>

      </div><!-- /ikp-body -->
    `;
    document.body.appendChild(panel);

    // Tab click
    panel.querySelectorAll('.ikp-tab').forEach(t => {
      t.onclick = () => switchTab(t.dataset.tab);
    });

    // Mappa
    mapCanvas = document.getElementById('ikp-map-canvas');
    mapCtx    = mapCanvas.getContext('2d');
    resizeCanvas();
    mapCanvas.addEventListener('touchstart',  e => { mapDrag={x:e.touches[0].clientX,y:e.touches[0].clientY,vx:mapView.x,vy:mapView.y}; }, {passive:true});
    mapCanvas.addEventListener('touchmove',   e => { if(!mapDrag)return; mapView.x=mapDrag.vx-(e.touches[0].clientX-mapDrag.x); mapView.y=mapDrag.vy-(e.touches[0].clientY-mapDrag.y); drawMap(); }, {passive:true});
    mapCanvas.addEventListener('touchend',    () => mapDrag=null);
    mapCanvas.addEventListener('mousedown',   e => { mapDrag={x:e.clientX,y:e.clientY,vx:mapView.x,vy:mapView.y}; });
    mapCanvas.addEventListener('mousemove',   e => { if(!mapDrag)return; mapView.x=mapDrag.vx-(e.clientX-mapDrag.x); mapView.y=mapDrag.vy-(e.clientY-mapDrag.y); drawMap(); });
    mapCanvas.addEventListener('mouseup',     () => mapDrag=null);

    // Toast
    const toastEl = document.createElement('div');
    toastEl.id = 'ikp-toast';
    document.body.appendChild(toastEl);

    log('UI costruita');
  }

  // ── TOGGLE PANNELLO ──────────────────────────
  function toggle() {
    panelOpen = !panelOpen;
    document.getElementById('ikp-panel').classList.toggle('open', panelOpen);
    document.getElementById('ikp-overlay').classList.toggle('open', panelOpen);
    if (panelOpen) {
      refreshActiveTab();
      updateStatusBar();
      startTimerTick();
      updateStorageInfo();
    } else {
      stopTimerTick();
    }
  }

  // ── TABS ─────────────────────────────────────
  function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('.ikp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.ikp-section').forEach(s => s.classList.toggle('active', s.id === `ikp-tab-${name}`));
    refreshActiveTab();
  }

  function refreshActiveTab() {
    switch (activeTab) {
      case 'timers':    renderTimers();    break;
      case 'resources': renderResources(); break;
      case 'islands':   refreshIslands();  break;
      case 'map':       resizeCanvas(); mapIslands=[]; drawMap(); break;
      case 'db':        renderDB();        break;
    }
  }

  // ── STATUS BAR ───────────────────────────────
  async function updateStatusBar() {
    if (!window.IkDB) return;
    try {
      const [total, islands] = await Promise.all([
        window.IkDB.count('entries'),
        window.IkDB.count('islands'),
      ]);
      const timers = window.IkNotifier?.getActive().length || 0;
      setText('ikp-s-captured', sessionCount);
      setText('ikp-s-total',    total);
      setText('ikp-s-islands',  islands);
      setText('ikp-s-timers',   timers);
    } catch {}
  }

  // ── RENDER TIMER ─────────────────────────────
  function renderTimers() {
    const list = document.getElementById('ikp-timer-list');
    if (!list || !window.IkNotifier) return;
    const active = window.IkNotifier.getActive();
    if (active.length === 0) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">⏳</div><p>Nessun timer attivo.<br>I timer appaiono automaticamente<br>quando giochi.</p></div>`;
      return;
    }
    list.innerHTML = active.map(t => {
      const icon = { building:'🏗', research:'🔬', fleet_enemy:'⚔️', fleet:'⛵' }[t.type] || '⏰';
      const urgent = t.msLeft < 5 * 60 * 1000;
      return `<div class="ikp-timer">
        <div class="ikp-timer-icon">${icon}</div>
        <div class="ikp-timer-info">
          <div class="ikp-timer-label">${t.label}</div>
          <div class="ikp-timer-sub">${t.type}</div>
        </div>
        <div class="ikp-timer-time ${urgent?'urgent':''}" data-id="${t.id}">
          ${window.IkNotifier.formatTime(t.msLeft)}
        </div>
      </div>`;
    }).join('');
  }

  function startTimerTick() {
    stopTimerTick();
    timerInterval = setInterval(() => {
      if (!panelOpen) return;
      if (activeTab === 'timers') renderTimers();
      // Aggiorna solo i countdown senza ri-renderizzare tutto
      document.querySelectorAll('.ikp-timer-time[data-id]').forEach(el => {
        const active = window.IkNotifier?.getActive() || [];
        const t = active.find(a => a.id === el.dataset.id);
        if (t) {
          el.textContent = window.IkNotifier.formatTime(t.msLeft);
          el.classList.toggle('urgent', t.msLeft < 5*60*1000);
        }
      });
    }, 1000);
  }

  function stopTimerTick() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  // ── RENDER RESOURCES ─────────────────────────
  async function renderResources() {
    if (!window.IkDB) return;
    const el = document.getElementById('ikp-cities-list');
    try {
      const [cities, resources] = await Promise.all([
        window.IkDB.getAll('cities'),
        window.IkDB.getAll('resources'),
      ]);
      if (cities.length === 0) {
        el.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">🏛</div><p>Nessuna città rilevata.<br>Apri una città nel gioco.</p></div>`;
        return;
      }
      el.innerHTML = cities.map(city => {
        const res = resources.find(r => r.cityId === city.id) || {};
        return `<div class="ikp-card">
          <div class="ikp-card-title">🏛 ${city.name} <span style="font-size:10px;color:var(--text-muted)">[${city.islandX}:${city.islandY}]</span></div>
          <div class="ikp-res-grid">
            ${resItem('🪵', 'Legno',    res.wood,    res.maxWood)}
            ${resItem('🪨', 'Marmo',    res.marble,  res.maxMarbel)}
            ${resItem('🍷', 'Vino',     res.wine,    null)}
            ${resItem('💎', 'Cristallo',res.crystal, null)}
            ${resItem('🔥', 'Zolfo',   res.sulfur,  null)}
            ${resItem('🪙', 'Oro',      res.gold,    null)}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:8px">
            👥 Pop: ${res.population||'?'} · Aggiornato: ${res.updated ? res.updated.slice(11,19) : '—'}
          </div>
        </div>`;
      }).join('');
    } catch (e) { el.innerHTML = `<div class="ikp-empty"><p>Errore: ${e.message}</p></div>`; }
  }

  function resItem(icon, label, val, max) {
    const v = val !== undefined ? Number(val).toLocaleString() : '—';
    const m = max ? ` / ${Number(max).toLocaleString()}` : '';
    return `<div class="ikp-res-item">
      <div class="ikp-res-label">${icon} ${label}</div>
      <div class="ikp-res-value">${v}${m}</div>
    </div>`;
  }

  // ── RENDER ISLANDS ───────────────────────────
  async function refreshIslands() {
    if (!window.IkDB) return;
    const q = (document.getElementById('ikp-isl-search')?.value || '').toLowerCase();
    let all = await window.IkDB.getAll('islands');
    if (q) all = all.filter(i => i.name?.toLowerCase().includes(q) || `${i.x}:${i.y}`.includes(q));
    setText('ikp-isl-count', all.length);
    const list = document.getElementById('ikp-isl-list');
    if (!list) return;
    if (all.length === 0) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">🗺</div><p>Nessuna isola trovata.</p></div>`;
      return;
    }
    list.innerHTML = all.slice(0, 300).map(i => `
      <div class="ikp-island-row" onclick="window.IkApp.goToIsland(${i.x},${i.y})">
        <div class="ikp-coords">[${i.x}:${i.y}]</div>
        <div class="ikp-isl-name">${i.name}</div>
        <div class="ikp-isl-res">${i.resource||''}</div>
      </div>`).join('');
  }

  // ── MAPPA ────────────────────────────────────
  function resizeCanvas() {
    if (!mapCanvas) return;
    mapCanvas.width = mapCanvas.offsetWidth || window.innerWidth - 28;
  }

  function mapReset() { mapView={x:0,y:0,scale:2}; drawMap(); }
  function mapZoom(z) { mapView.scale = Math.max(1, mapView.scale*z); drawMap(); }

  function goToIsland(x, y) {
    switchTab('map');
    mapView.x = x*mapView.scale - mapCanvas.width/2;
    mapView.y = y*mapView.scale - mapCanvas.height/2;
    drawMap();
  }

  async function drawMap() {
    if (!mapCtx || !mapCanvas) return;
    const W=mapCanvas.width, H=mapCanvas.height, s=mapView.scale;
    const ctx=mapCtx;

    ctx.fillStyle='#080500'; ctx.fillRect(0,0,W,H);

    // Griglia
    ctx.strokeStyle='rgba(107,74,30,0.12)'; ctx.lineWidth=0.5;
    const gs=10*s;
    for(let x=(-mapView.x)%gs;x<W;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=(-mapView.y)%gs;y<H;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

    if (!mapIslands.length && window.IkDB) {
      try { mapIslands = await window.IkDB.getAll('islands'); } catch {}
    }

    const q=(document.getElementById('ikp-map-search')?.value||'').toLowerCase();
    for (const isl of mapIslands) {
      const cx=isl.x*s-mapView.x, cy=isl.y*s-mapView.y;
      if(cx<-10||cx>W+10||cy<-10||cy>H+10) continue;
      const r=Math.max(2.5,s*0.3);
      const hl=q&&(isl.name?.toLowerCase().includes(q)||`${isl.x}:${isl.y}`.includes(q));
      ctx.beginPath(); ctx.arc(cx,cy,hl?r*2:r,0,Math.PI*2);
      ctx.fillStyle=hl?'#e8b84b':'#2a6a9e'; ctx.fill();
      if(s>5||hl){
        ctx.fillStyle=hl?'#f5d07a':'rgba(240,221,176,0.6)';
        ctx.font=`${Math.max(9,s*0.65)}px serif`;
        ctx.fillText(isl.name,cx+r+3,cy+4);
      }
    }

    if(!mapIslands.length){
      ctx.fillStyle='rgba(107,74,30,0.7)'; ctx.font='13px serif';
      ctx.textAlign='center';
      ctx.fillText('Nessun dato — visita ikalogs.ru',W/2,H/2);
      ctx.textAlign='left';
    }
  }

  // ── RENDER DB ────────────────────────────────
  async function renderDB() {
    if (!window.IkDB) return;
    const el = document.getElementById('ikp-db-list');
    try {
      const all = await window.IkDB.getAll('entries');
      if (!all.length) { el.innerHTML='<div class="ikp-empty"><p>Nessun dato ancora.</p></div>'; return; }
      el.innerHTML = all.slice(-40).reverse().map(e => {
        let short = e.url||'';
        try { const u=new URL(e.url); short=u.searchParams.get('action')||u.searchParams.get('view')||u.pathname.slice(-24); } catch {}
        return `<div class="ikp-db-row">
          <span class="ikp-tag ${e.type||'unknown'}">${e.type||'?'}</span>
          <span style="flex:1;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${short.slice(0,30)}</span>
          <span style="color:var(--text-muted);font-size:10px;flex-shrink:0">${(e.date||'').slice(11,19)}</span>
        </div>`;
      }).join('');
    } catch {}
    await updateStatusBar();
  }

  // ── CLEAR DB ─────────────────────────────────
  async function clearDB() {
    if (!confirm('Eliminare tutti i dati?')) return;
    await Promise.all(['entries','islands','cities','resources','constructions','research','fleets'].map(s=>window.IkDB.clear(s)));
    sessionCount=0; mapIslands=[];
    updateBadge(); refreshActiveTab(); updateStatusBar();
    toast('🗑 Database svuotato');
  }

  // ── IMPORT FILE ──────────────────────────────
  async function importFiles(input) {
    const files = Array.from(input.files);
    if (!files.length) return;
    let total = 0;
    for (const file of files) {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const entries = Array.isArray(json) ? json : [json];
        for (const entry of entries) {
          const data = entry.data || entry;
          const url  = entry.url || entry._meta?.url || 'import';
          if (window.IkParsers) await window.IkParsers.parse(url, data);
          total++;
        }
      } catch(e) { toast(`❌ ${file.name}: ${e.message}`); }
    }
    input.value='';
    mapIslands=[];
    refreshActiveTab(); updateStatusBar();
    toast(`✅ Importati ${total} record`);
  }

  // ── NOTIFICHE ────────────────────────────────
  async function askNotifPerm() {
    const ok = await window.IkNotifier?.requestPermission();
    const el = document.getElementById('ikp-notif-status');
    if (el) el.textContent = ok ? '✅ Abilitate' : '❌ Negate';
    if (ok) toast('🔔 Notifiche abilitate!');
  }

  // ── STORAGE INFO ─────────────────────────────
  async function updateStorageInfo() {
    const el = document.getElementById('ikp-storage-info');
    if (!el || !window.IkDB) return;
    const info = await window.IkDB.storageInfo();
    if (info) {
      el.innerHTML = `Usato: <b style="color:var(--gold)">${info.usedMB} MB</b> / ${info.quotaMB} MB (${info.pct}%)`;
    } else {
      el.textContent = 'Non disponibile su questo browser.';
    }
  }

  async function pruneOld() {
    const n = await window.IkDB?.pruneEntries(30);
    toast(`🧹 Eliminati ${n} record più vecchi di 30 giorni`);
    renderDB(); updateStatusBar();
  }

  // ── BADGE ────────────────────────────────────
  function updateBadge() {
    const b = document.getElementById('ikp-fab-badge');
    if (!b) return;
    b.textContent = sessionCount;
    b.style.display = sessionCount > 0 ? 'block' : 'none';
    setText('ikp-s-captured', sessionCount);
  }

  // ── TOAST ────────────────────────────────────
  let toastT;
  function toast(msg, duration=2800) {
    const el = document.getElementById('ikp-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ── UTILITY ──────────────────────────────────
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── CALLBACK DAI PARSER ──────────────────────
  function onIslandsUpdated(n)   { mapIslands=[]; if(panelOpen) updateStatusBar(); }
  function onCitiesUpdated(n)    { if(panelOpen && activeTab==='resources') renderResources(); }
  function onResourcesUpdated(id){ if(panelOpen && activeTab==='resources') renderResources(); }
  function onResearchUpdated(d)  { if(panelOpen && activeTab==='timers') renderTimers(); }
  function onFleetsUpdated(n)    { if(panelOpen && activeTab==='timers') renderTimers(); }
  function onTimerAdded(t)       { if(panelOpen && activeTab==='timers') renderTimers(); updateStatusBar(); }
  function onTimerExpired(id,type){ if(panelOpen) { renderTimers(); updateStatusBar(); } }

  // ── INIT ─────────────────────────────────────
  async function init() {
    log('Init...');
    await window.IkDB.open();
    log('DB aperto');
    await window.IkNotifier.restoreTimers();
    log('Timer ripristinati');
    buildUI();
    log('UI pronta — v3.0.0');
  }

  // Esponi globalmente
  window.IkApp = {
    init, toggle,
    toast, drawMap, mapReset, mapZoom,
    refreshIslands, goToIsland,
    clearDB, importFiles, pruneOld,
    askNotifPerm,
    onIslandsUpdated, onCitiesUpdated, onResourcesUpdated,
    onResearchUpdated, onFleetsUpdated, onTimerAdded, onTimerExpired,
  };

  log('Modulo caricato — in attesa di init()');
})();
