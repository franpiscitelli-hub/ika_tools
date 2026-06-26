// ═══════════════════════════════════════════════
// parser_ikalogs.js v7
//
// Struttura JSON:
// data.body.cities_info = { "X": { "Y": [{city}] } }
// data.body.islands     = [{ island_id, x, y, allies }]
//
// Campi città salvati (solo questi):
//   city_name, city_level, player_name, player_state, ally_name
//
// REGOLE:
// 1. Niente store "cities" separato — le città vivono
//    solo dentro islands[coords].cities[].
// 2. Coords X:Y esiste nel DB? → mantieni i dati worldmap,
//    AZZERA islands[coords].cities e ricrea con TUTTE le
//    polis del JSON ikalogs (anche doppioni di nome).
// 3. Coords X:Y NON esiste? → crea isola da zero coi dati ikalogs.
// 4. NIENTE scritture su 'players': i dati ikalogs servono
//    solo per la mappa. I players vengono gestiti
//    esclusivamente da parser_ranking.
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  async function parse(url, data) {
    const body = data?.body;
    if (!body) { console.warn('[parser_ikalogs] body mancante'); return { parsed: 0, parserName: 'ikalogs' }; }

    const citiesInfo  = body.cities_info;
    const islandsList = body.islands || [];

    if (!citiesInfo && !islandsList.length) return { parsed: 0, parserName: 'ikalogs' };

    let countIslands = 0, countCities = 0;

    // ── PRE-CARICAMENTO: solo islands (i dati ikalogs servono
    // unicamente per la mappa, niente scrittura su 'players') ──
    const allIslands = await window.IkDB.getAll('islands');
    const islandMap  = new Map(allIslands.map(r => [r.coords, r]));

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
            // Coordinate non presenti nel DB: crea isola da zero con i dati di ikalogs
            islandRec = {
              coords, x, y,
              id:        Number(cityList[0].island_id),
              hasCities: false,
              nCities:   0,
              cities:    [],
            };
            islandMap.set(coords, islandRec);
          }

          // Reset delle città di questa isola: sostituite interamente
          // con quelle del JSON ikalogs (anche se ci sono doppioni di nome)
          if (!islandRec._citiesReset) {
            islandRec.cities       = [];
            islandRec._citiesReset = true;
          }

          for (const city of cityList) {
            const playerName = city.player_name  || '';
            const allyName   = city.ally_name    || '';
            const cityName   = city.city_name    || '';
            const cityLevel  = Number(city.city_level) || 0;
            const playerState = city.player_state || '';

            // Solo i campi richiesti, niente ID artificiali
            islandRec.cities.push({
              city_name:    cityName,
              city_level:   cityLevel,
              player_name:  playerName,
              player_state: playerState,
              ally_name:    allyName,
            });
            countCities++;
          }
        }
      }
    } else {
      return { parsed: countIslands, parserName: 'ikalogs', countIslands, countCities: 0 };
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

    // ── STEP 4: scrittura batch — chunk da 200 per evitare abort IDB ──
    const CHUNK = 200;
    let writeErrors = 0;
    for (let i = 0; i < islandsToWrite.length; i += CHUNK) {
      const chunk = islandsToWrite.slice(i, i + CHUNK);
      try {
        await window.IkDB.putMany('islands', chunk);
      } catch (e) {
        writeErrors++;
        console.error(`[parser_ikalogs] putMany chunk ${i}–${i + CHUNK} error:`, e.message);
      }
    }
    if (writeErrors) console.warn(`[parser_ikalogs] ${writeErrors} chunk(s) con errore su ${Math.ceil(islandsToWrite.length / CHUNK)}`);


    const tot = countIslands + countCities;
    console.log(`[parser_ikalogs] ${countIslands} isole, ${countCities} città`);
    window.IkApp?.onIslandsUpdated?.(countIslands);
    return {
      parsed:      tot,
      parserName:  'ikalogs',
      countIslands,
      countCities,
    };
  }

  window.IkParsers?.registerParser('ikalogs', {
    match: url => /ikalogs/i.test(url) || /\/common\/report/i.test(url),
    parse,
  });
  console.log('[parser_ikalogs] v7 OK');
})();
