// ══════════════════════════════════════
// parser_ikalogs.js v4
// Logica basata sul vecchio db_globalplayers.js
// che funzionava correttamente.
//
// Struttura cities: { player_name, ally_name,
//   city_name, city_level, x, y, island_id }
// Players: id = avatarId (da ikalogs non disponibile
//   quindi usiamo player_name come chiave)
// ══════════════════════════════════════

(function () {
  'use strict';

  async function parse(url, data) {
    const body = data?.body;
    if (!body) return 0;

    let countIslands = 0, countCities = 0, countPlayers = 0;

    // ── STEP 1: importa isole ──
    const islandsList = body.islands;
    if (Array.isArray(islandsList)) {
      for (const island of islandsList) {
        const coords = `${island.x}:${island.y}`;
        const existing = await window.IkDB.get('islands', coords);

        await window.IkDB.put('islands', {
          ...(existing || {}),
          coords,
          id: Number(island.island_id),
          x: Number(island.x),
          y: Number(island.y),
          ikalogsUpdated: new Date().toISOString(),
        });
        countIslands++;
      }
    }

    // ── STEP 2: importa città e players ──
    const citiesInfo = body.cities_info;
    if (citiesInfo && typeof citiesInfo === 'object') {
      const playersCache = new Map();

      for (const xKey of Object.keys(citiesInfo)) {
        for (const yKey of Object.keys(citiesInfo[xKey])) {
          const listaCitta = citiesInfo[xKey][yKey];
          if (!Array.isArray(listaCitta)) continue;

          const coords = `${xKey}:${yKey}`;
          const islandRecord = (await window.IkDB.get('islands', coords)) || {
            coords, cities: [], nCities: 0
          };

          for (const cityObj of listaCitta) {
            const nick = cityObj.player_name || 'Sconosciuto';
            const cityKey = `${cityObj.island_id}_${cityObj.city_name}`;
            
            // Salva città
            await window.IkDB.put('cities', {
              id:         cityKey,
              name:       cityObj.city_name,
              level:      Number(cityObj.city_level || 0),
              islandId:   Number(cityObj.island_id),
              islandX:    Number(cityObj.x),
              islandY:    Number(cityObj.y),
              playerId:   `pl_${nick}`,
              playerName: nick,
              allyName:   cityObj.ally_name || null,
              updated:    new Date().toISOString(),
            });
            countCities++;

            // Aggiorna array città dell'isola
            if (!islandRecord.cities.some(c => c.city_name === cityObj.city_name)) {
              islandRecord.cities.push({
                player_name: nick,
                ally_name:   cityObj.ally_name,
                city_name:   cityObj.city_name,
                city_level:  Number(cityObj.city_level || 0)
              });
            }

            // Cache players
            const pKey = `pl_${nick}`;
            if (!playersCache.has(pKey)) {
              const prev = await window.IkDB.get('players', pKey);
              playersCache.set(pKey, {
                id: pKey, name: nick, ally: cityObj.ally_name || prev?.ally || '',
                status: prev?.status || cityObj.player_state || 'active',
                stateSource: prev?.stateSource || 'ikalogs',
                lastUpdate: Date.now()
              });
            }
          }

          // Aggiorna conteggio preciso su isola e salva
          islandRecord.nCities = islandRecord.cities.length;
          islandRecord.hasCities = islandRecord.cities.length > 0;
          await window.IkDB.put('islands', islandRecord);
        }
      }

      // Salva players
      for (const [, player] of playersCache) {
        await window.IkDB.put('players', player);
        countPlayers++;
      }
    }

    console.log(`[parser_ikalogs] ${countIslands} isole, ${countCities} città, ${countPlayers} players`);
    window.IkApp?.onIslandsUpdated?.(countIslands);
    return countIslands + countCities + countPlayers;
  }

  window.IkParsers?.registerParser('ikalogs', {
    match: url => /ikalogs/i.test(url),
    parse,
  });
})();
