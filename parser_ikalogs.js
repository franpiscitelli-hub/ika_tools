// ═══════════════════════════════════════════════
// parser_ikalogs.js v3
// Logica basata sul vecchio db_globalplayers.js
// che funzionava correttamente.
//
// Struttura cities: { player_name, ally_name,
//   city_name, city_level, x, y, island_id }
// Players: id = avatarId (da ikalogs non disponibile
//   quindi usiamo player_name come chiave)
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  async function parse(url, data) {
    const body = data?.body;
    if (!body) return 0;

    let countIslands = 0, countCities = 0, countPlayers = 0;

    // ── STEP 1: importa tutte le isole (anche vuote) ──
    // Logica da importAllIslands()
    const islandsList = body.islands;
    if (Array.isArray(islandsList)) {
      for (const island of islandsList) {
        const x  = island.x;
        const y  = island.y;
        const id = island.island_id;
        if (typeof x !== 'number' || typeof y !== 'number' || !id) continue;

        const coords   = `${x}:${y}`;
        const existing = await window.IkDB.get('islands', coords);

        // MERGE: non sovrascrivere mai dati worldmap già presenti
        await window.IkDB.put('islands', {
          ...(existing || {}),
          coords,
          id:     Number(id),
          x, y,
          // Se non c'era: isola vuota
          hasCities:  (existing?.hasCities) || false,
          nCities:    (existing?.nCities)   || 0,
          cities:     (existing?.cities)    || [],
          ikalogsUpdated: new Date().toISOString(),
        });
        countIslands++;
      }
    }

    // ── STEP 2: importa città e players (da cities_info) ──
    // Logica da importAllCities()
    const citiesInfo = body.cities_info;
    if (!citiesInfo || typeof citiesInfo !== 'object') {
      console.log('[parser_ikalogs] Nessun cities_info');
      return countIslands;
    }

    // Mappa temporanea: coords → Set di player_name (per contare isole popolate)
    const islandsConCitta = new Set();
    // Mappa players per questa sessione (evita get/put ripetuti)
    const playersCache = new Map();

    for (const xKey of Object.keys(citiesInfo)) {
      const colonna = citiesInfo[xKey];
      if (!colonna || typeof colonna !== 'object') continue;

      for (const yKey of Object.keys(colonna)) {
        const listaCitta = colonna[yKey];
        if (!Array.isArray(listaCitta)) continue;

        for (const cityObj of listaCitta) {
          if (!cityObj) continue;

          const x        = cityObj.x;
          const y        = cityObj.y;
          const coords   = `${x}:${y}`;
          const nick     = cityObj.player_name || 'Sconosciuto';
          const ally     = cityObj.ally_name   || '';
          const cityName = cityObj.city_name   || '';
          const level    = cityObj.city_level  || 0;
          const islandId = Number(cityObj.island_id) || null;
          const state    = cityObj.player_state || 'active';

          // ── Salva città ──────────────────────────
          // Chiave: island_id + city_name (no city_id in ikalogs)
          const cityKey = `${islandId}_${cityName}`;
          await window.IkDB.put('cities', {
            id:         cityKey,
            name:       cityName,
            level:      Number(level),
            islandId,
            islandX:    Number(x),
            islandY:    Number(y),
            playerId:   `pl_${nick}`,
            playerName: nick,
            allyName:   ally || null,
            updated:    new Date().toISOString(),
          });
          countCities++;

          // ── Aggiorna isola con città ─────────────
          const existing = await window.IkDB.get('islands', coords);
          const islandRecord = existing || {
            coords, id: islandId, x: Number(x), y: Number(y),
            hasCities: false, nCities: 0, cities: [],
          };

          // Aggiunge città all'array solo se non già presente
          const alreadyInCities = islandRecord.cities?.some(
            c => c.city_name === cityName && c.player_name === nick
          );
          if (!alreadyInCities) {
            if (!islandRecord.cities) islandRecord.cities = [];
            islandRecord.cities.push({
              player_name: nick,
              ally_name:   ally,
              city_name:   cityName,
              city_level:  Number(level),
            });
          }

          if (!islandsConCitta.has(coords)) {
            islandsConCitta.add(coords);
            islandRecord.hasCities = true;
            islandRecord.nCities   = islandRecord.cities.length;
          }
          islandRecord.nCities = islandRecord.cities.length;
          await window.IkDB.put('islands', islandRecord);

          // ── Salva player ─────────────────────────
          // Usa player_name come chiave (no player_id in ikalogs)
          const pKey = `pl_${nick}`;
          if (!playersCache.has(pKey)) {
            const prevPlayer = await window.IkDB.get('players', pKey);
            playersCache.set(pKey, {
              id:      pKey,
              name:    nick,
              ally:    ally,
              scores:  (prevPlayer?.scores)  || {},
              // Regola: stato da ikalogs SOLO se non esiste nel DB
              // Se esiste (da classifica) → mantieni
              status:      prevPlayer ? prevPlayer.status      : state,
              stateSource: prevPlayer ? prevPlayer.stateSource : 'ikalogs',
              lastUpdate:  Date.now(),
            });
          } else {
            // Aggiorna alleanza se cambiata
            const p   = playersCache.get(pKey);
            p.ally     = ally || p.ally;
          }
        }
      }
    }

    // Salva tutti i players dalla cache
    for (const [, player] of playersCache) {
      await window.IkDB.put('players', player);
      countPlayers++;
    }

    console.log(`[parser_ikalogs] ${countIslands} isole, ${countCities} città, ${countPlayers} players`);
    window.IkApp?.onIslandsUpdated?.(countIslands);
    return countIslands + countCities + countPlayers;
  }

  window.IkParsers?.registerParser('ikalogs', {
    match: url => /ikalogs/i.test(url),
    parse,
  });
  console.log('[parser_ikalogs] v3 OK');
})();
