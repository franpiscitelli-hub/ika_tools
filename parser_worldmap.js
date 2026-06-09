// ═══════════════════════════════════════════════
// parser_worldmap.js v3
// Logica da world_layout_importer.js
// NON resetta mai — solo update/merge
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
    const areaData = data.data;
    let count = 0;

    // Logica da importWorldLayoutFile() — NON resetta mai
    for (const xKey of Object.keys(areaData)) {
      const col = areaData[xKey];
      for (const yKey of Object.keys(col)) {
        const raw = col[yKey];
        if (!Array.isArray(raw) || raw.length < 8) continue;

        const x      = parseInt(xKey, 10);
        const y      = parseInt(yKey, 10);
        const coords = `${xKey}:${yKey}`;

        const tgNum  = Number(raw[2]);
        const tmNum  = Number(raw[3]);
        const pirTs  = raw[9] && raw[9] !== '0' ? Number(raw[9]) : null;

        // Merge con dati esistenti — non sovrascrivere cities/players
        const existing = await window.IkDB.get('islands', coords);

        await window.IkDB.put('islands', {
          // Prima i dati esistenti (ikalogs, cities, ecc.)
          ...(existing || {}),
          // Poi i dati worldmap (sovrascrivono solo campi worldmap)
          coords,
          id:          Number(raw[0]),
          name:        raw[1]  || `[${x}:${y}]`,
          x, y,
          tradegood:   tgNum,
          tgName:      TRADEGOOD[tgNum] || '?',
          temple:      tmNum,
          templeName:  TEMPLE[tmNum]    || '?',
          templeLevel: Number(raw[5]),
          clusterId:   Number(raw[4]),
          woodLevel:   Number(raw[6]),
          nCities:     existing?.nCities || Number(raw[7]),
          hasCities:   existing?.hasCities || Number(raw[7]) > 0,
          pirateTs:    pirTs,
          pirateDate:  pirTs ? new Date(pirTs * 1000).toISOString() : null,
          worldmapUpdated: new Date().toISOString(),
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
  console.log('[parser_worldmap] v3 OK');
})();
