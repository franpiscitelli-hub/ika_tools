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
  let mapPlayers   = new Map(); // id → player
  let mapCities    = [];
  let myPlayerId   = null;
  let myPlayerName = null;      // nome player corrente (da settings)
  let searchFilter = '';        // verde: player/isola
  let allyFilter   = '';        // verde: alleanza esatta
  let stateFilter  = '';        // verde: stato (active/inactive/vacation/banned)
  let noAllyFilter = false;     // verde: senza alleanza
  let refFilter    = '';        // azzurro: riferimento player/ally
  let mapView      = { x: 20, y: 1, scale: 5 };
  let mapDrag      = null;
  let mapCanvas, mapCtx;
  let timerInterval = null;
  let popupIsland   = null;

  // ── SISTEMA LOG IN-APP ───────────────────────
  const logBuffer = [];
  const LOG_MAX   = 200;

  function log(...a) {
    const msg  = a.join(' ');
    const time = new Date().toLocaleTimeString('it-IT');
    const entry = { time, msg };
    logBuffer.push(entry);
    if (logBuffer.length > LOG_MAX) logBuffer.shift();
    console.log('[IkApp]', msg);
    // Aggiorna UI log se tab aperta
    if (panelOpen && activeTab === 'log') renderLogTab();
    // Aggiorna badge log se errore
    if (msg.includes('❌') || msg.includes('errore') || msg.includes('error')) {
      const badge = document.getElementById('ikp-log-badge');
      if (badge) { badge.style.display = 'inline'; badge.textContent = '!'; }
    }
  }

  function renderLogTab() {
    const el = document.getElementById('ikp-log-list');
    if (!el) return;
    if (!logBuffer.length) {
      el.innerHTML = '<div style="color:var(--text-muted);padding:8px">Nessun log ancora.</div>';
      return;
    }
    el.innerHTML = logBuffer.slice().reverse().map(e => {
      const isErr  = e.msg.includes('❌') || e.msg.toLowerCase().includes('error');
      const isOk   = e.msg.includes('✅');
      const isWarn = e.msg.includes('⚠️');
      const color  = isErr ? 'var(--red)' : isOk ? 'var(--green)' : isWarn ? 'var(--orange)' : 'var(--text-dim)';
      return `<div style="padding:3px 0;border-bottom:1px solid var(--border);color:${color}">
        <span style="color:var(--text-muted)">${e.time}</span> ${e.msg}
      </div>`;
    }).join('');
  }

  function clearLog() {
    logBuffer.length = 0;
    renderLogTab();
  }

  function downloadLog() {
    const text = logBuffer.map(e => `[${e.time}] ${e.msg}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ik_log_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

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

  const isIkalogsSite = /ikalogs/i.test(window.location.hostname);
  const capturedJson  = []; // { url, date, data } — solo su ikalogs

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

    // Su ikalogs: salva il JSON catturato per il download manuale
    if (isIkalogsSite) {
      capturedJson.push({
        url,
        date: new Date().toISOString(),
        data: parsed,
      });
      // Limita la cronologia in memoria
      if (capturedJson.length > 100) capturedJson.shift();
      log(`#${sessionCount} catturato: ${key}`);
      if (panelOpen) refreshActiveTab();
      return;
    }

    // Parse e salva nel DB
    if (window.IkParsers) {
      const meta   = { date: new Date().toISOString() };
      const result = await window.IkParsers.parse(url, parsed, meta);
      log(`#${sessionCount} [${result.type}]`);
      // Auto-cleanup: elimina raw entries più vecchie di 30 minuti
      // I dati strutturati sono già nei rispettivi store
      if (sessionCount % 10 === 0 && window.IkDB) {
        window.IkDB.pruneRawByAge(30).catch(() => {});
      }
    }
    if (panelOpen) refreshActiveTab();
  }

  // ── CATTURATI (solo ikalogs) ─────────────────
  function renderCaptured() {
    const list = document.getElementById('ikp-captured-list');
    if (!list) return;
    if (!capturedJson.length) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">📭</div><p>Nessun JSON catturato.<br>Naviga su ikalogs per catturare dati.</p></div>`;
      return;
    }
    list.innerHTML = capturedJson.map((c, i) => {
      const short = c.url.length > 50 ? c.url.slice(0, 50) + '…' : c.url;
      return `
        <div class="ikp-card" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px;margin-bottom:6px">
          <div style="min-width:0;flex:1">
            <div style="font-size:12px;font-weight:600" title="${c.url.replace(/"/g,'&quot;')}">${short}</div>
            <div style="font-size:11px;color:var(--text-muted)">${c.date.replace('T',' ').slice(0,19)}</div>
          </div>
          <button class="ikp-btn small outline" onclick="window.IkApp.downloadCaptured(${i})">⬇</button>
        </div>`;
    }).reverse().join('');
  }

  function downloadCaptured(idx) {
    try {
      const c = capturedJson[idx];
      if (!c) return;
      const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ik_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) { toast('❌ Errore download: ' + e.message); }
  }

  function downloadAllCaptured() {
    if (!capturedJson.length) { toast('⚠️ Nessun JSON catturato'); return; }
    try {
      const blob = new Blob([JSON.stringify(capturedJson, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ik_captured_all_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('✅ Scaricati ' + capturedJson.length + ' JSON');
    } catch(e) { toast('❌ Errore download: ' + e.message); }
  }

  function clearCaptured() {
    capturedJson.length = 0;
    sessionCount = 0;
    updateBadge();
    renderCaptured();
    toast('🗑 Lista catturati svuotata');
  }


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
        <div id="ikp-title">⚓ IKARIAM COMPANION<span>v3.1.0 - No Bridge</span></div>
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
        <div class="ikp-tab" data-tab="captured" id="ikp-tab-btn-captured" style="display:none">📥 Catturati</div>
        <div class="ikp-tab active" data-tab="map" id="ikp-tab-btn-map">🗺 Mappa</div>
        <div class="ikp-tab" data-tab="timers" id="ikp-tab-btn-timers">⏰ Timer</div>
        <div class="ikp-tab" data-tab="mycities" id="ikp-tab-btn-mycities">🏠 Città</div>
        <div class="ikp-tab" data-tab="changes" id="ikp-tab-btn-changes">🔔 Cambi</div>
        <div class="ikp-tab" data-tab="db" id="ikp-tab-btn-db">🗄 Dati</div>
        <div class="ikp-tab" data-tab="log" id="ikp-tab-btn-log">📟 Log</div>
        <div class="ikp-tab" data-tab="settings" id="ikp-tab-btn-settings">⚙</div>
      </div>
      <div id="ikp-body">

        <!-- ══ CATTURATI (ikalogs) ══ -->
        <div class="ikp-section" id="ikp-tab-captured">
          <div class="ikp-card">
            <div class="ikp-card-title">📥 JSON catturati su ikalogs</div>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
              Naviga sulle pagine di ikalogs (mappa, classifiche, profili...) per catturare
              i dati JSON. Poi scaricali e importali nella Tab di Ikariam.
            </p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
              <button class="ikp-btn" onclick="window.IkApp.downloadAllCaptured()">⬇ Scarica tutto</button>
              <button class="ikp-btn outline" onclick="window.IkApp.renderCaptured()">↻ Aggiorna</button>
              <button class="ikp-btn danger small" onclick="window.IkApp.clearCaptured()">🗑 Svuota</button>
            </div>
            <div id="ikp-captured-list"></div>
          </div>
        </div>

        <!-- ══ MAPPA ══ -->
        <div class="ikp-section active" id="ikp-tab-map">
          <div class="ikp-map-filters">
            <input class="ikp-filter-input" id="ikp-f-search"
              placeholder="🟢 Player o isola..."
              oninput="window.IkApp.applyFilters()">
            <input class="ikp-filter-input" id="ikp-f-ally"
              placeholder="🟢 Alleanza (tag esatto)..."
              oninput="window.IkApp.applyFilters()">
            <select id="ikp-f-state" class="ikp-filter-input"
              onchange="window.IkApp.applyFilters()">
              <option value="">🟢 Stato player...</option>
              <option value="active">Attivo</option>
              <option value="inactive">Inattivo</option>
              <option value="vacation">Vacanza</option>
              <option value="banned">Bannato</option>
            </select>
            <input class="ikp-filter-input" id="ikp-f-ref"
              placeholder="🔵 Riferimento player/ally..."
              oninput="window.IkApp.applyFilters()">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;
                          color:var(--text-dim);padding:4px 8px;cursor:pointer">
              <input type="checkbox" id="ikp-f-noally"
                onchange="window.IkApp.applyFilters()"> Senza alleanza
            </label>
            <button class="ikp-btn small outline" onclick="window.IkApp.clearFilters()">✕ Reset</button>
          </div>
          <div id="ikp-map-wrap">
            <canvas id="ikp-map-canvas" height="575"></canvas>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;margin-bottom:10px;flex-wrap:wrap">
            <button class="ikp-btn small" onclick="window.IkApp.mapReset()">⌂ Reset</button>
            <button class="ikp-btn small" onclick="window.IkApp.mapZoom(1.4)">＋ Zoom</button>
            <button class="ikp-btn small" onclick="window.IkApp.mapZoom(0.7)">－ Zoom</button>
            <button class="ikp-btn small outline" onclick="window.IkApp.goToMe()">📍 Vai a me</button>
          </div>
          <div id="ikp-island-popup">
            <div id="ikp-popup-content">
              <div class="ikp-empty"><div class="ikp-empty-icon">🏝</div><p>Seleziona un'isola sulla mappa per vedere le sue polis.</p></div>
            </div>
          </div>
          <div class="ikp-map-legend">
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#c9b182"></div> Isola vuota</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#a8895c"></div> Con player</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#00e676"></div> Mio</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#ff9100"></div> 🟠 Filtro</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#7c4dff"></div> 🟣 Riferimento</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#ff1744"></div> 🔴 Entrambi</div>
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
          <div class="ikp-card">
            <div class="ikp-card-title">🍷 Esaurimento vino</div>
            <div id="ikp-wine-list">
              <div class="ikp-empty"><div class="ikp-empty-icon">🍷</div><p>Naviga le tue città per popolare questa stima.</p></div>
            </div>
          </div>
        </div>

        <!-- ══ MIE CITTÀ ══ -->
        <div class="ikp-section" id="ikp-tab-mycities">
          <!-- Popup edifici -->
          <div id="ikp-buildings-popup" style="display:none">
            <div id="ikp-buildings-popup-inner">
              <div id="ikp-buildings-popup-header">
                <span id="ikp-buildings-popup-title">Edifici</span>
                <button onclick="window.IkApp.closeBuildingsPopup()">✕</button>
              </div>
              <div id="ikp-buildings-popup-content"></div>
            </div>
          </div>
          <div class="ikp-card">
            <div class="ikp-card-title">
              🏠 Le mie città
              <button class="ikp-btn small outline" onclick="window.IkApp.renderMyCities()">↻</button>
            </div>
            <div id="ikp-mycities-list">
              <div class="ikp-empty"><div class="ikp-empty-icon">🏠</div><p>Naviga le tue città nel gioco per popolare questa vista.</p></div>
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

        <!-- ══ LOG ══ -->
        <div class="ikp-section" id="ikp-tab-log">
          <div class="ikp-card">
            <div class="ikp-card-title">
              📟 Log sistema
              <div style="display:flex;gap:6px">
                <button class="ikp-btn small outline" onclick="window.IkApp.clearLog()">🗑 Pulisci</button>
                <button class="ikp-btn small outline" onclick="window.IkApp.downloadLog()">⬇ Scarica</button>
              </div>
            </div>
            <div id="ikp-log-list" style="max-height:60vh;overflow-y:auto;
                 font-family:monospace;font-size:11px;line-height:1.6"></div>
          </div>
        </div>

        <!-- ══ DATABASE ══ -->
        <div class="ikp-section" id="ikp-tab-db">

          <!-- Stats compatte -->
          <div id="ikp-db-stats" style="display:grid;grid-template-columns:1fr 1fr 1fr;
               gap:8px;margin-bottom:12px"></div>

          <!-- Ricerca -->
          <div class="ikp-card" style="margin-bottom:10px">
            <div class="ikp-card-title">🔍 Ricerca nel DB</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
              <select id="ikp-db-store" class="ikp-input" style="flex:1;min-width:140px"
                      onchange="window.IkApp.dbSearch()">
                <option value="islands">🏝 Isole</option>
                <option value="my_cities">🏠 Mie città</option>
                <option value="account_summary">💰 Riepilogo account</option>
                <option value="enemy_buildings">🏢 Edifici nemici</option>
                <option value="players">👤 Players</option>
                <option value="state_changes">🔔 Cambi stato</option>
                <option value="entries">📋 JSON raw</option>
              </select>
              <input class="ikp-input" id="ikp-db-q" placeholder="Cerca..."
                     oninput="window.IkApp.dbSearch()" style="flex:2;min-width:140px">
            </div>
            <div id="ikp-db-results"></div>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="ikp-btn danger small" onclick="window.IkApp.clearDB()">🗑 Svuota DB</button>
            <button class="ikp-btn outline small" onclick="window.IkApp.renderDB()">↻ Aggiorna</button>
            <button class="ikp-btn outline small" onclick="window.IkApp.clearRaw()" title="Elimina JSON raw">🧹 Raw</button>
            <button class="ikp-btn outline small" onclick="window.IkApp.downloadSearchResults()" title="Scarica risultati visibili">⬇ Scarica</button>
          </div>
        </div>

        <!-- ══ SETTINGS ══ -->
        <div class="ikp-section" id="ikp-tab-settings">
          <div class="ikp-card">
            <div class="ikp-card-title">👤 Il mio profilo</div>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
              Imposta il tuo nome player per evidenziare le tue isole sulla mappa (verde brillante).
            </p>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <input class="ikp-input" id="ikp-my-name" type="text"
                placeholder="Il tuo nome esatto in gioco" style="flex:1">
              <button class="ikp-btn" onclick="window.IkApp.saveMyId()">💾 Salva</button>
            </div>
            <div style="display:flex;gap:8px">
              <input class="ikp-input" id="ikp-my-pid" type="number"
                placeholder="Avatar ID (opzionale)" style="flex:1">
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
            <div id="ikp-import-log" style="display:none;margin-top:10px;padding:8px;
              background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);
              max-height:200px;overflow-y:auto;font-family:monospace;font-size:11px"></div>
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
    myPlayerId   = Number(localStorage.getItem('ik_my_pid')) || null;
    myPlayerName = localStorage.getItem('ik_my_name') || null;
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
      case 'captured':  renderCaptured();    break;
      case 'map':       resizeCanvas(); drawMap(); break;
      case 'timers':    renderTimers();    break;
      case 'mycities':  renderMyCities();  break;
      case 'changes':   renderChanges();   break;
      case 'log':       renderLogTab();    break;
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
    mapIslands = await window.IkDB.getAll('islands');
    const players = await window.IkDB.getAll('players');
    // mapPlayers indicizzato per nome (usato da drawMap per nameToState)
    mapPlayers = new Map();
    for (const p of players) {
      mapPlayers.set(p.id, p);
      // Indice anche per nome minuscolo (per lookup veloce in drawMap)
      if (p.name) mapPlayers.set((p.name).toLowerCase(), p);
    }
    console.log(`[loadMapData] ${mapIslands.length} isole, ${players.length} players`);
    drawMap();
  }

  function resizeCanvas() {
    if (!mapCanvas) return;
    const wrap = document.getElementById('ikp-map-wrap');
    mapCanvas.width  = wrap ? wrap.clientWidth : window.innerWidth;
    mapCanvas.height = 575;
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
    stateFilter  = (document.getElementById('ikp-f-state')?.value  || '').toLowerCase().trim();
    noAllyFilter = document.getElementById('ikp-f-noally')?.checked || false;
    refFilter    = (document.getElementById('ikp-f-ref')?.value    || '').toLowerCase().trim();
    drawMap();
  }

  function clearFilters() {
    ['ikp-f-search','ikp-f-ally','ikp-f-ref'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const stateEl = document.getElementById('ikp-f-state');
    if (stateEl) stateEl.value = '';
    const noallyEl = document.getElementById('ikp-f-noally');
    if (noallyEl) noallyEl.checked = false;
    searchFilter = allyFilter = refFilter = stateFilter = '';
    noAllyFilter = false;
    drawMap();
  }

  // Cerca isola del proprio player per centrare la mappa
  function goToMe() {
    if (!myPlayerName) { toast('⚠️ Imposta il tuo nome player in ⚙ Impostazioni'); return; }
    const needle = myPlayerName.toLowerCase();
    const isl = mapIslands.find(i =>
      (i.cities || []).some(c => (c.player_name||'').toLowerCase() === needle)
    );
    if (!isl) { toast('⚠️ Nessuna tua isola trovata — visita prima ikalogs.ru'); return; }
    goToIsland(isl.x, isl.y);
  }

  // ── DRAW MAP ─────────────────────────────────
  // Logica colori basata su map_filters.js (versione collaudata)
  const COLOR_FILTER  = '#ff9100';  // arancione acceso — filtro
  const COLOR_REF     = '#7c4dff';  // viola acceso — riferimento
  const COLOR_BOTH    = '#ff1744';  // rosso acceso — entrambi
  const COLOR_ME      = '#00e676';  // verde — il mio
  const COLOR_CITY    = '#a8895c';
  const COLOR_EMPTY   = '#c9b182';

  function drawMap() {
    if (!mapCtx || !mapCanvas) return;
    const W = mapCanvas.width, H = mapCanvas.height;
    const s = mapView.scale;
    const ctx = mapCtx;

    ctx.fillStyle = '#6ec6e8';
    ctx.fillRect(0, 0, W, H);

    // Griglia
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 0.5;
    const gs = 10 * s;
    const ox = ((-mapView.x * s) % gs + gs) % gs;
    const oy = ((-mapView.y * s) % gs + gs) % gs;
    for (let x = ox; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = oy; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Assi centro mappa
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    const c50 = worldToCanvas(50, 50);
    ctx.beginPath(); ctx.moveTo(c50.cx, 0); ctx.lineTo(c50.cx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, c50.cy); ctx.lineTo(W, c50.cy); ctx.stroke();

    // nameToState: player_name → status (per filtro stato)
    const nameToState = new Map();
    for (const [, p] of mapPlayers) {
      nameToState.set((p.name || '').toLowerCase(), p.status || p.state || 'active');
    }

    const r = Math.max(2, s * 0.45);

    for (const isl of mapIslands) {
      const { cx, cy } = worldToCanvas(isl.x, isl.y);
      if (cx < -r*3 || cx > W+r*3 || cy < -r*3 || cy > H+r*3) continue;

      // cities[] salvato da parser_ikalogs (player_name, ally_name, city_name, city_level)
      const cities    = isl.cities || [];
      const hasCities = cities.length > 0;

      let matchFilter = false;
      let matchRef    = false;
      let isMe        = false;

      for (const city of cities) {
        const pname  = (city.player_name || '').toLowerCase();
        const ally   = (city.ally_name  || '').toLowerCase();
        const pstate = nameToState.get(pname) || 'active';

        // Il mio player
        if (myPlayerName && pname === myPlayerName.toLowerCase()) isMe = true;

        // Filtro verde
        if (searchFilter && (pname.includes(searchFilter) || (isl.name||'').toLowerCase().includes(searchFilter))) matchFilter = true;
        if (allyFilter   && ally === allyFilter)   matchFilter = true;
        if (stateFilter  && pstate === stateFilter) matchFilter = true;
        if (noAllyFilter && !ally)                  matchFilter = true;

        // Filtro azzurro (riferimento)
        if (refFilter && (pname.includes(refFilter) || ally.includes(refFilter))) matchRef = true;
      }

      // Isole tutte della stessa dimensione, colore diverso per occupate/vuote
      let color  = hasCities ? COLOR_CITY : COLOR_EMPTY;
      let radius = r;
      let alpha  = 1.0;
      let glow   = false;

      if (isMe)                        { color = COLOR_ME;     alpha = 1; glow = true; }
      else if (matchFilter && matchRef){ color = COLOR_BOTH;   alpha = 1; glow = true; }
      else if (matchFilter)            { color = COLOR_FILTER; alpha = 1; glow = true; }
      else if (matchRef)               { color = COLOR_REF;    alpha = 1; glow = true; }

      ctx.globalAlpha = alpha;
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
      ctx.fillStyle = color;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      if (glow) ctx.shadowBlur = 0;
      ctx.globalAlpha = 1.0;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '10px monospace';
    const tl = canvasToWorld(0, 0);
    ctx.fillText(`[${Math.round(tl.wx)}:${Math.round(tl.wy)}]`, 6, 14);

    if (mapIslands.length === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Naviga la mappa di gioco per caricare le isole', W/2, H/2);
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
  function findNearestIsland(cx, cy, maxDist = 18) {
    const { wx, wy } = canvasToWorld(cx, cy);
    let best = null, bestD = Infinity;
    const threshold = maxDist / mapView.scale;
    for (const isl of mapIslands) {
      const d = Math.hypot(isl.x - wx, isl.y - wy);
      if (d < bestD && d < threshold) { best = isl; bestD = d; }
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
    const cities = isl.cities || [];
    tt.innerHTML = `
      <div class="tt-title">${isl.name || `[${isl.x}:${isl.y}]`} [${isl.x}:${isl.y}]</div>
      ${isl.tgName     ? `<div class="tt-row"><span class="tt-label">Risorsa</span><span class="tt-value">${isl.tgName}</span></div>` : ''}
      ${isl.templeName ? `<div class="tt-row"><span class="tt-label">Tempio</span><span class="tt-value">${isl.templeName} Lv${isl.templeLevel||'?'}</span></div>` : ''}
      ${isl.woodLevel  ? `<div class="tt-row"><span class="tt-label">Falegnameria</span><span class="tt-value">Lv${isl.woodLevel}</span></div>` : ''}
      <div class="tt-row"><span class="tt-label">Polis</span><span class="tt-value">${cities.length}</span></div>
      ${cities.slice(0,4).map(c => {
        const pl = mapPlayers.get((c.player_name||'').toLowerCase());
        const stIcon = { active:'🟢', inactive:'🟡', vacation:'🔵', banned:'🔴' }[pl?.status||pl?.state] || '⚪';
        const ally  = pl?.ally || c.ally_name || '—';
        const score = pl?.scores?.score ?? Object.values(pl?.scores || {})[0];
        const scoreLabel = (score != null) ? Number(score).toLocaleString('it') : '—';
        return `<div class="tt-row">
          <span class="tt-label">${stIcon} ${c.player_name||'?'}</span>
          <span class="tt-value">${ally} · 🏆${scoreLabel}</span>
        </div>`;
      }).join('')}
      ${cities.length > 4 ? `<div style="font-size:11px;color:var(--text-muted);text-align:center">+${cities.length-4} altri</div>` : ''}
    `;
    tt.style.display = 'block';
    tt.style.left    = (sx + 14) + 'px';
    tt.style.top     = Math.max(60, sy - 20) + 'px';
  }
  function hideTooltip() {
    const tt = document.getElementById('ikp-map-tooltip');
    if (tt) tt.style.display = 'none';
  }

  // ── PANNELLO POLIS ISOLA (inline sotto la mappa) ──
  function showIslandPopup(isl) {
    popupIsland = isl;
    // Usa direttamente isl.cities[] salvato da parser_ikalogs
    const cities = isl.cities || [];
    const el     = document.getElementById('ikp-popup-content');
    if (!el) return;

    const stateColors = {
      active:'#4caf50', inactive:'#ff9800',
      vacation:'#2196f3', banned:'#f44336', deleted:'#666',
    };
    const stateLabels = {
      active:'Attivo', inactive:'Inattivo',
      vacation:'Vacanza', banned:'Bannato', deleted:'Eliminato',
    };

    // Info isola
    const info = [
      isl.tgName    ? `🎁 ${isl.tgName}`    : null,
      isl.templeName? `⛩ ${isl.templeName}` : null,
      isl.woodLevel ? `🪵 Lv${isl.woodLevel}` : null,
    ].filter(Boolean).join(' · ');

    el.innerHTML = `
      <div class="pop-title">🏝 ${isl.name || `[${isl.x}:${isl.y}]`}</div>
      <div class="pop-sub">[${isl.x}:${isl.y}]${info ? ' · ' + info : ''}</div>
      ${cities.length === 0
        ? '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">Nessuna città nel DB.<br>Visita ikalogs.ru per popolare i dati.</p>'
        : cities.map(c => {
            // Recupera stato dal DB players se disponibile
            const pl  = mapPlayers.get((c.player_name||'').toLowerCase());
            const st  = pl?.status || pl?.state || 'active';
            const sc  = stateColors[st] || '#aaa';
            const slb = stateLabels[st] || st;
            return `<div class="pop-city">
              <div class="pop-state" style="background:${sc}" title="${slb}"></div>
              <div style="flex:1">
                <div class="pop-city-name">${c.city_name || '?'}
                  <span style="font-size:11px;color:var(--text-muted)">Lv${c.city_level||'?'}</span>
                </div>
                <div class="pop-player">👤 ${c.player_name || '?'} · ${slb}</div>
              </div>
              ${c.ally_name ? `<div class="pop-ally">${c.ally_name}</div>` : ''}
            </div>`;
          }).join('')
      }
    `;
  }

  function closePopup() {
    popupIsland = null;
    const el = document.getElementById('ikp-popup-content');
    if (el) {
      el.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">🏝</div><p>Seleziona un'isola sulla mappa per vedere le sue polis.</p></div>`;
    }
    hideTooltip();
  }

  // ── TIMER ─────────────────────────────────────
  async function renderTimers() {
    const list = document.getElementById('ikp-timer-list');
    if (list && window.IkNotifier) {
      const active = window.IkNotifier.getActive();
      if (!active.length) {
        list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">⏳</div><p>Nessun timer.</p></div>`;
      } else {
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
    }
    await renderWineTimers();
  }

  // ── ESAURIMENTO VINO ─────────────────────────────
  // Stima per ogni polis: tempo rimanente = vino attuale / consumo orario
  async function renderWineTimers() {
    const list = document.getElementById('ikp-wine-list');
    if (!list || !window.IkDB) return;

    let cities = await window.IkDB.getAll('my_cities');
    cities = cities.filter(c => c.name || (c.islandX != null && c.islandY != null));

    // Solo città con dati vino disponibili
    const withWine = cities.filter(c => c.wine != null && c.wineSpendings != null);

    if (!withWine.length) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">🍷</div><p>Naviga le tue città per popolare questa stima.</p></div>`;
      return;
    }

    // Calcola ore rimanenti, ordina dal più urgente
    const rows = withWine.map(c => {
      let hoursLeft = null;
      if (c.wineSpendings > 0) {
        hoursLeft = c.wine / c.wineSpendings;
      } else if (c.wineSpendings === 0) {
        hoursLeft = Infinity; // nessun consumo: non si esaurisce
      }
      return { ...c, hoursLeft };
    }).sort((a, b) => (a.hoursLeft ?? Infinity) - (b.hoursLeft ?? Infinity));

    list.innerHTML = rows.map(c => {
      const coords = (c.islandX != null && c.islandY != null) ? `${c.islandX}:${c.islandY}` : '—';
      const wine   = Math.round(c.wine).toLocaleString('it');
      const spend  = c.wineSpendings.toLocaleString('it');

      let timeLabel, urgent = false;
      if (c.hoursLeft === Infinity) {
        timeLabel = '∞ (consumo nullo)';
      } else {
        const totalMin = Math.round(c.hoursLeft * 60);
        const days  = Math.floor(totalMin / 1440);
        const hours = Math.floor((totalMin % 1440) / 60);
        const mins  = totalMin % 60;
        const parts = [];
        if (days)  parts.push(`${days}g`);
        if (hours) parts.push(`${hours}h`);
        if (!days) parts.push(`${mins}m`);
        timeLabel = parts.join(' ');
        urgent = c.hoursLeft < 6; // meno di 6 ore: evidenzia
      }

      return `<div class="ikp-timer">
        <div class="ikp-timer-icon">🍷</div>
        <div class="ikp-timer-info">
          <div class="ikp-timer-label">${c.name || '?'} <span style="color:var(--text-muted);font-size:11px">[${coords}]</span></div>
          <div class="ikp-timer-sub">${wine} vino · consumo ${spend}/h</div>
        </div>
        <div class="ikp-timer-time ${urgent ? 'urgent' : ''}">
          ${timeLabel}
        </div>
      </div>`;
    }).join('');
  }

  // ── MIE CITTÀ ──────────────────────────────────
  async function renderMyCities() {
    const list = document.getElementById('ikp-mycities-list');
    if (!list || !window.IkDB) return;

    let cities = await window.IkDB.getAll('my_cities');
    const summary = await window.IkDB.get('account_summary', 'main');

    // Filtra record fantasma: senza nome e senza coordinate
    // (es. cityId residui da fallback errati di versioni precedenti)
    cities = cities.filter(c => c.name || (c.islandX != null && c.islandY != null));

    if (!cities.length && !summary) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">🏠</div><p>Naviga le tue città nel gioco per popolare questa vista.</p></div>`;
      return;
    }

    // ── Riepilogo globale account, organizzato per sezioni ──
    let summaryHtml = '';
    if (summary) {
      const netGold = (summary.income || 0) + (summary.upkeep || 0) + (summary.godGoldResult || 0);
      summaryHtml = `
        <div class="ikp-card" style="margin-bottom:10px">
          <div class="ikp-card-title">💰 Riepilogo account</div>

          <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-top:6px;margin-bottom:4px">🪙 ORO</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;margin-bottom:8px">
            <div>Oro: <b>${Math.round(summary.gold).toLocaleString('it')}</b></div>
            <div>📈 Entrate: <b>${Math.round(summary.income).toLocaleString('it')}</b></div>
            <div>📉 Consumo: <b>${Math.round(summary.upkeep).toLocaleString('it')}</b></div>
            <div>🏛 Pluto: <b>${Math.round(summary.godGoldResult).toLocaleString('it')}</b></div>
            <div>⚖ Netto/h: <b>${Math.round(netGold).toLocaleString('it')}</b></div>
            <div>🍯 Ambrosia: <b>${summary.ambrosia.toLocaleString('it')}</b></div>
          </div>

          <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px">⛴ NAVI</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
            <div>🚛 Trasportatori: <b>${summary.freeTransporters}/${summary.maxTransporters}</b></div>
            <div>⛴ Mercantili: <b>${summary.freeFreighters}/${summary.maxFreighters}</b></div>
          </div>
        </div>`;
    }

    const resetBtnHtml = `
      <div style="margin-top:10px">
        <button class="ikp-btn danger small" onclick="window.IkApp.resetMyCities()">🗑 Reset dati polis</button>
      </div>`;

    if (!cities.length) {
      list.innerHTML = summaryHtml
        + `<div class="ikp-empty"><div class="ikp-empty-icon">🏠</div><p>Naviga le tue città nel gioco per popolare la tabella polis.</p></div>`
        + resetBtnHtml;
      return;
    }

    // Ordina per coordinate
    cities.sort((a, b) => (a.islandX - b.islandX) || (a.islandY - b.islandY) || (a.cityId - b.cityId));

    let totalWine = 0;

    const rows = cities.map(c => {
      const coords  = (c.islandX != null && c.islandY != null) ? `${c.islandX}:${c.islandY}` : '—';
      const tgName  = c.tgName || '—';
      const tgPerHr = (c.tgPerHour != null) ? c.tgPerHour.toLocaleString('it') : '—';
      const wood    = (c.wood != null) ? Math.round(c.wood).toLocaleString('it') : '—';
      const sciUp   = (c.scientistsUpkeep != null) ? c.scientistsUpkeep.toLocaleString('it') : '—';
      const wineSp  = (c.wineSpendings != null) ? c.wineSpendings.toLocaleString('it') : '—';
      if (c.wineSpendings != null) totalWine += c.wineSpendings;
      let citFree = '—', citBusy = '—';
      if (c.citizens != null && c.population != null) {
        citFree = Math.round(c.citizens).toLocaleString('it');
        citBusy = Math.round(c.population - c.citizens).toLocaleString('it');
      }
      return `<tr style="cursor:pointer" onclick="window.IkApp.showBuildingsPopup(${c.cityId})">
        <td>${c.cityId}</td>
        <td>${c.name || '—'}</td>
        <td>${coords}</td>
        <td>${tgName}</td>
        <td style="text-align:right">${tgPerHr}</td>
        <td style="text-align:right">${wood}</td>
        <td style="text-align:right">${wineSp}</td>
        <td style="text-align:right">${sciUp}</td>
        <td style="text-align:right">${citFree}</td>
        <td style="text-align:right">${citBusy}</td>
        <td style="text-align:center">🏛</td>
      </tr>`;
    }).join('');

    list.innerHTML = summaryHtml + `
      <div style="overflow-x:auto">
        <table class="ikp-db-table">
          <thead><tr>
            <th>ID</th><th>Nome</th><th>X:Y</th><th>Bene</th>
            <th style="text-align:right">Bene/h</th>
            <th style="text-align:right">🪵 Legno</th>
            <th style="text-align:right">🍷 Consumo vino</th>
            <th style="text-align:right">Scienziati</th>
            <th style="text-align:right">Liberi</th>
            <th style="text-align:right">Occupati</th>
            <th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr style="font-weight:600;border-top:2px solid var(--border)">
            <td colspan="6">Totale consumo vino</td>
            <td style="text-align:right">${Math.round(totalWine).toLocaleString('it')}</td>
            <td colspan="3"></td>
          </tr></tfoot>
        </table>
      </div>
    ` + resetBtnHtml;
  }

  // ── POPUP EDIFICI CITTÀ ──────────────────────────
  const BUILDING_ICONS = {
    townHall:        '🏛', warehouse:       '🏪', tavern:         '🍺',
    academy:         '🎓', shipyard:        '⚓', barracks:       '⚔️',
    wall:            '🏰', museum:          '🖼', palace:         '👑',
    branchOffice:    '🏢', temple:          '⛩', beautification: '🌸',
    luxuryResidence: '🏠', embassy:         '📜', dump:           '🗑',
    pirateFortress:  '🏴‍☠️', forester:       '🌲', vineyard:       '🍇',
    quarry:          '⛏', crystalMine:     '💎', sulfurPit:      '🔥',
    carpenter:       '🪚', glassblower:     '🫙', alchemistTower: '⚗️',
    gunpowderTower:  '💣', workshop:        '🔧', architectOffice:'📐',
    gynaeceum:       '🧵', safehouse:       '🕵️', highRiseTower:  '🏗',
  };

  async function showBuildingsPopup(cityId) {
    const popup   = document.getElementById('ikp-buildings-popup');
    const title   = document.getElementById('ikp-buildings-popup-title');
    const content = document.getElementById('ikp-buildings-popup-content');
    if (!popup || !content || !window.IkDB) return;

    const city = await window.IkDB.get('my_cities', cityId);
    if (!city) { toast('⚠️ Dati città non disponibili'); return; }

    title.textContent = `${city.name || '?'} [${city.islandX}:${city.islandY}]`;

    const buildings = city.buildings || [];
    const occupied  = buildings.filter(b => b.building && b.building !== '');
    const empty     = buildings.filter(b => !b.building || b.building === '');

    const buildingHtml = occupied.map(b => {
      const icon      = BUILDING_ICONS[b.building] || '🏗';
      const statIcons = [
        b.isBusy     ? '<span title="In costruzione">🔨</span>' : '',
        b.canUpgrade  ? '<span title="Upgrade disponibile">⬆️</span>' : '',
        b.isMaxLevel  ? '<span title="Livello massimo">⭐</span>' : '',
      ].filter(Boolean).join('');
      return `
        <div class="ikp-building-card ${b.isBusy ? 'busy' : ''} ${b.isMaxLevel ? 'maxlvl' : ''}">
          <div class="ikp-building-icon">${icon}</div>
          <div class="ikp-building-name">${b.name || b.building}</div>
          <div class="ikp-building-level">Lv ${b.level}</div>
          ${statIcons ? `<div class="ikp-building-status">${statIcons}</div>` : ''}
        </div>`;
    }).join('');

    const emptyHtml = empty.length ? `
      <div style="margin-top:12px;font-size:12px;color:var(--text-muted);font-weight:600">
        📭 Slot vuoti (${empty.length})
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
        ${empty.map(() => `<div class="ikp-building-card empty">⬜</div>`).join('')}
      </div>` : '';

    content.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
        ${occupied.length} edifici · ${empty.length} slot vuoti
      </div>
      <div class="ikp-buildings-grid">${buildingHtml}</div>
      ${emptyHtml}
    `;

    popup.style.display = 'flex';
  }

  function closeBuildingsPopup() {
    const popup = document.getElementById('ikp-buildings-popup');
    if (popup) popup.style.display = 'none';
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

  // ── ACCOUNT ────────────────────────────────────
  let selectedCityId = null;

  async function renderAccount() {
    if (!window.IkDB) return;

    // Popola selettore città
    const cities    = await window.IkDB.getAll('cities');
    const ownCities = cities.filter(c => c.isOwn || c.source === 'ikariam');
    const select    = document.getElementById('ikp-city-select');
    if (select && ownCities.length) {
      const current = select.value || selectedCityId;
      select.innerHTML = ownCities.map(c =>
        `<option value="${c.id}" ${c.id == current ? 'selected' : ''}>
          ${c.isCapital ? '⭐ ' : ''}${c.name}
          ${c.islandX ? `[${c.islandX}:${c.islandY}]` : ''}
        </option>`
      ).join('');
      if (!selectedCityId) selectedCityId = ownCities[0].id;
    }

    const cityId = selectedCityId || (ownCities[0]?.id);
    if (!cityId) {
      document.getElementById('ikp-account-content').innerHTML =
        `<div class="ikp-empty"><div class="ikp-empty-icon">🏛</div>
         <p>Nessuna città disponibile.<br>Apri una città nel gioco.</p></div>`;
      return;
    }

    // Carica dati per la città selezionata
    const [city, res, constructions, buildings] = await Promise.all([
      window.IkDB.get('cities', Number(cityId)),
      window.IkDB.get('resources', Number(cityId)),
      window.IkDB.getAll('constructions'),
      window.IkDB.getAll('buildings'),
    ]);

    const cityConstr  = constructions.filter(c => c.cityId === Number(cityId));
    const cityBuildings = buildings.filter(b => b.cityId === Number(cityId))
                                   .sort((a,b) => a.groundId - b.groundId);

    const el = document.getElementById('ikp-account-content');
    if (!el) return;

    const n  = v => v != null ? Number(v).toLocaleString('it') : '—';
    const ms = res?.maxStorage ? ` / ${n(res.maxStorage)}` : '';
    const upd = res?.updated?.slice(11,19) || '—';

    el.innerHTML = `

      <!-- ── FINANZE ── -->
      <div class="ikp-card">
        <div class="ikp-card-title">🪙 Finanze
          <span style="font-size:10px;font-weight:400;color:var(--text-muted)">agg. ${upd}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${acItem('🪙','Oro',         n(res?.gold))}
          ${acItem('📈','Entrate',     n(res?.income))}
          ${acItem('📉','Uscite',      n(res?.upkeep))}
          ${acItem('⚖️','Saldo',       res ? `${res.income - res.upkeep > 0 ? '+' : ''}${n(res.income - res.upkeep)}` : '—')}
          ${acItem('🔮','Ambrosia',    n(res?.ambrosia))}
          ${acItem('🧪','Scienziati',  n(res?.scientistsUpkeep))}
          ${acItem('🏛','Dio oro',     n(res?.godGoldResult))}
          ${acItem('⚡','Az. città',   n(res?.maxActionPoints))}
        </div>
      </div>

      <!-- ── RISORSE ── -->
      <div class="ikp-card">
        <div class="ikp-card-title">📦 Risorse
          <span style="font-size:10px;font-weight:400;color:var(--text-muted)">max${ms}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${acItemRate('🪵','Legno',     n(res?.wood),    res?.woodPerHour)}
          ${acItemRate('🍷','Vino',      n(res?.wine),    res?.wineSpendings ? `-${n(res.wineSpendings)}/h` : null)}
          ${acItemRate('🪨','Marmo',     n(res?.marble),  null)}
          ${acItemRate('💎','Cristallo', n(res?.crystal), null)}
          ${acItemRate('🔥','Zolfo',    n(res?.sulfur),  null)}
          ${acItem(    '🧑','Cittadini', res ? `${n(res.citizens)} / ${n(res.population)}` : '—')}
        </div>
        ${res?.tgName ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px">
          Produzione: <b style="color:var(--accent)">${res.tgName}</b>
          +${n(res.tgPerHour)}/h
          ${res.badTaxAccountant ? ' ⚠️ Tassatore scarso' : ''}
        </div>` : ''}
      </div>

      <!-- ── TRASPORTI ── -->
      <div class="ikp-card">
        <div class="ikp-card-title">⛵ Trasporti</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${acItem('🚢','Trasportatori', n(res?.maxTransporters))}
          ${acItem('⚓','Mercantili',    n(res?.maxFreighters))}
        </div>
      </div>

      <!-- ── COSTRUZIONI IN CORSO ── -->
      ${cityConstr.length ? `
      <div class="ikp-card">
        <div class="ikp-card-title">🏗 Costruzioni in corso</div>
        ${cityConstr.map(c => {
          const left = c.endTime - Date.now();
          const h    = Math.floor(left / 3600000);
          const m    = Math.floor((left % 3600000) / 60000);
          const timeStr = left > 0
            ? `<span style="color:var(--accent);font-weight:700">${h}h ${m}m</span>`
            : `<span style="color:var(--green)">✅ Completato</span>`;
          return `<div style="display:flex;justify-content:space-between;
                              padding:8px 0;border-bottom:1px solid var(--border);
                              font-size:13px">
            <span>🏗 ${c.count > 1 ? c.count + ' edifici' : 'Edificio'}</span>
            ${timeStr}
          </div>`;
        }).join('')}
      </div>` : ''}

      <!-- ── EDIFICI ── -->
      ${cityBuildings.length ? `
      <div class="ikp-card">
        <div class="ikp-card-title">🏠 Edifici
          <span style="font-size:10px;font-weight:400;color:var(--text-muted)">
            ${cityBuildings.length} posizioni
          </span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${cityBuildings.filter(b => b.name).map(b => `
            <div style="display:flex;align-items:center;gap:6px;
                        padding:6px 8px;background:var(--bg-card2);
                        border-radius:var(--radius-sm);border:1px solid var(--border);
                        ${b.isBusy ? 'border-color:var(--accent)' : ''}">
              <span style="font-size:18px">${buildingIcon(b.building)}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;color:var(--text);
                            overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${b.name}
                </div>
                <div style="font-size:11px;color:var(--text-muted)">
                  Lv ${b.level}
                  ${b.isBusy    ? ' 🔨' : ''}
                  ${b.isMaxLevel ? ' ✅' : ''}
                  ${b.canUpgrade && !b.isBusy ? ' ⬆️' : ''}
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}
    `;
  }

  function acItem(icon, label, val) {
    return `<div style="background:var(--bg-card2);border:1px solid var(--border);
                        border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;
                  letter-spacing:.4px">${icon} ${label}</div>
      <div style="font-size:16px;font-weight:700;color:var(--text);margin-top:2px">${val}</div>
    </div>`;
  }

  function acItemRate(icon, label, val, rate) {
    return `<div style="background:var(--bg-card2);border:1px solid var(--border);
                        border-radius:var(--radius-sm);padding:8px 10px">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;
                  letter-spacing:.4px">${icon} ${label}</div>
      <div style="font-size:16px;font-weight:700;color:var(--text);margin-top:2px">${val}</div>
      ${rate ? `<div style="font-size:11px;color:var(--green)">+${typeof rate === 'number' ? rate.toLocaleString('it') : rate}/h</div>` : ''}
    </div>`;
  }

  function buildingIcon(building) {
    const icons = {
      townHall:'🏛', academy:'🎓', warehouse:'🏪', hideout:'🏚',
      tavern:'🍺', museum:'🏛', port:'⚓', shipyard:'🚢',
      barracks:'⚔️', wall:'🏯', carpenter:'🪵', glassblowing:'💎',
      alchemist:'🔥', winegrower:'🍷', quarry:'🪨', palace:'👑',
      branchOffice:'🏢', temple:'⛩', oracle:'🔮', lighthouse:'🔦',
      safehouse:'🏠', embassy:'🤝', workshop:'🔧', pirateFortress:'☠️',
    };
    return icons[building] || '🏠';
  }

  function selectCity(id) {
    selectedCityId = id;
    renderAccount();
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

    if (title) title.textContent = lastRanking.tipoLabel || lastRanking.rankingType || 'Classifica';
    if (range) range.textContent = `Pos. ${lastRanking.range}`;

    const stateIcon = { active:'🟢', inactive:'🟡', vacation:'🔵', banned:'🔴', deleted:'⚫' };
    const stateCls  = { active:'state-active', inactive:'state-inactive', vacation:'state-vacation', banned:'state-banned' };

    // Cambi di stato per questa sessione
    const changedIds = new Set((lastRanking.changes || []).map(c => c.playerId));

    list.innerHTML = `
      <div style="display:grid;grid-template-columns:40px 1fr auto auto;gap:6px 10px;
                  font-size:11px;font-weight:700;color:var(--text-muted);
                  padding:6px 8px;border-bottom:2px solid var(--border);margin-bottom:4px;
                  text-transform:uppercase;letter-spacing:.5px">
        <span>Pos.</span><span>Giocatore</span><span>Ally</span><span>Punti</span>
      </div>
      ${lastRanking.players.map(p => {
        // Nuovo formato: p.avatarId, p.nome, p.alleanza, p.punteggio, p.status, p.position
        const changed = changedIds.has(p.avatarId);
        const change  = (lastRanking.changes || []).find(c => c.playerId === p.avatarId);
        const isMe    = myPlayerName && (p.nome||'').toLowerCase() === myPlayerName.toLowerCase();
        const score   = p.punteggio || 0;
        return `<div style="display:grid;grid-template-columns:40px 1fr auto auto;
                            gap:4px 10px;padding:7px 8px;align-items:center;
                            border-bottom:1px solid var(--border);border-radius:4px;
                            ${isMe     ? 'background:rgba(0,230,118,0.08);'   : ''}
                            ${changed  ? 'background:rgba(255,152,0,0.1);'    : ''}">
          <span style="font-weight:700;color:var(--accent);font-size:13px">${p.position}</span>
          <div>
            <div style="font-weight:600;color:var(--text);font-size:13px">
              ${stateIcon[p.status]||'⚪'} ${p.nome}
              ${isMe ? '<span class="ikp-me-badge">TU</span>' : ''}
            </div>
            ${p.honorTitle ? `<div style="font-size:10px;color:var(--text-muted);font-style:italic">${p.honorTitle}</div>` : ''}
            ${changed && change ? `<div style="font-size:10px;color:var(--orange);margin-top:2px">
              ⚡ ${change.prevState} → ${change.newState}</div>` : ''}
          </div>
          <span style="font-size:12px;color:var(--text-dim);white-space:nowrap">${p.alleanza||'—'}</span>
          <span style="font-size:12px;font-weight:600;color:var(--text);text-align:right;white-space:nowrap">
            ${score > 1000000 ? (score/1000000).toFixed(2)+'M' : score.toLocaleString('it')}
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
        <div class="ikp-change-player">👤 ${c.playerName}${c.prevName ? ` <span style="font-size:11px;color:var(--text-muted)">(ex: ${c.prevName})</span>` : ''} ${c.allyName !== '—' ? `<span style="font-size:11px;color:var(--text-muted)">[${c.allyName}]</span>` : ''}</div>
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

  // Configurazione colonne per ogni store
  const STORE_COLS = {
    islands: [
      { k: 'coords',      label: 'Coord' },
      { k: 'name',        label: 'Nome' },
      { k: 'tgName',      label: 'Risorsa' },
      { k: 'templeName',  label: 'Tempio' },
      { k: 'templeLevel', label: 'Lv Tempio' },
      { k: 'woodLevel',   label: 'Lv Legno' },
      { k: 'nCities',     label: 'Polis' },
    ],
    my_cities: [
      { k: 'cityId',     label: 'ID' },
      { k: 'name',       label: 'Nome' },
      { k: 'islandX',    label: 'X' },
      { k: 'islandY',    label: 'Y' },
      { k: 'wood',       label: '🪵' },
      { k: 'gold',       label: '🪙' },
      { k: 'population', label: 'Pop' },
      { k: 'tgName',     label: 'Bene' },
    ],
    enemy_buildings: [
      { k: 'cityId',    label: 'ID' },
      { k: 'cityName',  label: 'Città' },
      { k: 'ownerName', label: 'Player' },
      { k: 'islandX',   label: 'X' },
      { k: 'islandY',   label: 'Y' },
      { k: 'buildings', label: 'Edifici' },
    ],
    account_summary: [
      { k: 'gold',             label: '🪙 Oro' },
      { k: 'income',           label: 'Entrate' },
      { k: 'upkeep',           label: 'Consumo' },
      { k: 'godGoldResult',    label: 'Pluto' },
      { k: 'ambrosia',         label: '🍯 Ambrosia' },
      { k: 'freeTransporters', label: 'Trasp. liberi' },
      { k: 'maxTransporters',  label: 'Trasp. tot' },
      { k: 'freeFreighters',   label: 'Merc. liberi' },
      { k: 'maxFreighters',    label: 'Merc. tot' },
      { k: 'updated',          label: 'Agg.' },
    ],
    players: [
      { k: 'id',          label: 'ID' },
      { k: 'name',        label: 'Nome' },
      { k: 'ally',        label: 'Ally' },
      { k: 'status',      label: 'Stato' },
      { k: 'stateSource', label: 'Fonte' },
    ],
    state_changes: [
      { k: 'playerName',  label: 'Player' },
      { k: 'prevName',    label: 'Ex-nome' },
      { k: 'allyName',    label: 'Ally' },
      { k: 'prevState',   label: 'Da' },
      { k: 'newState',    label: 'A' },
      { k: 'newUpdate',   label: 'Data' },
    ],
    entries: [
      { k: 'type',        label: 'Tipo' },
      { k: 'url',         label: 'URL' },
      { k: 'date',        label: 'Data' },
      { k: '_parserName', label: 'Parser' },
      { k: '_parserCount',label: 'Records' },
      { k: '_actions',    label: 'Azioni' },
    ],
  };

  const STORE_SEARCH = {
    islands:       r => `${r.coords} ${r.name} ${r.tgName} ${r.templeName}`.toLowerCase(),
    my_cities:       r => `${r.name} ${r.cityId} ${r.islandX}:${r.islandY} ${r.tgName}`.toLowerCase(),
    enemy_buildings: r => `${r.cityName} ${r.ownerName} ${r.islandX}:${r.islandY}`.toLowerCase(),
    account_summary: r => 'main',
    players:       r => `${r.name} ${r.ally} ${r.status} ${r.stateSource}`.toLowerCase(),
    state_changes: r => `${r.playerName} ${r.allyName} ${r.prevState} ${r.newState}`.toLowerCase(),
    entries:       r => `${r.type} ${r.url}`.toLowerCase(),
  };

  // Formatta valore per cella tabella
  function fmtCell(v, key) {
    if (v === null || v === undefined) return '<span style="color:#aaa">—</span>';
    if (key === 'endTime') {
      const d = new Date(v);
      const left = v - Date.now();
      if (left > 0) {
        const h = Math.floor(left/3600000);
        const m = Math.floor((left%3600000)/60000);
        return `<span style="color:var(--accent)">${h}h ${m}m</span>`;
      }
      return `<span style="color:var(--text-muted)">${d.toLocaleTimeString('it')}</span>`;
    }
    if (key === 'newUpdate' || key === 'updated') {
      try { return new Date(v).toLocaleString('it-IT', { dateStyle:'short', timeStyle:'short' }); } catch {}
    }
    if (key === 'score') return Number(v) > 1000000 ? (Number(v)/1000000).toFixed(2)+'M' : Number(v).toLocaleString('it');
    if (key === 'state' || key === 'prevState' || key === 'newState') {
      const cls = { active:'state-active', inactive:'state-inactive', vacation:'state-vacation', banned:'state-banned' };
      const lbl = { active:'Attivo', inactive:'Inattivo', vacation:'Vacanza', banned:'Bannato' };
      return `<span class="ikp-state-badge ${cls[v]||''}">${lbl[v]||v}</span>`;
    }
    if (key === 'isBusy') return v ? '🔴' : '🟢';
    if (key === 'url') {
      try { const u = new URL(v); return u.searchParams.get('action')||u.searchParams.get('view')||u.pathname.slice(-20); } catch {}
    }
    if (typeof v === 'boolean') return v ? '✅' : '❌';
    if (typeof v === 'number') return v.toLocaleString('it');
    if (typeof v === 'string' && v.length > 28) return `<span title="${v}">${v.slice(0,26)}…</span>`;
    return String(v);
  }

  // Cache record per download (evita problemi con JSON in onclick)
  let _dbRecordCache = [];

  function renderTable(rows, cols) {
    if (!rows.length) return '<p style="font-size:12px;color:var(--text-muted);padding:8px">Nessun risultato</p>';
    // Salva in cache per download tramite indice
    _dbRecordCache = rows;
    return `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--bg-card2)">
              ${cols.map(c => `<th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid var(--border);white-space:nowrap">${c.label}</th>`).join('')}
              <th style="padding:6px 8px;border-bottom:2px solid var(--border);width:32px"></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r, i) => `<tr style="${i%2===1?'background:var(--bg-card2)':''}">
                ${cols.map(c => `<td style="padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:middle;white-space:nowrap">${fmtCell(r[c.k], c.k)}</td>`).join('')}
                <td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:center">
                  <button onclick="window.IkApp.downloadRecord(${i})" style="background:none;border:1px solid var(--border);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;color:var(--text-muted)" title="Scarica">⬇</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function downloadRecord(idx) {
    try {
      const rec  = _dbRecordCache[idx];
      if (!rec) { toast('❌ Record non trovato'); return; }
      const name = rec.coords || rec.id || rec.combatId || rec.playerName || 'record';
      const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `ik_${String(name).replace(/[^a-z0-9_:.-]/gi,'_')}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('⬇ Record scaricato');
    } catch(e) { toast('❌ Errore download: ' + e.message); }
  }

  // Download tutti i risultati della ricerca corrente
  function downloadSearchResults() {
    const store  = document.getElementById('ikp-db-store')?.value || 'entries';
    const q      = document.getElementById('ikp-db-q')?.value || '';
    window.IkDB.getAll(store).then(all => {
      const searchFn = STORE_SEARCH[store] || (r => JSON.stringify(r).toLowerCase());
      const filtered = q ? all.filter(r => searchFn(r).includes(q.toLowerCase())) : all;
      const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `ik_${store}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`⬇ ${filtered.length} record scaricati`);
    });
  }

  async function dbSearch() {
    const store = document.getElementById('ikp-db-store')?.value || 'islands';
    const q     = (document.getElementById('ikp-db-q')?.value || '').toLowerCase().trim();
    const el    = document.getElementById('ikp-db-results');
    if (!el || !window.IkDB) return;

    el.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted)">⏳ Caricamento...</div>';

    try {
      let all = await window.IkDB.getAll(store);
      const searchFn = STORE_SEARCH[store] || (r => JSON.stringify(r).toLowerCase());

      // Filtra per query
      if (q) all = all.filter(r => searchFn(r).includes(q));

      // Mostra max 50 risultati
      const shown = all.slice(0, 50);
      const cols  = STORE_COLS[store] || [{ k: 'id', label: 'ID' }];

      el.innerHTML = `
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
          ${all.length} risultati${all.length > 50 ? ' (mostrati 50)' : ''}
          ${q ? ` per "<b style="color:var(--accent)">${q}</b>"` : ''}
        </div>
        ${renderTable(shown, cols)}`;
    } catch(e) {
      el.innerHTML = `<p style="color:var(--red);font-size:12px">Errore: ${e.message}</p>`;
    }
  }

  async function renderDB() {
    // Stats compatte in cima
    const statsEl = document.getElementById('ikp-db-stats');
    if (statsEl && window.IkDB) {
      const counts = await window.IkDB.countAll();
      const items = [
        { icon: '🏝', label: 'Isole',     val: counts.islands },
        { icon: '🏠', label: 'Mie città', val: counts.my_cities },
        { icon: '🏢', label: 'Ed.nemici', val: counts.enemy_buildings },
        { icon: '👤', label: 'Players',   val: counts.players },
        { icon: '🔔', label: 'Cambi',     val: counts.state_changes },
        { icon: '📋', label: 'JSON raw',  val: counts.entries },
      ];
      statsEl.innerHTML = items.map(it => `
        <div style="background:var(--bg-card);border:1px solid var(--border);
             border-radius:var(--radius);padding:10px 8px;text-align:center">
          <div style="font-size:18px">${it.icon}</div>
          <div style="font-size:16px;font-weight:700;color:var(--accent)">${it.val}</div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;
               letter-spacing:.5px">${it.label}</div>
        </div>`).join('');
    }

    // Avvia ricerca default (isole, nessun filtro)
    await dbSearch();
    updateStatusBar();
  }

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

  
  // ── CLEAR RAW ────────────────────────────────
  async function clearRaw() {
    if (!confirm('Eliminare tutti i JSON raw?\nI dati strutturati (isole, players, ecc.) vengono mantenuti.')) return;
    await window.IkDB.clearRawEntries();
    toast('🧹 Raw entries eliminate');
    renderDB();
    updateStatusBar();
  }

  // ── CLEAR DB ─────────────────────────────────
  async function clearDB() {
    if (!confirm('Eliminare tutti i dati?')) return;
    const stores = ['entries','islands','players','state_changes','my_cities','enemy_buildings','account_summary'];
    await Promise.all(stores.map(s => window.IkDB.clear(s).catch(()=>{})));
    sessionCount = 0; mapIslands = []; mapCities = []; mapPlayers = new Map();
    updateBadge(); refreshActiveTab(); updateStatusBar();
    toast('🗑 DB svuotato');
  }

  // Reset solo dati polis (my_cities + account_summary).
  // Mantiene isole, players, cambi stato, edifici nemici.
  async function resetMyCities() {
    if (!confirm('Azzerare i dati delle tue polis (risorse, edifici, riepilogo account)?')) return;
    await window.IkDB.clear('my_cities').catch(()=>{});
    await window.IkDB.clear('account_summary').catch(()=>{});
    renderMyCities();
    toast('🗑 Dati polis azzerati');
  }

  // ── CALLBACK DAI PARSER ───────────────────────
  function onIslandsUpdated(n)  { if (panelOpen && activeTab === 'map') loadMapData(); updateStatusBar(); }
  function onCitiesUpdated(id)  { if (panelOpen && activeTab === 'account') renderAccount(); }
  function onResourcesUpdated() {
    if (window.IkNotifier) window.IkNotifier.scheduleWineTimers();
    if (!panelOpen) return;
    if (activeTab === 'account')  renderAccount();
    if (activeTab === 'timers')   renderWineTimers();
    if (activeTab === 'mycities') renderMyCities();
  }
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
    log('Init v3.2.5...');

    if (isIkalogsSite) {
      // Su ikalogs non c'è DB/parsers/notifier: solo UI bridge + catturati
      log('ℹ️ Modalità bridge (ikalogs) — skip DB/parsers/notifier');
      buildUI();

      // Nascondi i tab non rilevanti su ikalogs
      const hideTabs = ['map','timers','resources','ranking','changes','db','log'];
      hideTabs.forEach(t => {
        const btn = document.getElementById('ikp-tab-btn-' + t);
        const sec = document.getElementById('ikp-tab-' + t);
        if (btn) btn.style.display = 'none';
        if (sec) sec.classList.remove('active');
      });
      // Attiva "Catturati" come tab predefinito
      const capBtn = document.getElementById('ikp-tab-btn-captured');
      const capSec = document.getElementById('ikp-tab-captured');
      if (capBtn) { capBtn.style.display = ''; capBtn.classList.add('active'); }
      if (capSec) capSec.classList.add('active');
      activeTab = 'captured';
      renderCaptured();

      log('✅ Companion v3.2.5 pronto su', window.location.hostname);
      return;
    }

    // 1. Apri DB
    if (window.IkDB) {
      await window.IkDB.open();
      log('✅ DB aperto');
    } else {
      log('❌ IkDB non trovato!');
    }

    // 2. Carica sotto-parser (usa _gmFetch già impostato dal TM)
    if (window.IkParsers) {
      await window.IkParsers.loadSubParsers();
      log('✅ Parser caricati, registrati:', window.IkParsers.listParsers?.() || '?');
    } else {
      log('❌ IkParsers non trovato!');
    }

    // 3. Ripristina timer
    if (window.IkNotifier) {
      await window.IkNotifier.restoreTimers();
      log('✅ Timer ripristinati');
    }

    // 4. Build UI
    buildUI();

    // 5. Vista iniziale mappa centrata
    mapView = { x: 50, y: 25, scale: 5 };

    log('✅ Companion v3.2.5 pronto su', window.location.hostname);
  }



  function loadSettingsUI() {
    const nameEl = document.getElementById('ikp-my-name');
    if (nameEl && myPlayerName) nameEl.value = myPlayerName;
    const pidEl = document.getElementById('ikp-my-pid');
    if (pidEl && myPlayerId) pidEl.value = myPlayerId;
    const st = document.getElementById('ikp-notif-status');
    if (st) {
      st.textContent = !('Notification' in window) ? 'Non supportato'
        : Notification.permission === 'granted' ? '✅ Abilitate'
        : Notification.permission === 'denied'  ? '❌ Negate'
        : '⏳ Non impostate';
    }
    updateStorageInfo();
  }

  async function updateStorageInfo() {
    const el = document.getElementById('ikp-storage-info');
    if (!el || !window.IkDB) return;
    const info = await window.IkDB.storageInfo();
    el.innerHTML = info
      ? 'Usato: <b>' + info.usedMB + ' MB</b> / ' + info.quotaMB + ' MB (' + info.pct + '%)'
      : 'Non disponibile';
  }

  // ── SETTINGS ACTIONS ────────────────────────
  function saveMyId() {
    const nameVal = (document.getElementById('ikp-my-name')?.value || '').trim();
    if (!nameVal) { toast('⚠️ Inserisci il tuo nome player'); return; }
    myPlayerName = nameVal;
    localStorage.setItem('ik_my_name', nameVal);
    const val = Number(document.getElementById('ikp-my-pid')?.value);
    if (val) { myPlayerId = val; localStorage.setItem('ik_my_pid', String(val)); }
    const info = document.getElementById('ikp-my-pid-info');
    if (info) info.textContent = '✅ Salvato come "' + nameVal + '"';
    toast('✅ Salvato: ' + nameVal);
    drawMap();
    log('✅ Player impostato: ' + nameVal + (val ? ' (ID: ' + val + ')' : ''));
  }

  async function askNotifPerm() {
    const ok = await window.IkNotifier?.requestPermission();
    const el = document.getElementById('ikp-notif-status');
    if (el) el.textContent = ok ? '✅ Abilitate' : '❌ Negate';
    if (ok) toast('🔔 Notifiche abilitate!');
  }

  async function pruneOld() {
    const n = await window.IkDB?.pruneEntries(30);
    toast('🧹 Rimossi ' + n + ' record');
    renderDB();
    updateStatusBar();
  }


  // ── IMPORT FILE MANUALE ──────────────────────
  function importLog(msg, color) {
    const box = document.getElementById('ikp-import-log');
    if (!box) return;
    const line = document.createElement('div');
    line.style.cssText = 'font-size:11px;padding:1px 0;color:' + (color || 'var(--text)');
    line.textContent = new Date().toISOString().slice(11,19) + ' ' + msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  async function importFiles(input) {
    const files = Array.from(input.files);
    if (!files.length) return;

    // Svuota e mostra log box
    const box = document.getElementById('ikp-import-log');
    if (box) { box.innerHTML = ''; box.style.display = 'block'; }

    let total = 0;

    for (const file of files) {
      importLog('📂 File: ' + file.name);
      try {
        const text = await file.text();
        importLog('   Dimensione: ' + (text.length / 1024).toFixed(1) + ' KB');

        let json;
        try {
          json = JSON.parse(text);
          importLog('   JSON parsato OK');
        } catch(pe) {
          importLog('   ❌ JSON non valido: ' + pe.message, 'var(--red)');
          throw pe;
        }

        const entries = Array.isArray(json) ? json : [json];
        importLog('   Entry trovate: ' + entries.length);

        for (const entry of entries) {
          const data   = entry.data || entry;
          const url    = entry.url || entry._meta?.url || 'https://ikalogs.ru/import';
          const entryId = entry.id;
          const meta   = { date: entry.date || entry._meta?.date || null };
          importLog('   URL: ' + url);
          if (meta.date) importLog('   Data cattura: ' + meta.date);

          if (!window.IkParsers) {
            importLog('   ❌ IkParsers non disponibile', 'var(--red)');
            continue;
          }

          // Controlla quale parser matcha
          const matchedParser = window.IkParsers.whichParser?.(url, data, meta);
          importLog('   Parser selezionato: ' + (matchedParser || 'nessuno'),
                    matchedParser ? 'var(--text)' : 'orange');

          if (!matchedParser) {
            importLog('   ⚠️ Nessun parser matcha URL: ' + url, 'orange');
          }

          importLog('   ▶ Avvio parse...');
          const result = await window.IkParsers.parse(url, data, meta);
          const n = (typeof result === 'object') ? (result.parsed || 0) : (Number(result) || 0);
          total += n;

          if (typeof result === 'object' && result.parserName) {
            importLog('   Parser eseguito: ' + result.parserName, 'var(--ok)');
            if (result.countIslands  != null) importLog('   Isole:   ' + result.countIslands);
            if (result.countCities   != null) importLog('   Città:   ' + result.countCities);
            if (result.countPlayers  != null) importLog('   Players: ' + result.countPlayers);
          }
          importLog('   ✅ Totale record: ' + n, n > 0 ? 'var(--ok)' : 'orange');

          // Aggiorna record raw nel DB con info diagnostica
          if (entryId) {
            try {
              const raw = await window.IkDB.get('entries', entryId);
              if (raw) {
                raw._parserName  = result?.parserName || (n > 0 ? 'ok' : 'none');
                raw._parserCount = n;
                raw._parserDate  = new Date().toISOString();
                await window.IkDB.put('entries', raw);
              }
            } catch {}
          }
        }

        importLog('✅ ' + file.name + ' completato', 'var(--ok)');
        toast('📂 ' + file.name + ': OK');
      } catch(e) {
        importLog('❌ Errore: ' + e.message, 'var(--red)');
        toast('❌ ' + file.name + ': ' + e.message);
        log('❌ Import ' + file.name + ': ' + e.message);
      }
    }

    input.value = '';
    await loadMapData();
    refreshActiveTab();
    updateStatusBar();
    importLog('──────────────────────');
    importLog('TOTALE importato: ' + total + ' record', total > 0 ? 'var(--ok)' : 'orange');
    if (total > 0) toast('✅ Importati ' + total + ' record');
  }

  window.IkApp = {
    init, toggle, toast, drawMap, mapReset, mapZoom,
    applyFilters, clearFilters, goToMe,
    closePopup, saveMyId, askNotifPerm, pruneOld,
    clearDB, clearChanges, importFiles, importLog,
    onRankingUpdated, onIslandsUpdated, onCitiesUpdated, onResourcesUpdated,
    dbSearch, clearRaw, renderAccount, selectCity,
    downloadRecord, downloadSearchResults, downloadLog, clearLog, renderLogTab,
    renderCaptured, downloadCaptured, downloadAllCaptured, clearCaptured,
    renderMyCities, resetMyCities, renderWineTimers,
    showBuildingsPopup, closeBuildingsPopup,
    onResearchUpdated, onFleetsUpdated, onTimerAdded,
    onTimerExpired, onStateChanges,
  };
  log('Modulo caricato');
})();

