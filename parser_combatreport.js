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

  // ── Mappa class CSS → unitId numerico ──────────────────────────
  // La classe è "s<N>" dove N è l'ID interno Ikariam
  // Truppe di terra
  const UNIT_NAMES = {
    // Navi
    211: 'Nave lanciafiamme',
    212: 'Ariete a vapore',
    213: 'Bombardiere',
    214: 'Nave da guerra',
    215: 'Incrociatore corazzato',
    216: 'Ariete a vapore',   // alt (alcuni server usano 216)
    217: 'Sommergibile',
    // Truppe terra
    301: 'Tiratore',
    302: 'Oplita',
    303: 'Arciere',
    304: 'Carro',
    305: 'Mortaio',
    306: 'Catapulta',
    307: 'Ariete',
    308: 'Dottore',
    309: 'Cuoco',
    310: 'Spia',
  };

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
  function parseReportView(html, combatId) {
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
              name:   UNIT_NAMES[unitId] || `unit_${unitId}`,
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
  function parseDetailedRound(html, combatId) {
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
    const parseField = (fieldId) => {
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
          const lossPx  = slot.querySelector('.loss')?.style?.height?.replace('px','');
          slots.push({
            slotId,
            position,
            unitId,
            unitName: UNIT_NAMES[unitId] || `unit_${unitId}`,
            count:    numM ? parseInt(numM[1]) : null,
            losses:   numM ? parseInt(numM[2]) : null,
            lossBarPx:lossPx ? parseInt(lossPx) : 0,
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
          if (unitId && cnt) reserveUnits.push({ unitId, unitName: UNIT_NAMES[unitId] || `unit_${unitId}`, count: parseInt(cnt) });
        });
      }

      return { slots, reserve: reserveUnits };
    };

    roundData.attacker = parseField('fieldAttacker');
    roundData.defender = parseField('fieldDefender');

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
  async function updatePlayerUnits(playerId, playerName, allyName, slots, reserve, blessings, combatId, date, unitUpgrades) {
    if (!playerId && !playerName) return;

    // Se non abbiamo playerId, prova a cercarlo in players per nome
    let resolvedId = playerId;
    let unresolvedName = false;
    if (!resolvedId && playerName) {
      try {
        const allPlayers = await window.IkDB.getAll('players');
        const found = allPlayers.find(p =>
          p.name?.toLowerCase() === playerName.toLowerCase() ||
          p.name?.toLowerCase().includes(playerName.toLowerCase())
        );
        if (found) {
          resolvedId = found.id; // es. "av_100141"
        } else {
          // Usa il nome come chiave (prefisso "name_")
          resolvedId = `name_${playerName.toLowerCase().replace(/\s+/g,'_')}`;
          unresolvedName = true;
          console.warn(`[IkCombat] Player "${playerName}" non trovato in classifica — usata chiave nome`);
        }
      } catch {
        resolvedId = `name_${(playerName||'unknown').toLowerCase().replace(/\s+/g,'_')}`;
        unresolvedName = true;
      }
    }

    // Aggrega le unità viste nel round (campo + riserva)
    const unitsSeen = {};
    for (const slot of (slots || [])) {
      if (!slot.unitId) continue;
      const total = (slot.count || 0) + (slot.losses || 0);
      if (!unitsSeen[slot.unitId]) unitsSeen[slot.unitId] = { count: 0, losses: 0 };
      unitsSeen[slot.unitId].count  += slot.count  || 0;
      unitsSeen[slot.unitId].losses += slot.losses || 0;
    }
    for (const r of (reserve || [])) {
      if (!r.unitId) continue;
      if (!unitsSeen[r.unitId]) unitsSeen[r.unitId] = { count: 0, losses: 0 };
      unitsSeen[r.unitId].count += r.count || 0;
    }

    // Aggiunge le informazioni di potenziamento dai tooltip (per nome unità)
    // unitUpgrades: Map<unitName, { upgrades: {name→{name,level}}, slotsCount, ammo, ... }>
    const upgradesByName = {};
    if (unitUpgrades) {
      for (const [unitName, ud] of unitUpgrades.entries()) {
        upgradesByName[unitName] = ud;
      }
    }

    // Leggi record esistente
    let existing = null;
    try { existing = await window.IkDB.get('player_units', resolvedId); } catch {}

    const now = date || new Date().toISOString();
    const prev = existing || { playerId: resolvedId, playerName, allyName, units: {}, blessings: [], combatHistory: [], unresolvedName };

    // Aggiorna le unità: teniamo il massimo osservato per tipo
    const updatedUnits = { ...(prev.units || {}) };
    for (const [id, data] of Object.entries(unitsSeen)) {
      const prevU     = updatedUnits[id] || { maxCount: 0, totalLosses: 0, lastSeen: null, upgrades: {} };
      const unitName  = UNIT_NAMES[id] || `unit_${id}`;
      // Potenziamenti: cerca per nome unità nei tooltip data
      const tooltipData = upgradesByName[unitName] || null;
      const prevUpgrades = prevU.upgrades || {};
      const mergedUpgrades = { ...prevUpgrades };
      if (tooltipData) {
        for (const [upgName, upgData] of Object.entries(tooltipData.upgrades || {})) {
          const existing = mergedUpgrades[upgName];
          if (!existing || existing.level < upgData.level) {
            mergedUpgrades[upgName] = upgData;
          }
        }
      }
      updatedUnits[id] = {
        unitId:      parseInt(id),
        unitName,
        maxCount:    Math.max(prevU.maxCount || 0, data.count + data.losses),
        totalLosses: (prevU.totalLosses || 0) + data.losses,
        lastSeen:    now,
        source:      'combat',
        upgrades:    mergedUpgrades,
        ...(tooltipData?.ammo != null ? { lastAmmo: tooltipData.ammo } : {}),
      };
    }

    // Aggiungi benedizioni (no duplicati per nome+data)
    const prevBlessings = prev.blessings || [];
    const newBlessings  = [...prevBlessings];
    for (const b of (blessings || [])) {
      const dup = newBlessings.find(x => x.name === b.name && x.date === b.date);
      if (!dup) newBlessings.push(b);
    }

    // Storico combattimenti (solo combatId e data)
    const prevHistory = prev.combatHistory || [];
    if (combatId && !prevHistory.find(h => h.combatId === combatId)) {
      prevHistory.push({ combatId, date: now });
    }

    const updated = {
      ...prev,
      playerName:     playerName || prev.playerName,
      allyName:       allyName   || prev.allyName,
      units:          updatedUnits,
      blessings:      newBlessings,
      combatHistory:  prevHistory,
      lastSeen:       now,
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

  // ── Estrai potenziamenti dai tooltip registerMouseOver ────────
  // Formato slotId: "side_row_col"  es. "11_22_5"
  //   side: 11=attacker, 12=defender
  //   row:  21=main, 22=flankLeft/Right, 23=longRange, 24=artillery, 25=air, ...
  //   col:  posizione nello slot
  //
  // Tooltip: <h2>Nome Unità (Player[Ally])</h2>
  //          <p>Potenziamento attacco superiore (LV)</p>
  //          <p>Potenziamento difesa superiore (LV)</p>
  //          <p>Munizione: XX%</p>  (se presente)
  //          <p>Punti vita: XX%</p>
  //          <p>Perdite: N</p>       (se sconfitti)
  //
  // Ritorna: Map<playerKey, { playerName, allyName, units: Map<unitName, { upgrades, ammo, slots }> }>
  function extractUpgradesFromTooltips(html) {
    const playerData = new Map();

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
      // playerFull può essere "Diesel[TIGRE]" o "Diesel"
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
        // Categorizza: "superiore" indica una ricerca avanzata
        // La prima <p> è tipicamente attacco, la seconda difesa
        upgrades.push({ name: upgName, level: upgLv });
      }

      // Parse munizioni e HP
      const ammoM   = tipRaw.match(/Munizione:\s*(\d+)%/);
      const hpM     = tipRaw.match(/Punti vita:\s*(\d+)%/);
      const lossesM = tipRaw.match(/Perdite:\s*(\d+)/);

      // Side dal primo numero dello slotId
      const sidePart = slotRaw.split('_')[0];
      const side     = sidePart === '12' ? 'defender' : 'attacker';

      // Aggrega per player → per unitName
      if (!playerData.has(playerKey)) {
        playerData.set(playerKey, { playerName, allyName, side, units: new Map() });
      }
      const pd = playerData.get(playerKey);

      if (!pd.units.has(unitName)) {
        pd.units.set(unitName, { unitName, upgrades: {}, slotsCount: 0, minHp: 100, totalLosses: 0, ammo: null });
      }
      const ud = pd.units.get(unitName);
      ud.slotsCount++;

      // Potenziamenti: tieni il massimo (tutti gli slot dello stesso tipo hanno gli stessi lv)
      for (const upg of upgrades) {
        const existing = ud.upgrades[upg.name];
        if (!existing || existing.level < upg.level) {
          ud.upgrades[upg.name] = { name: upg.name, level: upg.level };
        }
      }

      if (hpM)     ud.minHp      = Math.min(ud.minHp, parseInt(hpM[1]));
      if (lossesM) ud.totalLosses += parseInt(lossesM[1]);
      if (ammoM && ud.ammo === null) ud.ammo = parseInt(ammoM[1]);
    }

    return playerData;
  }

  // ── Funzione principale parse ─────────────────────────────────
  async function parse(url, data, meta) {
    if (!Array.isArray(data)) return { parsed: 0 };

    const urlObj  = new URL('https://x.com/?' + url.split('?')[1]);
    const view    = urlObj.searchParams.get('view') || '';
    const combatId= parseInt(urlObj.searchParams.get('combatId') || urlObj.searchParams.get('detailedCombatId')) || null;

    const cv = findChangeView(data);
    let parsed = 0;

    // ── militaryAdvisorReportView ────────────────────────────────
    if (cv?.viewType === 'militaryAdvisorReportView' && combatId) {
      const report = parseReportView(cv.html, combatId);
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
      const round = parseDetailedRound(cv.html, combatId);
      if (round?.round != null) {
        const blessings = extractBlessings(round.events);

        // Estrai potenziamenti dai tooltip registerMouseOver
        const allTooltipData = extractUpgradesFromTooltips(cv.html);
        // Separa per side (basato sul campo "side" nel playerData)
        const getPlayerUpgrades = (pName) => {
          const key = pName?.toLowerCase().replace(/\s*\[[^\]]+\]$/, '').trim();
          return allTooltipData.get(key)?.units || null;
        };

        const attName = round.morale?.attacker?.playerName || round.attackerName;
        const defName = round.morale?.defender?.playerName || round.defenderName;

        // Aggiungi upgrades ai slot del round (per salvarli nel combat_report)
        const enrichSlots = (slots, pName) => {
          const upgData = allTooltipData.get(pName?.toLowerCase().replace(/\s*\[[^\]]+\]$/, '').trim());
          if (!upgData) return slots;
          return (slots || []).map(slot => {
            const ud = upgData.units.get(slot.unitName);
            if (!ud) return slot;
            return { ...slot, upgrades: ud.upgrades, ammo: ud.ammo };
          });
        };

        // Aggiungi anche le unità viste solo nei tooltip (non nei slot DOM, es. riserva non visibile)
        // Le aggiunge come slotExtra per completezza
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

        // Aggiorna player_units per attaccante
        await updatePlayerUnits(
          round.morale?.attacker?.playerId,
          attName,
          null,
          round.attacker?.slots,
          round.attacker?.reserve,
          blessings.filter(b => b.playerName === attName),
          combatId,
          round.date,
          getPlayerUpgrades(attName)
        );
        // Aggiorna player_units per difensore
        await updatePlayerUnits(
          round.morale?.defender?.playerId,
          defName,
          null,
          round.defender?.slots,
          round.defender?.reserve,
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
