// ═══════════════════════════════════════════════
// app.js — UI principale + intercettazione JSON
// v3.1.0
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // ── STATO ───────────────────────────────────
  let panelOpen    = false;
  let saveAllRaw   = false; // toggle: salva tutti i JSON intercettati in entries
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

      // Se "salva tutti i JSON grezzi" è attivo, salva anche quelli già parsati
      if (saveAllRaw && window.IkDB && result.type !== 'raw') {
        try {
          let actions = null;
          if (Array.isArray(parsed)) {
            actions = [...new Set(
              parsed.filter(it => Array.isArray(it)).map(it => String(it[0]))
            )].join(', ');
          }
          await window.IkDB.add('entries', {
            url, type: 'raw',
            date:         meta.date,
            server:       window.location.hostname,
            data:         parsed,
            _parserName:  result.type,
            _parserCount: result.parsed || 0,
            _actions:     actions,
          });
        } catch {}
      }

      // Auto-cleanup: elimina raw entries più vecchie di 30 minuti
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
        <div id="ikp-title">⚓ IKARIAM COMPANION<span>v3.2.0 - No Bridge</span></div>
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
        <div class="ikp-tab" data-tab="military" id="ikp-tab-btn-military">⚔️ Truppe</div>
        <div class="ikp-tab" data-tab="ranking" id="ikp-tab-btn-ranking">📊 Classifica</div>
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
              placeholder="🟠 Player o isola..."
              oninput="window.IkApp.applyFilters()">
            <input class="ikp-filter-input" id="ikp-f-ally"
              placeholder="🩷 Alleanza (tag esatto)..."
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
          <div style="display:flex;gap:8px;margin-top:8px;margin-bottom:6px;flex-wrap:wrap">
            <button class="ikp-btn small" onclick="window.IkApp.mapReset()">⌂ Reset</button>
            <button class="ikp-btn small" onclick="window.IkApp.mapZoom(1.4)">＋ Zoom</button>
            <button class="ikp-btn small" onclick="window.IkApp.mapZoom(0.7)">－ Zoom</button>
            <button class="ikp-btn small outline" onclick="window.IkApp.goToMe()">📍 Vai a me</button>
          </div>
          <!-- ── LEGENDA (tra mappa e popup) ── -->
          <div class="ikp-map-legend">
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#c9b182"></div>Vuota</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#7a5c35"></div>Player</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#00e676"></div>Mio</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#c6ff00"></div>Alleato</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#ff9100"></div>🟠&nbsp;Player</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#e91e8c"></div>🩷&nbsp;Alleanza</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#7c4dff"></div>🟣&nbsp;Rif.</div>
            <div class="ikp-legend-item"><div class="ikp-legend-dot" style="background:#ff1744"></div>🔴&nbsp;Entrambi</div>
          </div>
          <!-- ── POPUP POLIS ISOLA ── -->
          <div id="ikp-island-popup">
            <div id="ikp-popup-content">
              <div class="ikp-empty"><div class="ikp-empty-icon">🏝</div><p>Seleziona un'isola sulla mappa per vedere le sue polis.</p></div>
            </div>
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
            <div class="ikp-card-title" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center"
              onclick="var b=document.getElementById('ikp-completed-list');b.style.display=b.style.display==='none'?'block':'none';this.querySelector('.ikp-chev').textContent=b.style.display==='none'?'▸':'▾'">
              <span>✅ Completati (24h)</span>
              <span class="ikp-chev" style="font-size:11px;color:var(--text-muted)">▸</span>
            </div>
            <div id="ikp-completed-list" style="display:none">
              <div class="ikp-empty" style="padding:12px 0"><p style="font-size:12px;color:var(--text-muted)">Nessun timer completato nelle ultime 24h.</p></div>
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

        <!-- ══ TRUPPE / NAVI ══ -->
        <div class="ikp-section" id="ikp-tab-military">
          <div class="ikp-card">
            <div class="ikp-card-title">
              ⚔️ Truppe e navi per polis
              <button class="ikp-btn small outline" onclick="window.IkApp.renderMilitary()">↻</button>
            </div>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
              Apri la scheda "Truppe nella città" di ogni polis (Caserma/Cantiere
              Navale → Truppe) per popolare questa vista.
            </p>
            <div id="ikp-military-list">
              <div class="ikp-empty"><div class="ikp-empty-icon">⚔️</div><p>Nessun dato truppe ancora catturato.</p></div>
            </div>
          </div>

          <!-- ══ CALCOLATORE DANNO MURA ══ -->
          <div style="margin-top:10px;border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <div style="padding:8px 10px;background:var(--bg-alt);font-weight:700;font-size:13px;
                        display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none"
                 onclick="(function(){var b=document.getElementById('ikwc-body'),arr=document.getElementById('ikwc-arrow'),open=b.style.display!=='none';b.style.display=open?'none':'block';arr.textContent=open?'▶':'▼';})()">
              💥 Calcolo Splash
              <span id="ikwc-arrow" style="font-size:10px;color:var(--text-muted)">▶</span>
              <button class="ikp-btn small outline" style="margin-left:auto;font-size:11px"
                      onclick="event.stopPropagation();window.IkWallCalc.reset()">↺ Reset</button>
            </div>
            <div id="ikwc-body" class="ikp-card" style="display:none;margin:0;border:none;border-radius:0;box-shadow:none">
              <div style="padding:10px;border-top:1px solid var(--border)">
                <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
                  Calcola i danni all'artiglieria su più round. I potenziamenti officina vengono letti dal DB se disponibili.
                </p>

                <!-- INPUTS PRINCIPALI -->
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:10px">
                  <label style="font-size:12px">
                    ⛩ Liv. Efesto
                    <input id="ikwc-efesto" type="number" min="0" max="20" value="0"
                      style="width:100%;margin-top:3px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:13px"
                      oninput="window.IkWallCalc.compute()">
                  </label>
                  <label style="font-size:12px">
                    🏛 Liv. Municipio
                    <input id="ikwc-townhall" type="number" min="1" max="50" value="20"
                      style="width:100%;margin-top:3px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:13px"
                      oninput="window.IkWallCalc.compute()">
                  </label>
                  <label style="font-size:12px">
                    🏯 Liv. Mura
                    <input id="ikwc-wall" type="number" min="1" max="25" value="10"
                      style="width:100%;margin-top:3px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:13px"
                      oninput="window.IkWallCalc.compute()">
                  </label>
                </div>

                <!-- OVERRIDE POTENZIAMENTI OFFICINA -->
                <details style="margin-bottom:10px;font-size:12px">
                  <summary style="cursor:pointer;color:var(--text-muted);margin-bottom:6px">🔧 Potenziamenti officina (letti dal DB — espandi per override)</summary>
                  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px">
                    <label>🪨 Ariete liv. atk
                      <input id="ikwc-up-ram" type="number" min="0" max="3" value=""
                        placeholder="auto"
                        style="width:100%;margin-top:3px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:13px"
                        oninput="window.IkWallCalc.compute()">
                    </label>
                    <label>🪨 Catapulta liv. atk
                      <input id="ikwc-up-cat" type="number" min="0" max="3" value=""
                        placeholder="auto"
                        style="width:100%;margin-top:3px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:13px"
                        oninput="window.IkWallCalc.compute()">
                    </label>
                    <label>🪨 Mortaio liv. atk
                      <input id="ikwc-up-mor" type="number" min="0" max="3" value=""
                        placeholder="auto"
                        style="width:100%;margin-top:3px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:13px"
                        oninput="window.IkWallCalc.compute()">
                    </label>
                  </div>
                </details>

                <!-- UNITÀ PER ROUND -->
                <div style="font-size:12px;font-weight:600;margin-bottom:4px">🪖 Unità per round</div>
                <div id="ikwc-rounds-container" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"></div>
                <div style="display:flex;gap:6px;margin-bottom:12px">
                  <button class="ikp-btn small outline" onclick="window.IkWallCalc.addRound()">＋ Aggiungi round</button>
                  <button class="ikp-btn small outline" onclick="window.IkWallCalc.removeRound()">－ Rimuovi round</button>
                </div>

                <!-- RISULTATI -->
                <div id="ikwc-results"></div>
              </div>
            </div>
          </div>

          <!-- ══ VISUALIZZATORE REPORT COMBATTIMENTO ══ -->
          <div style="margin-top:10px;border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <div style="padding:8px 10px;background:var(--bg-alt);font-weight:700;font-size:13px;
                        display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none"
                 onclick="(function(){var b=document.getElementById('ikcr-body'),arr=document.getElementById('ikcr-arrow'),open=b.style.display!=='none';b.style.display=open?'none':'block';arr.textContent=open?'▶':'▼';if(open===false)window.IkApp.renderCombatReports();})()">
              ⚔️ Report Combattimento
              <span id="ikcr-arrow" style="font-size:10px;color:var(--text-muted)">▶</span>
              <button class="ikp-btn small outline" style="margin-left:auto;font-size:11px"
                      onclick="event.stopPropagation();window.IkApp.renderCombatReports()">↻</button>
            </div>
            <div id="ikcr-body" class="ikp-card" style="display:none;margin:0;border:none;border-radius:0;box-shadow:none">
              <div style="padding:10px;border-top:1px solid var(--border)">
                <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
                  <input id="ikcr-q" class="ikp-input" placeholder="Cerca player…"
                         style="flex:1;min-width:100px;font-size:12px"
                         oninput="window.IkApp.renderCombatReports()">
                  <select id="ikcr-type" style="padding:4px 6px;border:1px solid var(--border);
                          border-radius:4px;background:var(--bg);color:var(--text);font-size:12px"
                          onchange="window.IkApp.renderCombatReports()">
                    <option value="">Tutti</option>
                    <option value="naval">⛴ Navale</option>
                    <option value="land">🪖 Terra</option>
                  </select>
                </div>
                <div id="ikcr-list"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- ══ CLASSIFICA ══ -->
        <div class="ikp-section" id="ikp-tab-ranking">
          <div class="ikp-card">
            <div class="ikp-card-title">
              📊 Classifica
              <button class="ikp-btn small danger" onclick="window.IkApp.clearChanges()">🗑 Svuota stati</button>
            </div>
            <!-- summary compatto -->
            <div id="ikp-ranking-summary" style="display:flex;flex-wrap:wrap;gap:6px;
                 margin-bottom:10px;padding:6px 8px;background:var(--bg-alt);
                 border-radius:6px;font-size:12px;align-items:center">
              <span style="color:var(--text-muted)">Caricamento...</span>
            </div>
            <!-- filtri -->
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:center">
              <input id="ikp-chg-filter-name"  type="text"    placeholder="🔍 Nome player"
                     style="flex:1;min-width:100px;padding:4px 7px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:12px"
                     oninput="window.IkApp.renderChanges()">
              <input id="ikp-chg-filter-ally"  type="text"    placeholder="🏰 Alleanza"
                     style="flex:1;min-width:90px;padding:4px 7px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:12px"
                     oninput="window.IkApp.renderChanges()">
              <select id="ikp-chg-filter-type"
                      style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:12px"
                      onchange="window.IkApp.renderChanges()">
                <option value="">Tutti i tipi</option>
                <option value="score">Punteggio totale</option>
                <option value="building_score_main">Costruttori</option>
                <option value="building_score_secondary">Livelli edifici</option>
                <option value="research_score_main">Scienziati</option>
                <option value="research_score_secondary">Livelli ricerca</option>
                <option value="army_score_main">Generali</option>
                <option value="trader_score_secondary">Quantità oro</option>
                <option value="offense">Punti attacco</option>
                <option value="defense">Punti difesa</option>
                <option value="trade">Mercante</option>
                <option value="resources">Risorse</option>
                <option value="donations">Donazioni</option>
                <option value="pillaging">Saccheggio</option>
                <option value="piracy">Punti predatore</option>
                <option value="_all">👤 Cambi per giocatore (tutti)</option>
                <option value="_state">🔔 Solo cambi stato</option>
                <option value="_changes">⭐ Solo var. Generali/Attacco/Difesa</option>
                <option value="_ally">🏰 Solo cambi alleanza</option>
              </select>
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
          <div id="ikp-db-stats" style="display:grid;grid-template-columns:repeat(6,1fr);
               gap:5px;margin-bottom:12px"></div>

          <!-- Ricerca -->
          <div class="ikp-card" style="margin-bottom:10px">
            <div class="ikp-card-title">🔍 Ricerca nel DB</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
              <select id="ikp-db-store" class="ikp-input" style="flex:1;min-width:140px"
                      onchange="window.IkApp.dbSearch()">
                <option value="building_data">🏗 Dati edifici</option>
                <option value="unit_data">⚔️ Truppe/Navi</option>
                <option value="city_military">🪖 Truppe/Navi per polis</option>
                <option value="islands">🏝 Isole</option>
                <option value="my_cities">🏠 Mie città</option>
                <option value="account_summary">💰 Riepilogo account</option>
                <option value="enemy_buildings">🏢 Edifici nemici</option>
                <option value="players">👤 Players</option>
                <option value="state_changes">🔔 Cambi stato</option>
                <option value="score_changes">⭐ Var. punteggi</option>
                <option value="ally_changes">🏰 Cambi alleanza</option>
                <option value="combat_reports">⚔️ Rapporti combattimento</option>
                <option value="player_units">🪖 Truppe player</option>
                <option value="entries">📋 JSON raw</option>
              </select>
              <input class="ikp-input" id="ikp-db-q" placeholder="Cerca..."
                     oninput="window.IkApp.dbSearch()" style="flex:2;min-width:140px">
            </div>
            <div id="ikp-db-results"></div>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="ikp-btn danger small" onclick="window.IkApp.clearDB()">🗑 Svuota DB</button>
            <button class="ikp-btn danger small outline" onclick="window.IkApp.clearDbSection()" title="Svuota solo la sezione selezionata sopra">🗑 Svuota sezione</button>
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
            <div class="ikp-card-title">🗂 Cattura JSON</div>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
              Quando attivo, salva nel DB tutti i JSON intercettati (anche quelli già processati dai parser). Utile per analizzare nuovi tipi di dati. Disattiva quando hai finito per non riempire il DB.
            </p>
            <div style="display:flex;align-items:center;gap:10px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
                <input type="checkbox" id="ikp-save-all-raw"
                  onchange="window.IkApp.toggleSaveAllRaw(this.checked)"
                  style="width:18px;height:18px;cursor:pointer">
                Salva tutti i JSON grezzi
              </label>
              <span id="ikp-save-all-status" style="font-size:11px;color:var(--text-muted)"></span>
            </div>
          </div>
          <div class="ikp-card">
            <div class="ikp-card-title">💾 Storage</div>
            <div id="ikp-storage-info" style="font-size:13px;color:var(--text-dim)">Calcolo...</div>
            <button class="ikp-btn outline" style="margin-top:10px" onclick="window.IkApp.pruneOld()">🧹 Pulizia automatica</button>
          </div>
          <div class="ikp-card">
            <div class="ikp-card-title">⏳ Retention automatica</div>
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
              Elimina automaticamente i record più vecchi di N giorni. Lascia 0 per disabilitare.
            </p>
            <div style="display:flex;flex-direction:column;gap:8px">
              <label style="display:flex;align-items:center;gap:8px;font-size:13px">
                🔔 Cambi stato (state_changes)
                <input type="number" min="0" step="1" placeholder="0"
                       id="ikp-retention-state"
                       style="width:64px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:12px"
                       onchange="window.IkApp.saveRetention()">
                <span style="font-size:11px;color:var(--text-muted)">giorni</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px">
                ⭐ Var. Generali (score_changes)
                <input type="number" min="0" step="1" placeholder="0"
                       id="ikp-retention-score"
                       style="width:64px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:12px"
                       onchange="window.IkApp.saveRetention()">
                <span style="font-size:11px;color:var(--text-muted)">giorni</span>
              </label>
            </div>
            <div style="margin-top:10px;font-size:11px;color:var(--text-muted)" id="ikp-retention-status"></div>
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
      case 'military':  renderMilitary();  break;
      case 'ranking':   renderChanges();   break;
      case 'log':       renderLogTab();    break;
      case 'db':        renderDB();        break;
      case 'settings':  loadSettingsUI(); loadRetentionUI(); break;
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
  // Colori isola — tutti distinti su sfondo azzurro #6ec6e8
  const COLOR_EMPTY       = '#c9b182';  // sabbia         — isola vuota
  const COLOR_CITY        = '#7a5c35';  // marrone scuro  — con player
  const COLOR_ME          = '#00e676';  // verde brillante — mia polis
  const COLOR_ALLY        = '#c6ff00';  // lime brillante — alleato
  const COLOR_FILTER_NAME = '#ff9100';  // arancione       — filtro 🟠 player/isola
  const COLOR_FILTER_ALLY = '#e91e8c';  // magenta/rosa    — filtro 🩷 alleanza
  const COLOR_REF         = '#7c4dff';  // viola           — riferimento
  const COLOR_BOTH        = '#ff1744';  // rosso           — filtro + rif. insieme
  const COLOR_FILTER      = COLOR_FILTER_NAME; // alias legacy

  // Restituisce il tag alleanza del proprio account (lowercase), o null
  function getMyAlly() {
    if (!myPlayerName) return null;
    const pl = mapPlayers.get(myPlayerName.toLowerCase());
    const tag = pl?.ally || '';
    return tag ? tag.toLowerCase() : null;
  }

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
      if (p?.name) nameToState.set(p.name.toLowerCase(), p.status || p.state || 'active');
    }

    const myNameLow = myPlayerName ? myPlayerName.toLowerCase() : null;
    const myAlly    = getMyAlly(); // tag alleanza propria (lowercase) o null
    const r = Math.max(2, s * 0.45);

    for (const isl of mapIslands) {
      const { cx, cy } = worldToCanvas(isl.x, isl.y);
      if (cx < -r*3 || cx > W+r*3 || cy < -r*3 || cy > H+r*3) continue;

      const cities    = isl.cities || [];
      const hasCities = cities.length > 0;

      let isMe           = false;
      let hasAlly        = false;  // almeno un alleato sulla isola (non mio)
      let matchPlayerSrc = false;  // filtro 🟠 player/isola/stato
      let matchAllySrc   = false;  // filtro 🩷 alleanza
      let matchRef       = false;  // filtro 🟣 riferimento

      for (const city of cities) {
        const pname     = (city.player_name || '').toLowerCase();
        const pl        = mapPlayers.get(pname);
        const allyDb    = (pl?.ally || '').toLowerCase();
        const allyRaw   = (city.ally_name || '').toLowerCase();
        const allyEff   = allyDb || allyRaw; // preferisce DB (aggiornato da ranking)
        const pstate    = nameToState.get(pname) || 'active';

        if (myNameLow && pname === myNameLow)                     isMe = true;
        if (myAlly && allyEff === myAlly && pname !== myNameLow)  hasAlly = true;

        // Filtro 🟠 player/isola (campo "Player o isola")
        if (searchFilter && (pname.includes(searchFilter) || (isl.name||'').toLowerCase().includes(searchFilter))) matchPlayerSrc = true;
        if (stateFilter  && pstate === stateFilter)               matchPlayerSrc = true;
        if (noAllyFilter && !allyEff)                             matchPlayerSrc = true;

        // Filtro 🩷 alleanza (campo "Alleanza")
        if (allyFilter && allyEff === allyFilter)                 matchAllySrc = true;

        // Filtro 🟣 riferimento (campo "Riferimento")
        if (refFilter && (pname.includes(refFilter) || allyEff.includes(refFilter))) matchRef = true;
      }

      const matchFilter = matchPlayerSrc || matchAllySrc;

      // Priorità colore: me > entrambi-filtri > filtro-player > filtro-ally > rif. > alleato > city > vuota
      let color = hasCities ? COLOR_CITY : COLOR_EMPTY;
      let glow  = false;

      if (isMe) {
        color = COLOR_ME;          glow = true;
      } else if (matchFilter && matchRef) {
        color = COLOR_BOTH;        glow = true;
      } else if (matchPlayerSrc) {
        color = COLOR_FILTER_NAME; glow = true;
      } else if (matchAllySrc) {
        color = COLOR_FILTER_ALLY; glow = true;
      } else if (matchRef) {
        color = COLOR_REF;         glow = true;
      } else if (hasAlly) {
        color = COLOR_ALLY;        glow = true;
      }

      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
      ctx.fillStyle = color;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      if (glow) ctx.shadowBlur = 0;
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
    const cities  = isl.cities || [];
    const myAlly  = getMyAlly();
    const myNameL = myPlayerName ? myPlayerName.toLowerCase() : null;
    tt.innerHTML = `
      <div class="tt-title">${isl.name || `[${isl.x}:${isl.y}]`} [${isl.x}:${isl.y}]</div>
      ${isl.tgName     ? `<div class="tt-row"><span class="tt-label">Risorsa</span><span class="tt-value">${isl.tgName}</span></div>` : ''}
      ${isl.templeName ? `<div class="tt-row"><span class="tt-label">Tempio</span><span class="tt-value">${isl.templeName} Lv${isl.templeLevel||'?'}</span></div>` : ''}
      ${isl.woodLevel  ? `<div class="tt-row"><span class="tt-label">Falegnameria</span><span class="tt-value">Lv${isl.woodLevel}</span></div>` : ''}
      <div class="tt-row"><span class="tt-label">Polis</span><span class="tt-value">${cities.length}</span></div>
      ${cities.slice(0,5).map(c => {
        const pname   = (c.player_name||'').toLowerCase();
        const pl      = mapPlayers.get(pname);
        const stIcon  = { active:'🟢', inactive:'🟡', vacation:'🔵', banned:'🔴' }[pl?.status||pl?.state] || '⚪';
        const ally    = pl?.ally || c.ally_name || '—';
        const allyLow = (pl?.ally || c.ally_name || '').toLowerCase();
        const score   = pl?.scores?.score ?? Object.values(pl?.scores || {})[0];
        const scoreLabel = (score != null) ? Number(score).toLocaleString('it') : '—';
        const isMe    = myNameL && pname === myNameL;
        const isAlly  = !isMe && myAlly && allyLow === myAlly;
        const dot     = isMe ? '#00e676' : isAlly ? '#c6ff00' : null;
        return `<div class="tt-row"${dot ? ` style="border-left:2px solid ${dot};padding-left:4px"` : ''}>
          <span class="tt-label">${stIcon} ${c.player_name||'?'}</span>
          <span class="tt-value">${ally} · 🏆${scoreLabel}</span>
        </div>`;
      }).join('')}
      ${cities.length > 5 ? `<div style="font-size:11px;color:var(--text-muted);text-align:center">+${cities.length-5} altri</div>` : ''}
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
    const cities  = isl.cities || [];
    const el      = document.getElementById('ikp-popup-content');
    if (!el) return;

    const stateColors = {
      active:'#4caf50', inactive:'#ff9800',
      vacation:'#2196f3', banned:'#f44336', deleted:'#666',
    };
    const stateLabels = {
      active:'Attivo', inactive:'Inattivo',
      vacation:'Vacanza', banned:'Bannato', deleted:'Eliminato',
    };

    const info = [
      isl.tgName    ? `🎁 ${isl.tgName}`      : null,
      isl.templeName? `⛩ ${isl.templeName}`   : null,
      isl.woodLevel ? `🪵 Lv${isl.woodLevel}`  : null,
    ].filter(Boolean).join(' · ');

    const myNameLow  = myPlayerName ? myPlayerName.toLowerCase() : null;
    const myAlly     = getMyAlly();
    const isMyIsland = myNameLow && cities.some(c => (c.player_name||'').toLowerCase() === myNameLow);

    // Mappa stato per evidenziazioni filtro nel popup
    const nameToState = new Map();
    for (const [, p] of mapPlayers) {
      if (p?.name) nameToState.set(p.name.toLowerCase(), p.status || 'active');
    }

    el.innerHTML = `
      <div class="pop-title">🏝 ${isl.name || `[${isl.x}:${isl.y}]`}${isMyIsland
        ? ' <span style="color:#00e676;font-size:11px;font-weight:600">● mia isola</span>' : ''}</div>
      <div class="pop-sub">[${isl.x}:${isl.y}]${info ? ' · ' + info : ''}</div>
      ${cities.length === 0
        ? '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">Nessuna città nel DB.<br>Visita ikalogs.ru per popolare i dati.</p>'
        : cities.map(c => {
            const pname    = (c.player_name || '').toLowerCase();
            const pl       = mapPlayers.get(pname);
            const st       = pl?.status || pl?.state || 'active';
            const sc       = stateColors[st] || '#aaa';
            const slb      = stateLabels[st]  || st;

            // Alleanza: DB (aggiornato da ranking) ha precedenza su city.ally_name
            const allyTag  = pl?.ally || c.ally_name || '';
            const allyLow  = allyTag.toLowerCase();

            // Punteggio e posizione dal ranking
            const score    = pl?.scores?.score ?? Object.values(pl?.scores || {})[0];
            const scoreStr = (score != null) ? Number(score).toLocaleString('it') : null;
            const pos      = pl?.position?.score ?? null;

            // Classificazione per evidenziazione
            const isMyCity      = myNameLow && pname === myNameLow;
            const isAllyCity    = !isMyCity && myAlly && allyLow && allyLow === myAlly;
            const isOnMyIsland  = isMyIsland && !isMyCity; // altro player sulla mia isola

            const pstate = nameToState.get(pname) || 'active';
            let mFiltName = false, mFiltAlly = false, mRef = false;
            if (searchFilter && (pname.includes(searchFilter) || (isl.name||'').toLowerCase().includes(searchFilter))) mFiltName = true;
            if (stateFilter  && pstate === stateFilter)   mFiltName = true;
            if (noAllyFilter && !allyLow)                 mFiltName = true;
            if (allyFilter   && allyLow === allyFilter)   mFiltAlly = true;
            if (refFilter && (pname.includes(refFilter) || allyLow.includes(refFilter))) mRef = true;

            // Scegli bordo colorato (priorità)
            let rowBorder = '', badge = '';
            if (isMyCity) {
              rowBorder = 'border-left:3px solid #00e676;background:rgba(0,230,118,0.07)';
              badge = '<span style="font-size:10px;color:#00e676;font-weight:700;margin-left:5px">● IO</span>';
            } else if (mFiltName && mRef) {
              rowBorder = 'border-left:3px solid #ff1744;background:rgba(255,23,68,0.07)';
              badge = '<span style="font-size:10px;color:#ff1744;font-weight:700;margin-left:5px">🔴</span>';
            } else if (mFiltName) {
              rowBorder = 'border-left:3px solid #ff9100;background:rgba(255,145,0,0.07)';
              badge = '<span style="font-size:10px;color:#ff9100;font-weight:700;margin-left:5px">🟠</span>';
            } else if (mFiltAlly) {
              rowBorder = 'border-left:3px solid #e91e8c;background:rgba(233,30,140,0.07)';
              badge = '<span style="font-size:10px;color:#e91e8c;font-weight:700;margin-left:5px">🩷</span>';
            } else if (mRef) {
              rowBorder = 'border-left:3px solid #7c4dff;background:rgba(124,77,255,0.07)';
              badge = '<span style="font-size:10px;color:#7c4dff;font-weight:700;margin-left:5px">🟣</span>';
            } else if (isAllyCity) {
              rowBorder = 'border-left:3px solid #c6ff00;background:rgba(198,255,0,0.10)';
              badge = '<span style="font-size:10px;color:#c6ff00;font-weight:700;margin-left:5px">● ALT</span>';
            } else if (isOnMyIsland) {
              rowBorder = 'border-left:3px solid rgba(255,152,0,0.5);background:rgba(255,152,0,0.04)';
            }

            const safePlayerName = (c.player_name || '').replace(/'/g, "\\'");

            return `<div class="pop-city" style="${rowBorder}">
              <div class="pop-state" style="background:${sc}" title="${slb}"></div>
              <div style="flex:1;min-width:0">
                <div class="pop-city-name">${c.city_name || '?'}${badge}
                  <span style="font-size:11px;color:var(--text-muted)"> Lv${c.city_level||'?'}</span>
                </div>
                <div class="pop-player" style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
                  <span>👤 ${c.player_name || '?'}</span>
                  ${allyTag ? `<span style="font-size:11px;color:var(--text-dim);background:var(--bg);
                    padding:0 4px;border-radius:3px;border:1px solid var(--border)">${allyTag}</span>` : ''}
                  <span style="font-size:11px;color:var(--text-muted)">${slb}</span>
                </div>
                ${scoreStr ? `<div style="font-size:11px;color:var(--text-dim);margin-top:1px">🏆 ${scoreStr}${pos ? ` · #${pos}` : ''}</div>` : ''}
              </div>
              <button class="ikp-btn small outline" style="flex-shrink:0;padding:4px 7px;font-size:13px"
                onclick="window.IkApp.showPlayerDetail('${safePlayerName}')" title="Dettagli player">📊</button>
            </div>`;
          }).join('')
      }
    `;
  }

  // ── DETTAGLIO PLAYER (aperto dal pulsante 📊 nel popup) ──
  // ── TRUPPE E POTENZIAMENTI PLAYER (pulsante 🪖 nella classifica) ──
  async function showPlayerUnits(playerId, playerName) {
    // Rimuovi eventuale popup precedente
    const existing = document.getElementById('ikp-player-units-overlay');
    if (existing) existing.remove();

    // Crea overlay modale bianco (stesso approccio di showPlayerDetail)
    const overlay = document.createElement('div');
    overlay.id = 'ikp-player-units-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);
      display:flex;align-items:flex-end;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#ffffff;border-radius:14px 14px 0 0;width:100%;max-width:520px;
        max-height:75vh;overflow-y:auto;padding:16px 16px 24px;
        box-shadow:0 -4px 24px rgba(0,0,0,0.3);box-sizing:border-box;color:#2c1f0e">
        <div style="padding:12px 0 8px;font-size:13px;color:#9e8060">⏳ Caricamento truppe di <b style="color:#2c1f0e">${playerName}</b>…</div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const innerDiv = overlay.querySelector('div');

    let rec = null;
    if (window.IkDB) {
      // Prova prima per playerId, poi per nome
      try { rec = await window.IkDB.get('player_units', playerId); } catch {}
      if (!rec) {
        try {
          const all  = await window.IkDB.getAll('player_units');
          const clean = playerName.toLowerCase().replace(/\s*\[[^\]]+\]$/, '').trim();
          rec = all.find(r =>
            r.playerName?.toLowerCase().replace(/\s*\[[^\]]+\]$/, '').trim() === clean
          ) || null;
        } catch {}
      }
    }

    const closeBtnHtml = `<button onclick="document.getElementById('ikp-player-units-overlay').remove()"
      style="background:none;border:1px solid #d4c5a9;border-radius:16px;padding:6px 14px;
             font-size:12px;color:#6b4f2e;cursor:pointer;margin-top:12px">Chiudi</button>`;

    if (!rec || !rec.units || !Object.keys(rec.units).length) {
      innerDiv.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-weight:700;font-size:14px;color:#2c1f0e">🪖 ${playerName}</div>
          <button onclick="document.getElementById('ikp-player-units-overlay').remove()"
            style="background:none;border:none;font-size:20px;color:#9e8060;cursor:pointer;padding:0 4px;line-height:1">✕</button>
        </div>
        <p style="font-size:12px;color:#9e8060">
          Nessun dato truppe. Naviga un report di combattimento che lo include.
        </p>
        ${closeBtnHtml}`;
      return;
    }

    const units    = Object.values(rec.units);
    const withUpg  = units.filter(u => u.upgrades && Object.keys(u.upgrades).length > 0);
    const noUpg    = units.filter(u => !u.upgrades || Object.keys(u.upgrades).length === 0);

    const renderUnit = u => {
      const upgs = Object.values(u.upgrades || {});
      const upgsHtml = upgs.map(upg =>
        `<div style="font-size:11px;color:#9e8060;margin-left:8px">
          └ ${upg.name}: <b style="color:#8b5e3c">lv ${upg.level}</b>
        </div>`
      ).join('');
      return `
        <div style="padding:6px 0;border-bottom:1px solid #d4c5a9">
          <div style="font-size:12px;font-weight:600;color:#2c1f0e">
            ${u.unitName}
            ${u.maxCount ? `<span style="font-size:11px;color:#9e8060;font-weight:400"> · max ${u.maxCount.toLocaleString('it')}</span>` : ''}
            ${u.totalLosses ? `<span style="font-size:11px;color:#c62828;font-weight:400"> · perdite ${u.totalLosses.toLocaleString('it')}</span>` : ''}
          </div>
          ${upgsHtml}
        </div>`;
    };

    const lastSeen = rec.lastSeen ? fmt(rec.lastSeen) : '—';
    const allyStr  = rec.allyName && rec.allyName !== '—' ? ` [${rec.allyName}]` : '';
    const unresolvedWarn = rec.unresolvedName
      ? `<div style="font-size:11px;color:#c62828;margin-bottom:6px">⚠️ ID player non risolto — dati collegati per nome</div>`
      : '';

    innerDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-weight:700;font-size:14px;color:#2c1f0e">🪖 ${playerName}${allyStr}</div>
          <div style="font-size:11px;color:#9e8060;margin-top:2px">
            ID: ${rec.playerId} · Ultimo visto: ${lastSeen}
          </div>
        </div>
        <button onclick="document.getElementById('ikp-player-units-overlay').remove()"
          style="background:none;border:none;font-size:20px;color:#9e8060;cursor:pointer;padding:0 4px;line-height:1">✕</button>
      </div>
      ${unresolvedWarn}

      ${withUpg.length ? `
        <div style="font-weight:600;font-size:12px;margin-bottom:4px;color:#8b5e3c">
          ⬆️ Unità con potenziamenti noti (${withUpg.length})
        </div>
        ${withUpg.map(renderUnit).join('')}
      ` : ''}

      ${noUpg.length ? `
        <div style="font-weight:600;font-size:12px;margin:10px 0 4px;color:#9e8060">
          Altre unità note — senza dati upgrades (${noUpg.length})
        </div>
        <div style="font-size:11px;color:#9e8060">
          ${noUpg.map(u => `${u.unitName}${u.maxCount ? ` (max ${u.maxCount})` : ''}`).join(' · ')}
        </div>
      ` : ''}

      ${rec.combatHistory?.length ? `
        <div style="font-size:11px;color:#9e8060;margin-top:10px">
          📋 ${rec.combatHistory.length} combattimento/i nel DB
        </div>
      ` : ''}

      ${closeBtnHtml}`;
  }

  function showPlayerDetail(playerName) {
    // Cerca il player nel DB (mapPlayers è indicizzato per nome lowercase)
    const pl = mapPlayers.get(playerName.toLowerCase());

    // Raccoglie tutte le polis di questo player su tutte le isole caricate
    const polis = [];
    for (const isl of mapIslands) {
      for (const c of (isl.cities || [])) {
        if ((c.player_name || '').toLowerCase() === playerName.toLowerCase()) {
          polis.push({ ...c, islandX: isl.x, islandY: isl.y, islandName: isl.name || `[${isl.x}:${isl.y}]` });
        }
      }
    }
    polis.sort((a, b) => a.islandX - b.islandX || a.islandY - b.islandY);

    const stateLabels = { active:'Attivo', inactive:'Inattivo', vacation:'Vacanza', banned:'Bannato', deleted:'Eliminato' };
    const stateColors = { active:'#4caf50', inactive:'#ff9800', vacation:'#2196f3', banned:'#f44336', deleted:'#666' };
    const st    = pl?.status || pl?.state || 'active';
    const stLbl = stateLabels[st] || st;
    const stCol = stateColors[st] || '#aaa';

    // Punteggi dal DB ranking
    const scores   = pl?.scores   || {};
    const positions= pl?.position || {};
    const scoreRows = Object.entries(scores).map(([k, v]) => {
      const pos = positions[k];
      const label = { score:'Totale', generals:'Generali', admirals:'Ammiragli', scientists:'Scienziati', builders:'Costruttori', diplomats:'Diplomatici' }[k] || k;
      return `<tr>
        <td style="color:#9e8060;padding:3px 8px 3px 0">${label}</td>
        <td style="font-weight:600;text-align:right;color:#2c1f0e">${Number(v).toLocaleString('it')}</td>
        <td style="color:#9e8060;text-align:right;padding-left:8px">${pos != null ? '#'+pos : '—'}</td>
      </tr>`;
    }).join('');

    const allyTag = pl?.ally || '';
    const honor   = pl?.honorTitle || '';

    // Mostra in un overlay/modal sopra il popup
    const existing = document.getElementById('ikp-player-detail-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ikp-player-detail-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);
      display:flex;align-items:flex-end;justify-content:center;
    `;
    overlay.innerHTML = `
      <div>
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <div style="font-size:16px;font-weight:700;color:#2c1f0e">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;
                background:${stCol};margin-right:6px;vertical-align:middle"></span>
              ${playerName}
            </div>
            ${allyTag ? `<div style="font-size:12px;color:#6b4f2e;margin-top:2px">🛡 ${allyTag}</div>` : ''}
            ${honor   ? `<div style="font-size:11px;color:#9e8060;font-style:italic">${honor}</div>` : ''}
            <div style="font-size:11px;color:${stCol};margin-top:2px">${stLbl}</div>
          </div>
          <button onclick="document.getElementById('ikp-player-detail-overlay').remove()"
            style="background:none;border:none;font-size:20px;color:#9e8060;cursor:pointer;padding:0 4px;line-height:1">✕</button>
        </div>

        ${scoreRows ? `
        <!-- Punteggi classifica -->
        <div style="font-size:11px;font-weight:700;color:#9e8060;text-transform:uppercase;
          letter-spacing:.5px;margin-bottom:6px">🏆 Classifica</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px">
          <thead>
            <tr style="font-size:10px;color:#9e8060">
              <th style="text-align:left;padding-bottom:4px">Categoria</th>
              <th style="text-align:right">Punti</th>
              <th style="text-align:right;padding-left:8px">Posizione</th>
            </tr>
          </thead>
          <tbody>${scoreRows}</tbody>
        </table>` : `<div style="font-size:12px;color:#9e8060;margin-bottom:14px">
          ℹ️ Dati classifica non disponibili — naviga la classifica in gioco per caricarli.
        </div>`}

        <!-- Lista polis -->
        <div style="font-size:11px;font-weight:700;color:#9e8060;text-transform:uppercase;
          letter-spacing:.5px;margin-bottom:6px">🏛 Polis (${polis.length})</div>
        ${polis.length === 0
          ? `<div style="font-size:12px;color:#9e8060">Nessuna polis nel DB — visita ikalogs.ru per popolare i dati.</div>`
          : `<table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="font-size:10px;color:#9e8060;border-bottom:1px solid #d4c5a9">
                  <th style="text-align:left;padding-bottom:4px">Città</th>
                  <th style="text-align:center">Lv</th>
                  <th style="text-align:right">Coord</th>
                  <th style="text-align:left;padding-left:8px">Isola</th>
                </tr>
              </thead>
              <tbody>
                ${polis.map((p, i) => `
                  <tr style="border-bottom:1px solid #d4c5a9;${i % 2 === 0 ? 'background:#f5f0e8' : 'background:#ffffff'}">
                    <td style="padding:4px 4px 4px 0;color:#2c1f0e">${p.city_name || '?'}</td>
                    <td style="text-align:center;color:#9e8060">${p.city_level || '?'}</td>
                    <td style="text-align:right;font-family:monospace;font-size:11px;color:#8b5e3c">[${p.islandX}:${p.islandY}]</td>
                    <td style="padding-left:8px;color:#6b4f2e;font-size:11px">${p.islandName}</td>
                  </tr>`).join('')}
              </tbody>
            </table>`}
      </div>
    `;

    // Chiudi toccando lo sfondo
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    // Appende direttamente in body con z-index massimo, sopra tutto (incluso #ikp-panel)
    document.body.appendChild(overlay);
  }

  function closePopup() {
    popupIsland = null;
    const el = document.getElementById('ikp-popup-content');
    if (el) {
      el.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">🏝</div><p>Seleziona un'isola sulla mappa per vedere le sue polis.</p></div>`;
    }
    // Rimuovi overlay truppe player se aperto
    document.getElementById('ikp-player-units-overlay')?.remove();
    document.getElementById('ikp-player-detail-overlay')?.remove();
    hideTooltip();
  }

  // ── TIMER ─────────────────────────────────────
  async function renderTimers() {
    const list = document.getElementById('ikp-timer-list');
    if (list && window.IkNotifier) {
      const active = window.IkNotifier.getActive();
      if (!active.length) {
        list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">⏳</div><p>Nessun timer attivo.<br>Apri città e avvia costruzioni.</p></div>`;
      } else {
        const icons = { building:'🏗', research:'🔬', fleet_enemy:'⚔️', transport:'🚛', deploy:'🪖', deployfleet:'⛴', shrine:'⛩' };
        list.innerHTML = active.map(t => {
          // Label building ha formato: "🏗 NomeCittà — NomeEdificio LvX → LvY"
          // Label transport/deploy ha formato: "🚛/🪖 Origine → Target (N navi) — dettaglio carico"
          let mainLabel = t.label;
          let subLabel  = t.type;
          if (t.type === 'building') {
            const dashIdx = t.label.indexOf(' — ');
            if (dashIdx !== -1) {
              mainLabel = t.label.slice(0, dashIdx);
              subLabel  = t.label.slice(dashIdx + 3);
            }
          } else if (t.type === 'research') {
            subLabel = 'Ricerca';
          } else if (t.type === 'fleet_enemy') {
            subLabel = '⚠️ Flotta nemica';
          } else if (t.type === 'transport' || t.type === 'deploy' || t.type === 'deployfleet') {
            const dashIdx = t.label.indexOf(' — ');
            if (dashIdx !== -1) {
              mainLabel = t.label.slice(0, dashIdx);
              subLabel  = t.label.slice(dashIdx + 3); // carico/truppe/navi, o vuoto se non note
            } else {
              subLabel = t.type === 'deploy' ? 'Schieramento truppe'
                       : t.type === 'deployfleet' ? 'Trasferimento flotta' : 'Trasporto merci';
            }
          } else if (t.type === 'shrine') {
            // Label formato: "⛩ NomeDio — XX%" (o senza percentuale se non disponibile)
            const dashIdx = t.label.indexOf(' — ');
            if (dashIdx !== -1) {
              mainLabel = t.label.slice(0, dashIdx);
              subLabel  = `Favore divino: ${t.label.slice(dashIdx + 3)}`;
            } else {
              subLabel = 'Favore divino';
            }
          }
          const endStr = window.IkNotifier.formatEndDateTime(t.endTime);
          return `<div class="ikp-timer">
            <div class="ikp-timer-icon">${icons[t.type]||'⏰'}</div>
            <div class="ikp-timer-info">
              <div class="ikp-timer-label">${mainLabel}</div>
              <div class="ikp-timer-sub">${subLabel}</div>
              <div class="ikp-timer-sub" style="opacity:0.7">🕐 termina ${endStr}</div>
            </div>
            <div class="ikp-timer-time ${t.msLeft < 300000 ? 'urgent' : ''}" data-id="${t.id}">
              ${window.IkNotifier.formatTime(t.msLeft)}
            </div>
          </div>`;
        }).join('');
      }
    }
    await renderCompletedTimers();
    await renderWineTimers();
  }

  // ── TIMER COMPLETATI (ultime 24h) ─────────────
  async function renderCompletedTimers() {
    const list = document.getElementById('ikp-completed-list');
    if (!list || !window.IkNotifier) return;

    const completed = await window.IkNotifier.getCompleted();
    if (!completed.length) {
      list.innerHTML = `<div class="ikp-empty" style="padding:12px 0"><p style="font-size:12px;color:var(--text-muted)">Nessun timer completato nelle ultime 24h.</p></div>`;
      return;
    }

    const icons = { building:'🏗', research:'🔬', fleet_enemy:'⚔️', transport:'🚛', deploy:'🪖', deployfleet:'⛴', shrine:'⛩' };
    list.innerHTML = completed.map(t => {
      let mainLabel = t.label, subLabel = '';
      if (t.type === 'building' || t.type === 'transport' || t.type === 'deploy' || t.type === 'deployfleet' || t.type === 'shrine') {
        const dashIdx = (t.label || '').indexOf(' — ');
        if (dashIdx !== -1) {
          mainLabel = t.label.slice(0, dashIdx);
          subLabel  = t.label.slice(dashIdx + 3);
        }
      }
      const ago = formatAgo(Date.now() - (t.completedAt || 0));
      return `<div class="ikp-timer" style="opacity:0.7">
        <div class="ikp-timer-icon">${icons[t.type] || '✅'}</div>
        <div class="ikp-timer-info">
          <div class="ikp-timer-label">${mainLabel}</div>
          <div class="ikp-timer-sub">${subLabel || t.type}</div>
        </div>
        <div class="ikp-timer-time" style="font-size:11px;color:var(--text-muted)">
          ${ago}
        </div>
      </div>`;
    }).join('');
  }

  // Formatta "quanto tempo fa" in italiano breve
  function formatAgo(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 1)  return 'ora';
    if (min < 60) return `${min}m fa`;
    const h = Math.floor(min / 60);
    if (h < 24)   return `${h}h fa`;
    return `${Math.floor(h/24)}g fa`;
  }

  // ── ESAURIMENTO VINO ─────────────────────────────
  // Stima per ogni polis: tempo rimanente = vino attuale / consumo NETTO
  // (consumo - produzione). Se la polis produce vino (tradegood=vino) e la
  // produzione oraria copre o supera il consumo, il vino non si esaurisce mai (∞).
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

    // Calcola consumo netto = consumo - produzione (mai sotto zero)
    const rows = withWine.map(c => {
      const prod     = c.wineProduction || 0;  // produzione oraria (solo se la polis produce vino)
      const spend    = c.wineSpendings  || 0;
      const netSpend = Math.max(0, spend - prod);

      let hoursLeft;
      if (netSpend <= 0) {
        hoursLeft = Infinity; // produzione ≥ consumo: non si esaurisce mai
      } else {
        hoursLeft = c.wine / netSpend;
      }
      return { ...c, hoursLeft, prod, netSpend };
    }).sort((a, b) => (a.hoursLeft ?? Infinity) - (b.hoursLeft ?? Infinity));

    list.innerHTML = rows.map(c => {
      const coords = (c.islandX != null && c.islandY != null) ? `${c.islandX}:${c.islandY}` : '—';
      const wine   = Math.round(c.wine).toLocaleString('it');
      const spend  = c.wineSpendings.toLocaleString('it');
      const prodLabel = c.prod > 0 ? ` · produzione +${c.prod.toLocaleString('it')}/h` : '';

      let timeLabel, urgent = false, endStr = '';
      if (c.hoursLeft === Infinity) {
        timeLabel = '∞';
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
        endStr = window.IkNotifier?.formatEndDateTime?.(Date.now() + c.hoursLeft * 3600000) || '';
      }

      return `<div class="ikp-timer">
        <div class="ikp-timer-icon">🍷</div>
        <div class="ikp-timer-info">
          <div class="ikp-timer-label">${c.name || '?'} <span style="color:var(--text-muted);font-size:11px">[${coords}]</span></div>
          <div class="ikp-timer-sub">${wine} vino · consumo ${spend}/h${prodLabel}</div>
          ${endStr ? `<div class="ikp-timer-sub" style="opacity:0.7">🕐 esaurito ${endStr}</div>` : ''}
        </div>
        <div class="ikp-timer-time ${urgent ? 'urgent' : ''}" style="${c.hoursLeft === Infinity ? 'font-size:22px;letter-spacing:-1px' : ''}">
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

    // Pre-carica building_data indicizzato per buildingType
    const allBuildingData = await window.IkDB.getAll('building_data');
    const buildingDataByType = new Map(allBuildingData.map(b => [b.buildingType, b]));

    // Edifici che riducono il costo di costruzione (buildingType → risorsa ridotta)
    const REDUCTION_MAP = {
      carpentering:  'wood',       // carpenteria → legno
      architect:     'tradegood',  // ufficio architetto → marmo/bene
      vineyard:      'wine',       // cantina → vino (non usato nelle costruzioni ma previsto)
      optician:      'tradegood',  // ottico → cristallo (bene commerciale)
      fireworker:    'tradegood',  // officina/zona pirotecnica → zolfo (bene commerciale)
      stonemason:    'tradegood',  // tagliapietra → marmo (bene commerciale)
      forester:      'wood',       // casa guardiaboschi → legno
      glassblowing:  'tradegood',  // vetraio → cristallo (bene commerciale)
      winegrower:    'wine',       // torchio → vino
    };

    // Calcola % riduzione per ogni risorsa dato l'elenco edifici di una città
    function getReductions(buildings) {
      const red = { wood: 0, tradegood: 0 };
      for (const b of (buildings || [])) {
        const resource = REDUCTION_MAP[b.building];
        if (resource && b.level > 0) {
          red[resource] = Math.min(50, red[resource] + b.level);
        }
      }
      return red;
    }

    // Estrae i livelli degli edifici "chiave" da mostrare in tabella principale
    function getKeyLevels(buildings) {
      const byType = new Map((buildings || []).map(b => [b.building, b]));
      return {
        townHall: byType.get('townHall')?.level ?? null,
        wall:     byType.get('wall')?.level ?? null,
        barracks: byType.get('barracks')?.level ?? null,
        shipyard: byType.get('shipyard')?.level ?? null,
      };
    }

    // Indicatori a pallino per edifici "da monitorare" nella tabella espandibile:
    //  - Nascondiglio: 🔴 se livello ≤ municipio (vulnerabile a spionaggio), 🟢 altrimenti
    //  - Carpenteria/Ufficio Architetto/Cantina/Officina/Ottico: 🟡 se livello < 50, 🟢 altrimenti
    const YELLOW_THRESHOLD_TYPES = new Set(['carpentering', 'architect', 'vineyard', 'fireworker', 'optician']);
    function buildingDot(b, townHallLevel) {
      if (b.building === 'safehouse') {
        const ok = townHallLevel == null || b.level > townHallLevel;
        return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;
          background:${ok ? '#4caf50' : '#f44336'};margin-right:5px" title="${ok ? 'OK' : 'Livello ≤ Municipio: vulnerabile'}"></span>`;
      }
      if (YELLOW_THRESHOLD_TYPES.has(b.building)) {
        const ok = b.level >= 50;
        return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;
          background:${ok ? '#4caf50' : '#ffc107'};margin-right:5px" title="${ok ? 'Lv 50 raggiunto' : 'Sotto Lv 50'}"></span>`;
      }
      return '';
    }

    // Formatta numero grande
    function fmtN(n) {
      if (n == null || isNaN(n)) return '—';
      if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
      if (n >= 1e3) return Math.round(n).toLocaleString('it');
      return String(Math.round(n));
    }

    // Formatta una durata in ms come "Xg Yh", "Xh Ym" o "Xm" compatto
    function fmtDuration(ms) {
      if (!ms || ms <= 0) return '0m';
      const totalMin = Math.ceil(ms / 60000);
      const days  = Math.floor(totalMin / 1440);
      const hours = Math.floor((totalMin % 1440) / 60);
      const mins  = totalMin % 60;
      if (days)  return `${days}g ${hours}h`;
      if (hours) return `${hours}h ${mins}m`;
      return `${mins}m`;
    }

    // Filtra record fantasma
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

    const BICONS = {
      townHall:'🏛', warehouse:'🏪', tavern:'🍺', academy:'🎓',
      shipyard:'⚓', barracks:'⚔️', wall:'🏰', museum:'🖼',
      palace:'👑', palaceColony:'👑', branchOffice:'🏢', temple:'⛩', beautification:'🌸',
      luxuryResidence:'🏠', embassy:'📜', carpentering:'🪚',
      optician:'🫙', glassblowing:'💎', alchemistTower:'⚗️', fireworker:'💣',
      workshop:'🔧', forester:'🌲', vineyard:'🍇', winegrower:'🍇', stonemason:'⛏',
      port:'⚓', dump:'🗑', architect:'📐', safehouse:'🕵️',
    };

    const rows = cities.map((c, idx) => {
      const coords  = (c.islandX != null && c.islandY != null) ? `${c.islandX}:${c.islandY}` : '—';
      const tgName  = c.tgName || '—';
      const tgPerHr = (c.tgPerHour != null) ? c.tgPerHour.toLocaleString('it') : '—';
      const wood    = (c.woodPerHour != null) ? Math.round(c.woodPerHour).toLocaleString('it') : '—';
      const sciUp   = (c.scientistsUpkeep != null) ? c.scientistsUpkeep.toLocaleString('it') : '—';
      const wineSp  = (c.wineSpendings != null) ? c.wineSpendings.toLocaleString('it') : '—';
      if (c.wineSpendings != null) totalWine += c.wineSpendings;
      let citFree = '—', citBusy = '—';
      if (c.citizens != null && c.population != null) {
        citFree = Math.round(c.citizens).toLocaleString('it');
        citBusy = Math.round(c.population - c.citizens).toLocaleString('it');
      }

      // Tabella edifici espandibile
      const buildings  = c.buildings || [];
      const occupied   = buildings.filter(b => b.building);
      const emptyCount = buildings.filter(b => !b.building).length;
      const detailId   = `ikp-brow-${idx}`;

      // Riduzioni costo per questa città
      const red = getReductions(buildings);

      // Livelli edifici chiave per la tabella principale
      const keyLevels = getKeyLevels(buildings);

      // Quantità risorse disponibili in questa città, per il check "sufficiente"
      const TG_NAME_TO_KEY = { vino: 'wine', marmo: 'marble', cristallo: 'crystal', zolfo: 'sulfur' };
      const tgKey = TG_NAME_TO_KEY[(c.tgName || '').toLowerCase()] || null;
      const available = {
        wood:      c.wood ?? 0,
        tradegood: tgKey ? (c[tgKey] ?? null) : null,
      };
      // Produzione oraria, per calcolare il tempo di attesa se le risorse non bastano
      const production = {
        wood:      c.woodPerHour ?? 0,
        tradegood: c.tgPerHour   ?? 0,
      };

      let bContent;
      if (!occupied.length) {
        bContent = `<td colspan="14" style="padding:10px;font-size:12px;color:var(--text-muted)">Dati edifici non ancora disponibili. Visita questa città nel gioco.</td>`;
      } else {
        const bRows = [
          ...occupied.map(b => {
            const icon = BICONS[b.building] || '🏗';
            const dot  = buildingDot(b, keyLevels.townHall);

            // Costo prossimo livello da building_data (chiavi reali: wood/wine/marble/crystal/sulfur)
            let costHtml = '<span style="color:var(--text-muted)">—</span>';
            let rowHighlight = '';
            if (!b.isMaxLevel) {
              const bd = buildingDataByType.get(b.building);
              if (bd) {
                const nextLevel = bd.levels?.find(l => l.level === b.level + 1);
                if (nextLevel) {
                  // Trova tutte le colonne-risorsa richieste da questo edificio (wood/wine/marble/crystal/sulfur)
                  const RESOURCE_KEYS = ['wood', 'wine', 'marble', 'crystal', 'sulfur'];
                  const RESOURCE_ICONS = { wood:'🪵', wine:'🍷', marble:'🪨', crystal:'🔷', sulfur:'🟡' };
                  const parts = [];
                  let allSufficient = true;
                  let maxWaitMs = 0;
                  let hasAnyCost = false;

                  for (const rk of RESOURCE_KEYS) {
                    const base = nextLevel[rk];
                    if (base == null || base === 0) continue;
                    hasAnyCost = true;
                    // Riduzione: 'wood' usa red.wood, le altre 4 risorse (bene commerciale)
                    // usano red.tradegood se è quella prodotta dalla città
                    const reduction = rk === 'wood' ? red.wood : (rk === tgKey ? red.tradegood : 0);
                    const final = base * (1 - reduction / 100);

                    const haveQty = rk === 'wood' ? available.wood : (rk === tgKey ? available.tradegood : null);
                    const sufficient = haveQty != null && haveQty >= final;
                    if (!sufficient) allSufficient = false;

                    // Tempo di attesa se la città produce questa risorsa e non basta ancora
                    let waitLabel = '';
                    if (!sufficient && haveQty != null) {
                      const prodRate = rk === 'wood' ? production.wood : (rk === tgKey ? production.tradegood : 0);
                      if (prodRate > 0) {
                        const missing = final - haveQty;
                        const waitMs  = (missing / prodRate) * 3600000;
                        maxWaitMs = Math.max(maxWaitMs, waitMs);
                        waitLabel = ` <span style="color:#ff9100;font-size:10px">⏳${fmtDuration(waitMs)}</span>`;
                      }
                    }

                    const reducedNote = reduction > 0 ? ` <span style="color:#4caf50;font-size:10px">(-${reduction}%)</span>` : '';
                    const qtyColor = haveQty == null ? 'inherit' : (sufficient ? '#4caf50' : 'inherit');
                    parts.push(`${RESOURCE_ICONS[rk]} <span style="color:${qtyColor}">${fmtN(final)}</span>${reducedNote}${waitLabel}`);
                  }

                  if (nextLevel.time) parts.push(`⏱ ${nextLevel.time}`);
                  costHtml = parts.join(' &nbsp;');

                  // Evidenzia la riga in verde se tutte le risorse necessarie sono già disponibili
                  if (hasAnyCost && allSufficient) {
                    rowHighlight = 'background:rgba(76,175,80,0.12)';
                  }
                } else if (bd.levels?.length > 0) {
                  costHtml = '<span style="color:var(--text-muted);font-size:11px">Dati non disp.</span>';
                }
              } else {
                costHtml = '<span style="color:var(--text-muted);font-size:11px">Apri aiuto edificio</span>';
              }
            }

            return `<tr style="${rowHighlight}">
              <td style="padding-left:28px">${dot}${icon} ${b.name || b.building}</td>
              <td style="text-align:center;font-weight:700">${b.level}</td>
              <td style="font-size:12px">${costHtml}</td>
            </tr>`;
          }),
          ...Array(emptyCount).fill(0).map(() =>
            `<tr style="color:var(--text-muted)">
              <td style="padding-left:28px">⬜ Slot vuoto</td>
              <td style="text-align:center">—</td>
              <td></td>
            </tr>`
          ),
        ].join('');

        // Mostra riduzioni attive per questa città
        const redNote = [
          red.wood > 0      ? `🪵 legno -${red.wood}%` : '',
          red.tradegood > 0 ? `🔨 bene -${red.tradegood}%` : '',
        ].filter(Boolean).join(' · ');

        bContent = `<td colspan="14" style="padding:0">
          <table class="ikp-db-table" style="border-top:none">
            <thead><tr style="background:var(--bg)">
              <th>Edificio</th>
              <th style="text-align:center">Lv</th>
              <th>Costo prossimo livello${redNote ? ` <span style="color:#4caf50;font-weight:400;font-size:10px">(${redNote})</span>` : ''}</th>
            </tr></thead>
            <tbody>${bRows}</tbody>
          </table>
          <div style="font-size:11px;color:var(--text-muted);padding:4px 8px">${occupied.length} edifici · ${emptyCount} slot vuoti</div>
        </td>`;
      }

      return `<tr style="cursor:pointer" onclick="var r=document.getElementById('${detailId}');r.style.display=r.style.display==='none'?'table-row':'none'">
        <td>${c.cityId}</td>
        <td>${coords}</td>
        <td>${c.name || '—'}</td>
        <td style="text-align:center">${keyLevels.townHall ?? '—'}</td>
        <td style="text-align:center">${keyLevels.wall ?? '—'}</td>
        <td style="text-align:center">${keyLevels.barracks ?? '—'}</td>
        <td style="text-align:center">${keyLevels.shipyard ?? '—'}</td>
        <td>${tgName}</td>
        <td style="text-align:right">${tgPerHr}</td>
        <td style="text-align:right">${wood}</td>
        <td style="text-align:right">${wineSp}</td>
        <td style="text-align:right">${sciUp}</td>
        <td style="text-align:right">${citFree}</td>
        <td style="text-align:right">${citBusy}</td>
      </tr>
      <tr id="${detailId}" style="display:none;background:var(--bg)">
        ${bContent}
      </tr>`;
    }).join('');

    list.innerHTML = summaryHtml + `
      <div style="overflow-x:auto">
        <table class="ikp-db-table">
          <thead><tr>
            <th>ID</th><th>X:Y</th><th>Nome</th>
            <th style="text-align:center" title="Municipio">🏛 Mun.</th>
            <th style="text-align:center" title="Mura della città">🏯 Mura</th>
            <th style="text-align:center" title="Caserma">⚔️ Cas.</th>
            <th style="text-align:center" title="Cantiere Navale">⚓ Cant.</th>
            <th>Bene</th>
            <th style="text-align:right">Bene/h</th>
            <th style="text-align:right">🪵 Legno/h</th>
            <th style="text-align:right">🍷 Consumo vino</th>
            <th style="text-align:right">Scienziati</th>
            <th style="text-align:right">Liberi</th>
            <th style="text-align:right">Occupati</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr style="font-weight:600;border-top:2px solid var(--border)">
            <td colspan="10">Totale consumo vino</td>
            <td style="text-align:right">${Math.round(totalWine).toLocaleString('it')}</td>
            <td colspan="3"></td>
          </tr></tfoot>
        </table>
      </div>
    ` + resetBtnHtml;
  }


  // ── TRUPPE / NAVI PER POLIS ───────────────────
  // ── VISUALIZZATORE REPORT COMBATTIMENTO ─────────────────────
  async function renderCombatReports() {
    const el = document.getElementById('ikcr-list');
    if (!el || !window.IkDB) return;

    const q    = (document.getElementById('ikcr-q')?.value || '').trim().toLowerCase();
    const type = document.getElementById('ikcr-type')?.value || '';

    el.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px">⏳ Caricamento…</div>';

    let reports = [];
    try { reports = await window.IkDB.getAll('combat_reports'); } catch {}

    // Filtra
    if (q)    reports = reports.filter(r =>
      `${r.attackerName} ${r.defenderName} ${r.combatId}`.toLowerCase().includes(q)
    );
    if (type) reports = reports.filter(r => r.type === type);

    // Ordina per data decrescente
    reports.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);

    if (!reports.length) {
      el.innerHTML = `<div class="ikp-empty" style="padding:12px">
        <div class="ikp-empty-icon">⚔️</div>
        <p>Nessun report. Naviga i rapporti di combattimento nel gioco.</p>
      </div>`;
      return;
    }

    const UNIT_ICON = { naval: '⛴', land: '🪖' };

    el.innerHTML = reports.map(r => {
      const ico      = UNIT_ICON[r.type] || '⚔️';
      const dateStr  = r.date ? fmt(r.date) : '—';
      const roundsOk = r.capturedRounds?.length || 0;
      const roundsTot= r.totalRounds || '?';

      // Riepilogo unità dalla unitSummary (riepilogo finale del report)
      const summarySide = side => {
        const units = r.unitSummary?.[side] || [];
        if (!units.length) return '<span style="color:var(--text-muted)">—</span>';
        return units.map(u =>
          `<span style="white-space:nowrap">${u.name}: <b>${u.count.toLocaleString('it')}</b>`
          + (u.losses ? ` <span style="color:var(--danger,#e44)">(-${u.losses})</span>` : '')
          + `</span>`
        ).join(' · ');
      };

      // Round dettaglio espandibile
      const roundsHtml = (r.rounds || []).map(rd => {
        const attSlots = rd.attacker?.slots || [];
        const defSlots = rd.defender?.slots || [];

        const renderSlots = slots => {
          if (!slots.length) return '<span style="color:var(--text-muted)">—</span>';
          // Raggruppa per unitName
          const byUnit = {};
          for (const s of slots) {
            const k = s.unitName || s.unitId;
            if (!byUnit[k]) byUnit[k] = { count: 0, losses: 0, upgrades: s.upgrades };
            byUnit[k].count  += s.count  || 0;
            byUnit[k].losses += s.losses || 0;
          }
          return Object.entries(byUnit).map(([name, d]) => {
            const upgHtml = d.upgrades && Object.keys(d.upgrades).length
              ? ` <span style="font-size:10px;color:var(--accent)" title="${
                  Object.values(d.upgrades).map(u => `${u.name} lv${u.level}`).join(', ')
                }">⬆️${Object.keys(d.upgrades).length}</span>`
              : '';
            return `<span style="white-space:nowrap">${name}: <b>${d.count}</b>`
              + (d.losses ? ` <span style="color:var(--danger,#e44)">(-${d.losses})</span>` : '')
              + upgHtml + `</span>`;
          }).join(' · ');
        };

        const blessStr = (rd.blessings || []).map(b => `✨ ${b.playerName}: ${b.name}`).join(' · ');

        return `
          <div style="margin-top:6px;background:var(--bg-alt);border-radius:4px;padding:6px 8px;font-size:11px">
            <div style="font-weight:600;margin-bottom:4px">
              Round ${rd.round}/${roundsTot}
              <span style="font-weight:400;color:var(--text-muted);margin-left:6px">${rd.date ? fmt(rd.date) : ''}</span>
              ${rd.attacker?.morale?.moralePct != null
                ? `<span style="color:var(--text-muted);margin-left:6px">
                    ATK morale ${rd.attacker.morale.moralePct}%
                    · DEF morale ${rd.defender?.morale?.moralePct ?? '?'}%
                  </span>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <div>
                <div style="color:var(--text-muted);font-size:10px;margin-bottom:2px">
                  ⚔️ ${rd.attackerName || r.attackerName || 'ATK'}
                  ${rd.attacker?.morale?.totalUnits != null
                    ? `(${rd.attacker.morale.totalUnits}${rd.attacker.morale.losses ? ` -${rd.attacker.morale.losses}` : ''})` : ''}
                </div>
                <div style="line-height:1.6">${renderSlots(attSlots)}</div>
              </div>
              <div>
                <div style="color:var(--text-muted);font-size:10px;margin-bottom:2px">
                  🛡 ${rd.defenderName || r.defenderName || 'DEF'}
                  ${rd.defender?.morale?.totalUnits != null
                    ? `(${rd.defender.morale.totalUnits}${rd.defender.morale.losses ? ` -${rd.defender.morale.losses}` : ''})` : ''}
                </div>
                <div style="line-height:1.6">${renderSlots(defSlots)}</div>
              </div>
            </div>
            ${blessStr ? `<div style="margin-top:4px;color:var(--text-muted)">${blessStr}</div>` : ''}
          </div>`;
      }).join('');

      // Stats dal BBCode
      const statsHtml = r.stats ? `
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;margin-top:4px">
          ${r.stats.attacker?.generals   != null ? `<span>⭐ Gen ATK: <b>${r.stats.attacker.generals}</b></span>` : ''}
          ${r.stats.attacker?.attackPts  != null ? `<span>⚔️ Pt ATK: <b>${r.stats.attacker.attackPts?.toLocaleString('it')}</b></span>` : ''}
          ${r.stats.defender?.defensePts != null ? `<span>🛡 Pt DEF: <b>${r.stats.defender.defensePts?.toLocaleString('it')}</b></span>` : ''}
          ${r.stats.attacker?.dmgPct     != null ? `<span>💥 Danno ATK: <b>${r.stats.attacker.dmgPct}%</b></span>` : ''}
          ${r.stats.defender?.dmgPct     != null ? `<span>💥 Danno DEF: <b>${r.stats.defender.dmgPct}%</b></span>` : ''}
        </div>` : '';

      const expandId = `ikcr-exp-${r.combatId}`;
      return `
        <div style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden">
          <!-- Header cliccabile -->
          <div style="padding:8px 10px;background:var(--bg-alt);cursor:pointer"
               onclick="(function(){var d=document.getElementById('${expandId}');d.style.display=d.style.display==='none'?'block':'none';})()">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="font-weight:700;font-size:12px">${ico} #${r.combatId}</span>
              <span style="font-size:12px">${r.attackerName || '?'} vs ${r.defenderName || '?'}</span>
              <span style="font-size:11px;color:var(--text-muted)">${dateStr}</span>
              <span style="font-size:11px;margin-left:auto;color:var(--text-muted)">
                ${roundsOk}/${roundsTot} round catturati
              </span>
              ${r.winner ? `<span style="font-size:11px;color:var(--ok,#2a8)">🏆 ${r.winner}</span>` : ''}
            </div>
            ${statsHtml}
          </div>
          <!-- Dettaglio espandibile -->
          <div id="${expandId}" style="display:none;padding:8px 10px">
            <!-- Riepilogo finale unità -->
            ${r.unitSummary ? `
              <div style="font-size:11px;margin-bottom:6px">
                <div style="color:var(--text-muted);font-size:10px;margin-bottom:2px">Riepilogo finale</div>
                <div>⚔️ ${summarySide('attacker')}</div>
                <div>🛡 ${summarySide('defender')}</div>
              </div>` : ''}
            <!-- Round dettagliati -->
            ${roundsHtml || '<div style="font-size:11px;color:var(--text-muted)">Nessun round dettagliato catturato. Naviga i round nel gioco.</div>'}
          </div>
        </div>`;
    }).join('');
  }

  async function renderMilitary() {
    const list = document.getElementById('ikp-military-list');
    if (!list || !window.IkDB) return;

    const records = await window.IkDB.getAll('city_military');
    if (!records.length) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">⚔️</div><p>Apri la scheda "Truppe nella città" di una polis (Caserma o Cantiere Navale → Truppe) per popolare questa vista.</p></div>`;
      return;
    }

    // ── dati accessori ──────────────────────────────────────
    const [myCities, enemyBuildings, unitData, townHallAll, constructionsAll] = await Promise.all([
      window.IkDB.getAll('my_cities'),
      window.IkDB.getAll('enemy_buildings'),
      window.IkDB.getAll('unit_data'),
      window.IkDB.getAll('town_hall_data').catch(() => []),
      window.IkDB.getAll('constructions').catch(() => []),
    ]);
    const cityInfo = new Map();
    for (const c of myCities)       cityInfo.set(c.cityId, { name: c.name, x: c.islandX, y: c.islandY });
    for (const c of enemyBuildings) if (!cityInfo.has(c.cityId)) cityInfo.set(c.cityId, { name: c.cityName, x: c.islandX, y: c.islandY });

    // Lookup per nome, generali (punti generale) e mantenimento (oro/ora)
    const unitMeta = new Map(unitData.map(u => [u.unitId, {
      name:     u.name     || `#${u.unitId}`,
      generals: u.generals ?? null,
      upkeep:   u.cost?.upkeep ?? null,
      kind:     u.kind,
    }]));

    records.sort((a, b) => {
      const ia = cityInfo.get(a.cityId) || {}, ib = cityInfo.get(b.cityId) || {};
      return (ia.x ?? 9999) - (ib.x ?? 9999) || (ia.y ?? 9999) - (ib.y ?? 9999) || a.cityId - b.cityId;
    });

    // ── utilità ─────────────────────────────────────────────
    function sumUnits(groups) {
      let total = 0;
      for (const g of (groups || [])) for (const n of Object.values(g.units || {})) total += n;
      return total;
    }

    // Accumula conteggi totali in una Map<unitId, count>
    function addGroupsToMap(groups, target) {
      for (const g of (groups || [])) {
        for (const [id, n] of Object.entries(g.units || {})) {
          const k = Number(id);
          target.set(k, (target.get(k) || 0) + n);
        }
      }
    }

    // Formatta l'elenco unità in linea
    function formatUnitsList(unitsObj, icon) {
      const entries = Object.entries(unitsObj || {})
        .map(([id, n]) => ({ n, id: Number(id), name: (unitMeta.get(Number(id)) || {}).name || `#${id}` }))
        .filter(e => e.n > 0)
        .sort((a, b) => b.n - a.n);
      if (!entries.length) return '<span style="color:var(--text-muted)">—</span>';
      return entries
        .map(e => `<span style="white-space:nowrap;margin-right:10px;display:inline-block">${icon} <b>${e.n.toLocaleString('it')}</b> ${e.name}</span>`)
        .join('');
    }

    function renderOwnerGroups(groups, icon) {
      if (!groups || !groups.length) return '<span style="color:var(--text-muted);font-size:12px">— nessuna —</span>';
      return groups.map(g => {
        const body = formatUnitsList(g.units, icon);
        return groups.length > 1
          ? `<div style="margin-bottom:6px"><b>${g.ownerName}</b><br>${body}</div>`
          : `<div>${body}</div>`;
      }).join('');
    }

    // Render blocco generali + mantenimento.
    // landMap e seaMap sono Map<unitId, count>; red = { land, sea } percentuali.
    function renderGeneralsAndUpkeep(landMap, seaMap, red) {
      red = red || initRed;
      let totalGenerals = 0, totalUpkeepRaw = 0, totalUpkeepNet = 0;
      const genRows = [], upkRows = [];

      const combined = new Map();
      for (const [id, n] of (landMap || new Map())) combined.set(id, { n, kind: 'unit' });
      for (const [id, n] of (seaMap  || new Map())) combined.set(id, { n, kind: 'ship' });

      const sorted = [...combined.entries()]
        .filter(([, v]) => v.n > 0)
        .sort(([, a], [, b]) => b.n - a.n);

      for (const [id, { n, kind }] of sorted) {
        const meta = unitMeta.get(id) || {};
        const icon = kind === 'ship' ? '⛴' : '🪖';
        const name = meta.name || `#${id}`;
        const reduction = kind === 'ship' ? (red.sea / 100) : (red.land / 100);

        if (meta.generals != null) {
          const g = meta.generals * n;
          totalGenerals += g;
          genRows.push(`<span style="white-space:nowrap;margin-right:10px;display:inline-block">${icon} <b>${n.toLocaleString('it')}</b> ${name} = ${g % 1 === 0 ? g.toLocaleString('it') : g.toFixed(1)} gen.</span>`);
        }
        if (meta.upkeep != null) {
          const uRaw = meta.upkeep * n;
          const uNet = uRaw * (1 - reduction);
          totalUpkeepRaw += uRaw;
          totalUpkeepNet += uNet;
          const redLabel = reduction > 0 ? ` <span style="color:var(--text-muted);font-size:11px">(-${(reduction*100).toFixed(1)}% → ${Math.round(uNet).toLocaleString('it')})</span>` : '';
          upkRows.push(`<span style="white-space:nowrap;margin-right:10px;display:inline-block">${icon} <b>${n.toLocaleString('it')}</b> ${name} = ${Math.round(uRaw).toLocaleString('it')} 🪙/h${redLabel}</span>`);
        }
      }

      const genTotalStr = totalGenerals % 1 === 0 ? totalGenerals.toLocaleString('it') : totalGenerals.toFixed(1);
      const upkNetStr   = Math.round(totalUpkeepNet).toLocaleString('it');
      const upkRawStr   = Math.round(totalUpkeepRaw).toLocaleString('it');
      const hasRed      = (red.land > 0 || red.sea > 0) && totalUpkeepRaw > 0;
      const upkLabel    = hasRed
        ? `${upkNetStr}/h <span style="color:var(--text-muted);font-size:11px">(lordo: ${upkRawStr}/h)</span>`
        : `${upkRawStr}/h`;

      let html = '';
      if (genRows.length) {
        html += `<div style="margin-bottom:8px">
          <div style="font-weight:600;margin-bottom:4px">⭐ Generali totali: <b>${genTotalStr}</b></div>
          <div style="font-size:12px;line-height:1.8">${genRows.join('')}</div>
        </div>`;
      }
      if (upkRows.length) {
        html += `<div>
          <div style="font-weight:600;margin-bottom:4px">🪙 Mantenimento: <b>${upkLabel}</b></div>
          <div style="font-size:12px;line-height:1.8">${upkRows.join('')}</div>
        </div>`;
      }
      if (!html) html = '<span style="color:var(--text-muted);font-size:12px">Dati generali/mantenimento non disponibili (apri la pagina Aiuto di ogni unità).</span>';
      return html;
    }

    // ── CITTADINI / REDDITO MASSIMO ──────────────────────────
    // Il reddito max usa la popolazione massima (non i cittadini attivi)
    let totalMaxPop = 0, totalPriests = 0;
    for (const th of (townHallAll || [])) {
      totalMaxPop  += th.maxPopulation || 0;
      totalPriests += th.priests       || 0;
    }
    const netCitizens = Math.max(0, totalMaxPop - totalPriests);

    // Benedizione Pluto attiva? (godKey = 'plutus', endTime > now)
    const now = Date.now();
    const plutusRec = (constructionsAll || []).find(
      c => c.type === 'shrine' && c.godKey === 'plutus' && c.endTime > now
    );
    const plutusBonus = plutusRec?.currentBonus ?? 0;   // es. 67 → +67%
    const maxIncome   = Math.round(netCitizens * 3 * (1 + plutusBonus / 100));

    const plutusLabel = plutusBonus > 0
      ? `⛩ Pluto +${plutusBonus}% (${plutusRec?.graceText || ''}) · `
      : '';

    // ── RIDUZIONE MANTENIMENTO (campi editabili, persistiti in localStorage) ──
    const LS_KEY_LAND = 'ikp_upkeep_reduction_land';
    const LS_KEY_SEA  = 'ikp_upkeep_reduction_sea';
    const savedLandRed = parseFloat(localStorage.getItem(LS_KEY_LAND) || '0') || 0;
    const savedSeaRed  = parseFloat(localStorage.getItem(LS_KEY_SEA)  || '0') || 0;

    // I valori di riduzione vengono letti dal DOM al momento del render dei totali,
    // così l'utente può cambiarli senza ricaricare: usiamo una funzione che li rilegge ogni volta.
    function getReductions() {
      const l = parseFloat(document.getElementById('ikp-mil-red-land')?.value || '0') || 0;
      const s = parseFloat(document.getElementById('ikp-mil-red-sea')?.value  || '0') || 0;
      return { land: Math.min(Math.max(l, 0), 100), sea: Math.min(Math.max(s, 0), 100) };
    }

    // Ricalcola e aggiorna solo i blocchi generali/mantenimento senza rirenderizzare tutto
    function refreshUpkeepBlocks() {
      const red = getReductions();
      localStorage.setItem(LS_KEY_LAND, red.land);
      localStorage.setItem(LS_KEY_SEA,  red.sea);

      // Ricrea i contenuti dei blocchi recap globali e di ogni polis
      document.querySelectorAll('[data-ikp-upkeep]').forEach(el => {
        const scope = el.dataset.ikpUpkeep; // 'global-land', 'global-sea', 'polis-N'
        const totalsLand = JSON.parse(el.dataset.totalsLand || '{}');
        const totalsSea  = JSON.parse(el.dataset.totalsSea  || '{}');
        el.innerHTML = renderGeneralsAndUpkeep(
          new Map(Object.entries(totalsLand).map(([k,v]) => [Number(k),v])),
          new Map(Object.entries(totalsSea).map(([k,v]) => [Number(k),v])),
          red
        );
      });
    }

    const reductionBarHtml = `
      <div style="display:flex;flex-direction:column;gap:8px;
                  padding:8px 10px;margin-bottom:10px;
                  background:var(--bg-alt);border:1px solid var(--border);border-radius:6px;font-size:13px">
        <!-- RIGA 1: Cittadini e reddito massimo -->
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;
                    padding-bottom:8px;border-bottom:1px solid var(--border)">
          <span>👥 Cittadini netti: <b>${netCitizens.toLocaleString('it')}</b>
            <span style="font-size:11px;color:var(--text-muted)">
              (max pop ${totalMaxPop.toLocaleString('it')} − ${totalPriests.toLocaleString('it')} sacerdoti)
            </span>
          </span>
          <span>💰 Reddito max: <b id="ikp-max-income" style="color:var(--ok,#2a8)">${maxIncome.toLocaleString('it')}/h</b>
            <span style="font-size:11px;color:var(--text-muted)">
              ${plutusLabel}(×3${plutusBonus > 0 ? ` ×${(1 + plutusBonus/100).toFixed(2)}` : ''})
            </span>
          </span>
          ${townHallAll.length === 0 ? '<span style="font-size:11px;color:var(--text-muted)">ℹ️ Apri il Municipio di ogni polis per aggiornare i dati.</span>' : ''}
        </div>
        <!-- RIGA 2: Riduzione mantenimento -->
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <span style="font-weight:600">✂️ Riduzione mantenimento:</span>
          <label style="display:flex;align-items:center;gap:5px">
            🪖 Truppe
            <input id="ikp-mil-red-land" type="number" min="0" max="100" step="0.1"
                   value="${savedLandRed}"
                   style="width:64px;padding:3px 5px;border:1px solid var(--border);border-radius:4px;
                          background:var(--bg);color:var(--text);font-size:13px"
                   oninput="window._ikpRefreshUpkeep?.()"> %
          </label>
          <label style="display:flex;align-items:center;gap:5px">
            ⛴ Navi
            <input id="ikp-mil-red-sea" type="number" min="0" max="100" step="0.1"
                   value="${savedSeaRed}"
                   style="width:64px;padding:3px 5px;border:1px solid var(--border);border-radius:4px;
                          background:var(--bg);color:var(--text);font-size:13px"
                   oninput="window._ikpRefreshUpkeep?.()"> %
          </label>
          <span style="font-size:11px;color:var(--text-muted)">Es. 26% = ricerca livello massimo</span>
        </div>
      </div>`;

    // Espone la funzione globalmente così il handler oninput la trova
    window._ikpRefreshUpkeep = refreshUpkeepBlocks;

    // Leggo la riduzione iniziale (dai valori salvati)
    const initRed = { land: savedLandRed, sea: savedSeaRed };

    // ── RECAP GLOBALE (righe sopra la tabella) ───────────────
    const globalLand = new Map(), globalSea = new Map();
    for (const rec of records) {
      addGroupsToMap(rec.land?.garrison,  globalLand);
      addGroupsToMap(rec.land?.allied,    globalLand);
      addGroupsToMap(rec.sea?.own,        globalSea);
      addGroupsToMap(rec.sea?.allied,     globalSea);
    }

    const globalLandTotal = [...globalLand.values()].reduce((a,b) => a+b, 0);
    const globalSeaTotal  = [...globalSea.values()].reduce((a,b) => a+b, 0);

    function buildRecapChips(totalsMap, icon) {
      return [...totalsMap.entries()]
        .filter(([,n]) => n > 0)
        .sort(([,a],[,b]) => b - a)
        .map(([id,n]) => {
          const name = (unitMeta.get(id) || {}).name || `#${id}`;
          return `<span style="white-space:nowrap;margin-right:10px;display:inline-block">${icon} <b>${n.toLocaleString('it')}</b> ${name}</span>`;
        }).join('') || '<span style="color:var(--text-muted)">—</span>';
    }

    const globalLandJson = JSON.stringify(Object.fromEntries(globalLand));
    const globalSeaJson  = JSON.stringify(Object.fromEntries(globalSea));

    const recapHtml = reductionBarHtml + `
      <div style="margin-bottom:10px;border:1px solid var(--border);border-radius:6px;overflow:hidden">
        <!-- RECAP TRUPPE -->
        <div style="cursor:pointer;padding:8px 10px;background:var(--bg-alt);display:flex;align-items:center;gap:8px;user-select:none"
             onclick="var d=document.getElementById('ikp-mil-recap-land');d.style.display=d.style.display==='none'?'block':'none'">
          <span style="font-weight:700">🪖 Totale truppe: ${globalLandTotal.toLocaleString('it')}</span>
          <span style="font-size:12px;margin-left:auto;color:var(--text-muted)">▼ espandi</span>
        </div>
        <div style="padding:8px 10px;font-size:13px;line-height:1.9;border-top:1px solid var(--border)">
          ${buildRecapChips(globalLand, '🪖')}
        </div>
        <div id="ikp-mil-recap-land" style="display:none;padding:8px 10px;border-top:1px solid var(--border);background:var(--bg)"
             data-ikp-upkeep="global-land"
             data-totals-land="${globalLandJson.replace(/"/g,'&quot;')}"
             data-totals-sea="{}">
          ${renderGeneralsAndUpkeep(globalLand, new Map(), initRed)}
        </div>

        <!-- RECAP NAVI -->
        <div style="cursor:pointer;padding:8px 10px;background:var(--bg-alt);display:flex;align-items:center;gap:8px;user-select:none;border-top:2px solid var(--border)"
             onclick="var d=document.getElementById('ikp-mil-recap-sea');d.style.display=d.style.display==='none'?'block':'none'">
          <span style="font-weight:700">⛴ Totale navi: ${globalSeaTotal.toLocaleString('it')}</span>
          <span style="font-size:12px;margin-left:auto;color:var(--text-muted)">▼ espandi</span>
        </div>
        <div style="padding:8px 10px;font-size:13px;line-height:1.9;border-top:1px solid var(--border)">
          ${buildRecapChips(globalSea, '⛴')}
        </div>
        <div id="ikp-mil-recap-sea" style="display:none;padding:8px 10px;border-top:1px solid var(--border);background:var(--bg)"
             data-ikp-upkeep="global-sea"
             data-totals-land="{}"
             data-totals-sea="${globalSeaJson.replace(/"/g,'&quot;')}">
          ${renderGeneralsAndUpkeep(new Map(), globalSea, initRed)}
        </div>
      </div>`;

    // ── RIGHE PER POLIS ──────────────────────────────────────
    const rows = records.map((rec, idx) => {
      const info   = cityInfo.get(rec.cityId) || {};
      const coords = (info.x != null && info.y != null) ? `${info.x}:${info.y}` : '—';
      const name   = info.name || '—';

      const landTotal = sumUnits(rec.land?.garrison) + sumUnits(rec.land?.allied);
      const seaTotal  = sumUnits(rec.sea?.own)        + sumUnits(rec.sea?.allied);
      const occTotal  = sumUnits(rec.land?.occupying);
      const blkTotal  = sumUnits(rec.sea?.blocking);

      // Sfondo verde se c'è almeno una truppa o nave presente
      const hasUnits = landTotal > 0 && seaTotal > 0;
      const rowBg    = hasUnits ? 'background:rgba(34,139,34,0.12)' : '';

      const gl = rec.garrisonLimits || {};
      const detailId = `ikp-mil-detail-${idx}`;

      const sections = [
        { label: '🪖 Presidio',         groups: rec.land?.garrison,  icon: '🪖' },
        { label: '🤝 Alleati (terra)',  groups: rec.land?.allied,    icon: '🪖', onlyIfAny: true },
        { label: '🚩 Occupanti',        groups: rec.land?.occupying, icon: '🪖', onlyIfAny: true, danger: true },
        { label: '⛴ Navi',              groups: rec.sea?.own,        icon: '⛴' },
        { label: '🤝 Alleati (mare)',   groups: rec.sea?.allied,     icon: '⛴', onlyIfAny: true },
        { label: '🚧 Flotte bloccate',  groups: rec.sea?.blocking,   icon: '⛴', onlyIfAny: true, danger: true },
      ].filter(s => !s.onlyIfAny || (s.groups && s.groups.length));

      const detailRows = sections.map(s => `
        <tr>
          <td style="white-space:nowrap;vertical-align:top;font-weight:600;${s.danger ? 'color:var(--red)' : ''}">${s.label}</td>
          <td>${renderOwnerGroups(s.groups, s.icon)}</td>
        </tr>`).join('');

      // Calcolo generali + mantenimento per questa singola polis
      const polisLand = new Map(), polisSea = new Map();
      addGroupsToMap(rec.land?.garrison, polisLand);
      addGroupsToMap(rec.land?.allied,   polisLand);
      addGroupsToMap(rec.sea?.own,       polisSea);
      addGroupsToMap(rec.sea?.allied,    polisSea);
      const polisLandJson = JSON.stringify(Object.fromEntries(polisLand));
      const polisSeaJson  = JSON.stringify(Object.fromEntries(polisSea));

      const detailHtml = `
        <table class="ikp-db-table" style="border-top:none"><tbody>${detailRows}</tbody></table>
        <div style="padding:8px 10px;border-top:1px solid var(--border)"
             data-ikp-upkeep="polis-${rec.cityId}"
             data-totals-land="${polisLandJson.replace(/"/g,'&quot;')}"
             data-totals-sea="${polisSeaJson.replace(/"/g,'&quot;')}">
          ${renderGeneralsAndUpkeep(polisLand, polisSea, initRed)}
        </div>
        <div style="font-size:11px;color:var(--text-muted);padding:4px 10px 8px">
          Lim. guarnigione — terra: ${(gl.land ?? 0).toLocaleString('it')}/${(gl.landMax ?? 0).toLocaleString('it')}
          &nbsp;·&nbsp; mare: ${(gl.sea ?? 0).toLocaleString('it')}/${(gl.seaMax ?? 0).toLocaleString('it')}
          &nbsp;·&nbsp; agg. ${rec.updated ? new Date(rec.updated).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
        </div>`;

      return `<tr style="cursor:pointer;${rowBg}" onclick="var r=document.getElementById('${detailId}');r.style.display=r.style.display==='none'?'table-row':'none'">
        <td>${rec.cityId}</td>
        <td>${coords}</td>
        <td>${name}</td>
        <td style="text-align:right">${landTotal > 0 ? `<b>${landTotal.toLocaleString('it')}</b>` : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="text-align:right">${seaTotal  > 0 ? `<b>${seaTotal.toLocaleString('it')}</b>`  : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="text-align:center">${occTotal > 0 ? `<span style="color:var(--red)">🚩 ${occTotal.toLocaleString('it')}</span>` : '—'}</td>
        <td style="text-align:center">${blkTotal > 0 ? `<span style="color:var(--red)">🚧 ${blkTotal.toLocaleString('it')}</span>` : '—'}</td>
      </tr>
      <tr id="${detailId}" style="display:none;background:var(--bg)">
        <td colspan="7" style="padding:0">${detailHtml}</td>
      </tr>`;
    }).join('');

    // ── SIMULATORE ADDESTRAMENTO ─────────────────────────────
    const RES      = ['wood','marble','crystal','sulfur','wine','citizens'];
    const RES_ICON = { wood:'🪵', marble:'🪨', crystal:'💎', sulfur:'🌋', wine:'🍷', citizens:'👥' };
    const RES_LBL  = { wood:'Legname', marble:'Marmo', crystal:'Cristallo', sulfur:'Zolfo', wine:'Vino', citizens:'Pop.' };

    // Formula: t(L) = t_ref × 0.95^(L − L_ref)   (−5% per livello)
    const BUILDING_R = 0.95;
    const UNIT_BASE  = {
      301:{refLv:19,refSec:57,   minLv:1,  btype:'barracks'},
      302:{refLv:19,refSec:139,  minLv:6,  btype:'barracks'},
      303:{refLv:19,refSec:209,  minLv:4,  btype:'barracks'},
      304:{refLv:19,refSec:662,  minLv:13, btype:'barracks'},
      305:{refLv:19,refSec:2786, minLv:14, btype:'barracks'},
      306:{refLv:19,refSec:1536, minLv:8,  btype:'barracks'},
      307:{refLv:19,refSec:397,  minLv:1,  btype:'barracks'},
      308:{refLv:19,refSec:943,  minLv:12, btype:'barracks'},
      309:{refLv:19,refSec:1792, minLv:11, btype:'barracks'},
      310:{refLv:19,refSec:878,  minLv:5,  btype:'barracks'},
      311:{refLv:19,refSec:1078, minLv:9,  btype:'barracks'},
      312:{refLv:19,refSec:851,  minLv:10, btype:'barracks'},
      313:{refLv:19,refSec:195,  minLv:7,  btype:'barracks'},
      315:{refLv:19,refSec:36,   minLv:1,  btype:'barracks'},
      210:{refLv:21,refSec:1291, minLv:1,  btype:'shipyard'},
      211:{refLv:21,refSec:1129, minLv:1,  btype:'shipyard'},
      212:{refLv:21,refSec:4860, minLv:1,  btype:'shipyard'},
      213:{refLv:21,refSec:1788, minLv:1,  btype:'shipyard'},
      214:{refLv:21,refSec:1788, minLv:1,  btype:'shipyard'},
      215:{refLv:21,refSec:3660, minLv:1,  btype:'shipyard'},
      216:{refLv:21,refSec:2647, minLv:1,  btype:'shipyard'},
      217:{refLv:21,refSec:3234, minLv:1,  btype:'shipyard'},
      218:{refLv:21,refSec:1792, minLv:1,  btype:'shipyard'},
      219:{refLv:21,refSec:2927, minLv:1,  btype:'shipyard'},
      220:{refLv:21,refSec:1946, minLv:1,  btype:'shipyard'},
    };

    function simCalcTime(unitId, level) {
      const b = UNIT_BASE[unitId];
      if (!b || level < b.minLv) return null;
      return Math.max(1, Math.round(b.refSec * Math.pow(BUILDING_R, level - b.refLv)));
    }
    function fmtSec(s) {
      if (s == null) return '—';
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      if (h) return `${h}h${m}m`;
      if (m) return `${m}m${sec > 0 ? sec + 's' : ''}`;
      return `${sec}s`;
    }

    function isBarbarian(uid, m) {
      if (!m.name) return true;
      if (m.kind === 'ship' && (uid <= 204 || uid >= 221)) return true;
      if (/barbari/i.test(m.name)) return true;
      return false;
    }

    // Edifici disponibili per polis (da my_cities + building_training)
    const buildingTrainingAll = await window.IkDB.getAll('building_training').catch(() => []);
    const cityBuildings = {};   // { cityId: { barracks: lv, shipyard: lv, name, x, y } }
    for (const c of myCities) {
      if (!c.buildings) continue;
      cityBuildings[c.cityId] = { name: c.name || `c${c.cityId}`, x: c.islandX, y: c.islandY, barracks: null, shipyard: null };
      for (const b of c.buildings)
        if (b.building === 'barracks' || b.building === 'shipyard')
          cityBuildings[c.cityId][b.building] = b.level;
    }
    for (const bt of buildingTrainingAll) {
      if (!cityBuildings[bt.cityId]) cityBuildings[bt.cityId] = { name: `c${bt.cityId}`, x: null, y: null, barracks: null, shipyard: null };
      cityBuildings[bt.cityId][bt.type] = bt.level;
    }
    const cityList = Object.entries(cityBuildings).map(([id, v]) => ({ cityId: +id, ...v }));

    // simMeta
    const simMeta = new Map(
      unitData.filter(u => !isBarbarian(u.unitId, u))
              .map(u => [u.unitId, {
                kind: u.kind, name: u.name || `#${u.unitId}`,
                generals: u.generals ?? null, upkeep: u.cost?.upkeep ?? null, cost: u.cost || {}
              }])
    );

    const simUnits = [...simMeta.entries()]
      .filter(([, m]) => m.kind === 'unit' || m.kind === 'ship')
      .sort(([a, am], [b, bm]) => am.kind !== bm.kind ? (am.kind === 'unit' ? -1 : 1) : a - b);

    const landUnits = simUnits.filter(([, m]) => m.kind === 'unit');
    const seaUnits  = simUnits.filter(([, m]) => m.kind === 'ship');

    function usedRes(units) {
      const used = new Set();
      for (const [, m] of units) for (const r of RES) if ((m.cost[r] ?? 0) > 0) used.add(r);
      return RES.filter(r => used.has(r));
    }
    const landRes = usedRes(landUnits);
    const seaRes  = usedRes(seaUnits);

    // Miglior tempo disponibile per un'unità (edificio più alto che la sblocca)
    function bestTime(unitId) {
      const b = UNIT_BASE[unitId]; if (!b) return null;
      let best = null;
      for (const c of cityList) {
        const lv = c[b.btype]; if (!lv || lv < b.minLv) continue;
        const t = simCalcTime(unitId, lv);
        if (t != null && (best === null || t < best)) best = t;
      }
      return best;
    }

    // Distribuzione ottimale greedy su polis disponibili
    function calcDist(unitId, qty) {
      const b = UNIT_BASE[unitId]; if (!b || !qty) return null;
      const avail = cityList.filter(c => c[b.btype] && c[b.btype] >= b.minLv)
                            .sort((a, c2) => (c2[b.btype] || 0) - (a[b.btype] || 0));
      if (!avail.length) return null;
      // Greedy: distribuisci riducendo il makespan
      // Ogni polis ha un accumulatore di tempo; assegna ogni unità alla polis meno carica
      const load = avail.map(c => ({ c, tPerUnit: simCalcTime(unitId, c[b.btype]), total: 0, qty: 0 }));
      for (let i = 0; i < qty; i++) {
        load.sort((a, c2) => (a.total + a.tPerUnit) - (c2.total + c2.tPerUnit));
        load[0].total += load[0].tPerUnit;
        load[0].qty++;
      }
      const makespan = Math.max(...load.map(l => l.total));
      return { dist: load.filter(l => l.qty > 0), makespan };
    }

    // ─── HTML tabella ──────────────────────────────────────────
    function buildTH(resCols) {
      return `<thead><tr>
        <th>Unità</th>
        <th style="width:68px">Qtà</th>
        <th style="text-align:right">⭐ Gen.</th>
        <th style="text-align:right;white-space:nowrap">🪙 Mant./h</th>
        <th style="text-align:center;width:38px">Flet</th>
        <th style="text-align:right;white-space:nowrap">🪙 Flet/h</th>
        <th style="text-align:right;white-space:nowrap">⏱ Tempo/u</th>
        ${resCols.map(r => `<th style="text-align:right;white-space:nowrap">${RES_ICON[r]} ${RES_LBL[r]}</th>`).join('')}
      </tr></thead>`;
    }

    function buildRows(units, resCols) {
      if (!units.length) return `<tr><td colspan="${7 + resCols.length}" style="color:var(--text-muted);font-style:italic;padding:8px">Nessuna unità disponibile.</td></tr>`;
      return units.map(([id, m]) => {
        const bt = bestTime(id);
        const resTds = resCols.map(r => `<td id="sim-res-${id}-${r}" style="text-align:right;color:var(--text-muted);font-size:12px">—</td>`).join('');
        return `<tr>
          <td style="white-space:nowrap;font-size:12px">${m.name}</td>
          <td style="padding:1px 3px"><input type="number" min="0" step="1" placeholder="0"
              id="sim-inp-${id}" data-sim-unit="${id}" data-sim-kind="${m.kind}"
              style="width:100%;height:26px;padding:0 4px;border:1px solid var(--border);border-radius:4px;
                     background:var(--bg);color:var(--text);font-size:12px;box-sizing:border-box;
                     line-height:26px"
              oninput="window._ikpSimUpdate?.()"></td>
          <td id="sim-gen-${id}"      style="text-align:right;color:var(--text-muted);font-size:12px">—</td>
          <td id="sim-upk-${id}"      style="text-align:right;color:var(--text-muted);font-size:12px">—</td>
          <td style="text-align:center;padding:1px 3px">
            <button id="sim-flet-${id}" onclick="window._ikpSimToggleFlet?.(${id})"
                    style="width:32px;height:26px;padding:0;border-radius:4px;border:1px solid var(--border);
                           background:var(--bg);color:var(--text-muted);font-size:11px;cursor:pointer;font-weight:600">N</button>
          </td>
          <td id="sim-flet-upk-${id}" style="text-align:right;color:var(--text-muted);font-size:12px">—</td>
          <td style="text-align:right;font-size:12px;color:${bt ? 'var(--text)' : 'var(--text-muted)'}">${bt ? fmtSec(bt) : '—'}</td>
          ${resTds}
        </tr>`;
      }).join('');
    }

    function buildTfoot(prefix, resCols) {
      const resTotRow = resCols.map(r => `<td id="sim-res-tot-${prefix}-${r}" style="text-align:right;font-weight:600;color:var(--text)">—</td>`).join('');
      const label = prefix === 'land' ? 'Totale truppe' : 'Totale navi';
      return `<tfoot>
        <tr style="font-weight:700;border-top:2px solid var(--border);font-size:12px">
          <td>${label}</td><td></td>
          <td id="sim-tot-${prefix}-gen"  style="text-align:right">—</td>
          <td id="sim-tot-${prefix}-upk"  style="text-align:right">—</td>
          <td></td>
          <td id="sim-tot-${prefix}-flet" style="text-align:right">—</td>
          <td></td>
          ${resCols.map(r => `<td id="sim-tot-${prefix}-${r}" style="text-align:right">—</td>`).join('')}
        </tr>
        <tr style="font-size:11px;color:var(--text-muted);border-top:1px dashed var(--border)">
          <td colspan="2" style="padding:3px 4px;font-style:italic">Risorse totali necessarie</td>
          <td></td><td></td><td></td><td></td><td></td>
          ${resTotRow}
        </tr>
        <tr id="sim-dist-${prefix}-row" style="display:none;background:var(--bg-alt)">
          <td colspan="${7 + resCols.length}" style="padding:6px 8px" id="sim-dist-${prefix}-body"></td>
        </tr>
      </tfoot>`;
    }

    const simulatorHtml = `
      <div id="ikp-sim" style="margin-top:12px;border:1px solid var(--border);border-radius:6px;overflow:hidden">
        <div style="padding:8px 10px;background:var(--bg-alt);font-weight:700;font-size:13px;
                    display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none"
             onclick="(function(){var b=document.getElementById('ikp-sim-body'),arr=document.getElementById('ikp-sim-arrow'),open=b.style.display!=='none';b.style.display=open?'none':'block';arr.textContent=open?'▶':'▼';})()">
          🧮 Simulatore addestramento
          <span id="ikp-sim-arrow" style="font-size:10px;color:var(--text-muted)">▶</span>
          <button class="ikp-btn small outline" style="margin-left:auto;font-size:11px"
                  onclick="event.stopPropagation();window._ikpSimReset?.()">Reset</button>
        </div>
        <div id="ikp-sim-body" style="display:none">
          <div style="padding:5px 10px 0;border-top:1px solid var(--border)">
            <div style="font-size:11px;font-weight:700;color:var(--text-muted);padding:3px 0;border-bottom:1px solid var(--border)">🪖 TRUPPE DI TERRA</div>
          </div>
          <div style="overflow-x:auto;padding:0 10px 4px">
            <table class="ikp-db-table" style="border:none;width:100%">
              ${buildTH(landRes)}
              <tbody>${buildRows(landUnits, landRes)}</tbody>
              ${landUnits.length ? buildTfoot('land', landRes) : ''}
            </table>
          </div>
          <div style="padding:5px 10px 0;border-top:2px solid var(--border)">
            <div style="font-size:11px;font-weight:700;color:var(--text-muted);padding:3px 0;border-bottom:1px solid var(--border)">⛴ NAVI</div>
          </div>
          <div style="overflow-x:auto;padding:0 10px 10px">
            <table class="ikp-db-table" style="border:none;width:100%">
              ${buildTH(seaRes)}
              <tbody>${buildRows(seaUnits, seaRes)}</tbody>
              ${seaUnits.length ? buildTfoot('sea', seaRes) : ''}
            </table>
          </div>
        </div>
      </div>`;

    // Mantenimento truppe ATTUALI in tutte le polis (per confronto con reddito max)
    // Map<unitId, totalCount> sommando tutte le polis
    const currentTroopCount = new Map();
    for (const rec of records) {
      addGroupsToMap(rec.land?.garrison, currentTroopCount);
      addGroupsToMap(rec.land?.allied,   currentTroopCount);
      addGroupsToMap(rec.sea?.own,       currentTroopCount);
      addGroupsToMap(rec.sea?.allied,    currentTroopCount);
    }
    // maxIncome è già calcolato sopra; passiamolo alla closure
    const _maxIncome = maxIncome;

    // ── Logica JS simulatore (closure diretta, senza <script>) ──────────────
    {
      const LS_FLET   = 'ikp_sim_flet';
      const SS_INPUTS = 'ikp_sim_inputs';   // sessionStorage — sopravvive al reload ma non alla chiusura tab

      let fletState = {};
      try { fletState = JSON.parse(localStorage.getItem(LS_FLET) || '{}'); } catch(e) {}

      // Ripristina valori input dalla sessione precedente (reload pagina)
      let savedInputs = {};
      try { savedInputs = JSON.parse(sessionStorage.getItem(SS_INPUTS) || '{}'); } catch(e) {}

      function saveInputs() {
        const out = {};
        document.querySelectorAll('[data-sim-unit]').forEach(i => { if (i.value) out[i.dataset.simUnit] = i.value; });
        try { sessionStorage.setItem(SS_INPUTS, JSON.stringify(out)); } catch(e) {}
      }

      const _lu = landUnits, _su = seaUnits;
      const _sm = simMeta,   _lr = landRes,  _sr = seaRes;   // alias closure
      const _curTroops = currentTroopCount;
      const _maxInc    = _maxIncome;

      function sFmt(n)  { return n % 1 === 0 ? n.toLocaleString('it') : n.toFixed(1); }
      function sFmtI(n) { return Math.round(n).toLocaleString('it'); }
      function sRed()   {
        const l = parseFloat(document.getElementById('ikp-mil-red-land')?.value || '0') || 0;
        const s = parseFloat(document.getElementById('ikp-mil-red-sea') ?.value || '0') || 0;
        return { land: Math.min(Math.max(l,0),100)/100, sea: Math.min(Math.max(s,0),100)/100 };
      }

      function simUpdate() {
        saveInputs();  // persisti valori in sessionStorage ad ogni modifica
        const red = sRed();
        const tot = { land:{gen:0,upk:0,flet:0}, sea:{gen:0,upk:0,flet:0} };
        const totRes = { land:{}, sea:{} };

        for (const [id, m] of _sm) {
          const inp = document.getElementById('sim-inp-' + id); if (!inp) continue;
          const n   = parseInt(inp.value, 10) || 0;
          const grp = m.kind === 'ship' ? 'sea' : 'land';
          const rc  = grp === 'sea' ? _sr : _lr;

          const gEl  = document.getElementById('sim-gen-' + id);
          const uEl  = document.getElementById('sim-upk-' + id);
          const fEl  = document.getElementById('sim-flet-upk-' + id);
          const btn  = document.getElementById('sim-flet-' + id);
          const isFl = !!fletState[id];

          if (btn) {
            btn.textContent = isFl ? 'Y' : 'N';
            btn.style.background  = isFl ? 'rgba(34,139,34,0.18)' : 'var(--bg)';
            btn.style.color       = isFl ? '#2a8' : 'var(--text-muted)';
            btn.style.borderColor = isFl ? '#2a8' : 'var(--border)';
          }
          const dim = el => { if(el){ el.textContent='—'; el.style.color='var(--text-muted)'; el.style.fontWeight='normal'; }};

          if (!n) { dim(gEl); dim(uEl); dim(fEl); rc.forEach(r => dim(document.getElementById(`sim-res-${id}-${r}`))); continue; }

          const rf = grp === 'ship' ? red.sea : red.land;
          const gen   = m.generals != null ? m.generals * n : null;
          const upkB  = m.upkeep   != null ? m.upkeep   * n : null;
          const upkN  = upkB  != null ? upkB  * (1 - rf)       : null;
          const upkF  = upkN  != null ? upkN  * (isFl ? 2 : 1) : null;

          if (gEl) { gEl.textContent = gen  != null ? sFmt(gen)  : '—'; gEl.style.color = gen  != null ? 'var(--text)' : 'var(--text-muted)'; }
          if (uEl) { uEl.textContent = upkN != null ? sFmtI(upkN): '—'; uEl.style.color = upkN != null ? 'var(--text)' : 'var(--text-muted)'; }
          if (fEl) {
            if (upkF != null) { fEl.textContent = sFmtI(upkF); fEl.style.color = isFl ? '#e80' : 'var(--text)'; fEl.style.fontWeight = isFl ? '700' : 'normal'; }
            else dim(fEl);
          }

          for (const r of rc) {
            const el = document.getElementById(`sim-res-${id}-${r}`);
            const v  = (m.cost[r] ?? 0) * n;
            if (el) { el.textContent = v > 0 ? Math.ceil(v).toLocaleString('it') : '—'; el.style.color = v > 0 ? 'var(--text)' : 'var(--text-muted)'; }
            if (v > 0) totRes[grp][r] = (totRes[grp][r] || 0) + v;
          }
          if (gen  != null) tot[grp].gen  += gen;
          if (upkN != null) tot[grp].upk  += upkN;
          if (upkF != null) tot[grp].flet += upkF;
        }

        const set = (eid, v, sfx) => { const el=document.getElementById(eid); if(el) el.textContent = v>0 ? sFmt(v)+(sfx||'') : '—'; };
        set('sim-tot-land-gen', tot.land.gen); set('sim-tot-land-upk', tot.land.upk, '/h'); set('sim-tot-land-flet', tot.land.flet, '/h');
        set('sim-tot-sea-gen',  tot.sea.gen);  set('sim-tot-sea-upk',  tot.sea.upk,  '/h'); set('sim-tot-sea-flet',  tot.sea.flet,  '/h');

        for (const grp of ['land','sea']) {
          const cols = grp === 'land' ? _lr : _sr;
          for (const r of cols) {
            // totale per colonna (riga bold)
            set(`sim-tot-${grp}-${r}`, totRes[grp][r] || 0);
            // riga risorse totali separata
            const el2 = document.getElementById(`sim-res-tot-${grp}-${r}`);
            const v2  = totRes[grp][r] || 0;
            if (el2) el2.textContent = v2 > 0 ? Math.ceil(v2).toLocaleString('it') : '—';
          }
        }

        // ── Controllo reddito massimo ────────────────────────────
        const red2 = sRed();
        let currentUpkeepTotal = 0;
        for (const [id, count] of _curTroops) {
          const m = _sm.get(id); if (!m || m.upkeep == null) continue;
          const rf = m.kind === 'ship' ? red2.sea / 100 : red2.land / 100;
          currentUpkeepTotal += m.upkeep * count * (1 - rf);
        }
        const simUpkeepTotal = tot.land.flet + tot.sea.flet;
        const grandTotal     = currentUpkeepTotal + simUpkeepTotal;

        if (_maxInc > 0) {
          const exceeded = grandTotal > _maxInc;
          const col = exceeded ? 'var(--red,#d44)' : 'var(--text)';
          ['sim-tot-land-upk','sim-tot-sea-upk','sim-tot-land-flet','sim-tot-sea-flet'].forEach(eid => {
            const el = document.getElementById(eid); if (el) el.style.color = col;
          });
          const incEl = document.getElementById('ikp-max-income');
          if (incEl) {
            incEl.style.color = exceeded ? 'var(--red,#d44)' : 'var(--ok,#2a8)';
            incEl.title = exceeded
              ? `⚠️ Totale mantenimento ${Math.round(grandTotal).toLocaleString('it')}/h supera il reddito`
              : '';
          }
        }

        // Distribuzione per polis
        for (const [grp, units] of [['land', _lu], ['sea', _su]]) {
          const rows = [];
          for (const [id, m] of units) {
            const n = parseInt(document.getElementById('sim-inp-' + id)?.value || '0', 10) || 0;
            if (!n) continue;
            const res = calcDist(id, n); if (!res) continue;
            const parts = res.dist.map(d =>
              `<span style="white-space:nowrap;margin-right:8px">${d.c.name} lv${d.c[UNIT_BASE[id]?.btype]}: <b>${d.qty}</b>u × ${fmtSec(d.tPerUnit)} = ${fmtSec(d.total)}</span>`
            ).join('');
            rows.push(`<div style="margin-bottom:3px;font-size:12px"><b>${m.name}</b>: ${parts} → <b>⏱ ${fmtSec(res.makespan)}</b></div>`);
          }
          const row  = document.getElementById(`sim-dist-${grp}-row`);
          const body = document.getElementById(`sim-dist-${grp}-body`);
          if (row && body) {
            if (rows.length) { body.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:5px">🏭 Distribuzione ottimale per polis</div>` + rows.join(''); row.style.display = 'table-row'; }
            else row.style.display = 'none';
          }
        }
      }

      window._ikpSimUpdate     = simUpdate;
      window._ikpSimReset      = () => { document.querySelectorAll('[data-sim-unit]').forEach(i => i.value = ''); fletState = {}; savedInputs = {}; try{localStorage.setItem(LS_FLET,'{}');sessionStorage.removeItem(SS_INPUTS);}catch(e){} simUpdate(); };
      window._ikpSimToggleFlet = id => { fletState[id] = !fletState[id]; try{localStorage.setItem(LS_FLET,JSON.stringify(fletState));}catch(e){} simUpdate(); };
      const _pr = window._ikpRefreshUpkeep;
      window._ikpRefreshUpkeep = () => { _pr?.(); simUpdate(); };
      // Ripristina valori input salvati dalla sessione (sopravvivono al reload della pagina)
      setTimeout(() => {
        for (const [uid, val] of Object.entries(savedInputs)) {
          const el = document.getElementById('sim-inp-' + uid);
          if (el) el.value = val;
        }
        simUpdate();
      }, 0);
    }

    list.innerHTML = recapHtml + `
      <div style="overflow-x:auto">
        <table class="ikp-db-table">
          <thead><tr>
            <th>ID</th><th>X:Y</th><th>Nome</th>
            <th style="text-align:right" title="Truppe proprie + alleate">🪖 Truppe</th>
            <th style="text-align:right" title="Navi proprie + alleate">⛴ Navi</th>
            <th style="text-align:center" title="Truppe nemiche occupanti">🚩 Occ.</th>
            <th style="text-align:center" title="Flotte nemiche bloccate">🚧 Blocco</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="font-size:11px;color:var(--text-muted);padding:6px 2px">Tocca una riga per il dettaglio + generali + mantenimento della singola polis.</div>
    ` + simulatorHtml;

    setTimeout(window._ikpSimUpdate, 0);
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
      townHall:'🏛', academy:'🎓', warehouse:'🏪', hideout:'🏚', safehouse:'🏠',
      tavern:'🍺', museum:'🏛', port:'⚓', shipyard:'🚢',
      barracks:'⚔️', wall:'🏯', carpentering:'🪵', glassblowing:'💎',
      alchemist:'🔥', winegrower:'🍷', vineyard:'🍷', stonemason:'🪨', palace:'👑', palaceColony:'👑',
      branchOffice:'🏢', temple:'⛩', oracle:'🔮', lighthouse:'🔦',
      embassy:'🤝', workshop:'🔧', pirateFortress:'☠️',
      architect:'📐', optician:'🫙', fireworker:'💣', forester:'🌲', dump:'🗑',
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
    if (panelOpen && activeTab === 'ranking') renderChanges();
    loadMapData();
    if (data.changes && data.changes.length > 0) {
      toast(`🏆 ${data.changes.length} cambi stato in classifica!`, 4000);
    }
  }

  // ── CAMBI STATO ───────────────────────────────
  const RANKING_LABELS = {
    score:                    'Punteggio totale',
    building_score_main:      'Costruttori',
    building_score_secondary: 'Livelli edifici',
    research_score_main:      'Scienziati',
    research_score_secondary: 'Livelli ricerca',
    army_score_main:          'Generali',
    trader_score_secondary:   'Quantità oro',
    offense:                  'Punti attacco',
    defense:                  'Punti difesa',
    trade:                    'Mercante',
    resources:                'Risorse',
    donations:                'Donazioni',
    pillaging:                'Saccheggio',
    piracy:                   'Punti predatore',
  };

  async function renderChanges() {
    const list = document.getElementById('ikp-changes-list');
    if (!list || !window.IkDB) return;

    const filterName = (document.getElementById('ikp-chg-filter-name')?.value || '').trim().toLowerCase();
    const filterAlly = (document.getElementById('ikp-chg-filter-ally')?.value || '').trim().toLowerCase();
    const filterType = document.getElementById('ikp-chg-filter-type')?.value || '';

    const stateCfg = {
      active:   { label:'Attivo',   cls:'state-active'   },
      inactive: { label:'Inattivo', cls:'state-inactive' },
      vacation: { label:'Vacanza',  cls:'state-vacation' },
      banned:   { label:'Bannato',  cls:'state-banned'   },
      deleted:  { label:'Eliminato',cls:'state-banned'   },
    };

    const SCORE_LABELS = {
      army_score_main: '⭐ Generali',
      offense:         '⚔️ Attacco',
      defense:         '🛡 Difesa',
    };

    const deltaColor = d => d > 0 ? 'var(--ok,#2a8)' : 'var(--danger,#e44)';
    const deltaSign  = d => d > 0 ? `+${d.toLocaleString('it')}` : d.toLocaleString('it');

    // ── Viste merged per giocatore ──────────────────────────────────────
    const MERGE_MODES = ['_all', '_state', '_changes', '_ally'];
    if (MERGE_MODES.includes(filterType)) {
      const wantState  = filterType === '_all' || filterType === '_state';
      const wantScores = filterType === '_all' || filterType === '_changes';
      const wantAlly   = filterType === '_all' || filterType === '_ally';

      const [stateChanges, scoreChanges, allyChanges] = await Promise.all([
        wantState  ? window.IkDB.getAll('state_changes').catch(() => []) : Promise.resolve([]),
        wantScores ? window.IkDB.getAll('score_changes').catch(() => []) : Promise.resolve([]),
        wantAlly   ? window.IkDB.getAll('ally_changes').catch(() => [])  : Promise.resolve([]),
      ]);

      // Merge per giocatore
      const playerMap = new Map();
      const getOrCreate = (id, name, ally) => {
        if (!playerMap.has(id)) {
          playerMap.set(id, { id, name, ally, stateEvents: [], scoreEvents: [], allyEvents: [], lastDate: null });
        }
        return playerMap.get(id);
      };

      const passFilter = (name, ally) => {
        if (filterName && !name?.toLowerCase().includes(filterName)) return false;
        if (filterAlly && (ally || '').toLowerCase() !== filterAlly) return false;
        return true;
      };

      for (const c of stateChanges) {
        if (!passFilter(c.playerName, c.allyName)) continue;
        const rec = getOrCreate(c.playerId || c.playerName, c.playerName, c.allyName);
        rec.stateEvents.push(c);
        if (!rec.lastDate || c.newUpdate > rec.lastDate) rec.lastDate = c.newUpdate;
      }
      for (const c of scoreChanges) {
        if (!passFilter(c.playerName, c.allyName)) continue;
        const rec = getOrCreate(c.avatarId || c.playerName, c.playerName, c.allyName);
        rec.scoreEvents.push(c);
        if (!rec.lastDate || c.date > rec.lastDate) rec.lastDate = c.date;
      }
      for (const c of allyChanges) {
        if (!passFilter(c.playerName, c.newAlly)) continue;
        const rec = getOrCreate(c.playerId || c.playerName, c.playerName, c.newAlly);
        rec.allyEvents.push(c);
        if (!rec.lastDate || c.date > rec.lastDate) rec.lastDate = c.date;
      }

      if (!playerMap.size) {
        list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">😴</div><p>Nessun cambio trovato.</p></div>`;
        return;
      }

      const sorted = [...playerMap.values()].sort((a, b) =>
        (b.lastDate || '') > (a.lastDate || '') ? 1 : -1
      );

      list.innerHTML = sorted.map(rec => {
        const allyStr = rec.ally && rec.ally !== '—'
          ? `<span style="font-size:11px;color:var(--text-muted)">[${rec.ally}]</span>` : '';

        // Cambi stato
        const stateHtml = rec.stateEvents
          .slice().sort((a, b) => (a.newUpdate || '') > (b.newUpdate || '') ? 1 : -1)
          .map(c => {
            const prev = stateCfg[c.prevState] || { label: c.prevState, cls: '' };
            const next = stateCfg[c.newState]  || { label: c.newState,  cls: '' };
            return `<div style="font-size:11px;margin-top:3px">
              🔔 <span class="ikp-state-badge ${prev.cls}">${prev.label}</span>
              → <span class="ikp-state-badge ${next.cls}">${next.label}</span>
              <span style="color:var(--text-muted);margin-left:4px">${fmt(c.newUpdate)}</span>
            </div>`;
          }).join('');

        // Variazioni punteggio raggruppate per tipo
        const byType = {};
        for (const e of rec.scoreEvents) {
          if (!byType[e.scoreType]) byType[e.scoreType] = [];
          byType[e.scoreType].push(e);
        }
        const scoreHtml = Object.entries(byType).map(([type, events]) => {
          const evSorted   = events.slice().sort((a, b) => (a.date || '') > (b.date || '') ? 1 : -1);
          const totalDelta = evSorted.reduce((s, e) => s + (e.delta || 0), 0);
          const last       = evSorted[evSorted.length - 1];
          const label      = SCORE_LABELS[type] || type;
          const pips       = evSorted.map(e =>
            `<span style="color:${deltaColor(e.delta)};font-size:10px">${deltaSign(e.delta)}</span>`
          ).join(' ');
          return `<div style="font-size:11px;margin-top:3px">
            ${label}: ${pips}
            = <b style="color:${deltaColor(totalDelta)}">${deltaSign(totalDelta)}</b>
            <span style="color:var(--text-muted);margin-left:4px">
              (${evSorted[0].prevScore?.toLocaleString('it')} → ${last.newScore?.toLocaleString('it')})
              · ${fmt(last.date)}
            </span>
          </div>`;
        }).join('');

        // Cambi alleanza
        const allyHtml = rec.allyEvents
          .slice().sort((a, b) => (a.date || '') > (b.date || '') ? 1 : -1)
          .map(c => `<div style="font-size:11px;margin-top:3px">
            🏰 <span style="color:var(--text-muted)">${c.prevAlly || '—'}</span>
            → <b>${c.newAlly || '—'}</b>
            <span style="color:var(--text-muted);margin-left:4px">${fmt(c.date)}</span>
          </div>`).join('');

        return `<div class="ikp-change-row" style="padding:8px 10px">
          <div class="ikp-change-player" style="margin-bottom:4px">
            👤 <b>${rec.name}</b> ${allyStr}
          </div>
          ${stateHtml}${scoreHtml}${allyHtml}
          ${!stateHtml && !scoreHtml && !allyHtml
            ? '<span style="font-size:11px;color:var(--text-muted)">—</span>' : ''}
        </div>`;
      }).join('');
      return;
    }

    // ── Vista punteggi classifica (tabella players) ─────────────────────
    const players = await window.IkDB.getAll('players');

    let filtered = players.filter(p => {
      if (!p.scores || !Object.keys(p.scores).length) return false;
      if (filterName && !(p.name || '').toLowerCase().includes(filterName)) return false;
      if (filterAlly && (p.ally || '').toLowerCase() !== filterAlly) return false;
      return true;
    });

    const lastUpdate = filtered.reduce((best, p) =>
      (!best || (p.lastUpdateDate || '') > best) ? (p.lastUpdateDate || null) : best, null);
    renderSummary(filtered, lastUpdate);

    if (!filtered.length) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">😴</div><p>Nessun dato classifica trovato.<br>Naviga le pagine classifica nel gioco.</p></div>`;
      return;
    }

    const allScoreKeys = filterType
      ? [filterType]
      : [...new Set(filtered.flatMap(p => Object.keys(p.scores || {})))];
    const shownKeys = allScoreKeys.filter(k => RANKING_LABELS[k]);

    if (!shownKeys.length) {
      list.innerHTML = `<div class="ikp-empty"><div class="ikp-empty-icon">😴</div><p>Nessun punteggio disponibile per il filtro selezionato.</p></div>`;
      return;
    }

    const sortKey = shownKeys[0];
    filtered.sort((a, b) => (b.scores?.[sortKey] ?? 0) - (a.scores?.[sortKey] ?? 0));

    // Carica i playerId per cui esistono dati truppe con upgrades
    const knownUnitsIds = new Set();
    try {
      const allUnits = await window.IkDB.getAll('player_units');
      for (const pu of allUnits) {
        const hasUpgrades = Object.values(pu.units || {}).some(u =>
          u.upgrades && Object.keys(u.upgrades).length > 0
        );
        if (hasUpgrades) {
          knownUnitsIds.add(pu.playerId);
          if (pu.playerName) knownUnitsIds.add(pu.playerName.toLowerCase().replace(/\s*\[[^\]]+\]$/, '').trim());
        }
      }
    } catch {}

    const scoreTh = shownKeys.map(k =>
      `<th style="text-align:right;white-space:nowrap;font-size:11px">${RANKING_LABELS[k] || k}</th>`
    ).join('');

    const rows = filtered.map(p => {
      const stBadge = stateCfg[p.status]
        ? `<span class="ikp-state-badge ${stateCfg[p.status].cls}" style="font-size:10px">${stateCfg[p.status].label}</span>`
        : '';
      const scoreCells = shownKeys.map(k => {
        const v   = p.scores?.[k];
        const pos = p.position?.[k];
        const posStr = pos ? `<span style="color:var(--text-muted);font-size:10px"> #${pos}</span>` : '';
        return `<td style="text-align:right;font-size:12px">${v != null ? v.toLocaleString('it') + posStr : '<span style="color:var(--text-muted)">—</span>'}</td>`;
      }).join('');

      const nameHistory = p.nameHistory?.length
        ? `<span style="font-size:10px;color:var(--text-muted)"> (ex: ${p.nameHistory.map(h => h.name).join(', ')})</span>`
        : '';

      const safeId   = (p.id || '').replace(/'/g, "\\'");
      const safeName = (p.name || '').replace(/'/g, "\\'");
      const cleanName = (p.name || '').toLowerCase().replace(/\s*\[[^\]]+\]$/, '').trim();
      const hasUnitData = knownUnitsIds.has(p.id) || knownUnitsIds.has(cleanName);

      return `<tr>
        <td style="white-space:nowrap;font-size:12px">
          👤 ${p.name}${nameHistory} ${stBadge}
          ${p.ally ? `<span style="font-size:11px;color:var(--text-muted)">[${p.ally}]</span>` : ''}
          ${hasUnitData ? `<button class="ikp-btn small outline" style="padding:2px 6px;font-size:11px;margin-left:4px"
            onclick="window.IkApp.showPlayerUnits('${safeId}','${safeName}')"
            title="Truppe e potenziamenti noti">🪖</button>` : ''}
        </td>
        ${scoreCells}
        <td style="font-size:10px;color:var(--text-muted);text-align:right">${fmt(p.lastUpdateDate)}</td>
      </tr>`;
    }).join('');

    list.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">
        ${filtered.length} player · ordinati per ${RANKING_LABELS[sortKey] || sortKey}
        · aggiornato ${fmt(filtered[0]?.lastUpdateDate)}
      </div>
      <div style="overflow-x:auto">
        <table class="ikp-db-table" style="width:100%">
          <thead><tr>
            <th>Player</th>
            ${scoreTh}
            <th style="text-align:right;font-size:11px">Rilevato</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
  function fmt(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('it-IT', { dateStyle:'short', timeStyle:'short' }); } catch { return iso; }
  }

  async function clearChanges() {
    if (!confirm('Eliminare tutti i cambi di stato, punteggi e alleanze?')) return;
    await Promise.all([
      window.IkDB.clear('state_changes'),
      window.IkDB.clear('score_changes').catch(() => {}),
      window.IkDB.clear('ally_changes').catch(() => {}),
    ]);
    renderChanges();
    toast('🗑 Cambi eliminati');
  }

  // ── DATABASE VIEWER ──────────────────────────

  // Configurazione colonne per ogni store
  const STORE_COLS = {
    building_data: [
      { k: 'buildingId',   label: 'ID' },
      { k: 'name',         label: 'Edificio' },
      { k: 'buildingType', label: 'Tipo' },
      { k: 'levelCount',   label: 'Livelli' },
      { k: 'requirement',  label: 'Requisito' },
      { k: 'updated',      label: 'Agg.' },
    ],
    unit_data: [
      { k: 'unitId',     label: 'ID' },
      { k: 'kind',       label: 'Tipo' },
      { k: 'name',       label: 'Nome' },
      { k: 'type',       label: 'Classe' },
      { k: 'isRanged',   label: 'Distanza' },
      { k: 'cost',       label: 'Costo' },
      { k: 'stats',      label: 'Stats' },
      { k: 'requirement',label: 'Requisito' },
    ],
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
    city_military: [
      { k: 'cityId',         label: 'ID' },
      { k: 'land',           label: 'Truppe' },
      { k: 'sea',            label: 'Navi' },
      { k: 'garrisonLimits', label: 'Lim. guarnigione' },
      { k: 'updated',        label: 'Agg.' },
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
    combat_reports: [
      { k: 'combatId',      label: 'ID' },
      { k: 'date',          label: 'Data' },
      { k: 'type',          label: 'Tipo' },
      { k: 'attackerName',  label: 'Attaccante' },
      { k: 'defenderName',  label: 'Difensore' },
      { k: 'totalRounds',   label: 'Round' },
      { k: 'winner',        label: 'Vincitore' },
      { k: 'capturedDate',  label: 'Catturato' },
    ],
    player_units: [
      { k: 'playerId',    label: 'ID' },
      { k: 'playerName',  label: 'Player' },
      { k: 'allyName',    label: 'Ally' },
      { k: 'units',       label: 'Unità (con up.)' },
      { k: 'lastSeen',    label: 'Ultimo visto' },
    ],
  };

  const STORE_SEARCH = {
    building_data: r => `${r.name} ${r.buildingType} ${r.requirement}`.toLowerCase(),
    unit_data:     r => `${r.name} ${r.kind} ${r.type}`.toLowerCase(),
    islands:       r => `${r.coords} ${r.name} ${r.tgName} ${r.templeName}`.toLowerCase(),
    my_cities:       r => `${r.name} ${r.cityId} ${r.islandX}:${r.islandY} ${r.tgName}`.toLowerCase(),
    enemy_buildings: r => `${r.cityName} ${r.ownerName} ${r.islandX}:${r.islandY}`.toLowerCase(),
    city_military: r => `${r.cityId}`.toLowerCase(),
    account_summary: r => 'main',
    players:       r => `${r.name} ${r.ally} ${r.status} ${r.stateSource}`.toLowerCase(),
    state_changes: r => `${r.playerName} ${r.allyName} ${r.prevState} ${r.newState}`.toLowerCase(),
    entries:       r => `${r.type} ${r.url}`.toLowerCase(),
    combat_reports:r => `${r.combatId} ${r.attackerName||''} ${r.defenderName||''} ${r.winner||''}`.toLowerCase(),
    player_units:  r => `${r.playerId} ${r.playerName||''} ${r.allyName||''}`.toLowerCase(),
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
    if (key === 'newUpdate' || key === 'updated' || key === 'date' || key === 'capturedDate' || key === 'lastSeen') {
      try { return new Date(v).toLocaleString('it-IT', { dateStyle:'short', timeStyle:'short' }); } catch {}
    }
    if (key === 'score') return Number(v) > 1000000 ? (Number(v)/1000000).toFixed(2)+'M' : Number(v).toLocaleString('it');
    if (key === 'state' || key === 'prevState' || key === 'newState') {
      const cls = { active:'state-active', inactive:'state-inactive', vacation:'state-vacation', banned:'state-banned' };
      const lbl = { active:'Attivo', inactive:'Inattivo', vacation:'Vacanza', banned:'Bannato' };
      return `<span class="ikp-state-badge ${cls[v]||''}">${lbl[v]||v}</span>`;
    }
    if (key === 'units' && v && typeof v === 'object') {
      // Mostra solo le unità con almeno un upgrade
      const withUpg = Object.values(v).filter(u => u.upgrades && Object.keys(u.upgrades).length > 0);
      if (!withUpg.length) return '<span style="color:#aaa">—</span>';
      return withUpg.map(u => `${u.unitName} (${Object.keys(u.upgrades).length} up.)`).join(', ');
    }
    if (key === 'isBusy') return v ? '🔴' : '🟢';
    if (key === 'isRanged') return v ? '🏹 Sì' : '⚔️ No';
    if (key === 'kind') return v === 'ship' ? '⛴ Nave' : '🪖 Truppa';
    if ((key === 'land' || key === 'sea') && v && typeof v === 'object') {
      const cats = Object.values(v).flat();
      const total = cats.reduce((sum, g) => sum + Object.values(g.units || {}).reduce((a, b) => a + b, 0), 0);
      return total > 0 ? total.toLocaleString('it') : '<span style="color:#aaa">—</span>';
    }
    if (key === 'garrisonLimits' && v && typeof v === 'object') {
      return `🪖 ${v.land ?? 0}/${v.landMax ?? 0} · ⛴ ${v.sea ?? 0}/${v.seaMax ?? 0}`;
    }
    if (key === 'cost' && v && typeof v === 'object') {
      const ICONS = { wood:'🪵', wine:'🍷', marble:'🪨', crystal:'🔷', sulfur:'🟡', citizens:'👤', upkeep:'🪙' };
      const parts = Object.entries(v)
        .filter(([k]) => ICONS[k])
        .map(([k, val]) => `${ICONS[k]}${typeof val === 'number' ? val.toLocaleString('it') : val}`);
      return parts.join(' ') || '—';
    }
    if (key === 'stats' && v && typeof v === 'object') {
      const parts = [];
      if (v.hp    != null) parts.push(`❤️${v.hp}`);
      if (v.speed != null) parts.push(`⚡${v.speed}`);
      if (v.armor != null) parts.push(`🛡${v.armor}`);
      return parts.join(' ') || '—';
    }
    if (key === 'requirement' && v && typeof v === 'object' && v.building) {
      return `${v.building}${v.level != null ? ` (Lv${v.level})` : ''}`;
    }
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
        { icon: '🏗', label: 'Edifici',   val: counts.building_data },
        { icon: '⚔️', label: 'Truppe/Navi', val: counts.unit_data },
        { icon: '🪖', label: 'Truppe/polis', val: counts.city_military },
        { icon: '🏝', label: 'Isole',     val: counts.islands },
        { icon: '🏠', label: 'Mie città', val: counts.my_cities },
        { icon: '🏢', label: 'Ed.nemici', val: counts.enemy_buildings },
        { icon: '👤', label: 'Players',   val: counts.players },
        { icon: '🔔', label: 'Cambi',     val: counts.state_changes },
        { icon: '📋', label: 'JSON raw',  val: counts.entries },
      ];
      statsEl.innerHTML = items.map(it => `
        <div style="background:var(--bg-card);border:1px solid var(--border);
             border-radius:var(--radius);padding:5px 4px;text-align:center;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--accent);white-space:nowrap;
               overflow:hidden;text-overflow:ellipsis">${it.icon} ${it.val}</div>
          <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;
               letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.label}</div>
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
    const stores = ['entries','islands','players','state_changes','my_cities','enemy_buildings','account_summary','building_data','unit_data','city_military','score_changes','ally_changes','combat_reports','player_units'];
    await Promise.all(stores.map(s => window.IkDB.clear(s).catch(()=>{})));
    sessionCount = 0; mapIslands = []; mapCities = []; mapPlayers = new Map();
    updateBadge(); refreshActiveTab(); updateStatusBar();
    toast('🗑 DB svuotato');
  }

  // Etichette leggibili per ciascuno store, riusate per conferma/toast
  const STORE_LABELS = {
    building_data:   '🏗 Dati edifici',
    unit_data:       '⚔️ Truppe/Navi',
    city_military:   '🪖 Truppe/Navi per polis',
    islands:         '🏝 Isole',
    my_cities:       '🏠 Mie città',
    account_summary: '💰 Riepilogo account',
    enemy_buildings: '🏢 Edifici nemici',
    players:         '👤 Players',
    state_changes:   '🔔 Cambi stato',
    score_changes:   '⭐ Var. punteggi',
    ally_changes:    '🏰 Cambi alleanza',
    combat_reports:  '⚔️ Rapporti combattimento',
    player_units:    '🪖 Truppe player',
    entries:         '📋 JSON raw',
  };

  // Svuota solo la sezione attualmente selezionata nella tendina di ricerca DB
  async function clearDbSection() {
    const store = document.getElementById('ikp-db-store')?.value;
    if (!store || !window.IkDB) return;
    const label = STORE_LABELS[store] || store;

    if (!confirm(`Svuotare solo la sezione "${label}"?\nQuesta azione non può essere annullata.`)) return;

    try {
      await window.IkDB.clear(store);

      // Sincronizza stato in-memory se la sezione svuotata influisce sulla mappa
      if (store === 'islands') mapIslands = [];
      if (store === 'players') mapPlayers = new Map();
      if (store === 'my_cities') mapCities = [];

      await renderDB();
      refreshActiveTab();
      updateStatusBar();
      toast(`🗑 Sezione "${label}" svuotata`);
    } catch (e) {
      toast('⚠️ Errore durante lo svuotamento: ' + e.message);
    }
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
    if (!panelOpen) return;
    if (activeTab === 'account')  renderAccount();
    if (activeTab === 'timers')   renderWineTimers();
    if (activeTab === 'mycities') renderMyCities();
  }
  function onMilitaryUpdated(cityId) { if (panelOpen && activeTab === 'military') renderMilitary(); }
  function onResearchUpdated()  { if (panelOpen && activeTab === 'timers') renderTimers(); }
  function onFleetsUpdated()    { if (panelOpen && activeTab === 'timers') renderTimers(); }
  function onTimerAdded()       { if (panelOpen) updateStatusBar(); }
  function onTimerExpired()     { if (panelOpen) { renderTimers(); updateStatusBar(); } }
  function onStateChanges(list) {
    if (panelOpen && activeTab === 'ranking') renderChanges();
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

    // 1b. Applica valori di default "Punti Generale" alle unità già presenti
    if (window.IkUnitGenerals) {
      const { applied } = await window.IkUnitGenerals.applyGeneralsDefaults();
      if (applied) log(`✅ Generali default applicati a ${applied} unità`);
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

    // Ripristina impostazioni utente
    saveAllRaw = localStorage.getItem('ikp_save_all_raw') === '1';
    if (saveAllRaw) log('⚠️ saveAllRaw ON — tutti i JSON verranno salvati');

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
    // Ripristina stato toggle saveAllRaw
    const cb = document.getElementById('ikp-save-all-raw');
    if (cb) cb.checked = saveAllRaw;
    updateSaveAllStatus();
    updateStorageInfo();
  }

  function toggleSaveAllRaw(enabled) {
    saveAllRaw = enabled;
    localStorage.setItem('ikp_save_all_raw', enabled ? '1' : '0');
    updateSaveAllStatus();
    toast(enabled ? '🗂 Cattura JSON attiva' : '🗂 Cattura JSON disattivata');
    log(enabled ? '⚠️ saveAllRaw ON — tutti i JSON verranno salvati' : 'saveAllRaw OFF');
  }

  function updateSaveAllStatus() {
    const el = document.getElementById('ikp-save-all-status');
    if (!el) return;
    el.textContent = saveAllRaw ? '🟠 Attiva — i JSON vengono salvati' : '⚫ Non attiva';
    el.style.color  = saveAllRaw ? '#ff9100' : 'var(--text-muted)';
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

  // ── SUMMARY COMPATTO (pannello in cima alla Classifica) ──
  async function renderSummary(filteredPlayers, lastUpdate) {
    const panel = document.getElementById('ikp-ranking-summary');
    if (!panel) return;
    if (!filteredPlayers || !filteredPlayers.length) {
      panel.innerHTML = '<span style="color:var(--text-muted)">Nessun player</span>';
      return;
    }

    const counts = { active:0, inactive:0, vacation:0, banned:0, deleted:0 };
    for (const p of filteredPlayers) {
      const s = p.status || 'unknown';
      if (counts[s] !== undefined) counts[s]++;
    }

    const stateColor = { active:'var(--ok,#2a8)', inactive:'var(--text-muted)', vacation:'#e80', banned:'var(--red)', deleted:'var(--red)' };
    const stateIcon  = { active:'🟢', inactive:'⚫', vacation:'🟡', banned:'🔴', deleted:'🔴' };
    const stateLabel = { active:'Attivi', inactive:'Inattivi', vacation:'Vacanza', banned:'Bannati', deleted:'Eliminati' };

    const chips = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `<span style="white-space:nowrap;padding:2px 7px;border-radius:10px;
             border:1px solid var(--border);font-size:12px">
        ${stateIcon[s]} <b style="color:${stateColor[s]}">${n}</b>
        <span style="color:var(--text-muted)">${stateLabel[s]}</span>
      </span>`).join('');

    panel.innerHTML = `
      <span style="font-size:12px;font-weight:700;margin-right:6px">👥 ${filteredPlayers.length} player</span>
      ${chips}
      ${lastUpdate ? `<span style="margin-left:auto;font-size:10px;color:var(--text-muted)">agg. ${fmt(lastUpdate)}</span>` : ''}
    `;
  }

  // ── RETENTION SETTINGS ───────────────────────────
  const LS_RETENTION = 'ikp_retention';

  function loadRetentionUI() {
    try {
      const r = JSON.parse(localStorage.getItem(LS_RETENTION) || '{}');
      const stateEl = document.getElementById('ikp-retention-state');
      const scoreEl = document.getElementById('ikp-retention-score');
      if (stateEl && r.state) stateEl.value = r.state;
      if (scoreEl && r.score) scoreEl.value = r.score;
    } catch {}
  }

  function saveRetention() {
    const stateEl = document.getElementById('ikp-retention-state');
    const scoreEl = document.getElementById('ikp-retention-score');
    const r = {
      state: parseInt(stateEl?.value || '0', 10) || 0,
      score: parseInt(scoreEl?.value || '0', 10) || 0,
    };
    try { localStorage.setItem(LS_RETENTION, JSON.stringify(r)); } catch {}
    const el = document.getElementById('ikp-retention-status');
    if (el) el.textContent = `Salvato: state_changes ${r.state || 'disabilitato'} gg · score_changes ${r.score || 'disabilitato'} gg`;
    return r;
  }

  async function pruneOld() {
    let removed = 0;
    // Pulizia entries JSON > 30 giorni (comportamento esistente)
    const n = await window.IkDB?.pruneEntries(30);
    removed += n || 0;

    // Pulizia in base alla retention configurata
    try {
      const r = JSON.parse(localStorage.getItem(LS_RETENTION) || '{}');
      const now = Date.now();

      if (r.state > 0) {
        const cutoff = new Date(now - r.state * 86400 * 1000).toISOString();
        const all = await window.IkDB.getAll('state_changes');
        let del = 0;
        for (const rec of all) {
          if ((rec.newUpdate || rec.date || '') < cutoff) {
            try { await window.IkDB.delete('state_changes', rec.id); del++; } catch {}
          }
        }
        removed += del;
        console.log(`[pruneOld] state_changes: rimossi ${del} record > ${r.state} giorni`);
      }

      if (r.score > 0) {
        const cutoff = new Date(now - r.score * 86400 * 1000).toISOString();
        const all = await window.IkDB.getAll('score_changes');
        let del = 0;
        for (const rec of all) {
          if ((rec.date || '') < cutoff) {
            try { await window.IkDB.delete('score_changes', rec.id); del++; } catch {}
          }
        }
        removed += del;
        console.log(`[pruneOld] score_changes: rimossi ${del} record > ${r.score} giorni`);
      }
    } catch(e) { console.warn('[pruneOld] retention error:', e.message); }

    toast(`🧹 Rimossi ${removed} record`);
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
        const msg = e?.message || String(e);
        const stack = e?.stack ? '\n' + e.stack.split('\n').slice(0,4).join('\n') : '';
        importLog('❌ Errore: ' + msg, 'var(--red)');
        console.error('[importFiles] ❌', file.name, e);
        toast('❌ ' + file.name + ': ' + msg);
        log('❌ Import ' + file.name + ': ' + msg + stack);
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
    closePopup, saveMyId, askNotifPerm, pruneOld, saveRetention,
    toggleSaveAllRaw,
    clearDB, clearDbSection, clearChanges, importFiles, importLog,
    onRankingUpdated, onIslandsUpdated, onCitiesUpdated, onResourcesUpdated,
    dbSearch, clearRaw, renderAccount, selectCity,
    downloadRecord, downloadSearchResults, downloadLog, clearLog, renderLogTab,
    renderCaptured, downloadCaptured, downloadAllCaptured, clearCaptured,
    renderMyCities, resetMyCities, renderWineTimers,
    renderMilitary, onMilitaryUpdated, renderCombatReports,
    renderSummary, renderChanges,
    onResearchUpdated, onFleetsUpdated, onTimerAdded,
    onTimerExpired, onStateChanges,
    onTownHallUpdated: (cityId) => {
      if (panelOpen && activeTab === 'mycities') renderMyCities();
      // HUD: trigger principale — il parser ha appena ricevuto dati da questa città
      injectCityHUD(cityId);
      refreshCityHUD(cityId);
    },
    onBlessingUpdated: (cityId, blessing) => { console.log('[IkApp] benedizione aggiornata city='+cityId, blessing?.godName); },
    showPlayerDetail, showPlayerUnits,
  };
  log('Modulo caricato');

  // ── HUD CITTÀ IN-PAGE ─────────────────────────────────────────────────────
  // Pannello a scomparsa iniettato nell'angolo in alto a sinistra del gioco,
  // visibile quando si naviga una propria città.
  // ─────────────────────────────────────────────────────────────────────────

  let hudCurrentCityId = null;
  let hudOpen = false;

  // Ricava cityId dall'URL della richiesta XHR intercettata (es. ?view=townHall&cityId=123)
  function hudGetCityIdFromUrl() {
    // Prova search string standard
    const m = /[?&]cityId=(\d+)/.exec(window.location.search)
           || /[?&]cityId=(\d+)/.exec(window.location.href);
    return m ? Number(m[1]) : null;
  }

  // Controlla se siamo in una vista città (DOM contiene elementi tipici)
  function hudIsInCityView() {
    // Ikariam mostra un breadcrumb tipo "Mondo > IslandName > CityName"
    // e un elemento con la mappa della città
    return !!(
      document.querySelector('#cityContainer, #city, .city-background, #buildingSlot_1, [id^="buildingSlot_"]')
      || document.querySelector('.cityView, #cityview, [class*="cityView"]')
    );
  }

  // Costruisce l'HTML del pannello per una città
  async function buildHudContent(cityId) {
    if (!window.IkDB) return '<p style="color:#9e8060;font-size:12px">DB non disponibile.</p>';

    let city = null;
    try { city = await window.IkDB.get('my_cities', cityId); } catch {}
    let th   = null;
    try { th   = await window.IkDB.get('town_hall_data', cityId); } catch {}

    if (!city && !th) return `
      <p style="color:#9e8060;font-size:12px">
        Nessun dato per questa polis.<br>
        Apri il <b>Municipio</b> per popolare il DB.
      </p>`;

    const fmtN = n => (n == null || isNaN(n)) ? '—'
      : n >= 1e6 ? (n/1e6).toFixed(2)+'M'
      : n >= 1e3 ? Math.round(n).toLocaleString('it')
      : String(Math.round(n));

    const row = (icon, label, val) => `
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:3px 0;border-bottom:1px solid #ede8df">
        <span style="color:#9e8060;font-size:12px">${icon} ${label}</span>
        <span style="font-weight:600;font-size:12px;color:#2c1f0e">${val}</span>
      </div>`;

    const section = (title) => `
      <div style="font-size:10px;font-weight:700;color:#9e8060;text-transform:uppercase;
        letter-spacing:.5px;margin:10px 0 4px">${title}</div>`;

    let html = '';

    // ── Header polis ──
    const coords = city ? `[${city.islandX}:${city.islandY}]` : '';
    const tgName = city?.tgName || '—';
    html += `<div style="font-size:14px;font-weight:700;color:#2c1f0e;margin-bottom:2px">
      🏛 ${city?.name || 'Polis #'+cityId}
    </div>
    <div style="font-size:11px;color:#9e8060;margin-bottom:8px">
      ${coords}${coords && tgName !== '—' ? ' · ' : ''}${tgName !== '—' ? '🪨 '+tgName : ''}
    </div>`;

    // ── Produzione ──
    if (city) {
      html += section('📦 Produzione');
      html += row('🪵','Legno/h', fmtN(city.woodPerHour));
      html += row('🪨','Bene/h',  fmtN(city.tgPerHour));
      html += row('🍷','Vino/h (consumo)', fmtN(city.wineSpendings));
    }

    // ── Dati Municipio ──
    if (th) {
      html += section('👥 Popolazione');
      html += row('👥','Abitanti', `${fmtN(th.population)} / ${fmtN(th.maxPopulation)}`);
      const citFree = (th.citizens != null && th.population != null)
        ? fmtN(th.citizens) : '—';
      const citBusy = (th.citizens != null && th.population != null)
        ? fmtN(th.population - th.citizens) : '—';
      html += row('😊','Felicità', th.happinessText || fmtN(th.happiness));
      html += row('🏗','Liberi / Occupati', `${citFree} / ${citBusy}`);
      html += row('🎓','Scienziati', fmtN(th.scientists));

      html += section('💰 Economia');
      html += row('💰','Entrate/h', fmtN(th.income));
      html += row('⚠️','Corruzione', fmtN(th.corruption));
      if (th.actionPoints != null)
        html += row('⚡','Azioni', `${th.actionPoints} / ${th.actionPointsMax}`);

      if (th.blessing?.godName) {
        const pct  = th.blessing.percent ? ` +${th.blessing.percent}%` : '';
        const left = th.blessing.graceText || '';
        html += section('✨ Benedizione');
        html += row('🙏', th.blessing.godName + pct, left || 'Attiva');
      }
    }

    // ── Edifici chiave ──
    if (city?.buildings?.length) {
      const byType = new Map(city.buildings.map(b => [b.building, b]));
      const kv = [
        ['🏛','Municipio',    byType.get('townHall')?.level],
        ['🏯','Mura',         byType.get('wall')?.level],
        ['⚔️','Caserma',     byType.get('barracks')?.level],
        ['⚓','Cantiere',     byType.get('shipyard')?.level],
        ['🕵️','Nascondiglio',byType.get('safehouse')?.level],
        ['🎓','Accademia',    byType.get('academy')?.level],
        ['🍺','Taverna',      byType.get('tavern')?.level],
      ].filter(([,,v]) => v != null);
      if (kv.length) {
        html += section('🏗 Edifici chiave');
        kv.forEach(([icon, label, val]) => { html += row(icon, label, 'Lv ' + val); });
      }
    }

    return html;
  }

  // Crea / aggiorna l'HUD nella pagina del gioco
  async function injectCityHUD(cityId) {
    hudCurrentCityId = cityId;

    let hud = document.getElementById('ikp-city-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'ikp-city-hud';
      document.body.appendChild(hud);
    }

    // Stile inline aggressivo per battere qualsiasi CSS del gioco
    hud.setAttribute('style', [
      'position:fixed',
      'bottom:80px',          // sopra la barra browser mobile
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'width:280px',
      'max-width:90vw',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'pointer-events:auto',
      'display:block',
      'visibility:visible',
      'opacity:1',
    ].join(';'));

    hud.innerHTML = `
      <button id="ikp-city-hud-toggle"
        style="all:unset;display:flex;align-items:center;justify-content:space-between;
          width:100%;box-sizing:border-box;
          background:#5a3e1b;border-radius:${hudOpen?'10px 10px 0 0':'10px'};
          padding:8px 14px;font-size:13px;font-weight:700;color:#fff8f0;
          cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,0.4);">
        <span>🏛 Polis — info rapide</span>
        <span id="ikp-hud-arrow">${hudOpen?'▲':'▼'}</span>
      </button>
      <div id="ikp-city-hud-body"
        style="background:#ffffff;border:2px solid #5a3e1b;border-top:none;
          border-radius:0 0 10px 10px;padding:10px 14px;
          box-shadow:0 6px 20px rgba(0,0,0,0.35);
          max-height:55vh;overflow-y:auto;
          display:${hudOpen?'block':'none'};
          box-sizing:border-box;color:#2c1f0e;">
        <div style="color:#9e8060;font-size:12px;text-align:center;padding:8px 0">⏳ Caricamento…</div>
      </div>
    `;

    document.getElementById('ikp-city-hud-toggle').addEventListener('click', () => {
      hudOpen = !hudOpen;
      const body   = document.getElementById('ikp-city-hud-body');
      const arrow  = document.getElementById('ikp-hud-arrow');
      const toggle = document.getElementById('ikp-city-hud-toggle');
      if (body)   body.style.display        = hudOpen ? 'block' : 'none';
      if (arrow)  arrow.textContent         = hudOpen ? '▲' : '▼';
      if (toggle) toggle.style.borderRadius = hudOpen ? '10px 10px 0 0' : '10px';
    });

    const body = document.getElementById('ikp-city-hud-body');
    if (body) body.innerHTML = await buildHudContent(cityId);
  }

  function removeCityHUD() {
    document.getElementById('ikp-city-hud')?.remove();
    hudCurrentCityId = null;
  }

  // Aggiorna contenuto HUD quando arrivano nuovi dati (chiamato da onTownHallUpdated)
  async function refreshCityHUD(cityId) {
    if (cityId !== hudCurrentCityId) return;
    const body = document.getElementById('ikp-city-hud-body');
    if (!body) return;
    body.innerHTML = await buildHudContent(cityId);
  }

  // ── Strategia di rilevamento multipla ──
  // Ikariam è una SPA: l'URL cambia raramente. Usiamo tre approcci:
  // 1. onTownHallUpdated (già agganciato sopra) → trigger principale
  // 2. MutationObserver sul DOM → rileva caricamento vista città
  // 3. Polling URL come fallback

  function hudDetectFromDOM() {
    // Cerca elementi DOM tipici della vista città di Ikariam
    const cityEl = document.querySelector(
      '#cityContainer, #city_overview, [id^="buildingSlot_"], .city_overview'
    );
    if (cityEl) {
      // Siamo in una vista città — prova a ricavare cityId dall'URL
      const urlCityId = hudGetCityIdFromUrl();
      if (urlCityId && urlCityId !== hudCurrentCityId) {
        injectCityHUD(urlCityId);
      } else if (!urlCityId && !document.getElementById('ikp-city-hud')) {
        // cityId non nell'URL ma DOM città presente: usa l'ultimo cityId noto
        if (hudCurrentCityId) injectCityHUD(hudCurrentCityId);
      }
    } else if (!cityEl && document.getElementById('ikp-city-hud')) {
      // Non siamo più in una vista città
      removeCityHUD();
    }
  }

  function hudWatchUrl() {
    let lastUrl = window.location.href;

    setInterval(() => {
      const url = window.location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        hudDetectFromDOM();
      }
    }, 400);

    // MutationObserver per cambi DOM (navigazione SPA senza cambio URL)
    const observer = new MutationObserver(() => hudDetectFromDOM());
    observer.observe(document.body, { childList: true, subtree: false });

    // Check iniziale
    hudDetectFromDOM();
  }

  // Esponi globalmente per test da console: window.IkHUD.show(cityId)
  window.IkHUD = { show: injectCityHUD, hide: removeCityHUD, refresh: refreshCityHUD };

  if (!isIkalogsSite) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hudWatchUrl);
    } else {
      hudWatchUrl();
    }
  }

})();

// ═══════════════════════════════════════════════
// IkWallCalc — Calcolatore Danno Mura
// Logica: mortai → catapulte → arieti per slot
// Lo slot non completamente abbattuto trasferisce danno agli slot rimasti.
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // ── Statistiche base delle unità di artiglieria ──────────────────────
  // unitId: 305=Mortaio, 306=Catapulta, 307=Ariete
  const ARTILLERY = [
    { id: 307, label: '🪨 Ariete',    baseAtk: 1600, inputId: 'ikwc-up-ram', dbId: 'unit_307' },
    { id: 306, label: '🎯 Catapulta', baseAtk: 2660, inputId: 'ikwc-up-cat', dbId: 'unit_306' },
    { id: 305, label: '💣 Mortaio',   baseAtk: 5400, inputId: 'ikwc-up-mor', dbId: 'unit_305' },
  ];

  // Efesto: +3% sul danno base per livello
  const EFESTO_BONUS_PER_LV = 0.03;

  // ── Formule dal foglio Excel ──────────────────────────────────────────

  // Numero slot mura in base al livello del municipio
  // Dal foglio: slot = ROUNDDOWN(townhallLv / 5, 0) + 3 (min 3, max 7 per municipio lv 20+)
  // Verifica: lv38 → 7 slot (coerente col foglio: 7)
  function wallSlots(townhallLv) {
    return Math.min(7, Math.max(3, Math.floor(townhallLv / 5) + 3));
  }

  // HP per slot mura in base al livello mura
  // Dal foglio: HP slot = wallLv * 990 (per lv20 = 19800, coerente col foglio)
  function wallSlotHp(wallLv) {
    return wallLv * 990;
  }

  // Armatura mura per livello
  // Dal foglio: lv20 → 1440. Formula: wallLv * 72
  function wallArmor(wallLv) {
    return wallLv * 72;
  }

  // Danno effettivo di un'unità tenendo conto del potenziamento officina, Efesto e armatura
  // Officina attacco: +5 danno flat per livello (fonte: dati foglio Excel)
  // Efesto: baseAtk * efestoLv * 3% (bonus percentuale sul base)
  function unitEffectiveDmg(baseAtk, upgradeLv, efestoLv, armorVal) {
    const efBonus  = Math.round(baseAtk * efestoLv * EFESTO_BONUS_PER_LV);
    const upFlat   = upgradeLv * 5; // +5 per livello officina
    const rawDmg   = baseAtk + efBonus + upFlat;
    return Math.max(0, rawDmg - armorVal);
  }

  // ── Stato: numero di round e valori input ────────────────────────────
  let numRounds = 1;

  function getRoundInputIds(roundIdx) {
    return ARTILLERY.map(u => `ikwc-r${roundIdx}-${u.id}`);
  }

  // ── Lettura potenziamenti dal DB ─────────────────────────────────────
  async function readUpgradesFromDB() {
    if (!window.IkDB) return {};
    const result = {};
    for (const u of ARTILLERY) {
      try {
        const rec = await window.IkDB.get('unit_data', u.dbId);
        if (rec?.upgrades?.offensive?.currentLevel != null) {
          result[u.id] = rec.upgrades.offensive.currentLevel;
        }
      } catch (_) {}
    }
    return result;
  }

  // ── Salva e ripristina i valori degli input per round ───────────────
  function saveRoundValues() {
    const saved = [];
    for (let r = 0; r < numRounds; r++) {
      const row = {};
      for (const u of ARTILLERY) {
        const el = document.getElementById(`ikwc-r${r}-${u.id}`);
        row[u.id] = el ? (parseInt(el.value) || 0) : 0;
      }
      saved.push(row);
    }
    return saved;
  }

  // ── Render dei round input ───────────────────────────────────────────
  function renderRoundInputs(savedValues) {
    const container = document.getElementById('ikwc-rounds-container');
    if (!container) return;

    let html = '';
    for (let r = 0; r < numRounds; r++) {
      html += `<div style="display:flex;align-items:center;gap:8px;background:var(--bg-alt);
                            padding:6px 10px;border-radius:6px;font-size:12px">
        <span style="font-weight:600;min-width:60px">Round ${r + 1}</span>`;
      for (const u of ARTILLERY) {
        const val = savedValues?.[r]?.[u.id] ?? 0;
        html += `<label style="display:flex;align-items:center;gap:4px">
          ${u.label}
          <input id="ikwc-r${r}-${u.id}" type="number" min="0" value="${val}"
            style="width:52px;padding:3px 5px;border:1px solid var(--border);border-radius:4px;
                   background:var(--bg);color:var(--text);font-size:12px"
            oninput="window.IkWallCalc.compute()">
        </label>`;
      }
      html += `</div>`;
    }
    container.innerHTML = html;
  }

  // ── Simulazione round per round ─────────────────────────────────────
  function simulate(slots, slotHp, unitDmg) {
    // slotHp: HP base iniziale di ogni slot
    // unitDmg: array per round, ciascuno array di {label, dmgPerUnit, count, unitId}
    //          unità in ordine mortaio → catapulta → ariete
    // Regole:
    //   - Ogni unità spara sul proprio slot corrente; se lo abbatte, il residuo è PERSO
    //     e l'unità successiva inizia sul prossimo slot
    //   - A fine round, il danno totale subito dagli slot ancora vivi viene diviso
    //     equamente per slot vivi; tutti i slot vivi nel round successivo partono da
    //     slotHpBase - (dannoTotaleVivi / nSlotVivi)

    let currentSlotHp = slotHp; // HP base attuale (ridefinito ogni round per redistribuzione)
    let hpSlots = Array.from({ length: slots }, () => currentSlotHp);

    const roundResults = [];

    for (let r = 0; r < unitDmg.length; r++) {
      const roundUnits = unitDmg[r];
      const hpBefore = [...hpSlots];

      // Simula ogni singola unità di artiglieria (mortai first, poi catapulte, poi arieti)
      let slotIdx = 0;
      // Avanza al primo slot vivo
      while (slotIdx < slots && hpSlots[slotIdx] <= 0) slotIdx++;

      for (const unitGroup of roundUnits) {
        for (let n = 0; n < unitGroup.count; n++) {
          if (slotIdx >= slots) break;
          const dmg = unitGroup.dmgPerUnit;
          if (dmg >= hpSlots[slotIdx]) {
            // Abbatte lo slot; residuo perso
            hpSlots[slotIdx] = 0;
            slotIdx++;
            while (slotIdx < slots && hpSlots[slotIdx] <= 0) slotIdx++;
          } else {
            hpSlots[slotIdx] -= dmg;
          }
        }
      }

      const dmgBySlot = hpSlots.map((hp, i) => Math.max(0, hpBefore[i] - hp));
      const activeSlotsAfter = hpSlots.filter(hp => hp > 0).length;
      const totalDmgDealt = dmgBySlot.reduce((a, b) => a + b, 0);

      roundResults.push({
        round: r + 1,
        hpBefore,
        hpAfter: [...hpSlots],
        dmgBySlot,
        totalDmgRound: totalDmgDealt,
        activeSlotsBefore: hpBefore.filter(hp => hp > 0).length,
        activeSlotsAfter,
        overflowDmg: 0, // nella logica per-unità non c'è overflow rilevante
        units: roundUnits,
        slotHpBase: currentSlotHp,
      });

      // Ridistribuzione per il round successivo:
      // tutti gli slot rimasti partono da: currentSlotHp - (dannoSubitoVivi / nVivi)
      if (r + 1 < unitDmg.length && activeSlotsAfter > 0) {
        const dmgOnLiving = hpSlots.reduce((sum, hp, i) => {
          return hp > 0 ? sum + dmgBySlot[i] : sum;
        }, 0);
        if (dmgOnLiving > 0) {
          const reduction = dmgOnLiving / activeSlotsAfter;
          currentSlotHp = Math.max(0, currentSlotHp - reduction);
          hpSlots = hpSlots.map(hp => hp > 0 ? currentSlotHp : 0);
        }
      }
    }

    return roundResults;
  }

  // ── Compute e render risultati ───────────────────────────────────────
  async function compute() {
    const resultsDiv = document.getElementById('ikwc-results');
    if (!resultsDiv) return;

    const efestoLv   = parseInt(document.getElementById('ikwc-efesto')?.value)   || 0;
    const townhallLv = parseInt(document.getElementById('ikwc-townhall')?.value) || 20;
    const wallLv     = parseInt(document.getElementById('ikwc-wall')?.value)     || 10;

    const slots   = wallSlots(townhallLv);
    const slotHp  = wallSlotHp(wallLv);
    const armor   = wallArmor(wallLv);

    // Leggi potenziamenti: prima dal DB, poi eventuale override manuale
    const dbUpgrades = await readUpgradesFromDB();

    const upgradeLevels = {};
    for (const u of ARTILLERY) {
      const manualInput = document.getElementById(u.inputId);
      const manualVal   = manualInput?.value !== '' ? parseInt(manualInput.value) : null;
      upgradeLevels[u.id] = manualVal ?? dbUpgrades[u.id] ?? 0;
    }

    // Danno netto per unità
    const unitStats = ARTILLERY.map(u => ({
      id:         u.id,
      label:      u.label,
      upgradeLv:  upgradeLevels[u.id],
      dmgPerUnit: unitEffectiveDmg(u.baseAtk, upgradeLevels[u.id], efestoLv, armor),
      baseAtk:    u.baseAtk,
    }));

    // Leggi quantità per ogni round — ordinato mortaio, catapulta, ariete
    const artilleryOrder = [305, 306, 307]; // mortaio first
    const unitDmgPerRound = [];
    for (let r = 0; r < numRounds; r++) {
      const roundUnits = artilleryOrder.map(unitId => {
        const inputEl = document.getElementById(`ikwc-r${r}-${unitId}`);
        const count   = parseInt(inputEl?.value) || 0;
        const stat    = unitStats.find(u => u.id === unitId);
        return { label: stat.label, dmgPerUnit: stat.dmgPerUnit, count, unitId };
      });
      unitDmgPerRound.push(roundUnits);
    }

    // Simula
    const results = simulate(slots, slotHp, unitDmgPerRound);

    // ── HTML risultati ────────────────────────────────────────────────
    const pct = hp => slotHp > 0 ? Math.floor(hp / slotHp * 100) : 0;
    const hpColor = p => p === 0 ? 'var(--danger,#e44)' : p < 50 ? '#f90' : 'var(--ok,#2a8)';

    // Tabella parametri
    let html = `
      <div style="background:var(--bg-alt);border:1px solid var(--border);border-radius:6px;
                  padding:8px 10px;margin-bottom:10px;font-size:12px">
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px">
          <span>🏛 Municipio <b>lv ${townhallLv}</b></span>
          <span>🏯 Mura <b>lv ${wallLv}</b></span>
          <span>⛩ Efesto <b>lv ${efestoLv}</b></span>
          <span>📦 Slot mura: <b>${slots}</b></span>
          <span>❤️ HP/slot: <b>${slotHp.toLocaleString('it')}</b></span>
          <span>🛡 Armatura: <b>${armor.toLocaleString('it')}</b></span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">`;

    for (const u of unitStats) {
      html += `<span>${u.label}: base <b>${u.baseAtk.toLocaleString('it')}</b>
        → up lv${u.upgradeLv} + Efesto lv${efestoLv}
        → <b style="color:var(--ok,#2a8)">${u.dmgPerUnit.toLocaleString('it')}</b> netto/unità</span>`;
    }
    html += `</div></div>`;

    // Tabella round per round
    for (const rr of results) {
      const totalUnits = rr.units.reduce((s, u) => s + u.count, 0);
      const unitSummary = rr.units.filter(u => u.count > 0)
        .map(u => `${u.count} ${u.label} (${(u.dmgPerUnit * u.count).toLocaleString('it')} dmg)`)
        .join(' + ') || '—';

      html += `
        <div style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;overflow:hidden">
          <div style="background:var(--bg-alt);padding:6px 10px;font-weight:600;font-size:12px;
                      display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span>⚔️ Round ${rr.round}</span>
            <span style="color:var(--text-muted);font-weight:400">${unitSummary}</span>
            <span style="margin-left:auto;color:var(--text-muted)">
              Danno totale: <b>${rr.totalDmgRound.toLocaleString('it')}</b>
              · Slot attivi: <b>${rr.activeSlotsAfter}/${slots}</b>
              ${rr.overflowDmg > 0 ? `· <span style="color:#f90">Overflow: ${Math.round(rr.overflowDmg).toLocaleString('it')}</span>` : ''}
            </span>
          </div>
          <div style="padding:8px 10px">
            <div style="display:flex;gap:4px;flex-wrap:wrap">`;

      for (let s = 0; s < slots; s++) {
        const hpAfter  = rr.hpAfter[s];
        const hpBefore = rr.hpBefore[s];
        const p        = pct(hpAfter);
        const pBefore  = pct(hpBefore);
        const dmg      = rr.dmgBySlot[s];
        html += `
              <div style="flex:1;min-width:60px;background:var(--bg);border:1px solid var(--border);
                          border-radius:4px;padding:5px 6px;text-align:center;font-size:11px">
                <div style="color:var(--text-muted);margin-bottom:2px">Slot ${s + 1}</div>
                <div style="font-weight:700;color:${hpColor(p)}">${p}%</div>
                <div style="font-size:10px;color:var(--text-muted)">${Math.round(hpAfter).toLocaleString('it')} HP</div>
                ${dmg > 0 ? `<div style="font-size:10px;color:var(--danger,#e44)">−${Math.round(dmg).toLocaleString('it')}</div>` : ''}
              </div>`;
      }

      html += `</div></div></div>`;
    }

    // Riepilogo finale
    const finalHp   = results[results.length - 1]?.hpAfter || Array(slots).fill(slotHp);
    const totalActive = finalHp.filter(hp => hp > 0).length;
    const totalHpLeft = finalHp.reduce((s, hp) => s + hp, 0);
    const pctLeft   = Math.round(totalHpLeft / (slots * slotHp) * 100);

    html += `
      <div style="background:var(--bg-alt);border:1px solid var(--border);border-radius:6px;
                  padding:8px 10px;font-size:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <span style="font-weight:600">📊 Riepilogo finale</span>
        <span>Slot rimasti: <b style="color:${totalActive === 0 ? 'var(--danger,#e44)' : 'var(--ok,#2a8)'}">${totalActive}/${slots}</b></span>
        <span>HP totali rimasti: <b>${Math.round(totalHpLeft).toLocaleString('it')}</b> (${pctLeft}%)</span>
        ${totalActive === 0 ? '<span style="color:var(--danger,#e44);font-weight:700">🏴 Mura abbattute!</span>' : ''}
      </div>`;

    resultsDiv.innerHTML = html;
  }

  function addRound() {
    if (numRounds >= 20) return;
    const saved = saveRoundValues();
    numRounds++;
    renderRoundInputs(saved);
    compute();
  }

  function removeRound() {
    if (numRounds <= 1) return;
    const saved = saveRoundValues();
    numRounds--;
    renderRoundInputs(saved);
    compute();
  }

  function reset() {
    numRounds = 1;
    document.getElementById('ikwc-efesto')?.setAttribute('value', '0');
    document.getElementById('ikwc-townhall')?.setAttribute('value', '20');
    document.getElementById('ikwc-wall')?.setAttribute('value', '10');
    ['ikwc-up-ram','ikwc-up-cat','ikwc-up-mor'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    renderRoundInputs();
    compute();
  }

  // Inizializzazione: al primo caricamento del pannello
  function init() {
    renderRoundInputs();
    compute();
  }

  // Esposto globalmente
  window.IkWallCalc = { compute, addRound, removeRound, reset, init };

  // Auto-init quando l'elemento risultati è presente nel DOM
  const observer = new MutationObserver(() => {
    if (document.getElementById('ikwc-results') && !window._ikWallCalcInited) {
      window._ikWallCalcInited = true;
      init();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[IkWallCalc] v1 OK');
})();


