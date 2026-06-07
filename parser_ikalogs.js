// ═══════════════════════════════════════════════
// parser_ikalogs.js — Dati Ikalogs
// Struttura: { body: { rows: [...] }, query, params }
// Ogni row: island + city + player + ally
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // Stati giocatore
  const STATES = {
    active:   { label: 'Attivo',    icon: '🟢', color: '#5a9e4a' },
    inactive: { label: 'Inattivo',  icon: '🟡', color: '#e8b84b' },
    vacation: { label: 'Vacanza',   icon: '🔵', color: '#2a6a9e' },
    banned:   { label: 'Bannato',   icon: '🔴', color: '#9e3a2a' },
    deleted:  { label: 'Eliminato', icon: '⚫', color: '#555' },
  };

  async function parse(url, data) {
    if (!data) return 0;

    // Supporta risposta diretta o wrappata
    const rows = data.body?.rows || data.rows || (Array.isArray(data) ? data : null);
    if (!rows || rows.length === 0) return 0;

    let countIslands = 0, countCities = 0, countPlayers = 0;

    // Raggruppa per isola per non fare put ridondanti
    const islandsMap  = new Map();
    const playersMap  = new Map();
    const alliancesMap = new Map();

    for (const row of rows) {
      // ── Isola ──────────────────────────────────
      const x = Number(row.x);
      const y = Number(row.y);
      if (x && y) {
        const coords = `${x}:${y}`;
        if (!islandsMap.has(coords)) {
          islandsMap.set(coords, {
            coords,
            id:        Number(row.island_id),
            name:      row.island_name || `[${x}:${y}]`,
            x, y,
            tradegood: Number(row.tradegood),
            wonder:    Number(row.wonder),
            woodLevel: Number(row.island_wood),
            tgLevel:   Number(row.island_tradegood),
            wdLevel:   Number(row.island_wonder),
            nCities:   0, // aggiornato sotto
            cities:    [],
            updated:   row.island_updated || new Date().toISOString(),
          });
        }
      }

      // ── Città ──────────────────────────────────
      if (row.city_id) {
        const cityId = Number(row.city_id);
        const coords = `${x}:${y}`;
        const isl = islandsMap.get(coords);
        if (isl) {
          isl.cities.push({
            id:       cityId,
            name:     row.city_name,
            level:    Number(row.city_level),
            position: Number(row.city_pos),
            playerId: Number(row.player_id),
          });
          isl.nCities = isl.cities.length;
        }

        // Salva anche in store cities
        await window.IkDB.put('cities', {
          id:       cityId,
          name:     row.city_name || '?',
          level:    Number(row.city_level),
          position: Number(row.city_pos),
          islandX:  x, islandY: y,
          islandId: Number(row.island_id),
          playerId: Number(row.player_id),
          updated:  row.city_updated || new Date().toISOString(),
        });
        countCities++;
      }

      // ── Giocatore ──────────────────────────────
      if (row.player_id && !playersMap.has(Number(row.player_id))) {
        const playerId = Number(row.player_id);
        const state    = row.player_state || 'active';

        // Controlla cambio stato precedente
        try {
          const prev = await window.IkDB.get('players', playerId);
          if (prev && prev.state !== state) {
            window.IkNotifier?.notify(
              '📊 Cambio stato giocatore',
              `${row.player_name}: ${STATES[prev.state]?.label||prev.state} → ${STATES[state]?.label||state}`,
              { id: `state_${playerId}`, urgent: state === 'active' && prev.state !== 'active' }
            );
          }
        } catch {}

        playersMap.set(playerId, {
          id:      playerId,
          name:    row.player_name || '?',
          score:   Number(row.player_score),
          state,
          stateIcon:  STATES[state]?.icon  || '⚪',
          stateColor: STATES[state]?.color || '#aaa',
          allyId:  Number(row.ally_id) || null,
          allyName:row.ally_name || null,
          updated: row.player_updated || new Date().toISOString(),
        });
        countPlayers++;
      }

      // ── Alleanza ───────────────────────────────
      if (row.ally_id && !alliancesMap.has(Number(row.ally_id))) {
        alliancesMap.set(Number(row.ally_id), {
          id:      Number(row.ally_id),
          name:    row.ally_name || '?',
          updated: row.ally_updated || new Date().toISOString(),
        });
      }
    }

    // Salva isole
    for (const isl of islandsMap.values()) {
      try { await window.IkDB.put('islands', isl); countIslands++; } catch {}
    }
    // Salva giocatori
    for (const pl of playersMap.values()) {
      try { await window.IkDB.put('players', pl); } catch {}
    }
    // Salva alleanze
    for (const al of alliancesMap.values()) {
      try { await window.IkDB.put('alliances', al); } catch {}
    }

    console.log(`[parser_ikalogs] ${countIslands} isole, ${countCities} città, ${countPlayers} giocatori`);
    window.IkApp?.onIslandsUpdated?.(countIslands);
    return countIslands + countCities + countPlayers;
  }

  window.IkParsers?.registerParser('ikalogs', {
    match: url => /ikalogs/i.test(url),
    parse,
  });

  console.log('[parser_ikalogs] Caricato');
})();
