// ═══════════════════════════════════════════════════════════════════
// parser_combatreport.js — Parser rapporti di combattimento
// Gestisce: militaryAdvisorReportView (riepilogo), 
//           militaryAdvisorDetailedReportView (round dettagliato),
//           militaryAdvisorCombatList (lista rapporti)
//
// Store salvati:
//   combat_reports  — record per combatId (aggiornato incrementalmente
//                     ad ogni round catturato)
//   player_units    — profilo truppe note per playerId
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Mappa unitId → nome (da unit_data DB, aggiornata dai dati reali) ──
  // Viene completata a runtime leggendo unit_data dal DB (vedi getUnitName)
  const UNIT_NAMES_FALLBACK = {
    // Navi
    201: 'Nave mercantile',
    204: 'Nave merci',
    210: 'Nave con Ariete',
    211: 'Nave lanciafiamme',
    212: 'Sottomarino',
    213: 'Nave con Balestra',
    214: 'Nave con Catapulta',
    215: 'Nave con Mortaio',
    216: 'Ariete a vapore',
    217: 'Nave lanciamissili',
    218: 'Ariete con ruote a pale',
    219: 'Portapalloni',
    220: 'Nave appoggio',
    221: 'Speronatrice',
    222: 'Tagliavele',
    223: 'Battello sputafuoco',
    224: 'Battello frombola',
    225: 'Ascia speronatrice',
    226: 'Nave catapulta',
    227: 'Terrore sottomarino',
    228: 'Fuoco di drago',
    229: 'Battello anti-dirigibili',
    230: 'Nido dei Barbari',
    // Truppe terra
    301: 'Fromboliere',
    302: 'Spadaccino',
    303: 'Oplita',
    304: 'Tiratore fucile a zolfo',
    305: 'Mortaio',
    306: 'Catapulta',
    307: 'Ariete',
    308: 'Gigante a Vapore',
    309: 'Pallone aerostatico bombardiere',
    310: 'Cuoco',
    311: 'Guaritore',
    312: 'Girocottero',
    313: 'Arciere',
    315: 'Giavellottiere',
    316: 'Branditore di asce dei Barbari',
    319: 'Spartano',
    320: 'Branditori di mazze dei Barbari',
    321: 'Accoltellatori dei Barbari',
    322: 'Lanciatori di asce dei Barbari',
    323: 'Rotori da guerra dei Barbari',
    324: 'Arieti dei Barbari',
    325: 'Catapulta dei Barbari',
    326: 'Caccia dei Barbari',
    327: 'Dirigibile dei Barbari',
  };

  // Cache runtime: popolata leggendo unit_data dal DB al primo parse
  let _unitNamesCache = null;

  async function getUnitNameMap() {
    if (_unitNamesCache) return _unitNamesCache;
    _unitNamesCache = { ...UNIT_NAMES_FALLBACK };
    try {
      const units = await window.IkDB.getAll('unit_data');
      for (const u of (units || [])) {
        if (u.unitId && u.name) _unitNamesCache[u.unitId] = u.name;
      }
    } catch {}
    return _unitNamesCache;
  }

  // Alias sincrono per retrocompatibilità (usa il fallback se la cache non è pronta)
  const UNIT_NAMES = UNIT_NAMES_FALLBACK;

  // Posizioni slot → nome posizione
  const SLOT_POSITIONS = {
    main:      'linea principale',
    flankLeft: 'fianco sinistro',
    flankRight:'fianco destro',
    longRange: 'distanza',
    artillery: 'artiglieria',
    air:       'aria',
    airfighter:'caccia',
  };

  // Mappa row-id numerico → nome posizione
  // (il secondo numero nello slotId, es. "21" in "slot11_21_5")
  const SLOT_ROW_TO_POSITION = {
    21:  'main',
    22:  'flankLeft',   // flankLeft e flankRight condividono row 22; si distinguono dal lato del campo
    23:  'longRange',
    24:  'artillery',
    25:  'air',
    128: 'airfighter',
  };

  // Altezza max della barra loss in px → usata per calcolare % danno
  const LOSS_BAR_MAX_PX = 32;

  // ── Utility ────────────────────────────────────────────────────

  function findChangeView(actions) {
    if (!Array.isArray(actions)) return null;
    for (const item of actions) {
      if (!Array.isArray(item) || !item.length) continue;
      if (item[0] === 'changeView' && Array.isArray(item[1]) && item[1].length >= 2) {
        return { viewType: item[1][0], html: item[1][1] };
      }
    }
    return null;
  }

  function findAction(actions, key) {
    for (const item of actions) {
      if (Array.isArray(item) && item[0] === key) return item[1];
    }
    return null;
  }

  function parseDate(str) {
    // "25.06.2026 6:03:34" → ISO
    if (!str) return null;
    const m = str.match(/(\d+)\.(\d+)\.(\d+)\s+(\d+):(\d+):(\d+)/);
    if (!m) return null;
    return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T${m[4].padStart(2,'0')}:${m[5]}:${m[6]}`).toISOString();
  }

  function unitIdFromClass(cls) {
    const m = cls.match(/\bs(\d{3})\b/);
    return m ? parseInt(m[1]) : null;
  }

  // ── Parser HTML riepilogo battaglia (militaryAdvisorReportView) ──
  function parseReportView(html, combatId, unitNames) {
    const $ = (sel, ctx) => (ctx || document.createElement('div'));
    // Usiamo DOMParser se disponibile (browser), altrimenti BeautifulSoup non è disponibile in JS
    let doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch {
      return null;
    }

    const result = { combatId };

    // Titolo e data (es: "Battaglia navale vicino a Polis (25.06.2026 6:03:34)")
    const headerEl = doc.querySelector('#troopsReport h3.header, .contentBox01h h3.header');
    if (headerEl) {
      const fullText = headerEl.textContent.trim();
      const dateEl   = headerEl.querySelector('.date');
      const dateStr  = dateEl ? dateEl.textContent.replace(/[()]/g,'').trim() : null;
      result.title   = fullText.replace(dateEl?.textContent || '', '').trim();
      result.date    = parseDate(dateStr);
      result.type    = result.title.toLowerCase().includes('nav') ? 'naval' : 'land';
    }

    // Attaccante / Difensore con cityId e receiverId
    const attDiv = doc.querySelector('.attacker');
    const defDiv = doc.querySelector('.defender');

    const parseParticipant = el => {
      if (!el) return {};
      const text    = el.textContent.replace(/Attaccante:|Difensore:/,'').trim();
      const nameM   = text.match(/^([^\[]+(?:\[[^\]]+\])?)/);
      const name    = nameM ? nameM[1].trim() : text;
      const allyM   = name.match(/\[([^\]]+)\]$/);
      const cityLink = el.querySelector('a[href*="cityId"]');
      const msgLink  = el.querySelector('a[href*="receiverId"]');
      const cityIdM  = cityLink?.getAttribute('href').match(/cityId=(\d+)/);
      const playerIdM= msgLink?.getAttribute('href').match(/receiverId=(\d+)/);
      const cityNameEl = cityLink;
      return {
        name:       name.replace(/\s*\[[^\]]+\]$/, '').trim(),
        allyName:   allyM ? allyM[1] : null,
        playerId:   playerIdM ? `av_${playerIdM[1]}` : null,
        cityId:     cityIdM ? cityIdM[1] : null,
        cityName:   cityNameEl ? cityNameEl.textContent.trim() : null,
      };
    };

    result.attacker = parseParticipant(attDiv);
    result.defender = parseParticipant(defDiv);

    // Round totali (da "Esito della Battaglia - Round N")
    const h5 = doc.querySelector('h5');
    if (h5) {
      const rM = h5.textContent.match(/Round\s+(\d+)/i);
      if (rM) result.totalRounds = parseInt(rM[1]);
    }

    // Tabella unità (riepilogo finale)
    const table = doc.querySelector('table.militaryList, table.table01.overview');
    if (table) {
      const unitSummary = { attacker: [], defender: [] };
      const headers = [...table.querySelectorAll('tr:first-child td.alt, tr:first-child td:not(.col1)')];
      // Prima riga attaccante (textblue), seconda difensore (textred)
      const rows = { attacker: table.querySelector('tr.textblue'), defender: table.querySelector('tr.textred') };
      for (const [side, row] of Object.entries(rows)) {
        if (!row) continue;
        const cols = [...row.querySelectorAll('td')];
        // Trova le colonne con numeri (count e loss)
        let colIdx = 0;
        for (const hdr of headers) {
          const unitDiv = hdr.querySelector('.fleet, .military');
          const unitId  = unitDiv ? unitIdFromClass(unitDiv.className) : null;
          if (!unitId) { colIdx++; continue; }
          const countTd = cols[colIdx + 1] || cols[colIdx];
          const lossTd  = cols[colIdx + 2] || cols[colIdx + 1];
          const countStr = countTd?.textContent.trim().replace(/[^0-9]/g,'');
          const lossStr  = lossTd?.textContent.trim().match(/\(?\-?(\d+)\)?/)?.[1];
          if (countStr) {
            unitSummary[side].push({
              unitId,
              name:   (unitNames[unitId] || UNIT_NAMES_FALLBACK[unitId] || `unit_${unitId}`),
              count:  parseInt(countStr) || 0,
              losses: parseInt(lossStr)  || 0,
            });
          }
          colIdx += 2;
        }
      }
      result.unitSummary = unitSummary;
    }

    // Vincitore / perdente
    const winners = doc.querySelector('.winners');
    const losers  = doc.querySelector('.losers');
    if (winners) result.winner   = winners.textContent.replace('Vincitori:','').trim();
    if (losers)  result.loser    = losers.textContent.replace('Perdenti:','').trim();

    // Events (benedizioni, spostamenti)
    const events = [];
    doc.querySelectorAll('.recentEvents li, .eventList li').forEach(li => {
      events.push(li.textContent.trim());
    });
    result.events = events;

    return result;
  }

  // ── Parser HTML round dettagliato (militaryAdvisorDetailedReportView) ──
  function parseDetailedRound(html, combatId, unitNames, slotMap) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch { return null; }

    const roundData = { combatId };

    // Numero round e data
    const navCenter = doc.querySelector('td[style*="text-align:center"], .round_nav td:nth-child(3)');
    if (navCenter) {
      const txt  = navCenter.textContent;
      const rM   = txt.match(/Round\s*(\d+)\s*\/\s*(\d+)/i);
      const dM   = txt.match(/\(([^)]+)\)/);
      if (rM) { roundData.round = parseInt(rM[1]); roundData.totalRounds = parseInt(rM[2]); }
      if (dM) roundData.date = parseDate(dM[1]);
    }

    // Attaccante / difensore nomi
    const attDiv = doc.querySelector('.container_attacker');
    const defDiv = doc.querySelector('.container_defender');
    roundData.attackerName = attDiv ? attDiv.textContent.replace('Attaccante:','').trim() : null;
    roundData.defenderName = defDiv ? defDiv.textContent.replace('Difensore:','').trim() : null;

    // Morale e unità totali dai tavoli container_morale
    const moraleTables = doc.querySelectorAll('table.container_morale');
    roundData.morale = {};
    moraleTables.forEach(t => {
      const isAtt = !!t.querySelector('th.atter');
      const isDef = !!t.querySelector('th.deffer');
      const side  = isAtt ? 'attacker' : isDef ? 'defender' : null;
      if (!side) return;
      const avatarEl  = t.querySelector('.avatarName');
      const sizeEl    = t.querySelector('.militarySize');
      const moraleEl  = t.querySelector('.morale');
      const playerIdM = t.querySelector('[id^="slotmorale"]')?.id.match(/slotmorale(\d+)/);
      // Morale bar: c'è un div con width% che indica il morale precedente
      const bars      = t.querySelectorAll('.morale_bar .bar');
      const moraleVal = moraleEl ? parseInt(moraleEl.textContent) : null;
      const sizeM     = sizeEl?.textContent.trim().match(/(\d+)\s*\(-(\d+)\)/);
      roundData.morale[side] = {
        playerName:  avatarEl?.textContent.trim(),
        playerId:    playerIdM ? `av_${playerIdM[1]}` : null,
        totalUnits:  sizeM ? parseInt(sizeM[1]) : null,
        losses:      sizeM ? parseInt(sizeM[2]) : null,
        moralePct:   moraleVal,
      };
    });

    // ── Slot battlefield ────────────────────────────────────────
    const parseField = (fieldId, slotMap) => {
      const field = doc.getElementById(fieldId);
      if (!field) return { slots: [], reserve: null };
      const slots = [];

      // Slot schierati nel campo
      field.querySelectorAll('.location').forEach(loc => {
        const posClass = [...loc.classList].find(c => SLOT_POSITIONS[c]);
        const position = posClass || 'unknown';
        loc.querySelectorAll('.slot:not(.empty)').forEach(slot => {
          const slotId  = slot.id; // es: "slot11_21_5"
          const unitId  = unitIdFromClass(slot.className);
          if (!unitId) return;
          const numText = slot.querySelector('.number')?.textContent || '';
          const numM    = numText.trim().match(/(\d+)\s*\(-(\d+)\)/);

          // Barra rossa (loss bar): height in px → % danno
          const lossPx   = parseInt(slot.querySelector('.loss')?.style?.height?.replace('px','') || '0');
          const damageBarPct = lossPx > 0 ? Math.round(lossPx / LOSS_BAR_MAX_PX * 100) : 0;

          // Barra ammo (ammoLoss): height in px → % munizioni consumate
          const ammoLossPx    = parseInt(slot.querySelector('.ammoLoss')?.style?.height?.replace('px','') || '0');

          // Dati dal tooltip (per-slot): slotRaw è la parte dopo "slot" nell'id
          const slotRaw    = slotId?.replace(/^slot/, '');
          const tipData    = slotMap ? slotMap.get(slotRaw) : null;

          slots.push({
            slotId,
            slotRaw,                       // es: "11_21_5"
            position,                      // nome posizione CSS (main, flankLeft, …)
            positionLabel: SLOT_POSITIONS[position] || position,
            unitId,
            unitName:    (unitNames[unitId] || UNIT_NAMES_FALLBACK[unitId] || `unit_${unitId}`),
            count:       numM ? parseInt(numM[1]) : null,
            losses:      numM ? parseInt(numM[2]) : null,
            lossBarPx:   lossPx,
            damageBarPct,                  // % danno stimato dalla barra rossa (0-100)
            ammoLossBarPx: ammoLossPx,
            // Dati arricchiti dal tooltip (se disponibili)
            hp:          tipData?.hp       ?? null,   // % punti vita
            ammo:        tipData?.ammo     ?? null,   // % munizioni rimaste
            lossesTooltip: tipData?.losses ?? null,   // perdite dal tooltip (possono differire dal (-N) del DOM)
            upgrades:    tipData?.upgrades ?? {},
          });
        });
      });

      // Riserva (unità fuori campo, nella reserve bar)
      const reserveUnits = [];
      const resDiv = doc.getElementById(fieldId === 'fieldAttacker' ? 'resAttacker' : 'resDefender');
      if (resDiv) {
        resDiv.querySelectorAll('li').forEach(li => {
          const unitId = unitIdFromClass(li.querySelector('div')?.className || '');
          const cnt    = li.textContent.trim().replace(/[^0-9]/g,'');
          if (unitId && cnt) reserveUnits.push({ unitId, unitName: (unitNames[unitId] || UNIT_NAMES_FALLBACK[unitId] || `unit_${unitId}`), count: parseInt(cnt) });
        });
      }

      return { slots, reserve: reserveUnits };
    };

    roundData.attacker = parseField('fieldAttacker', slotMap);
    roundData.defender = parseField('fieldDefender', slotMap);

    // Events recenti
    const events = [];
    doc.querySelectorAll('.recentEvents li, ul.recentEvents li').forEach(li => {
      events.push(li.textContent.trim());
    });
    // Fallback: cerca un div che contenga testo di evento
    if (!events.length) {
      doc.querySelectorAll('li').forEach(li => {
        const t = li.textContent.trim();
        if (t.match(/si schiera|miracolo|distrutta|spostate/i)) events.push(t);
      });
    }
    roundData.events = events;

    return roundData;
  }

  // ── Parser BBCode export (noViewChange → updateViewScriptData) ──
  function parseBBCodeStats(exportText) {
    if (!exportText) return null;
    const stats = { attacker: {}, defender: {} };
    // Pattern: "Generali......[color=...]val[/color]"
    // Il BBCode ha attaccante a sinistra e difensore a destra separati da " - "
    const lines = exportText.split('\n');
    for (const line of lines) {
      const clean = line.replace(/\[color=[^\]]+\]|\[\/color\]/g,'').replace(/\[.*?\]/g,'').trim();
      // Riga con " - " separa attaccante e difensore
      const parts = clean.split(' - ');
      if (parts.length !== 2) continue;
      const parseVal = s => parseFloat(s.replace(/[^0-9,.-]/g,'').replace(',','.')) || null;
      if (clean.match(/Generali/i)) {
        stats.attacker.generals  = parseVal(parts[0]);
        stats.defender.generals  = parseVal(parts[1]);
      } else if (clean.match(/Punti.*attacco/i)) {
        stats.attacker.attackPts = parseVal(parts[0]);
      } else if (clean.match(/Punti.*difesa/i)) {
        stats.defender.defensePts= parseVal(parts[1]);
      } else if (clean.match(/Danno ricevuto/i)) {
        stats.attacker.dmgReceived = parseVal(parts[0]);
        stats.defender.dmgReceived = parseVal(parts[1]);
      } else if (clean.match(/Percentuale.*danno/i)) {
        stats.attacker.dmgPct = parseVal(parts[0]);
        stats.defender.dmgPct = parseVal(parts[1]);
      }
    }
    return stats;
  }

  // ── Lista rapporti (militaryAdvisorCombatList) ────────────────
  function parseCombatList(html) {
    let doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); }
    catch { return []; }
    const reports = [];
    // Righe nella tabella rapporti
    doc.querySelectorAll('table tbody tr, .contentBox tr').forEach(tr => {
      const links = tr.querySelectorAll('a[href*="combatId"], a[href*="detailedCombatId"]');
      if (!links.length) return;
      let combatId = null;
      for (const a of links) {
        const m = a.href.match(/combatId=(\d+)/);
        if (m) { combatId = parseInt(m[1]); break; }
      }
      if (!combatId) return;
      const cells = [...tr.querySelectorAll('td')];
      const dateStr = cells[0]?.textContent.trim();
      const rounds  = cells[1]?.textContent.trim();
      const city    = cells[2]?.textContent.trim();
      const owner   = cells[3]?.textContent.trim();
      reports.push({ combatId, date: parseDate(dateStr), rounds: parseInt(rounds)||null, city, owner });
    });
    return reports;
  }

  // ── Salva / aggiorna player_units ────────────────────────────
  // Dal report si importano SOLO gli upgrades delle unità che li hanno.
  // Per le unità senza upgrades non si importa nulla dal report.
  // unitUpgrades: Map<unitName, { upgrades:{}, ... }> estratti dai tooltip
  async function updatePlayerUnits(playerId, playerName, allyName, blessings, combatId, date, unitUpgrades) {
    if (!playerId && !playerName) return;
    if (!unitUpgrades || unitUpgrades.size === 0) return;
    const unitNames = await getUnitNameMap();

    // Risolvi playerId: prima dal report, poi dalla classifica per nome
    let resolvedId = playerId;
    let unresolvedName = false;
    if (!resolvedId && playerName) {
      try {
        const allPlayers = await window.IkDB.getAll('players');
        const cleanName  = playerName.replace(/\s*\[[^\]]+\]$/, '').trim().toLowerCase();
        const found = allPlayers.find(p =>
          p.name?.toLowerCase() === cleanName ||
          p.name?.toLowerCase() === playerName.toLowerCase()
        );
        if (found) {
          resolvedId = found.id;
        } else {
          resolvedId = `name_${cleanName.replace(/\s+/g,'_')}`;
          unresolvedName = true;
          console.warn(`[IkCombat] Player "${playerName}" non trovato in classifica — chiave: ${resolvedId}`);
        }
      } catch {
        resolvedId = `name_${(playerName||'unknown').toLowerCase().replace(/\s*\[[^\]]+\]$/,'').replace(/\s+/g,'_')}`;
        unresolvedName = true;
      }
    }

    // Leggi record esistente
    let existing = null;
    try { existing = await window.IkDB.get('player_units', resolvedId); } catch {}

    const now  = date || new Date().toISOString();
    const prev = existing || {
      playerId: resolvedId, playerName, allyName,
      units: {}, blessings: [], combatHistory: [], unresolvedName,
    };

    // Aggiorna solo le unità che hanno almeno un upgrade
    const updatedUnits = { ...(prev.units || {}) };
    for (const [unitName, ud] of unitUpgrades.entries()) {
      const upgrades = ud.upgrades || {};
      if (Object.keys(upgrades).length === 0) continue;  // salta se nessun upgrade

      // Ricava unitId dal nome
      const unitId = Object.entries(unitNames).find(([, n]) => n === unitName)?.[0]
                  || Object.entries(UNIT_NAMES_FALLBACK).find(([, n]) => n === unitName)?.[0];
      if (!unitId) {
        console.warn(`[IkCombat] unitId non trovato per "${unitName}"`);
        continue;
      }

      const prevU          = updatedUnits[unitId] || {};
      const mergedUpgrades = { ...(prevU.upgrades || {}) };
      for (const [upgName, upgData] of Object.entries(upgrades)) {
        const ex = mergedUpgrades[upgName];
        if (!ex || ex.level < upgData.level) mergedUpgrades[upgName] = upgData;
      }

      updatedUnits[unitId] = {
        ...prevU,              // mantieni maxCount, totalLosses, source, ecc.
        unitId:   parseInt(unitId),
        unitName,
        upgrades: mergedUpgrades,
        lastSeen: now,
      };
    }

    // Storico combattimenti
    const prevHistory = prev.combatHistory || [];
    if (combatId && !prevHistory.find(h => h.combatId === combatId))
      prevHistory.push({ combatId, date: now });

    // Benedizioni (no duplicati)
    const prevBlessings = prev.blessings || [];
    const newBlessings  = [...prevBlessings];
    for (const b of (blessings || []))
      if (!newBlessings.find(x => x.name === b.name && x.date === b.date))
        newBlessings.push(b);

    const updated = {
      ...prev,
      playerName:    playerName || prev.playerName,
      allyName:      allyName   || prev.allyName,
      units:         updatedUnits,
      blessings:     newBlessings,
      combatHistory: prevHistory,
      lastSeen:      now,
      unresolvedName,
    };

    try {
      await window.IkDB.put('player_units', updated);
    } catch (e) {
      console.error('[IkCombat] updatePlayerUnits error:', e.message);
    }
  }

  // ── Salva combat_report (merge incrementale per round) ────────
  async function saveCombatReport(combatId, patch) {
    if (!combatId) return;
    let existing = null;
    try { existing = await window.IkDB.get('combat_reports', combatId); } catch {}

    const base = existing || { combatId, rounds: [], capturedRounds: [] };

    // Merge patch nel record base
    const merged = { ...base, ...patch, combatId };

    // I rounds si aggiungono per numero (non sovrascrivono l'intero array)
    if (patch._roundData) {
      const rd = patch._roundData;
      const idx = (merged.rounds || []).findIndex(r => r.round === rd.round);
      if (idx >= 0) {
        merged.rounds[idx] = { ...merged.rounds[idx], ...rd };
      } else {
        merged.rounds = [...(merged.rounds || []), rd].sort((a,b) => a.round - b.round);
      }
      // Tieni traccia dei round catturati
      if (!merged.capturedRounds.includes(rd.round)) {
        merged.capturedRounds = [...merged.capturedRounds, rd.round].sort((a,b) => a-b);
      }
      delete merged._roundData;
    }

    try {
      await window.IkDB.put('combat_reports', merged);
    } catch (e) {
      console.error('[IkCombat] saveCombatReport error:', e.message);
    }
  }

  // ── Estrai benedizioni dagli eventi ──────────────────────────
  function extractBlessings(events) {
    const blessings = [];
    for (const ev of (events || [])) {
      const m = ev.match(/(?:Il miracolo di )?([^\[]+(?:\[[^\]]+\])?)\s+'([^']+)'\s+è attivo\.?\s*(?:\(([^)]+)\))?/i);
      if (m) {
        blessings.push({
          playerName: m[1].trim(),
          name:       m[2].trim(),
          date:       parseDate(m[3]) || null,
        });
      }
    }
    return blessings;
  }

  // ── Estrai dati dai tooltip registerMouseOver ─────────────────
  // Formato slotId: "side_row_col"  es. "11_22_5"
  //   side: 11=attacker, 12=defender
  //   row:  21=main, 22=flank, 23=longRange, 24=artillery, 25=air, 128=airfighter
  //   col:  posizione nello slot (0-6)
  //
  // Tooltip: <h2>Nome Unità (Player[Ally])</h2>
  //          <p>Potenziamento attacco superiore (LV)</p>
  //          <p>Potenziamento difesa superiore (LV)</p>
  //          <p>Munizione: XX%</p>  (se presente)
  //          <p>Punti vita: XX%</p>
  //          <p>Perdite: N</p>       (se sconfitti)
  //
  // Ritorna:
  //   slotMap  : Map<slotId, { unitName, playerName, allyName, side, rowId, col, position,
  //                             upgrades, hp, ammo, losses }>
  //   playerData: Map<playerKey, { playerName, allyName, side,
  //                                units: Map<unitName, { upgrades, ammo, slotsCount, minHp, totalLosses }> }>
  function extractUpgradesFromTooltips(html) {
    const playerData = new Map();
    const slotMap    = new Map();   // ← NUOVO: dati per singolo slot

    // Estrai tutte le chiamate registerMouseOver
    const RE = /registerMouseOver\("([^"]+)",\s*"((?:[^"\\]|\\.)*)"\)/g;
    let m;
    while ((m = RE.exec(html)) !== null) {
      const slotRaw  = m[1];
      const tipRaw   = m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n');

      // Parse header: nome unità e player
      const h2M = tipRaw.match(/<h2>([^(]+)\(([^)]+)\)<\/h2>/);
      if (!h2M) continue;

      const unitName   = h2M[1].trim();
      const playerFull = h2M[2].trim();
      const allyM      = playerFull.match(/\[([^\]]+)\]$/);
      const playerName = playerFull.replace(/\s*\[[^\]]+\]$/, '').trim();
      const allyName   = allyM ? allyM[1] : null;
      const playerKey  = playerName.toLowerCase();

      // Parse potenziamenti: ogni <p> con "(N)" è un upgrade
      const upgrades = [];
      const upgRE = /<p>([^(<]+)\((\d+)\)<\/p>/g;
      let um;
      while ((um = upgRE.exec(tipRaw)) !== null) {
        const upgName = um[1].trim();
        const upgLv   = parseInt(um[2]);
        upgrades.push({ name: upgName, level: upgLv });
      }

      // Parse munizioni, HP, perdite
      const ammoM   = tipRaw.match(/Munizione:\s*(\d+)%/);
      const hpM     = tipRaw.match(/Punti vita:\s*(\d+)%/);
      const lossesM = tipRaw.match(/Perdite:\s*(\d+)/);

      const hp     = hpM     ? parseInt(hpM[1])     : null;
      const ammo   = ammoM   ? parseInt(ammoM[1])   : null;
      const losses = lossesM ? parseInt(lossesM[1]) : 0;

      // Decodifica slotId → side / rowId / col / position
      const slotParts = slotRaw.split('_');
      const sideNum   = parseInt(slotParts[0]);
      const rowId     = parseInt(slotParts[1]);
      const col       = parseInt(slotParts[2]);
      const side      = sideNum === 12 ? 'defender' : 'attacker';
      const position  = SLOT_ROW_TO_POSITION[rowId] || `row${rowId}`;

      // ── Salva dati per singolo slot ──────────────────────────
      slotMap.set(slotRaw, {
        slotRaw,
        side,
        rowId,
        col,
        position,
        unitName,
        playerName,
        allyName,
        upgrades: Object.fromEntries(upgrades.map(u => [u.name, u])),
        hp,
        ammo,
        losses,
      });

      // ── Aggrega per player → per unitName (come prima) ───────
      if (!playerData.has(playerKey)) {
        playerData.set(playerKey, { playerName, allyName, side, units: new Map() });
      }
      const pd = playerData.get(playerKey);

      if (!pd.units.has(unitName)) {
        pd.units.set(unitName, { unitName, upgrades: {}, slotsCount: 0, minHp: 100, totalLosses: 0, ammo: null });
      }
      const ud = pd.units.get(unitName);
      ud.slotsCount++;

      for (const upg of upgrades) {
        const existing = ud.upgrades[upg.name];
        if (!existing || existing.level < upg.level) {
          ud.upgrades[upg.name] = { name: upg.name, level: upg.level };
        }
      }

      if (hp !== null) ud.minHp       = Math.min(ud.minHp, hp);
      if (losses)      ud.totalLosses += losses;
      if (ammo !== null && ud.ammo === null) ud.ammo = ammo;
    }

    return { playerData, slotMap };
  }

  // ── Funzione principale parse ─────────────────────────────────
  async function parse(url, data, meta) {
    if (!Array.isArray(data)) return { parsed: 0 };

    // Carica mappa unitId→nome dal DB (con cache)
    const unitNames = await getUnitNameMap();

    const urlObj  = new URL('https://x.com/?' + url.split('?')[1]);
    const view    = urlObj.searchParams.get('view') || '';
    const combatId= parseInt(urlObj.searchParams.get('combatId') || urlObj.searchParams.get('detailedCombatId')) || null;

    const cv = findChangeView(data);
    let parsed = 0;

    // ── militaryAdvisorReportView ────────────────────────────────
    if (cv?.viewType === 'militaryAdvisorReportView' && combatId) {
      const report = parseReportView(cv.html, combatId, unitNames);
      if (report) {
        const patch = {
          type:          report.type,
          title:         report.title,
          date:          report.date,
          totalRounds:   report.totalRounds,
          attackerName:  report.attacker?.name,
          defenderName:  report.defender?.name,
          attacker:      report.attacker,
          defender:      report.defender,
          winner:        report.winner,
          loser:         report.loser,
          unitSummary:   report.unitSummary,
          capturedDate:  meta.date || new Date().toISOString(),
        };
        await saveCombatReport(combatId, patch);
        parsed++;
      }
    }

    // ── militaryAdvisorDetailedReportView ───────────────────────
    if (cv?.viewType === 'militaryAdvisorDetailedReportView' && combatId) {
      // Estrai tooltip PRIMA del parse DOM, così slotMap è disponibile per arricchire gli slot
      const tooltipResult  = extractUpgradesFromTooltips(cv.html);
      const allTooltipData = tooltipResult.playerData;
      const slotMap        = tooltipResult.slotMap;

      const round = parseDetailedRound(cv.html, combatId, unitNames, slotMap);
      if (round?.round != null) {
        const blessings = extractBlessings(round.events);

        const getPlayerUpgrades = (pName) => {
          const key = pName?.toLowerCase().replace(/\s*\[[^\]]+\]$/, '').trim();
          return allTooltipData.get(key)?.units || null;
        };

        const attName = round.morale?.attacker?.playerName || round.attackerName;
        const defName = round.morale?.defender?.playerName || round.defenderName;

        // Gli slot sono già arricchiti con hp/ammo/upgrades per-slot da parseField (via slotMap).
        // enrichSlots aggiunge in più i dati aggregati per-tipo unità (minHp, ammo aggregata)
        // solo come fallback per i campi non presenti nel singolo slot.
        const enrichSlots = (slots, pName) => {
          const upgData = allTooltipData.get(pName?.toLowerCase().replace(/\s*\[[^\]]+\]$/, '').trim());
          if (!upgData) return slots;
          return (slots || []).map(slot => {
            if (slot.hp !== null && Object.keys(slot.upgrades || {}).length > 0) return slot; // già completo
            const ud = upgData.units.get(slot.unitName);
            if (!ud) return slot;
            return {
              ...slot,
              upgrades: Object.keys(slot.upgrades || {}).length > 0 ? slot.upgrades : ud.upgrades,
              ammo:     slot.ammo ?? ud.ammo,
            };
          });
        };

        // Unità viste solo nei tooltip (non nel DOM, es. riserva non visibile)
        const tooltipOnlyUnits = (pName, existingSlots) => {
          const key = pName?.toLowerCase().replace(/\s*\[[^\]]+\]$/, '').trim();
          const pd  = allTooltipData.get(key);
          if (!pd) return [];
          const existingNames = new Set((existingSlots||[]).map(s => s.unitName));
          const extras = [];
          for (const [uName, ud] of pd.units.entries()) {
            if (!existingNames.has(uName)) {
              extras.push({ unitName: uName, slotsCount: ud.slotsCount, upgrades: ud.upgrades, fromTooltipOnly: true });
            }
          }
          return extras;
        };

        const roundData = {
          round:         round.round,
          date:          round.date,
          attackerName:  attName,
          defenderName:  defName,
          attacker: {
            slots:        enrichSlots(round.attacker?.slots, attName),
            reserve:      round.attacker?.reserve || [],
            morale:       round.morale?.attacker || {},
            tooltipExtra: tooltipOnlyUnits(attName, round.attacker?.slots),
          },
          defender: {
            slots:        enrichSlots(round.defender?.slots, defName),
            reserve:      round.defender?.reserve || [],
            morale:       round.morale?.defender || {},
            tooltipExtra: tooltipOnlyUnits(defName, round.defender?.slots),
          },
          events:    round.events,
          blessings,
        };

        const patch = {
          totalRounds:  round.totalRounds,
          _roundData:   roundData,
          capturedDate: meta.date || new Date().toISOString(),
        };
        if (round.morale?.attacker?.playerId) {
          patch.attackerPlayerId = round.morale.attacker.playerId;
          patch.attackerName     = attName;
        }
        if (round.morale?.defender?.playerId) {
          patch.defenderPlayerId = round.morale.defender.playerId;
          patch.defenderName     = defName;
        }

        await saveCombatReport(combatId, patch);

        // Aggiorna player_units per attaccante (solo upgrades dai tooltip)
        await updatePlayerUnits(
          round.morale?.attacker?.playerId,
          attName,
          null,
          blessings.filter(b => b.playerName === attName),
          combatId,
          round.date,
          getPlayerUpgrades(attName)
        );
        // Aggiorna player_units per difensore (solo upgrades dai tooltip)
        await updatePlayerUnits(
          round.morale?.defender?.playerId,
          defName,
          null,
          blessings.filter(b => b.playerName === defName),
          combatId,
          round.date,
          getPlayerUpgrades(defName)
        );

        parsed++;
      }
    }

    // ── noViewChange → updateViewScriptData (BBCode stats) ─────
    if (view === 'noViewChange' && combatId) {
      const scriptData = findAction(data, 'updateViewScriptData');
      if (scriptData?.exportText) {
        const stats = parseBBCodeStats(scriptData.exportText);
        if (stats) {
          await saveCombatReport(combatId, { stats });
          parsed++;
        }
      }
    }

    return { parsed };
  }

  // ── Match ─────────────────────────────────────────────────────
  function match(url) {
    return /view=(militaryAdvisorReportView|militaryAdvisorDetailedReportView|militaryAdvisorCombatList|noViewChange)/.test(url)
      && /(?:detailed)?[Cc]ombat[Ii]d=\d+/.test(url);
  }

  window.IkParsers?.registerParser('combat_report', { match, parse });
  console.log('[IkCombat] Parser rapporti di combattimento v1 OK');
})();
