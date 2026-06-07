// ═══════════════════════════════════════════════
// parser_worldmap.js — Mappa mondo Ikariam
// Formato cella: [island_id, name, type, tradegood, ?, wonder, n_cities, ...]
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // Dizionari di decodifica
  const TYPES = { 1:'Fertile', 2:'Forestale', 3:'Mineraria', 4:'Vinicola', 5:'Cristallina', 6:'Sulfurea' };
  const TRADEGOOD = { 1:'Vino', 2:'Marmo', 3:'Cristallo', 4:'Zolfo' };
  const WONDERS = {
    0:'Nessuno', 1:'Colosso', 2:'Oracolo', 3:'Faro',
    4:'Mausoleo', 5:'Tempio', 6:'Giardini', 7:'Zeus',
    8:'Artemide', 9:'Poseidone', 10:'Atena',
    11:'Efesto', 12:'Afrodite', 13:'Ares', 14:'Demetra',
  };

  async function parse(url, data) {
    if (!data || !data.data) return 0;
    const grid = data.data; // { x: { y: [...] } }
    let count = 0;

    for (const xStr of Object.keys(grid)) {
      const col = grid[xStr];
      for (const yStr of Object.keys(col)) {
        const cell = col[yStr];
        if (!Array.isArray(cell) || cell.length < 7) continue;

        const x = Number(xStr);
        const y = Number(yStr);
        const island = {
          coords:    `${x}:${y}`,
          id:        Number(cell[0]),
          name:      cell[1] || `[${x}:${y}]`,
          x, y,
          type:      Number(cell[2]),
          typeName:  TYPES[cell[2]] || '?',
          tradegood: Number(cell[3]),
          tgName:    TRADEGOOD[cell[3]] || '?',
          wonder:    Number(cell[5]),
          wdName:    WONDERS[cell[5]] || '?',
          nCities:   Number(cell[6]),
          updated:   new Date().toISOString(),
        };

        try { await window.IkDB.put('islands', island); count++; } catch {}
      }
    }

    console.log(`[parser_worldmap] ${count} isole salvate`);
    window.IkApp?.onIslandsUpdated?.(count);
    return count;
  }

  // Registra nel dispatcher
  window.IkParsers?.registerParser('worldmap', {
    match: url => /action=WorldMap.*getJSONArea/i.test(url),
    parse,
  });

  console.log('[parser_worldmap] Caricato');
})();
