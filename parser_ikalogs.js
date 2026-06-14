// ═══════════════════════════════════════════════
// parser_ikalogs.js v4
//
// Struttura JSON (dallo screenshot):
// data.body.cities_info = { "X": { "Y": [{city}] } }
// data.body.islands     = [{ island_id, x, y, allies }]
//
// Campi city: island_id, ally_id, x, y,
//   city_name, city_level, player_name,
//   player_score, player_state, ally_name
//
// REGOLE:
// 1. Islands: merge su coords — worldmap ha priorità
//    su nome/risorsa/tempio/legno. Ikalogs aggiunge
//    cities[], nCities, allyNames, allies.
// 2. Cities: chiave = coords+"_"+city_name
//    (no city_id in ikalogs)
// 3. Players: chiave = player_name (no avatarId)
//    stato importato solo se player NON esiste già
//    (se esiste, stato da ranking ha priorità)
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  async function parse(url, data) {
    const body = data?.body;
    if (!body) { console.warn('[parser_ikalogs] body mancante'); return { parsed: 0, parserName: 'ikalogs' }; }

    const citiesInfo  = body.cities_info;
    const islandsList = body.islands || [];

    if (!citiesInfo && !islandsList.length) return { parsed: 0, parserName: 'ikalogs' };

    let countIslands = 0, countCities = 0, countPlayers = 0;

    // ── PRE-CARICAMENTO: tutto in memoria con una getAll() ciascuno ──
    const allIslands = await window.IkDB.getAll('islands');
    const allPlayers = await window.IkDB.getAll('players');

    const islandMap = new Map(allIslands.map(r => [r.coords, r]));
    const playerMap = new Map(allPlayers.map(r => [r.id, r]));

    const citiesToWrite = []; // accumulo per putMany finale

    // ── STEP 1: isole vuote da islands[] ─────────────
    for (const isl of islandsList) {
      const x = Number(isl.x), y = Number(isl.y);
      if (!x && !y) continue;
      const coords = `${x}:${y}`;
      const existing = islandMap.get(coords);
      if (!existing) {
        islandMap.set(coords, {
          coords,
          id:        Number(isl.island_id),
          x, y,
          allies:    isl.allies   || null,
          ally_num:  Number(isl.ally_num) || 0,
          hasCities: false,
          nCities:   0,
          cities:    [],
          ikalogsUpdated: new Date().toISOString(),
        });
        countIslands++;
      } else if (isl.allies && isl.allies !== existing.allies) {
        existing.allies   = isl.allies;
        existing.ally_num = Number(isl.ally_num) || 0;
      }
    }

    // ── STEP 2: cities_info → isole + città + players (tutto in memoria) ──
    if (citiesInfo) {
      for (const xKey of Object.keys(citiesInfo)) {
        const col = citiesInfo[xKey];
        if (!col || typeof col !== 'object') continue;

        for (const yKey of Object.keys(col)) {
          const cityList = col[yKey];
          if (!Array.isArray(cityList) || !cityList.length) continue;

          const x      = Number(xKey);
          const y      = Number(yKey);
          const coords = `${xKey}:${yKey}`;

          let islandRec = islandMap.get(coords);
          if (!islandRec) {
            islandRec = {
              coords, x, y,
              id:        Number(cityList[0].island_id),
              hasCities: false,
              nCities:   0,
              cities:    [],
            };
            islandMap.set(coords, islandRec);
          }

          // Reinizializza cities per questa sessione di import
          if (!islandRec._citiesReset) {
            islandRec.cities       = [];
            islandRec._citiesReset = true;
          }

          for (const city of cityList) {
            const playerName = city.player_name || '';
            const allyName   = city.ally_name   || '';
            const cityName   = city.city_name   || '';
            const cityLevel  = Number(city.city_level) || 0;

            islandRec.cities.push({
              player_name: playerName,
              ally_name:   allyName,
              city_name:   cityName,
              city_level:  cityLevel,
            });

            // Città: accumula per scrittura batch
            const cityKey = `${xKey}:${yKey}_${cityName}`;
            citiesToWrite.push({
              id:         cityKey,
              name:       cityName,
              level:      cityLevel,
              islandId:   Number(city.island_id),
              islandX:    x,
              islandY:    y,
              playerName,
              allyName:   allyName || null,
              source:     'ikalogs',
              updated:    new Date().toISOString(),
            });
            countCities++;

            // Player: aggiorna in mappa in memoria
            if (playerName) {
              const pKey = `pl_${playerName}`;
              const prev = playerMap.get(pKey);
              playerMap.set(pKey, {
                id:          pKey,
                name:        playerName,
                ally:        allyName || (prev?.ally || null),
                score:       Number(city.player_score) || (prev?.score || 0),
                status:      prev?.stateSource === 'ranking'
                               ? prev.status
                               : (city.player_state || prev?.status || 'active'),
                stateSource: prev?.stateSource === 'ranking'
                               ? 'ranking'
                               : 'ikalogs',
                lastUpdate:  Date.now(),
              });
              countPlayers++;
            }
          }
        }
      }
    } else {
      return { parsed: countIslands, parserName: 'ikalogs', countIslands, countCities: 0, countPlayers: 0 };
    }

    // ── STEP 3: finalizza isole in memoria ────────────
    const islandsToWrite = [];
    for (const rec of islandMap.values()) {
      delete rec._citiesReset;
      rec.nCities        = rec.cities?.length || 0;
      rec.hasCities      = rec.nCities > 0;
      rec.allyNames      = [...new Set((rec.cities || []).map(c => c.ally_name).filter(Boolean))];
      rec.ikalogsUpdated = new Date().toISOString();
      islandsToWrite.push(rec);
    }

    // ── STEP 4: scrittura batch — 3 transazioni totali ────
    try {
      await window.IkDB.putMany('islands', islandsToWrite);
      await window.IkDB.putMany('players', [...playerMap.values()]);
      await window.IkDB.putMany('cities',  citiesToWrite);
    } catch (e) {
      console.error('[parser_ikalogs] putMany error:', e.message);
    }

    const tot = countIslands + countCities + countPlayers;
    console.log(`[parser_ikalogs] ${countIslands} isole, ${countCities} città, ${countPlayers} players`);
    window.IkApp?.onIslandsUpdated?.(countIslands);
    return {
      parsed:      tot,
      parserName:  'ikalogs',
      countIslands,
      countCities,
      countPlayers,
    };
  }

  window.IkParsers?.registerParser('ikalogs', {
    match: url => /ikalogs/i.test(url) || /\/common\/report/i.test(url),
    parse,
  });
  console.log('[parser_ikalogs] v4 OK');
})();
