// ═══════════════════════════════════════════════
// parser_ikalogs.js v5
//
// REGOLE:
// 1. Considera SOLO i dati contenuti in body.cities_info
// 2. Se l'isola non esiste nel DB, la crea con i dati essenziali
// 3. Se l'isola esiste già, aggiorna SOLO nCities e hasCities
//    preservando tutti i dati inseriti da worldmap
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  async function parse(url, data) {
    const body = data?.body;
    if (!body) {
      console.warn('[parser_ikalogs] body mancante o non valido');
      return 0;
    }

    const citiesInfo = data.body.cities_info;
    if (!citiesInfo) {
      console.warn('[parser_ikalogs] cities_info non trovato nel JSON');
      return 0;
    }

    let countIslands = 0;

    // Iterazione sulla struttura delle coordinate {"X": { "Y": [...] }}
    for (const xKey of Object.keys(citiesInfo)) {
      const col = citiesInfo[xKey];
      for (const yKey of Object.keys(col)) {
        const citiesArray = col[yKey];
        if (!Array.isArray(citiesArray)) continue;

        const coords = `${xKey}:${yKey}`;
        const nCities = citiesArray.length;
        const hasCities = nCities > 0;

        // Controlla se l'isola è già censita nel database
        const existing = await window.IkDB.get('islands', coords);

        if (existing) {
          // L'isola esiste: aggiorna solo il contatore delle polis
          await window.IkDB.put('islands', {
            ...existing,
            nCities,
            hasCities,
            ikalogsUpdated: new Date().toISOString()
          });
        } else {
          // L'isola non esiste: la crea inizializzando le coordinate
          await window.IkDB.put('islands', {
            coords,
            x: Number(xKey),
            y: Number(yKey),
            name: `[${xKey}:${yKey}]`,
            nCities,
            hasCities,
            ikalogsUpdated: new Date().toISOString()
          });
        }
        countIslands++;
      }
    }

    console.log(`[parser_ikalogs] Elaborate ${countIslands} isole da cities_info`);
    window.IkApp?.onIslandsUpdated?.(countIslands);
    return countIslands;
  }

  window.IkParsers?.registerParser('ikalogs', {
    match: url => /ikalogs/i.test(url),
    parse,
  });
  console.log('[parser_ikalogs] v5 OK');
})();
