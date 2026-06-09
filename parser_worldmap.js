// ═══════════════════════════════════════════════
// parser_worldmap.js v4
// Logica da world_layout_importer.js
// NON resetta mai — solo update/merge
// ══════════════════════════════════════
(function () {
  'use strict';
  const TRADEGOOD = { 1:'Vino', 2:'Marmo', 3:'Cristallo', 4:'Zolfo' };
  const TEMPLE    = { 1:'Fucina di Efesto', 2:'Boschetto di Ade', 3:'Giardini di Demetra', 4:'Tempio di Atena', 5:'Tempio di Hermes', 6:'Fortezza di Ares', 7:'Tempio di Poseidone', 8:'Colosso' };

  async function parse(url, data) {
    if (!data?.data) return 0;
    const areaData = data.data;
    let count = 0;

    for (const xKey of Object.keys(areaData)) {
      const col = areaData[xKey];
      for (const yKey of Object.keys(col)) {
        const raw = col[yKey];
        if (!Array.isArray(raw) || raw.length < 8) continue;

        const coords = `${xKey}:${yKey}`;
        const existing = await window.IkDB.get('islands', coords) || { coords, cities: [] };

        await window.IkDB.put('islands', {
          ...existing,
          id:          Number(raw[0]),
          name:        raw[1] || `[${xKey}:${yKey}]`,
          x:           parseInt(xKey, 10),
          y:           parseInt(yKey, 10),
          tradegood:   Number(raw[2]),
          tgName:      TRADEGOOD[raw[2]] || '?',
          temple:      Number(raw[3]),
          templeName:  TEMPLE[raw[3]] || '?',
          templeLevel: Number(raw[5]),
          woodLevel:   Number(raw[6]),
          nCities:     existing.cities.length,
          hasCities:   existing.cities.length > 0,
          worldmapUpdated: new Date().toISOString()
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