// ═══════════════════════════════════════════════
// parser_ikalogs.js — Parser dati Ikalogs
//
// Struttura JSON:
// data.body.cities_info = { X: { Y: [{city}] } }
// data.body.islands     = [{ island_id, x, y, allies, ally_num }]
// data.body.rows        = [...] (dati estesi, poche righe)
//
// Regola player_state:
//   - Si importa SOLO se il player non esiste già nel DB
//   - Se esiste, lo stato viene preso dalla classifica Ikariam
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  async function parse(url, data) {
    const body = data?.body;
    if (!body) return 0;

    let countIslands = 0, countCities = 0, countPlayers = 0;

    // ── 1. cities_info → isole + città + players ──
    const citiesInfo = body.cities_info || {};
    for (const xStr of Object.keys(citiesInfo)) {
      const col = citiesInfo[xStr];
      for (const yStr of Object.keys(col)) {
        const cities = col[yStr];
        if (!Array.isArray(cities) || cities.length === 0) continue;

        const x = Number(xStr);
        const y = Number(yStr);

        // Prima city per dati isola
        const first = cities[0];
        const islandId = Number(first.island_id);

        // Salva/aggiorna isola
        // Non sovrascrive nome/tipo/risorsa se già presenti da worldmap
        const existingIsland = await window.IkDB.get('islands', `${x}:${y}`).catch(() => null);
        await window.IkDB.put('islands', {
          // Mantieni dati worldmap se presenti
          ...(existingIsland || {}),
          coords:   `${x}:${y}`,
          id:       islandId,
          x, y,
          hasCities: true,
          nCities:  cities.length,
          // Aggiorna lista alleanze sull'isola
          allyNames: [...new Set(cities.map(c => c.ally_name).filter(Boolean))],
          ikalogsUpdated: new Date().toISOString(),
        });
        countIslands++;

        // Salva città e players
        for (const city of cities) {
          const playerId = city.player_id || null;

          // ── Città ────────────────────────────
          await window.IkDB.put('cities', {
            // Chiave composta: usiamo island+nome se non c'è city_id
            id:         city.city_id || `${islandId}_${city.city_name}`,
            name:       city.city_name   || '?',
            level:      Number(city.city_level) || 0,
            islandId,
            islandX:    x,
            islandY:    y,
            playerId,
            playerName: city.player_name || '?',
            allyName:   city.ally_name   || null,
            updated:    new Date().toISOString(),
          });
          countCities++;

          // ── Player ───────────────────────────
          if (playerId) {
            const pid = Number(playerId);
            const existing = await window.IkDB.get('players', pid).catch(() => null);

            await window.IkDB.put('players', {
              id:        pid,
              name:      city.player_name  || '?',
              score:     Number(city.player_score) || 0,
              allyName:  city.ally_name    || null,
              // Regola: importa stato solo se player non esiste già
              // Se esiste, mantieni lo stato dalla classifica Ikariam
              state:     existing ? existing.state : (city.player_state || 'active'),
              stateSource: existing ? existing.stateSource || 'ikalogs' : 'ikalogs',
              updated:   new Date().toISOString(),
            });
            countPlayers++;
          }
        }
      }
    }

    // ── 2. islands array → alleanze per isola ──
    // Contiene anche isole senza città (solo alleanze)
    const islandsArr = body.islands || [];
    for (const isl of islandsArr) {
      const x = Number(isl.x), y = Number(isl.y);
      if (!x && !y) continue;
      const existing = await window.IkDB.get('islands', `${x}:${y}`).catch(() => null);
      if (existing) {
        // Aggiunge info alleanze senza sovrascrivere tutto
        existing.allies    = isl.allies    || existing.allies;
        existing.ally_num  = isl.ally_num  || existing.ally_num;
        await window.IkDB.put('islands', existing);
      } else {
        // Isola nuova (solo dalla lista islands)
        await window.IkDB.put('islands', {
          coords:   `${x}:${y}`,
          id:       Number(isl.island_id),
          x, y,
          allies:   isl.allies || null,
          ally_num: isl.ally_num || 0,
          hasCities:false,
          nCities:  0,
          ikalogsUpdated: new Date().toISOString(),
        });
        countIslands++;
      }
    }

    // ── 3. rows → dati estesi (poche righe, più dettagliati) ──
    const rows = body.rows || [];
    for (const row of rows) {
      // Aggiorna isola con dati dettagliati da rows
      if (row.x && row.y) {
        const existing = await window.IkDB.get('islands', `${row.x}:${row.y}`).catch(() => null);
        if (existing) {
          await window.IkDB.put('islands', {
            ...existing,
            name:      row.island_name   || existing.name,
            tradegood: row.tradegood     != null ? Number(row.tradegood) : existing.tradegood,
            wonder:    row.wonder        != null ? Number(row.wonder)    : existing.wonder,
            woodLevel: row.island_wood   != null ? Number(row.island_wood) : existing.woodLevel,
            tgLevel:   row.island_tradegood != null ? Number(row.island_tradegood) : existing.tgLevel,
            wdLevel:   row.island_wonder != null ? Number(row.island_wonder) : existing.wdLevel,
          });
        }
      }
    }

    const total = countIslands + countCities + countPlayers;
    console.log(`[parser_ikalogs] ${countIslands} isole, ${countCities} città, ${countPlayers} players`);
    window.IkApp?.onIslandsUpdated?.(countIslands);
    return total;
  }

  window.IkParsers?.registerParser('ikalogs', {
    match: url => /ikalogs/i.test(url),
    parse,
  });
  console.log('[parser_ikalogs] OK');
})();
