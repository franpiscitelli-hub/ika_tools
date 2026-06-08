// ═══════════════════════════════════════════════
// parser_worldmap.js v2
// Struttura cella: [id, name, tradegood, temple,
//   cluster_id, temple_level, wood_level, n_cities,
//   0, pirate_ts, 0, 0]
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const TRADEGOOD = {
    1: 'Vino', 2: 'Marmo', 3: 'Cristallo', 4: 'Zolfo',
  };

  const TEMPLE = {
    1: 'Fucina di Efesto',
    2: 'Boschetto di Ade',
    3: 'Giardini di Demetra',
    4: 'Tempio di Atena',
    5: 'Tempio di Hermes',
    6: 'Fortezza di Ares',
    7: 'Tempio di Poseidone',
    8: 'Colosso',
  };

  async function parse(url, data) {
    if (!data?.data) return 0;
    const grid = data.data;
    let count  = 0;

    for (const xStr of Object.keys(grid)) {
      const col = grid[xStr];
      for (const yStr of Object.keys(col)) {
        const cell = col[yStr];
        if (!Array.isArray(cell) || cell.length < 8) continue;

        const x = Number(xStr);
        const y = Number(yStr);

        const tgNum  = Number(cell[2]);
        const tmNum  = Number(cell[3]);
        const tmLvl  = Number(cell[5]);
        const pirTs  = cell[9] && cell[9] !== '0' ? Number(cell[9]) : null;

        // Merge con dati Ikalogs se già presenti
        const existing = await window.IkDB.get('islands', `${x}:${y}`);

        try {
          await window.IkDB.put('islands', {
            ...(existing || {}),
            coords:      `${x}:${y}`,
            id:          Number(cell[0]),
            name:        cell[1] || `[${x}:${y}]`,
            x, y,
            tradegood:   tgNum,
            tgName:      TRADEGOOD[tgNum] || '?',
            temple:      tmNum,
            templeName:  TEMPLE[tmNum]    || '?',
            templeLevel: tmLvl,
            clusterId:   Number(cell[4]),
            woodLevel:   Number(cell[6]),
            nCities:     Number(cell[7]),
            hasCities:   Number(cell[7]) > 0,
            pirateTs:    pirTs,
            pirateDate:  pirTs ? new Date(pirTs * 1000).toISOString() : null,
            worldmapUpdated: new Date().toISOString(),
          });
          count++;
        } catch (e) {
          console.error('[parser_worldmap] put error:', e.message);
        }
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
  console.log('[parser_worldmap] v2 OK');
})();
