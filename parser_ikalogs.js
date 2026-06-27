// ═══════════════════════════════════════════════
// parser_ikalogs.js v8
//
// Struttura JSON (da ikalogs export):
// entry.data.body.cities_info = { "X": { "Y": [{city}] } }
// entry.data.body.islands     = [{ island_id, x, y, allies }]
//
// REGOLE:
// 1. Niente store "cities" separato — le città vivono
//    solo dentro islands[coords].cities[].
// 2. Coords X:Y esiste nel DB? → mantieni i dati worldmap,
//    AZZERA islands[coords].cities e ricrea con TUTTE le
//    polis del JSON ikalogs.
// 3. Coords X:Y NON esiste? → crea isola da zero.
// 4. NIENTE scritture su 'players'.
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  async function parse(url, rawData) {
    // ── Normalizza input: accetta sia {body,...} che {data:{body,...}} ──
    // rawData può essere:
    //   A) { body, query, params }          ← chiamata diretta da intercettazione
    //   B) { data: { body, query, params } } ← wrapper da import manuale
    let body;
    if (rawData && rawData.body) {
      body = rawData.body;
    } else if (rawData && rawData.data && rawData.data.body) {
      body = rawData.data.body;
    } else {
      console.warn('[parser_ikalogs] body mancante in', typeof rawData);
      return { parsed: 0, parserName: 'ikalogs' };
    }

    const citiesInfo  = body.cities_info  || null;
    const islandsList = Array.isArray(body.islands) ? body.islands : [];

    if (!citiesInfo && !islandsList.length) {
      console.warn('[parser_ikalogs] nessun dato utile');
      return { parsed: 0, parserName: 'ikalogs' };
    }

    let countIslands = 0, countCities = 0;

    // ── PRE-CARICAMENTO isole esistenti ──────────
    let allIslands = [];
    try {
      allIslands = await window.IkDB.getAll('islands');
      if (!Array.isArray(allIslands)) allIslands = [];
    } catch (e) {
      console.warn('[parser_ikalogs] getAll islands failed:', e.message);
      allIslands = [];
    }

    const islandMap = new Map(allIslands.map(r => [r.coords, r]));

    // ── STEP 1: isole vuote da islands[] ─────────
    for (const isl of islandsList) {
      const x = Number(isl.x), y = Number(isl.y);
      if (!x && !y) continue;
      const coords = `${x}:${y}`;
      const existing = islandMap.get(coords);
      if (!existing) {
        islandMap.set(coords, {
          coords,
          id:        Number(isl.island_id) || 0,
          x, y,
          allies:    isl.allies   || null,
          ally_num:  Number(isl.ally_num) || 0,
          hasCities: false,
          nCities:   0,
          cities:    [],
          ikalogsUpdated: new Date().toISOString(),
        });
        countIslands++;
      } else {
        if (isl.allies && isl.allies !== existing.allies) {
          existing.allies   = isl.allies;
          existing.ally_num = Number(isl.ally_num) || 0;
        }
      }
    }

    // ── STEP 2: cities_info → città per isola ────
    if (citiesInfo && typeof citiesInfo === 'object') {
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
              id:        Number(cityList[0]?.island_id) || 0,
              hasCities: false,
              nCities:   0,
              cities:    [],
            };
            islandMap.set(coords, islandRec);
          }

          // Reset città: sostituite interamente con quelle di ikalogs
          if (!islandRec._citiesReset) {
            islandRec.cities       = [];
            islandRec._citiesReset = true;
          }

          for (const city of cityList) {
            islandRec.cities.push({
              city_name:    city.city_name    || '',
              city_level:   Number(city.city_level) || 0,
              player_name:  city.player_name  || '',
              player_state: city.player_state || '',
              ally_name:    city.ally_name    || '',
            });
            countCities++;
          }
        }
      }
    }

    // ── STEP 3: finalizza record in memoria ───────
    const islandsToWrite = [];
    for (const rec of islandMap.values()) {
      delete rec._citiesReset;
      rec.nCities        = (rec.cities || []).length;
      rec.hasCities      = rec.nCities > 0;
      rec.allyNames      = [...new Set((rec.cities || []).map(c => c.ally_name).filter(Boolean))];
      rec.ikalogsUpdated = new Date().toISOString();
      islandsToWrite.push(rec);
    }

    // ── STEP 4: scrittura in chunk da 200 ────────
    const CHUNK = 200;
    let writeErrors = 0;
    for (let i = 0; i < islandsToWrite.length; i += CHUNK) {
      const chunk = islandsToWrite.slice(i, i + CHUNK);
      try {
        await window.IkDB.putMany('islands', chunk);
      } catch (e) {
        writeErrors++;
        console.error(`[parser_ikalogs] chunk ${i}–${i + chunk.length} error:`, e.message);
      }
    }
    if (writeErrors) {
      console.warn(`[parser_ikalogs] ${writeErrors}/${Math.ceil(islandsToWrite.length / CHUNK)} chunk(s) falliti`);
    }

    const tot = countIslands + countCities;
    console.log(`[parser_ikalogs] v8: ${countIslands} isole, ${countCities} città (${writeErrors} errori write)`);
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
  console.log('[parser_ikalogs] v8 OK');
})();
