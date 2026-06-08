// ═══════════════════════════════════════════════
// app.js — UI principale + intercettazione JSON
// v3.1.0
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // ── STATO ───────────────────────────────────
  let panelOpen    = false;
  let activeTab    = 'map';
  let sessionCount = 0;
  let mapIslands   = [];
  let mapPlayers   = new Map(); // playerId → player
  let mapCities    = [];        // { islandCoords, playerId, ... }
  let myPlayerId   = null;
  let searchFilter = '';
  let allyFilter   = '';
  let refFilter    = '';        // riferimento alleanza/player
  let mapView      = { x: 20, y: 1, scale: 5 };
  let mapDrag      = null;
  let mapCanvas, mapCtx;
  let timerInterval = null;
  let popupIsland   = null;

  function log(...a) { console.log('[IkApp]', ...a); }

  // ── INTERCETTAZIONE ─────────────────────────
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
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    try { res.clone().text().then(t => onData(url, t)).catch(() => {}); } catch {}
    return res;
  };

  const lastSeen = {};
  async function onData(url, rawText) {
    if (!rawText || rawText.length < 10) return;
    const t = rawText.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return;
    const key = (() => { try { return new URL(url).pathname + new URL(url).search.slice(0,40); } catch { return url; } })();
    if ((Date.now() - (lastSeen[key] || 0)) < 2000) return;
    lastSeen[key] = Date.now();
    let parsed;
    try { parsed = JSON.parse(rawText); } catch { return; }
    sessionCount++;
    updateBadge();
    if (window.IkParsers) {
      const result = await window.IkParsers.parse(url, parsed);
      log(`#${sessionCount} [${result.type}]`);
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

    // Pannello
    const panel = document.createElement('div');
    panel.id = 'ikp-panel';
    panel.innerHTML = `
      <div id="ikp-header">
        <div id="ikp-title">⚓ IKARIAM COMPANION<span>v3.1.0</span></div>
        <button id="ikp-close-btn" onclick="window.IkApp.toggle()">✕</button>
      </div>
      <div id="ikp-statusbar">
        <div class="ikp-stat-pill">📥 <b id="ikp-s-cap">0</b> catturati</div>
        <div class="ikp-stat-pill">🗄 <b id="ikp-s-tot">0</b> record</div>
        <div class="ikp-stat-pill">🏝 <b id="ikp-s-isl">0</b> isole</div>
        <div class="ikp-stat-pill">👤 <b id="ikp-s-pl">0</b> players</div>
        <div class="ikp-stat-pill">⏰ <b id="ikp-s-tim">0</b> timer</div>
      </div>
      <div id="ikp-tabs">
        <div class="ikp-tab active" data-tab="map">🗺 Mappa</div>
        <div class="ikp-tab" data-tab="timers">⏰ Timer</div>
        <div class="ikp-tab" data-tab="resources">💰 Risorse</div>
        <div class="ikp-tab" data-tab="ranking">🏆 Classifica</div>
        <div class="ikp-tab" data-tab="changes">🔔 Cambi</div>
        <div class="ikp-tab" data-tab="db">🗄 Dati</div>
        <div class="ikp-tab" data-tab="settings">⚙</div>
      </div>
      <div id="ikp-body">

        <!-- ══ MAPPA ══ -->
        <div class="ikp-section active" id="ikp-tab-map">
          <div class="ikp-map-filters">
            <input class="ikp-filter-input" id="ikp-f-search"
              placeholder="🔍 Cerca player o isola..."
              oninput="window.IkApp.applyFilters()">
            <input class="ikp-filter-input" id="ikp-f-ally"
              placeholder="⚔ Alleanza (tag)..."
              oninput="window.IkApp.applyFilters()">
            <input class="ikp-filter-input" id="ikp-f-ref"
              placeholder="⭐ Riferimento player/ally..."
              oninput="window.IkApp.applyFilters()">
            <button class="ikp-btn small outline" onclick="window.IkApp.clearFilters()">✕ Reset</button>
          </div>
          <div id="ikp-map-wrap">
            <canvas id="ikp-map-canvas" height="460"></canvas>
          </div>
          <div class="ikp-map-legend">
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:var(--map-island)"></div> Isola vuota</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:var(--map-cities)"></div> Con player</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:var(--map-me)"></div> Mio</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:var(--map-search)"></div> Ricercato</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:var(--map-target)"></div> Riferimento</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:var(--map-ally)"></div> Alleanza</div>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <button class="ikp-btn small" onclick="window.IkApp.mapReset()">⌂ Reset</button>
            <button class="ikp-btn small" onclick="window.IkApp.mapZoom(1.4)">＋ Zoom</button>
            <button class="ikp-btn small" onclick="window.IkApp.mapZoom(0.7)">－ Zoom</button>
            <button class="ikp-btn small outline" onclick="window.IkApp.goToMe()">📍 Vai a me</button>
          </div>
        </div>

        <!-- ══ TIMER ══ -->
        <div class="ikp-section" id="ikp-tab-timers">
          <div class="ikp-card">
            <div class="ikp-card-title">⏰ Timer attivi</div>
            <div id="ikp-timer-list">
              <div class="ikp-empty"><div class="ikp-empty-icon">⏳</div><p>Nessun timer attivo.<br>Apri città e avvia costruzioni.</p></div>
            </div>
          </div>
        </div>

        <!-- ══ RISORSE ══ -->
        <div class="ikp-section" id="ikp-tab-resources">
          <div id="ikp-cities-list">
            <div class="ikp-empty"><div class="ikp-empty-icon">🏛</div><p>Nessuna città rilevata.<br>Apri una città nel gioco.</p></div>
          </div>
        </div>

        <!-- ══ CLASSIFICA ══ -->
        <div class="ikp-section" id="ikp-tab-ranking">
          <div class="ikp-card">
            <div class="ikp-card-title">
              🏆 <span id="ikp-rank-title">Classifica</span>
              <span id="ikp-rank-range" style="font-size:11px;font-weight:400;color:var(--text-muted)"></span>
            </div>
            <div id="ikp-rank-list">
              <div class="ikp-empty"><div class="ikp-empty-icon">🏆</div>
              <p>Apri la classifica nel gioco.<br>I dati appariranno automaticamente.</p></div>
            </div>
          </div>
        </div>

        <!-- ══ CAMBI STATO ══ -->
        <div class="ikp-section" id="ikp-tab-changes">
          <div class="ikp-card">
            <div class="ikp-card-title">
              🔔 Cambi di stato giocatori
              <button class="ikp-btn small danger" onclick="window.IkApp.clearChanges()">🗑 Svuota</button>
            </div>
            <div id="ikp-changes-list">
              <div class="ikp-empty"><div class="ikp-empty-icon">😴</div><p>Nessun cambio rilevato.<br>Aggiorna i dati di Ikalogs.</p></div>
            </div>
          </div>
        </div>

        <!-- ══ DATABASE ══ -->
        <div class="ikp-section" id="ikp-tab-db">
          <div class="ikp-card">
            <div class="ikp-card-title">
              📋 Ultimi JSON
              <button class="ikp-btn small danger" onclick="window.IkApp.clearDB()">🗑 Svuota DB</button>
            </div>
            <div id="ikp-db-list"></div>
          </div>
        </div>

        <!-- ══ SETTINGS ══ -->
        <div class="ikp-section" id="ikp-tab-settings">
          <div class="ikp-card">
            <div class="ikp-card-title">👤 Il mio Player ID</div>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
              Inserisci il tuo Player ID per evidenziare le tue isole sulla mappa.
            </p>
            <div style="display:flex;gap:8px">
              <input class="ikp-input" id="ikp-my-pid" type="number" placeholder="Es: 683999" style="flex:1">
              <button class="ikp-btn" onclick="window.IkApp.saveMyId()">💾 Salva</button>
            </div>
            <div id="ikp-my-pid-info" style="font-size:12px;color:var(--text-muted);margin-top:6px"></div>
          </div>
          <div class="ikp-card">
            <div class="ikp-card-title">🔔 Notifiche</div>
            <button class="ikp-btn success" onclick="window.IkApp.askNotifPerm()">🔔 Abilita notifiche</button>
            <span id="ikp-notif-status" style="font-size:12px;color:var(--text-muted);margin-left:10px"></span>
          </div>
          <div class="ikp-card">
            <div class="ikp-card-title">📥 Import file JSON</div>
            <input type="file" id="ikp-file-in" accept="*/*" multiple style="display:none"
              onchange="window.IkApp.importFiles(this)">
            <button class="ikp-btn" onclick="document.getElementById('ikp-file-in').click()">📂 Scegli file</button>
          </div>
          <div class="ikp-card">
            <div class="ikp-card-title">💾 Storage</div>
            <div id="ikp-storage-info" style="font-size:13px;color:var(--text-dim)">Calcolo...</div>
            <button class="ikp-btn outline" style="margin-top:10px" onclick="window.IkApp.pruneOld()">🧹 Pulizia 30+ giorni</button>
          </div>
        </div>

      </div><!-- /body -->
    `;
    document.body.appendChild(panel);

    // Popup isola
    const popup = document.createElement('div');
    popup.id = 'ikp-island-popup';
    popup.innerHTML = `<button id="ikp-popup-close" onclick="window.IkApp.closePopup()">✕</button><div id="ikp-popup-content"></div>`;
    document.body.appendChild(popup);

    // Tooltip mappa
    const tt = document.createElement('div');
    tt.id = 'ikp-map-tooltip';
    document.body.appendChild(tt);

    // Toast
    const toastEl = document.createElement('div');
    toastEl.id = 'ikp-toast';
    document.body.appendChild(toastEl);

    // Tab click
    panel.querySelectorAll('.ikp-tab').forEach(t => {
      t.onclick = () => switchTab(t.dataset.tab);
    });

    // Init mappa
    mapCanvas = document.getElementById('ikp-map-canvas');
    mapCtx    = mapCanvas.getContext('2d');
    resizeCanvas();
    mapCanvas.addEventListener('touchstart',  onTouchStart, { passive: true });
    mapCanvas.addEventListener('touchmove',   onTouchMove,  { passive: true });
    mapCanvas.addEventListener('touchend',    onTouchEnd);
    mapCanvas.addEventListener('mousedown',   onMouseDown);
    mapCanvas.addEventListener('mousemove',   onMouseMove);
    mapCanvas.addEventListener('mouseup',     () => mapDrag = null);
    mapCanvas.addEventListener('mouseleave',  () => { mapDrag = null; hideTooltip(); });
    mapCanvas.addEventListener('click',       onMapClick);
    mapCanvas.addEventListener('wheel',       e => { mapZoom(e.deltaY < 0 ? 1.15 : 0.87); }, { passive: true });

    // Carica myPlayerId salvato
    myPlayerId = Number(localStorage.getItem('ik_my_pid')) || null;
    if (myPlayerId) {
      const el = document.getElementById('ikp-my-pid');
      if (el) el.value = myPlayerId;
    }

    log('UI pronta');
  }

  // ── TOGGLE ───────────────────────────────────
  function toggle() {
    panelOpen = !panelOpen;
    document.getElementById('ikp-panel').classList.toggle('open', panelOpen);
    document.getElementById('ikp-overlay').classList.toggle('open', panelOpen);
    if (panelOpen) {
      refreshActiveTab();
      updateStatusBar();
      startTimerTick();
      updateStorageInfo();
      loadMapData();
    } else {
      stopTimerTick();
      closePopup();
    }
  }

  // ── TABS ─────────────────────────────────────
  function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('.ikp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.ikp-section').forEach(s => s.classList.toggle('active', s.id === `ikp-tab-${name}`));
    closePopup();
    refreshActiveTab();
  }

  function refreshActiveTab() {
    switch (activeTab) {
      case 'map':       resizeCanvas(); drawMap(); break;
      case 'timers':    renderTimers();    break;
      case 'resources': renderResources(); break;
      case 'ranking':   renderRanking();   break;
      case 'changes':   renderChanges();   break;
      case 'db':        renderDB();        break;
      case 'settings':  loadSettingsUI();  break;
    }
  }

  // ── STATUS BAR ───────────────────────────────
  async function updateStatusBar() {
    if (!window.IkDB) return;
    try {
      const [tot, isl, pl] = await Promise.all([
        window.IkDB.count('entries'),
        window.IkDB.count('islands'),
        window.IkDB.count('players'),
      ]);
      const tim = window.IkNotifier?.getActive().length || 0;
      setText('ikp-s-cap', sessionCount);
      setText('ikp-s-tot', tot);
      setText('ikp-s-isl', isl);
      setText('ikp-s-pl',  pl);
      setText('ikp-s-tim', tim);
    } catch {}
  }

  // ── MAPPA ─────────────────────────────────────
  async function loadMapData() {
    if (!window.IkDB) return;
    [mapIslands, mapCities] = await Promise.all([
      window.IkDB.getAll('islands'),
      window.IkDB.getAll('cities'),
    ]);
    const players = await window.IkDB.getAll('players');
    mapPlayers = new Map(players.map(p => [p.id, p]));
    drawMap();
  }

  function resizeCanvas() {
    if (!mapCanvas) return;
    const wrap = document.getElementById('ikp-map-wrap');
    mapCanvas.width  = wrap ? wrap.clientWidth : window.innerWidth;
    mapCanvas.height = 460;
  }

  function mapReset() {
    mapView = { x: 20, y: 1, scale: 5 };
    drawMap();
  }

  function mapZoom(z) {
    mapView.scale = Math.max(2, Math.min(60, mapView.scale * z));
    drawMap();
  }

  function applyFilters() {
    searchFilter = (document.getElementById('ikp-f-search')?.value || '').toLowerCase().trim();
    allyFilter   = (document.getElementById('ikp-f-ally')?.value   || '').toLowerCase().trim();
    refFilter    = (document.getElementById('ikp-f-ref')?.value     || '').toLowerCase().trim();
    drawMap();
  }

  function clearFilters() {
    ['ikp-f-search','ikp-f-ally','ikp-f-ref'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    searchFilter = allyFilter = refFilter = '';
    drawMap();
  }

  // Cerca isola del proprio player per centrare la mappa
  function goToMe() {
    if (!myPlayerId) { toast('⚠️ Imposta il tuo Player ID in ⚙ Impostazioni'); return; }
    const myCity = mapCities.find(c => c.playerId === myPlayerId);
    if (!myCity) { toast('⚠️ Città non trovata nel DB'); return; }
    mapView.x = myCity.islandX;
    mapView.y = myCity.islandY;
    drawMap();
  }

  // ── DRAW MAP ─────────────────────────────────
  function drawMap() {
    if (!mapCtx || !mapCanvas) return;
    const W = mapCanvas.width, H = mapCanvas.height;
    const s = mapView.scale;
    const ctx = mapCtx;

    // Sfondo mare
    ctx.fillStyle = '#1a2535';
    ctx.fillRect(0, 0, W, H);

    // Griglia
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    const gs = 10 * s;
    const ox = (-mapView.x * s) % gs;
    const oy = (-mapView.y * s) % gs;
    for (let x = ox; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = oy; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Assi X=50, Y=50 (centro mappa)
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    const cx50 = worldToCanvas(50, 0), cy50 = worldToCanvas(0, 50);
    ctx.beginPath(); ctx.moveTo(cx50.cx, 0); ctx.lineTo(cx50.cx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, cy50.cy); ctx.lineTo(W, cy50.cy); ctx.stroke();

    // Costruisci set di isole con player per lookup rapido
    const islandPlayerMap = new Map(); // coords → [{playerId, playerName, allyName, state}]
    for (const city of mapCities) {
      const key = `${city.islandX}:${city.islandY}`;
      if (!islandPlayerMap.has(key)) islandPlayerMap.set(key, []);
      islandPlayerMap.get(key).push(city);
    }

    // Disegna isole
    const r = Math.max(2, s * 0.28);
    for (const isl of mapIslands) {
      const { cx, cy } = worldToCanvas(isl.x, isl.y);
      if (cx < -r || cx > W + r || cy < -r || cy > H + r) continue;

      const cities = islandPlayerMap.get(isl.coords) || [];
      const hasCities = cities.length > 0;

      // Determina colore
      let color = hasCities ? '#4a9eff' : '#2a5a8a'; // default: isola con/senza player
      let radius = r;
      let glow   = false;

      if (hasCities) {
        // Controllo: isola mia
        const isMe = myPlayerId && cities.some(c => c.playerId === myPlayerId);
        if (isMe) { color = '#00e676'; glow = true; radius = r * 1.5; }

        // Filtro ricerca (player o isola)
        const matchSearch = searchFilter && cities.some(c =>
          c.playerName?.toLowerCase().includes(searchFilter) ||
          isl.name?.toLowerCase().includes(searchFilter)
        );
        if (matchSearch) { color = '#ff1744'; glow = true; radius = r * 1.8; }

        // Filtro alleanza
        const matchAlly = allyFilter && cities.some(c =>
          c.allyName?.toLowerCase().includes(allyFilter)
        );
        if (matchAlly && !matchSearch) { color = '#ab47bc'; glow = true; radius = r * 1.6; }

        // Filtro riferimento
        const matchRef = refFilter && cities.some(c =>
          c.playerName?.toLowerCase().includes(refFilter) ||
          c.allyName?.toLowerCase().includes(refFilter)
        );
        if (matchRef && !matchSearch && !matchAlly && !isMe) {
          color = '#ffeb3b'; glow = true; radius = r * 1.6;
        }
      }

      // Disegna
      if (glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Coordinate angolo
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px monospace';
    const tl = canvasToWorld(0, 0);
    ctx.fillText(`[${Math.round(tl.wx)}:${Math.round(tl.wy)}]`, 6, 14);

    if (mapIslands.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nessun dato — naviga la mappa di gioco', W / 2, H / 2);
      ctx.textAlign = 'left';
    }
  }

  function worldToCanvas(wx, wy) {
    return {
      cx: (wx - mapView.x) * mapView.scale + mapCanvas.width  / 2,
      cy: (wy - mapView.y) * mapView.scale + mapCanvas.height / 2,
    };
  }
  function canvasToWorld(cx, cy) {
    return {
      wx: (cx - mapCanvas.width  / 2) / mapView.scale + mapView.x,
      wy: (cy - mapCanvas.height / 2) / mapView.scale + mapView.y,
    };
  }

  // Trova isola vicina a coordinate canvas
  function findNearestIsland(cx, cy, maxDist = 16) {
    const { wx, wy } = canvasToWorld(cx, cy);
    let best = null, bestD = Infinity;
    for (const isl of mapIslands) {
      const d = Math.hypot(isl.x - wx, isl.y - wy);
      if (d < bestD && d < maxDist / mapView.scale) { best = isl; bestD = d; }
    }
    return best;
  }

  // ── DRAG / TOUCH ──────────────────────────────
  function onMouseDown(e) { mapDrag = { x: e.clientX, y: e.clientY, vx: mapView.x, vy: mapView.y }; }
  function onMouseMove(e) {
    if (mapDrag) {
      mapView.x = mapDrag.vx - (e.clientX - mapDrag.x) / mapView.scale;
      mapView.y = mapDrag.vy - (e.clientY - mapDrag.y) / mapView.scale;
      drawMap();
    } else {
      const rect = mapCanvas.getBoundingClientRect();
      const isl  = findNearestIsland(e.clientX - rect.left, e.clientY - rect.top);
      if (isl) showTooltip(e.clientX, e.clientY, isl);
      else      hideTooltip();
    }
  }

  let touchStart = null, touchDist = 0;
  function onTouchStart(e) {
    if (e.touches.length === 1) {
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, vx: mapView.x, vy: mapView.y };
    } else if (e.touches.length === 2) {
      touchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  }
  function onTouchMove(e) {
    if (e.touches.length === 1 && touchStart) {
      mapView.x = touchStart.vx - (e.touches[0].clientX - touchStart.x) / mapView.scale;
      mapView.y = touchStart.vy - (e.touches[0].clientY - touchStart.y) / mapView.scale;
      drawMap();
    } else if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (touchDist) mapZoom(d / touchDist);
      touchDist = d;
    }
  }
  function onTouchEnd(e) {
    touchStart = null;
    // Tap singolo → apri popup
    if (e.changedTouches.length === 1) {
      const rect = mapCanvas.getBoundingClientRect();
      const cx   = e.changedTouches[0].clientX - rect.left;
      const cy   = e.changedTouches[0].clientY - rect.top;
      const isl  = findNearestIsland(cx, cy, 24);
      if (isl) showIslandPopup(isl);
    }
  }
  function onMapClick(e) {
    const rect = mapCanvas.getBoundingClientRect();
    const isl  = findNearestIsland(e.clientX - rect.left, e.clientY - rect.top, 20);
    if (isl) showIslandPopup(isl);
  }

  // ── TOOLTIP (desktop hover) ──────────────────
  function showTooltip(sx, sy, isl) {
    const tt = document.getElementById('ikp-map-tooltip');
    if (!tt) return;
    const cities = mapCities.filter(c => c.islandX === isl.x && c.islandY === isl.y);
    tt.innerHTML = `
      <div class="tt-title">${isl.name} [${isl.x}:${isl.y}]</div>
      ${isl.tgName ? `<div class="tt-row"><span class="tt-label">Risorsa</span><span class="tt-value">${isl.tgName}</span></div>` : ''}
      ${isl.wdName ? `<div class="tt-row"><span class="tt-label">Meraviglia</span><span class="tt-value">${isl.wdName}</span></div>` : ''}
      <div class="tt-row"><span class="tt-label">Città</span><span class="tt-value">${cities.length}</span></div>
      ${cities.slice(0,3).map(c => `<div class="tt-row"><span class="tt-label">${c.playerName||'?'}</span><span class="tt-value">${c.allyName||'—'}</span></div>`).join('')}
      ${cities.length > 3 ? `<div style="font-size:11px;color:var(--text-muted);text-align:center">+${cities.length-3} altri</div>` : ''}
    `;
    tt.style.display = 'block';
    tt.style.left    = (sx + 14) + 'px';
    tt.style.top     = Math.max(60, sy - 20) + 'px';
  }
  function hideTooltip() {
    const tt = document.getElementById('ikp-map-tooltip');
    if (tt) tt.style.display = 'none';
  }

  // ── POPUP ISOLA (mobile tap) ─────────────────
  function showIslandPopup(isl) {
    popupIsland = isl;
    const cities = mapCities.filter(c => c.islandX === isl.x && c.islandY === isl.y);
    const el     = document.getElementById('ikp-popup-content');
    const popup  = document.getElementById('ikp-island-popup');
    if (!el || !popup) return;

    const stateColors = { active:'#4caf50', inactive:'#ff9800', vacation:'#2196f3', banned:'#f44336' };

    el.innerHTML = `
      <div class="pop-title">🏝 ${isl.name}</div>
      <div class="pop-sub">[${isl.x}:${isl.y}] ${isl.tgName ? '· ' + isl.tgName : ''} ${isl.wdName ? '· ' + isl.wdName : ''}</div>
      ${cities.length === 0
        ? '<p style="color:var(--text-muted);font-size:13px">Nessuna città su questa isola nel DB.</p>'
        : cities.map(c => {
            const pl = mapPlayers.get(c.playerId);
            const sc = stateColors[pl?.state] || '#aaa';
            return `<div class="pop-city">
              <div class="pop-state" style="background:${sc}"></div>
              <div>
                <div class="pop-city-name">${c.name || '?'} <span style="font-size:11px;color:var(--text-muted)">Lv${c.level||'?'}</span></div>
                <div class="pop-player">👤 ${c.playerName || '?'} ${pl ? '· ' + (pl.stateLabel || pl.state) : ''}</div>
              </div>
              ${c.allyName ? `<div class="pop-ally">${c.allyName}</div>` : ''}
            </div>`;
          }).join('')
      }
    `;
    popup.classList.add('open');
  }

  function closePopup() {
    const popup = document.getElementById('ikp-island-popup');
    if (popup) popup.classList.remove('open');
    popupIsland = null;
    hideTooltip();
  }

  // ── TIMER ─────────────────────────────────────
  function renderTimers() {
    const list = document.getElementById('ikp-timer-list');
    if (!list || !window.IkNotifier) return;
    const active = window.IkNotifier.getActive();
    if (!active.length) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">⏳</div><p>Nessun timer.</p></div>`;
      return;
    }
    const icons = { building:'🏗', research:'🔬', fleet_enemy:'⚔️' };
    list.innerHTML = active.map(t => `
      <div class="ikp-timer">
        <div class="ikp-timer-icon">${icons[t.type]||'⏰'}</div>
        <div class="ikp-timer-info">
          <div class="ikp-timer-label">${t.label}</div>
          <div class="ikp-timer-sub">${t.type}</div>
        </div>
        <div class="ikp-timer-time ${t.msLeft < 300000 ? 'urgent' : ''}" data-id="${t.id}">
          ${window.IkNotifier.formatTime(t.msLeft)}
        </div>
      </div>`).join('');
  }

  function startTimerTick() {
    stopTimerTick();
    timerInterval = setInterval(() => {
      if (!panelOpen) return;
      document.querySelectorAll('.ikp-timer-time[data-id]').forEach(el => {
        const t = window.IkNotifier?.getActive().find(a => a.id === el.dataset.id);
        if (t) { el.textContent = window.IkNotifier.formatTime(t.msLeft); el.classList.toggle('urgent', t.msLeft < 300000); }
      });
      updateStatusBar();
    }, 1000);
  }
  function stopTimerTick() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

  // ── RISORSE ───────────────────────────────────
  async function renderResources() {
    const el = document.getElementById('ikp-cities-list');
    if (!el || !window.IkDB) return;
    const [cities, resources] = await Promise.all([window.IkDB.getAll('cities'), window.IkDB.getAll('resources')]);
    const ownCities = cities.filter(c => c.ownerId === myPlayerId || !c.ownerId);
    if (!ownCities.length) {
      el.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">🏛</div><p>Nessuna città.</p></div>`;
      return;
    }
    el.innerHTML = ownCities.map(city => {
      const res = resources.find(r => r.cityId === city.id) || {};
      return `<div class="ikp-card">
        <div class="ikp-card-title">🏛 ${city.name} <span style="font-size:11px;font-weight:400">[${city.islandX}:${city.islandY}]</span></div>
        <div class="ikp-res-grid">
          ${ri('🪵','Legno',    res.wood,   res.maxRes)}
          ${ri('🍷','Vino',     res.wine,   null)}
          ${ri('🪨','Marmo',    res.marble, null)}
          ${ri('💎','Cristallo',res.crystal,null)}
          ${ri('🔥','Zolfo',   res.sulfur, null)}
          ${ri('🪙','Oro',      res.gold,   null)}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:8px">
          👥 ${res.citizens||0}/${res.population||0} · Aggiornato: ${res.updated?.slice(11,19)||'—'}
        </div>
      </div>`;
    }).join('');
  }
  function ri(icon, label, val, max) {
    const v = val != null ? Number(val).toLocaleString('it') : '—';
    const m = max != null ? `<div class="ikp-res-max">/ ${Number(max).toLocaleString('it')}</div>` : '';
    return `<div class="ikp-res-item">
      <div class="ikp-res-icon">${icon}</div>
      <div class="ikp-res-label">${label}</div>
      <div class="ikp-res-value">${v}</div>${m}
    </div>`;
  }

  // ── CLASSIFICA ────────────────────────────────
  // Ultimo snapshot ranking ricevuto
  let lastRanking = null;

  function renderRanking() {
    const list  = document.getElementById('ikp-rank-list');
    const title = document.getElementById('ikp-rank-title');
    const range = document.getElementById('ikp-rank-range');
    if (!list) return;

    if (!lastRanking || !lastRanking.players.length) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">🏆</div>
        <p>Apri la classifica nel gioco.<br>I dati appariranno automaticamente.</p></div>`;
      return;
    }

    if (title) title.textContent = lastRanking.rankingType;
    if (range) range.textContent = `Pos. ${lastRanking.range}`;

    const stateIcon = { active:'🟢', inactive:'🟡', vacation:'🔵', banned:'🔴', deleted:'⚫' };
    const stateCls  = { active:'state-active', inactive:'state-inactive', vacation:'state-vacation', banned:'state-banned' };

    // Evidenzia cambi di stato recenti
    const changedIds = new Set((lastRanking.changes || []).map(c => c.playerId));

    list.innerHTML = `
      <div style="display:grid;grid-template-columns:40px 1fr auto auto;gap:6px 10px;
                  font-size:12px;font-weight:700;color:var(--text-muted);
                  padding:6px 8px;border-bottom:2px solid var(--border);margin-bottom:4px">
        <span>Pos.</span><span>Giocatore</span><span>Alleanza</span><span>Punti</span>
      </div>
      ${lastRanking.players.map(p => {
        const changed = changedIds.has(p.pid);
        const change  = (lastRanking.changes || []).find(c => c.playerId === p.pid);
        const isMe    = myPlayerId && p.pid === myPlayerId;
        return `<div style="display:grid;grid-template-columns:40px 1fr auto auto;
                            gap:4px 10px;padding:7px 8px;align-items:center;
                            border-bottom:1px solid var(--border);border-radius:4px;
                            ${isMe ? 'background:rgba(139,94,60,0.08);' : ''}
                            ${changed ? 'background:rgba(255,152,0,0.1);' : ''}">
          <span style="font-weight:700;color:var(--accent);font-size:13px">${p.position}</span>
          <div>
            <div style="font-weight:600;color:var(--text);font-size:13px">
              ${stateIcon[p.state]||'⚪'} ${p.name}
              ${isMe ? '<span style="font-size:10px;background:#8b5e3c;color:#fff;padding:1px 5px;border-radius:8px;margin-left:4px">TU</span>' : ''}
            </div>
            ${p.honorTitle ? `<div style="font-size:10px;color:var(--text-muted);font-style:italic">${p.honorTitle}</div>` : ''}
            ${changed && change ? `<div style="font-size:10px;color:#e65100;margin-top:2px">
              ⚡ ${change.prevState} → ${change.newState}</div>` : ''}
          </div>
          <span style="font-size:12px;color:var(--text-dim);white-space:nowrap">${p.allyName||'—'}</span>
          <span style="font-size:12px;font-weight:600;color:var(--text);text-align:right;white-space:nowrap">
            ${p.score > 1000000 ? (p.score/1000000).toFixed(2)+'M' : p.score.toLocaleString('it')}
          </span>
        </div>`;
      }).join('')}
    `;
  }

  function onRankingUpdated(data) {
    lastRanking = data;
    if (panelOpen && activeTab === 'ranking') renderRanking();
    // Notifica badge se ci sono cambi di stato
    if (data.changes && data.changes.length > 0) {
      toast(`🏆 ${data.changes.length} cambi stato in classifica!`, 4000);
    }
  }

  // ── CAMBI STATO ───────────────────────────────
  async function renderChanges() {
    const list = document.getElementById('ikp-changes-list');
    if (!list || !window.IkDB) return;
    const changes = await window.IkDB.getAll('state_changes');
    if (!changes.length) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">😴</div><p>Nessun cambio rilevato.</p></div>`;
      return;
    }
    const stateCfg = {
      active:   { label:'Attivo',   cls:'state-active'   },
      inactive: { label:'Inattivo', cls:'state-inactive' },
      vacation: { label:'Vacanza',  cls:'state-vacation' },
      banned:   { label:'Bannato',  cls:'state-banned'   },
    };
    list.innerHTML = changes.slice().reverse().map(c => {
      const prev = stateCfg[c.prevState] || { label: c.prevState, cls: '' };
      const next = stateCfg[c.newState]  || { label: c.newState,  cls: '' };
      return `<div class="ikp-change-row">
        <div class="ikp-change-player">👤 ${c.playerName} ${c.allyName !== '—' ? `<span style="font-size:11px;color:var(--text-muted)">[${c.allyName}]</span>` : ''}</div>
        <div class="ikp-change-states">
          <span class="ikp-state-badge ${prev.cls}">${prev.label}</span>
          →
          <span class="ikp-state-badge ${next.cls}">${next.label}</span>
        </div>
        <div class="ikp-change-time">
          📅 Prec: ${fmt(c.prevUpdate)} → Nuovo: ${fmt(c.newUpdate)}
        </div>
      </div>`;
    }).join('');
  }
  function fmt(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('it-IT', { dateStyle:'short', timeStyle:'short' }); } catch { return iso; }
  }

  async function clearChanges() {
    if (!confirm('Eliminare tutti i cambi di stato?')) return;
    await window.IkDB.clear('state_changes');
    renderChanges();
    toast('🗑 Cambi stato eliminati');
  }

  // ── DATABASE VIEWER ──────────────────────────
  const DB_STORES = [
    { key: 'entries',       label: '📋 JSON catturati',   icon: '📋' },
    { key: 'islands',       label: '🏝 Isole',             icon: '🏝' },
    { key: 'cities',        label: '🏛 Città',             icon: '🏛' },
    { key: 'resources',     label: '💰 Risorse',           icon: '💰' },
    { key: 'players',       label: '👤 Players',           icon: '👤' },
    { key: 'constructions', label: '🏗 Costruzioni',       icon: '🏗' },
    { key: 'buildings',     label: '🏠 Edifici',           icon: '🏠' },
    { key: 'research',      label: '🔬 Ricerche',          icon: '🔬' },
    { key: 'fleets',        label: '⛵ Flotte',            icon: '⛵' },
    { key: 'alliances',     label: '⚔ Alleanze',          icon: '⚔' },
    { key: 'state_changes', label: '🔔 Cambi stato',      icon: '🔔' },
  ];

  // Formatta valore per visualizzazione compatta
  function fmtVal(v, depth = 0) {
    if (v === null || v === undefined) return '<span style="color:#aaa">—</span>';
    if (typeof v === 'boolean') return v ? '✅' : '❌';
    if (typeof v === 'number') return v.toLocaleString('it');
    if (typeof v === 'string') {
      if (v.length > 40) return `<span title="${v.replace(/"/g,"'")}">${v.slice(0,38)}…</span>`;
      return v;
    }
    if (Array.isArray(v)) return `[${v.length}]`;
    if (typeof v === 'object') return `{${Object.keys(v).slice(0,3).join(', ')}${Object.keys(v).length > 3 ? '…' : ''}}`;
    return String(v);
  }

  function renderRecord(rec, storeName) {
    if (!rec) return '';
    const skip = new Set(['data', 'raw', 'position', 'cities', 'rankings']);
    const entries = Object.entries(rec).filter(([k]) => !skip.has(k));
    return `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;
                        padding:8px 0;border-bottom:1px solid var(--border)">
      ${entries.map(([k,v]) => `
        <div style="display:flex;gap:4px;align-items:baseline">
          <span style="color:var(--text-muted);white-space:nowrap">${k}:</span>
          <span style="color:var(--text);font-weight:500">${fmtVal(v)}</span>
        </div>`).join('')}
    </div>`;
  }

  async function renderDB() {
    const el = document.getElementById('ikp-db-list');
    if (!el || !window.IkDB) return;

    // Conta tutti gli store
    const counts = await window.IkDB.countAll();

    let html = '';
    for (const store of DB_STORES) {
      const n = counts[store.key] || 0;
      // Prendi ultimi 3 record
      let last = [];
      try { last = await window.IkDB.getLast(store.key, 3); } catch {}

      html += `
        <div class="ikp-card" style="margin-bottom:10px">
          <div class="ikp-card-title" style="cursor:pointer"
               onclick="this.nextElementSibling.style.display=
                        this.nextElementSibling.style.display==='none'?'block':'none'">
            ${store.icon} ${store.label}
            <span style="margin-left:auto;background:var(--accent);color:#fff;
                         padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">
              ${n}
            </span>
          </div>
          <div ${n === 0 ? 'style="display:none"' : ''}>
            ${last.length === 0
              ? '<p style="font-size:12px;color:var(--text-muted);padding:8px 0">Nessun dato</p>'
              : last.map(r => renderRecord(r, store.key)).join('')
            }
            ${n > 3 ? `<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:4px">
              … altri ${n - 3} record</div>` : ''}
          </div>
        </div>`;
    }

    el.innerHTML = html || '<div class="ikp-empty"><p>DB vuoto</p></div>';
    updateStatusBar();
  }

  // ── SETTINGS ─────────────────────────────────
  function loadSettingsUI() {
    const el = document.getElementById('ikp-my-pid');
    if (el && myPlayerId) el.value = myPlayerId;
    const st = document.getElementById('ikp-notif-status');
    if (st) st.textContent = Notification.permission === 'granted' ? '✅ Abilitate' : Notification.permission === 'denied' ? '❌ Negate' : '⏳ Non impostate';
    updateStorageInfo();
  }

  function saveMyId() {
    const val = Number(document.getElementById('ikp-my-pid')?.value);
    if (!val) { toast('⚠️ Inserisci un ID valido'); return; }
    myPlayerId = val;
    localStorage.setItem('ik_my_pid', val);
    const info = document.getElementById('ikp-my-pid-info');
    const player = mapPlayers.get(val);
    if (info) info.textContent = player ? `✅ ${player.name}` : '✅ Salvato (player non ancora nel DB)';
    toast('✅ Player ID salvato');
    drawMap();
  }

  async function askNotifPerm() {
    const ok = await window.IkNotifier?.requestPermission();
    const el = document.getElementById('ikp-notif-status');
    if (el) el.textContent = ok ? '✅ Abilitate' : '❌ Negate';
    if (ok) toast('🔔 Notifiche abilitate!');
  }

  async function updateStorageInfo() {
    const el = document.getElementById('ikp-storage-info');
    if (!el || !window.IkDB) return;
    const info = await window.IkDB.storageInfo();
    el.innerHTML = info ? `Usato: <b>${info.usedMB} MB</b> / ${info.quotaMB} MB (${info.pct}%)` : 'Non disponibile';
  }

  async function pruneOld() {
    const n = await window.IkDB?.pruneEntries(30);
    toast(`🧹 Rimossi ${n} record`);
    renderDB(); updateStatusBar();
  }

  // ── IMPORT FILE ───────────────────────────────
  async function importFiles(input) {
    const files = Array.from(input.files);
    let total = 0;
    for (const file of files) {
      try {
        const json = JSON.parse(await file.text());
        const entries = Array.isArray(json) ? json : [json];
        for (const e of entries) {
          const data = e.data || e;
          const url  = e.url || e._meta?.url || 'import';
          if (window.IkParsers) await window.IkParsers.parse(url, data);
          total++;
        }
      } catch(err) { toast(`❌ ${file.name}`); }
    }
    input.value = '';
    await loadMapData();
    refreshActiveTab(); updateStatusBar();
    toast(`✅ Importati ${total} record`);
  }

  // ── CLEAR DB ─────────────────────────────────
  async function clearDB() {
    if (!confirm('Eliminare tutti i dati?')) return;
    const stores = ['entries','islands','cities','resources','constructions','research','fleets','players','alliances','buildings','state_changes'];
    await Promise.all(stores.map(s => window.IkDB.clear(s).catch(()=>{})));
    sessionCount = 0; mapIslands = []; mapCities = []; mapPlayers = new Map();
    updateBadge(); refreshActiveTab(); updateStatusBar();
    toast('🗑 DB svuotato');
  }

  // ── CALLBACK DAI PARSER ───────────────────────
  function onIslandsUpdated(n)  { if (panelOpen && activeTab === 'map') loadMapData(); updateStatusBar(); }
  function onCitiesUpdated(id)  { if (panelOpen && activeTab === 'resources') renderResources(); }
  function onResourcesUpdated() { if (panelOpen && activeTab === 'resources') renderResources(); }
  function onResearchUpdated()  { if (panelOpen && activeTab === 'timers') renderTimers(); }
  function onFleetsUpdated()    { if (panelOpen && activeTab === 'timers') renderTimers(); }
  function onTimerAdded()       { if (panelOpen) updateStatusBar(); }
  function onTimerExpired()     { if (panelOpen) { renderTimers(); updateStatusBar(); } }
  function onStateChanges(list) {
    if (panelOpen && activeTab === 'changes') renderChanges();
    if (list.length > 0) {
      const names = list.map(c => `${c.playerName}: ${c.prevState}→${c.newState}`).join(', ');
      window.IkNotifier?.notify('🔔 Cambi di stato', names, { urgent: false });
      toast(`🔔 ${list.length} cambi di stato rilevati`);
    }
  }

  // ── UTILITY ──────────────────────────────────
  function updateBadge() {
    const b = document.getElementById('ikp-fab-badge');
    if (!b) return;
    b.textContent = sessionCount;
    b.style.display = sessionCount > 0 ? 'block' : 'none';
    setText('ikp-s-cap', sessionCount);
  }

  let toastT;
  function toast(msg, dur = 2800) {
    const el = document.getElementById('ikp-toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), dur);
  }

  function setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }

  // ── INIT ─────────────────────────────────────
  async function init() {
    log('Init v3.1.0...');
    await window.IkDB.open();
    await window.IkParsers.loadSubParsers();
    await window.IkNotifier.restoreTimers();
    buildUI();
    log('✅ Pronto');
  }

  window.IkApp = {
    init, toggle, toast, drawMap, mapReset, mapZoom,
    applyFilters, clearFilters, goToMe,
    closePopup, saveMyId, askNotifPerm, pruneOld,
    clearDB, clearChanges, importFiles,
    onRankingUpdated, onIslandsUpdated, onCitiesUpdated, onResourcesUpdated,
    onResearchUpdated, onFleetsUpdated, onTimerAdded,
    onTimerExpired, onStateChanges,
  };
  log('Modulo caricato');
})();
