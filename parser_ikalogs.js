// ═══════════════════════════════════════════════
// parser_ikalogs.js — Dati Ikalogs
// row: island + city + player + ally
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const STATES = {
    active:   { label:'Attivo',   icon:'🟢', color:'#4caf50' },
    inactive: { label:'Inattivo', icon:'🟡', color:'#ff9800' },
    vacation: { label:'Vacanza',  icon:'🔵', color:'#2196f3' },
    banned:   { label:'Bannato',  icon:'🔴', color:'#f44336' },
    deleted:  { label:'Eliminato',icon:'⚫', color:'#666' },
  };

  async function parse(url, data) {
    const rows = data?.body?.rows || data?.rows || (Array.isArray(data) ? data : null);
    if (!rows?.length) return 0;

    const islandsMap  = new Map();
    const playersMap  = new Map();
    const alliancesMap = new Map();
    const stateChanges = [];
    let countCities = 0;

    for (const row of rows) {
      const x = Number(row.x), y = Number(row.y);

      // ── Isola ──────────────────────────────
      if (x && y) {
        const coords = `${x}:${y}`;
        if (!islandsMap.has(coords)) {
          islandsMap.set(coords, {
            coords, x, y,
            id:        Number(row.island_id),
            name:      row.island_name || `[${x}:${y}]`,
            tradegood: Number(row.tradegood),
            wonder:    Number(row.wonder),
            woodLevel: Number(row.island_wood),
            tgLevel:   Number(row.island_tradegood),
            wdLevel:   Number(row.island_wonder),
            hasCities: true,
            cities:    [],
            playerIds: [],
            allyIds:   [],
            updated:   row.island_updated || new Date().toISOString(),
          });
        }
        const isl = islandsMap.get(coords);

        // Città su isola
        if (row.city_id) {
          isl.cities.push({
            id:       Number(row.city_id),
            name:     row.city_name,
            level:    Number(row.city_level),
            position: Number(row.city_pos),
            playerId: Number(row.player_id),
            playerName: row.player_name,
            allyName: row.ally_name,
            state:    row.player_state,
          });
          if (!isl.playerIds.includes(Number(row.player_id)))
            isl.playerIds.push(Number(row.player_id));
          if (row.ally_id && !isl.allyIds.includes(Number(row.ally_id)))
            isl.allyIds.push(Number(row.ally_id));

          // Salva città
          try {
            await window.IkDB.put('cities', {
              id:        Number(row.city_id),
              name:      row.city_name || '?',
              level:     Number(row.city_level),
              position:  Number(row.city_pos),
              islandX:   x, islandY: y,
              islandId:  Number(row.island_id),
              playerId:  Number(row.player_id),
              playerName:row.player_name,
              allyName:  row.ally_name,
              updated:   row.city_updated || new Date().toISOString(),
            });
            countCities++;
          } catch {}
        }
      }

      // ── Giocatore ──────────────────────────
      if (row.player_id && !playersMap.has(Number(row.player_id))) {
        const pid   = Number(row.player_id);
        const state = row.player_state || 'active';

        // Controlla cambio stato
        try {
          const prev = await window.IkDB.get('players', pid);
          if (prev && prev.state !== state) {
            const now = new Date().toISOString();
            stateChanges.push({
              playerId:   pid,
              playerName: row.player_name,
              allyName:   row.ally_name || '—',
              prevState:  prev.state,
              newState:   state,
              prevUpdate: prev.updated,
              newUpdate:  now,
            });
          }
        } catch {}

        playersMap.set(pid, {
          id:        pid,
          name:      row.player_name || '?',
          score:     Number(row.player_score),
          state,
          stateLabel:STATES[state]?.label || state,
          stateIcon: STATES[state]?.icon  || '⚪',
          stateColor:STATES[state]?.color || '#aaa',
          allyId:    Number(row.ally_id) || null,
          allyName:  row.ally_name || null,
          updated:   row.player_updated || new Date().toISOString(),
        });
      }

      // ── Alleanza ───────────────────────────
      if (row.ally_id && !alliancesMap.has(Number(row.ally_id))) {
        alliancesMap.set(Number(row.ally_id), {
          id:      Number(row.ally_id),
          name:    row.ally_name || '?',
          updated: row.ally_updated || new Date().toISOString(),
        });
      }
    }

    // Salva tutto nel DB
    for (const isl of islandsMap.values()) {
      isl.nCities = isl.cities.length;
      try { await window.IkDB.put('islands', isl); } catch {}
    }
    for (const pl of playersMap.values()) {
      try { await window.IkDB.put('players', pl); } catch {}
    }
    for (const al of alliancesMap.values()) {
      try { await window.IkDB.put('alliances', al); } catch {}
    }

    // Notifica cambi di stato
    if (stateChanges.length > 0) {
      await saveStateChanges(stateChanges);
      window.IkApp?.onStateChanges?.(stateChanges);
    }

    const total = islandsMap.size + countCities + playersMap.size;
    console.log(`[parser_ikalogs] ${islandsMap.size} isole, ${countCities} città, ${playersMap.size} players, ${stateChanges.length} cambi stato`);
    window.IkApp?.onIslandsUpdated?.(islandsMap.size);
    return total;
  }

  async function saveStateChanges(changes) {
    for (const c of changes) {
      try {
        await window.IkDB.add('state_changes', {
          ...c,
          id: undefined, // autoincrement
        });
      } catch {}
    }
  }

  window.IkParsers?.registerParser('ikalogs', {
    match: url => /ikalogs/i.test(url),
    parse,
  });
  console.log('[parser_ikalogs] OK');
})();
