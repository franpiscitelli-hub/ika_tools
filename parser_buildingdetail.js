// ═══════════════════════════════════════════════
// parser_buildingdetail.js v1
//
// Gestisce le risposte della pagina "Aiuto edificio"
// (?view=buildingDetail&buildingId=N&helpId=1...)
//
// Match: changeView[0] === 'buildingDetail'
//
// Struttura dati salvata in 'building_data' (keyPath: buildingId):
// {
//   buildingId:   number,   // dall'URL
//   name:         string,   // es. "Municipio"
//   buildingType: string,   // es. "townHall" (da td.class CSS)
//   description:  string,   // testo descrizione edificio
//   requirement:  string,   // requisito (es. "Torchio", "nessun")
//   columns:      string[], // nomi colonne tabella (es. ["Livello","Legno","Marmo","Tempo","Scienziati"])
//   levels:       object[], // dati per livello: { level, wood, tradegood, time, [colSpecifica]: value, ... }
//   updated:      string,   // ISO timestamp
// }
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // Nomi fissi per le prime 4 colonne (sempre presenti, le th hanno solo immagini)
  const FIXED_COLS = ['level', 'wood', 'tradegood', 'time'];
  const FIXED_LABELS = ['Livello', 'Legno', 'Bene/Marmo', 'Tempo'];

  // Pulisce un numero HTML duplicato (es. "191.463191.463" → "191.463")
  // e rimuove separatori IT (.) per avere numero puro
  function cleanNum(raw) {
    raw = raw.trim();
    // Se è duplicato, prendi la prima metà
    const half = Math.floor(raw.length / 2);
    if (half > 1 && raw.slice(0, half) === raw.slice(half)) {
      raw = raw.slice(0, half);
    }
    // Rimuovi suffissi tipo "M" "G" "T" (versione abbreviata) se presenti
    // ma teniamo il valore leggibile originale senza abbreviazioni
    // Rimuovi separatori migliaia IT (punti)
    const numeric = raw.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(numeric);
    return isNaN(n) ? raw : n;
  }

  // Pulisce HTML di un elemento
  function stripHtml(s) {
    return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  // Estrae alt o testo da un <th>
  function thLabel(thHtml) {
    const alt = thHtml.match(/alt="([^"]+)"/);
    if (alt) return alt[1].trim();
    const txt = stripHtml(thHtml);
    return txt || null;
  }

  function findBuildingDetailHtml(data) {
    if (!Array.isArray(data)) return null;
    for (const item of data) {
      if (Array.isArray(item) && item[0] === 'changeView') {
        const view = item[1];
        if (Array.isArray(view) && view[0] === 'buildingDetail') {
          return typeof view[1] === 'string' ? view[1] : null;
        }
      }
    }
    return null;
  }

  async function parse(url, data, meta) {
    meta = meta || {};
    const html = findBuildingDetailHtml(data);
    if (!html) return { parsed: 0, parserName: 'buildingdetail' };

    // buildingId dall'URL
    const bidMatch = (url || '').match(/buildingId=(\d+)/);
    if (!bidMatch) return { parsed: 0, parserName: 'buildingdetail' };
    const buildingId = Number(bidMatch[1]);

    // Nome edificio: secondo h3 (primo è "Aiuto")
    const h3s = html.match(/<h3[^>]*>(.*?)<\/h3>/gs) || [];
    const name = h3s.length > 1 ? stripHtml(h3s[1]) : '?';

    // buildingType: classe CSS del td di anteprima (es. class="townHall")
    const typeMatch = html.match(/<td class="([a-zA-Z]+)"/);
    const buildingType = typeMatch ? typeMatch[1] : '';

    // Descrizione edificio
    const descMatch = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const description = descMatch ? stripHtml(descMatch[1]) : '';

    // Requisito
    const reqMatch = html.match(/Requisito[^:]*:?\s*<\/b>\s*([\s\S]*?)<\/td>/);
    const requirement = reqMatch ? stripHtml(reqMatch[1]) : '';

    // Tabella dati: l'ultima <table> nel documento
    const tables = html.match(/<table[\s\S]*?<\/table>/g) || [];
    const dataTable = tables[tables.length - 1] || '';

    if (!dataTable) return { parsed: 0, parserName: 'buildingdetail' };

    // Headers
    const thMatches = dataTable.match(/<th[^>]*>([\s\S]*?)<\/th>/g) || [];
    const colKeys   = [];
    const colLabels = [];

    thMatches.forEach((thHtml, i) => {
      if (i < FIXED_COLS.length) {
        colKeys.push(FIXED_COLS[i]);
        colLabels.push(FIXED_LABELS[i]);
      } else {
        const label = thLabel(thHtml) || `col${i}`;
        // Chiave snake_case dalla label
        const key = label
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '')
          .slice(0, 30);
        colKeys.push(key || `col${i}`);
        colLabels.push(label);
      }
    });

    // Righe dati (skip prima riga = headers)
    const trMatches = dataTable.match(/<tr[\s\S]*?<\/tr>/g) || [];
    const levels = [];

    for (const trHtml of trMatches) {
      const tdMatches = trHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
      if (!tdMatches.length) continue;

      const tds = tdMatches.map(td => stripHtml(td.replace(/<td[^>]*>/, '').replace(/<\/td>/, '')));
      if (!tds[0] || isNaN(Number(tds[0]))) continue; // skip header rows o righe non dati

      const levelObj = {};
      tds.forEach((val, i) => {
        const key = colKeys[i];
        if (!key) return;
        if (i === 0) {
          // level: intero
          levelObj[key] = Number(val);
        } else if (i === 3) {
          // time: stringa leggibile (es. "1G 5h")
          levelObj[key] = val;
        } else {
          levelObj[key] = cleanNum(val);
        }
      });

      if (levelObj.level > 0) levels.push(levelObj);
    }

    if (!levels.length) return { parsed: 0, parserName: 'buildingdetail' };

    // Salva in building_data
    try {
      const existing = await window.IkDB.get('building_data', buildingId);
      await window.IkDB.put('building_data', {
        ...(existing || {}),
        buildingId,
        name,
        buildingType,
        description,
        requirement,
        columns:  colLabels,
        colKeys,
        levels,
        levelCount: levels.length,
        updated:  meta.date || new Date().toISOString(),
      });
      console.log(`[parser_buildingdetail] ${name} (id=${buildingId}): ${levels.length} livelli`);
    } catch(e) {
      console.error('[parser_buildingdetail] DB error:', e.message);
      return { parsed: 0, parserName: 'buildingdetail' };
    }

    return {
      parsed:      1,
      parserName:  'buildingdetail',
      buildingId,
      name,
      levelCount:  levels.length,
    };
  }

  window.IkParsers?.registerParser('buildingdetail', {
    match: (url, data) => {
      if (!Array.isArray(data)) return false;
      return data.some(item =>
        Array.isArray(item) &&
        item[0] === 'changeView' &&
        Array.isArray(item[1]) &&
        item[1][0] === 'buildingDetail'
      );
    },
    parse,
  });

  console.log('[parser_buildingdetail] v1 OK');
})();
