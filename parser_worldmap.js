// ═══════════════════════════════════════════════
// parser_worldmap.js v4
//
// PRIORITÀ: worldmap ha priorità su tutto TRANNE
//   nCities e cities[] che vengono da ikalogs
//
// Merge:
//   - Tutti i campi worldmap sovrascrivono sempre
//   - cities[], nCities, hasCities: preservati se
//     già presenti da ikalogs (non sovrascrivere)
//   - Se ikalogs non ha ancora caricato, nCities
//     viene preso da cell[7]
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const TRADEGOOD = { 1:'Vino', 2:'Marmo', 3:'Cristallo', 4:'Zolfo' };
  const TEMPLE    = {
    1:'Fucina di Efesto',  2:'Boschetto di Ade',
    3:'Giardini di Demetra', 4:'Tempio di Atena',
    5:'Tempio di Hermes',  6:'Fortezza di Ares',
    7:'Tempio di Poseidone', 8:'Colosso',
  };

  async function parse(url, data) {
    if (!data?.data) return 0;
    const grid = data.data;
    let count  = 0;

    for (const xKey of Object.keys(grid)) {
      const col = grid[xKey];
      for (const yKey of Object.keys(col)) {
        const raw = col[yKey];
        if (!Array.isArray(raw) || raw.length < 8) continue;

        const coords = `${xKey}:${yKey}`;
        const tgNum  = Number(raw[2]);
        const tmNum  = Number(raw[3]);
        const pirTs  = raw[9] && raw[9] !== '0' ? Number(raw[9]) : null;
        const nCitiesFromMap = Number(raw[7]);

        // Leggi record esistente
        const existing = await window.IkDB.get('islands', coords);

        // cities[] e nCities: usa ikalogs se già presenti
        // worldmap aggiorna nCities solo se ikalogs non ha ancora caricato
        const cities    = existing?.cities   || [];
        const nCities   = cities.length > 0
          ? cities.length          // ikalogs ha già i dati → usa quelli
          : nCitiesFromMap;        // worldmap come fallback
        const hasCities = nCities > 0;

        await window.IkDB.put('islands', {
          // Prima i dati esistenti (per non perdere cities[], allyNames, ecc.)
          ...(existing || {}),
          // Campi worldmap — hanno sempre priorità
          coords,
          id:          Number(raw[0]),
          name:        String(raw[1]) || `[${xKey}:${yKey}]`,
          x:           Number(xKey),
          y:           Number(yKey),
          tradegood:   tgNum,
          tgName:      TRADEGOOD[tgNum] || '?',
          temple:      tmNum,
          templeName:  TEMPLE[tmNum]   || '?',
          templeLevel: Number(raw[5]),
          clusterId:   Number(raw[4]),
          woodLevel:   Number(raw[6]),
          pirateTs,
          pirateDate:  pirTs ? new Date(pirTs * 1000).toISOString() : null,
          worldmapUpdated: new Date().toISOString(),
          // nCities e hasCities: logica descritta sopra
          nCities,
          hasCities,
          // cities[] NON viene toccato (rimane quello di ikalogs)
        });
        count++;
      }
    }

    console.log(`[parser_worldmap] ${count} isole`);
    window.IkApp?.onIslandsUpdated?.(count);
    return count;
  }

  window.IkParsers?.registerParser('worldmap', {
    match: url => /WorldMap.*getJSONArea|getJSONWorldMap/i.test(url),
    parse,
  });
  console.log('[parser_worldmap] v4 OK');
})();
