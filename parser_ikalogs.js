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
    if (!body) { console.warn('[parser_ikalogs] body mancante'); return 0; }

    const citiesInfo = body.cities_info;
    const islandsList = body.islands || [];

    if (!citiesInfo && !islandsList.length) return 0;

    let countIslands = 0, countCities = 0, countPlayers = 0;

    // ── STEP 1: isole vuote da islands[] ─────────────
    // Solo quelle non già in DB o senza worldmap
    for (const isl of islandsList) {
      const x = Number(isl.x), y = Number(isl.y);
      if (!x && !y) continue;
      const coords = `${x}:${y}`;
      const existing = await window.IkDB.get('islands', coords);
      if (!existing) {
        // Isola nuova: crea con dati minimi
        await window.IkDB.put('islands', {
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
      } else {
        // Aggiorna solo allies (non sovrascrivere dati worldmap)
        if (isl.allies && isl.allies !== existing.allies) {
          existing.allies   = isl.allies;
          existing.ally_num = Number(isl.ally_num) || 0;
          await window.IkDB.put('islands', existing);
        }
      }
    }

    // ── STEP 2: cities_info → isole + città + players ──
    if (!citiesInfo) return countIslands;

    // Accumula cities per isola in memoria prima di scrivere
    // (evita letture/scritture ripetute dello stesso record isola)
    const islandBuffer = new Map(); // coords → island record

    for (const xKey of Object.keys(citiesInfo)) {
      const col = citiesInfo[xKey];
      if (!col || typeof col !== 'object') continue;

      for (const yKey of Object.keys(col)) {
        const cityList = col[yKey];
        if (!Array.isArray(cityList) || !cityList.length) continue;

        const x      = Number(xKey);
        const y      = Number(yKey);
        const coords = `${xKey}:${yKey}`;

        // Leggi isola (prima da buffer, poi da DB)
        if (!islandBuffer.has(coords)) {
          const fromDB = await window.IkDB.get('islands', coords);
          islandBuffer.set(coords, fromDB || {
            coords, x, y,
            id:        Number(cityList[0].island_id),
            hasCities: false,
            nCities:   0,
            cities:    [],
          });
        }
        const islandRec = islandBuffer.get(coords);

        // Reinizializza cities per questa sessione di import
        // (ricostruisce da zero ad ogni import ikalogs)
        if (!islandRec._citiesReset) {
          islandRec.cities       = [];
          islandRec._citiesReset = true;
        }

        for (const city of cityList) {
          const playerName = city.player_name || '';
          const allyName   = city.ally_name   || '';
          const cityName   = city.city_name   || '';
          const cityLevel  = Number(city.city_level) || 0;

          // Aggiungi città all'array isola
          islandRec.cities.push({
            player_name: playerName,
            ally_name:   allyName,
            city_name:   cityName,
            city_level:  cityLevel,
          });

          // Salva città nel suo store con chiave stabile
          const cityKey = `${xKey}:${yKey}_${cityName}`;
          try {
            await window.IkDB.put('cities', {
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
          } catch (e) {
            console.error('[parser_ikalogs] city put error:', e.message);
          }

          // Player: chiave = player_name
          if (playerName) {
            const pKey   = `pl_${playerName}`;
            const prev   = await window.IkDB.get('players', pKey);
            await window.IkDB.put('players', {
              id:          pKey,
              name:        playerName,
              ally:        allyName || (prev?.ally || null),
              score:       Number(city.player_score) || (prev?.score || 0),
              // Stato: importa SOLO se non esiste già nel DB
              // Se esiste (da ranking) il ranking ha priorità
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

    // ── STEP 3: scrivi isole aggiornate nel DB ────────
    for (const [coords, rec] of islandBuffer) {
      // Pulizia campo temporaneo
      delete rec._citiesReset;

      // Aggiorna nCities e hasCities
      rec.nCities       = rec.cities.length;
      rec.hasCities     = rec.nCities > 0;
      rec.allyNames     = [...new Set(
        rec.cities.map(c => c.ally_name).filter(Boolean)
      )];
      rec.ikalogsUpdated = new Date().toISOString();

      try {
        await window.IkDB.put('islands', rec);
        countIslands++;
      } catch (e) {
        console.error('[parser_ikalogs] island put error:', coords, e.message);
      }
    }

    console.log(`[parser_ikalogs] ${countIslands} isole, ${countCities} città, ${countPlayers} players`);
    window.IkApp?.onIslandsUpdated?.(countIslands);
    return countIslands + countCities + countPlayers;
  }

  window.IkParsers?.registerParser('ikalogs', {
    // Matcha:
    // 1. URL reali di ikalogs.ru (navigazione live)
    // 2. /common/report/index/ (JSON scaricati dall'app e reimportati)
    // 3. URL fallback usato da importFiles()
    match: url => /ikalogs/i.test(url)
               || /\/common\/report/i.test(url),
    parse,
  });
  console.log('[parser_ikalogs] v4 OK');
})();
