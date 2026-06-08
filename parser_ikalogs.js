// ═══════════════════════════════════════════════
// parser_ikalogs.js v2 — Parser dati Ikalogs
//
// NOTA: il JSON ikalogs NON contiene player_id né city_id.
// Chiavi usate:
//   players:  player_name (stringa)
//   cities:   "{island_id}_{city_name}" (stringa)
//   islands:  "X:Y" (coords)
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  function log(...a) { console.log('[parser_ikalogs]', ...a); }

  // Chiave player univoca: usa nome (no player_id disponibile)
  function playerKey(name) { return `pl_${name}`; }

  // Chiave città univoca: island_id + city_name
  function cityKey(islandId, cityName) { return `${islandId}_${cityName}`; }

  async function parse(url, data) {
    const body = data?.body;
    if (!body) { log('body mancante'); return 0; }

    let countIslands = 0, countCities = 0, countPlayers = 0;
    const playersSeen = new Map(); // playerKey → record

    // ── 1. cities_info ───────────────────────────
    const citiesInfo = body.cities_info || {};
    for (const xStr of Object.keys(citiesInfo)) {
      const col = citiesInfo[xStr];
      for (const yStr of Object.keys(col)) {
        const cities = col[yStr];
        if (!Array.isArray(cities) || cities.length === 0) continue;

        const x = Number(xStr), y = Number(yStr);
        const first   = cities[0];
        const islandId = Number(first.island_id);

        // Salva isola (merge con dati worldmap se già presenti)
        const existing = await window.IkDB.get('islands', `${x}:${y}`);
        await window.IkDB.put('islands', {
          ...(existing || {}),
          coords:    `${x}:${y}`,
          id:        islandId,
          x, y,
          hasCities: true,
          nCities:   cities.length,
          allyNames: [...new Set(cities.map(c => c.ally_name).filter(Boolean))],
          ikalogsUpdated: new Date().toISOString(),
        });
        countIslands++;

        // Salva città e players
        for (const city of cities) {
          const pName = city.player_name || '?';
          const pKey  = playerKey(pName);
          const cKey  = cityKey(islandId, city.city_name);

          // Città
          await window.IkDB.put('cities', {
            id:         cKey,
            name:       city.city_name   || '?',
            level:      Number(city.city_level) || 0,
            islandId,
            islandX:    x,
            islandY:    y,
            playerId:   pKey,       // riferimento al player
            playerName: pName,
            allyName:   city.ally_name || null,
            updated:    new Date().toISOString(),
          });
          countCities++;

          // Player (deduplicato per sessione)
          if (!playersSeen.has(pKey)) {
            const prevPlayer = await window.IkDB.get('players', pKey);
            playersSeen.set(pKey, {
              id:          pKey,
              name:        pName,
              score:       Number(city.player_score) || 0,
              allyName:    city.ally_name  || null,
              allyId:      city.ally_id    || null,
              // Regola stato: importa SOLO se player non esiste già nel DB
              state:       prevPlayer ? prevPlayer.state : (city.player_state || 'active'),
              stateSource: prevPlayer ? (prevPlayer.stateSource || 'ikalogs') : 'ikalogs',
              updated:     new Date().toISOString(),
            });
          }
        }
      }
    }

    // Salva tutti i players
    for (const [, player] of playersSeen) {
      await window.IkDB.put('players', player);
      countPlayers++;
    }

    // ── 2. islands array (lista completa con alleanze) ────
    const islandsArr = body.islands || [];
    for (const isl of islandsArr) {
      const x = Number(isl.x), y = Number(isl.y);
      if (!x && !y) continue;
      const existing = await window.IkDB.get('islands', `${x}:${y}`);
      if (existing) {
        existing.allies   = isl.allies   || existing.allies;
        existing.ally_num = isl.ally_num || existing.ally_num;
        await window.IkDB.put('islands', existing);
      } else {
        // Isola senza città
        await window.IkDB.put('islands', {
          coords:    `${x}:${y}`,
          id:        Number(isl.island_id),
          x, y,
          allies:    isl.allies   || null,
          ally_num:  isl.ally_num || 0,
          hasCities: false,
          nCities:   0,
          ikalogsUpdated: new Date().toISOString(),
        });
        countIslands++;
      }
    }

    // ── 3. rows (dati dettagliati, poche righe) ──────────
    const rows = body.rows || [];
    for (const row of rows) {
      const x = Number(row.x), y = Number(row.y);
      if (!x && !y) continue;
      const existing = await window.IkDB.get('islands', `${x}:${y}`);
      if (existing) {
        await window.IkDB.put('islands', {
          ...existing,
          name:      row.island_name      || existing.name,
          tradegood: row.tradegood        != null ? Number(row.tradegood)         : existing.tradegood,
          wonder:    row.wonder           != null ? Number(row.wonder)            : existing.wonder,
          woodLevel: row.island_wood      != null ? Number(row.island_wood)       : existing.woodLevel,
          tgLevel:   row.island_tradegood != null ? Number(row.island_tradegood)  : existing.tgLevel,
          wdLevel:   row.island_wonder    != null ? Number(row.island_wonder)     : existing.wdLevel,
        });
      }
    }

    log(`${countIslands} isole, ${countCities} città, ${countPlayers} players`);
    window.IkApp?.onIslandsUpdated?.(countIslands);
    return countIslands + countCities + countPlayers;
  }

  window.IkParsers?.registerParser('ikalogs', {
    match: url => /ikalogs/i.test(url),
    parse,
  });
  log('OK');
})();
