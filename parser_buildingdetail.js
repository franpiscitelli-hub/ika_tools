// ═══════════════════════════════════════════════
// parser_buildingdetail.js v2
//
// Gestisce le risposte della pagina "Aiuto edificio"
// (?view=buildingDetail&buildingId=N&helpId=1...)
//
// Match: changeView[0] === 'buildingDetail'
//
// v2: schema colonne LETTO DINAMICAMENTE dall'header invece di essere
// fisso. Ogni edificio ha un proprio set di colonne (da 3 a 6+), per
// esempio:
//   - Mura/Vetraio/ecc:      Livello, Legno, Marmo, Tempo
//   - Accademia:             Livello, Legno, Cristallo, Tempo, Scienziati
//   - Palazzo:                Livello, Legno, Vino, Marmo, Cristallo, Zolfo, Tempo
//   - Cantiere Navale/Caserma: Livello, Legno, Marmo, Tempo, Unità sbloccata (icona)
//   - Magazzino/Mercato:      Livello, Legno, Marmo, Tempo, Capacità
//   - Taverna/Museo:          Livello, Legno, Marmo, Tempo, Soddisfazione edificio, Soddisfazione bene
//   - Municipio:              Livello, Legno, Marmo, Tempo, Cittadini max
//   - Porto/Ambasciata:       Livello, Legno, Marmo, Tempo, +1 valore numerico (velocità/diplomazia)
//
// Struttura dati salvata in 'building_data' (keyPath: buildingId):
// {
//   buildingId:   number,
//   name:         string,    // es. "Municipio"
//   buildingType: string,    // es. "townHall" (da td.class CSS)
//   description:  string,
//   requirement:  string,
//   columns:      string[],  // etichette colonna leggibili, in ordine reale
//   colKeys:      string[],  // chiavi snake_case corrispondenti
//   levels:       object[],  // { level, ...colKey: value, ... }
//   updated:      string,
// }
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // Mappa parole chiave (in alt-text/classe icona o testo header) → { key, label }
  // Usata per riconoscere semanticamente ogni colonna risorsa/dato, indipendentemente
  // dalla posizione in cui compare nella tabella.
  const COLUMN_HINTS = [
    { key: 'wood',        label: 'Legno',     test: /legno|wood/i },
    { key: 'wine',        label: 'Vino',      test: /vino|wine/i },
    { key: 'marble',      label: 'Marmo',     test: /marmo|marble/i },
    { key: 'crystal',     label: 'Cristallo', test: /cristallo|crystal|(?<!hour)glass/i },
    { key: 'sulfur',      label: 'Zolfo',     test: /zolfo|sulfur/i },
    { key: 'gold',        label: 'Oro',       test: /^oro$|gold(?!en)/i },
    { key: 'time',        label: 'Tempo',     test: /tempo|durat|^time$|hourglass/i },
    { key: 'scientists',  label: 'Scienziati',test: /scienziat|scientist/i },
    { key: 'citizens',    label: 'Cittadini max', test: /cittadin|citizen/i },
    { key: 'capacity',    label: 'Capacità',  test: /capacit|capacity/i },
    { key: 'loadSpeed',   label: 'Velocità di Caricamento', test: /velocit.*caric|load.*speed/i },
    { key: 'diplomacy',   label: 'Punti diplomazia', test: /diplomaz|diplomac/i },
    { key: 'unit',        label: 'Unità sbloccata', test: /permett|unlock|unit/i },
  ];

  // ── MAPPA HASH ICONA → RISORSA (verificata su HTML reale) ──
  // Le icone <th class="costs"><img src="..."> NON hanno alt-text nel
  // markup reale del gioco — solo un URL con hash CDN. L'hash però è
  // STABILE per ogni risorsa in tutte le pagine, quindi lo usiamo come
  // identificatore primario (più affidabile dell'alt-text, spesso assente).
  // Hash verificati su Municipio, Accademia, Magazzino, Taverna, Palazzo.
  const ICON_HASH_MAP = {
    'c3527b2f694fb882563c04df6d8972': { key: 'wood',    label: 'Legno' },
    '94ddfda045a8f5ced3397d791fd064': { key: 'wine',    label: 'Vino' },
    'fc258b990c1a2a36c5aeb9872fc08a': { key: 'marble',  label: 'Marmo' },
    '417b4059940b2ae2680c070a197d8c': { key: 'crystal', label: 'Cristallo' },
    '5578a7dfa3e98124439cca4a387a61': { key: 'sulfur',  label: 'Zolfo' },
    '465f0358d2cb09c07cd0f5a53e38eb': { key: 'time',    label: 'Tempo' },
  };
  // Estrae l'hash identificativo da un URL icona CDN
  // (es. "//gf2.geo.gfsrv.net/cdn19/c3527b2f694fb882563c04df6d8972.png" → hash)
  function iconUrlHash(url) {
    const m = url.match(/\/([a-f0-9]{20,})\.png/i);
    return m ? m[1] : null;
  }


  function cleanNum(raw) {
    raw = raw.trim();
    const half = Math.floor(raw.length / 2);
    if (half > 1 && raw.slice(0, half) === raw.slice(half)) {
      raw = raw.slice(0, half);
    }
    const numeric = raw.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(numeric);
    return isNaN(n) ? raw : n;
  }

  // Estrae il valore numerico preciso da un <td>. Il gioco abbrevia i numeri
  // grandi nel testo visibile (es. "434,26M", "73,64M" per milioni) e mette
  // il valore ESATTO in uno di due posti, a seconda del tipo di colonna:
  //   - colonne "costs" (risorse):  <div class="tooltip">434.262.891</div>
  //   - colonne "allow" (extra):    attributo title="73.637.056" sul <td> stesso
  // Diamo sempre priorità al valore preciso quando presente.
  function extractNumericValue(tdInnerHtml, tdFullHtml) {
    const tooltipMatch = tdInnerHtml.match(/<div class="tooltip">([^<]+)<\/div>/);
    if (tooltipMatch) return cleanNum(tooltipMatch[1]);

    if (tdFullHtml) {
      const titleMatch = tdFullHtml.match(/title="([^"]+)"/);
      if (titleMatch) return cleanNum(titleMatch[1]);
    }

    return cleanNum(stripHtml(tdInnerHtml));
  }

  function stripHtml(s) {
    return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  // Estrae il "significato" di un <th>: alt-text immagine, classe CSS icona, o testo
  function thMeaning(thHtml) {
    const alt = thHtml.match(/alt="([^"]+)"/);
    if (alt) return alt[1].trim();
    const cls = thHtml.match(/class="([^"]+)"/);
    if (cls) return cls[1].trim();
    const txt = stripHtml(thHtml);
    return txt || '';
  }

  function thLabel(thHtml) {
    const alt = thHtml.match(/alt="([^"]+)"/);
    if (alt) return alt[1].trim();
    const txt = stripHtml(thHtml);
    return txt || null;
  }

  // Classifica una colonna in base a (in ordine di priorità):
  // 1. Hash icona CDN (identificatore più affidabile, sempre presente per risorse)
  // 2. Freccia "▶" nell'header (colonne soddisfazione composte)
  // 3. alt-text dell'icona o classe CSS semantica
  // 4. Testo puro dell'header (es. "Capacità", "Scienziati")
  function classifyColumn(thHtml, index, usedKeys) {
    function reserveKey(key) {
      let k = key;
      if (usedKeys.has(k)) {
        let n = 2;
        while (usedKeys.has(`${k}_${n}`)) n++;
        k = `${k}_${n}`;
      }
      usedKeys.add(k);
      return k;
    }

    // 0. Header con testo esplicito + icone decorative interne (es. Magazzino:
    // <th class="warehouseCapacity"><div>Capacità</div><img alt="Legno".../>...)
    // Va riconosciuto PRIMA dello scan hash, altrimenti le icone Legno/Vino/...
    // dentro l'header verrebbero erroneamente matchate come risorsa singola.
    const divTextMatch = thHtml.match(/<div[^>]*>([^<]+)<\/div>/);
    if (divTextMatch) {
      const divText = divTextMatch[1].trim();
      for (const hint of COLUMN_HINTS) {
        if (hint.test.test(divText)) {
          return { key: reserveKey(hint.key), label: hint.label };
        }
      }
    }

    // 1. Hash icona CDN — identifica risorse standard anche senza alt-text
    const imgSrcs = thHtml.match(/<img[^>]*src="([^"]+)"/g) || [];
    for (const imgTag of imgSrcs) {
      const srcMatch = imgTag.match(/src="([^"]+)"/);
      if (!srcMatch) continue;
      const hash = iconUrlHash(srcMatch[1]);
      if (hash && ICON_HASH_MAP[hash]) {
        const { key, label } = ICON_HASH_MAP[hash];
        return { key: reserveKey(key), label };
      }
    }

    // 2. Colonne "doppia icona ▶ smile" (rare; nei dati reali osservati finora
    // queste colonne hanno invece alt-text leggibile, ma manteniamo il check
    // come fallback per varianti non ancora viste)
    if (/▶|<i[^>]*arrow/i.test(thHtml)) {
      const isBuildingSrc = /cittadin|building|tavern|museum/i.test(thHtml);
      const key = reserveKey(isBuildingSrc ? 'satisfactionBuilding' : 'satisfactionGood');
      return { key, label: isBuildingSrc ? 'Soddisfazione edificio' : 'Soddisfazione bene' };
    }

    // 3. alt-text o classe CSS (colonne con testo leggibile tipo
    // "Bonus soddisfazione di base", "numero massimo di cittadini")
    const meaning = thMeaning(thHtml);
    for (const hint of COLUMN_HINTS) {
      if (hint.test.test(meaning)) {
        return { key: reserveKey(hint.key), label: hint.label };
      }
    }

    // 4. Testo puro dell'header come fallback finale (es. "Capacità" dentro
    // <div>, "Vino max.", "Scienziati")
    const label = thLabel(thHtml) || `col${index}`;
    let key = label
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 30) || `col${index}`;
    return { key: reserveKey(key), label };
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

    const bidMatch = (url || '').match(/buildingId=(\d+)/);
    if (!bidMatch) return { parsed: 0, parserName: 'buildingdetail' };
    const buildingId = Number(bidMatch[1]);

    const h3s = html.match(/<h3[^>]*>(.*?)<\/h3>/gs) || [];
    const name = h3s.length > 1 ? stripHtml(h3s[1]) : '?';

    const typeMatch = html.match(/<td class="([a-zA-Z]+)"/);
    const buildingType = typeMatch ? typeMatch[1] : '';

    const descMatch = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const description = descMatch ? stripHtml(descMatch[1]) : '';

    const reqMatch = html.match(/Requisito[^:]*:?\s*<\/b>\s*([\s\S]*?)<\/td>/);
    const requirement = reqMatch ? stripHtml(reqMatch[1]) : '';

    const tables = html.match(/<table[\s\S]*?<\/table>/g) || [];
    const dataTable = tables[tables.length - 1] || '';
    if (!dataTable) return { parsed: 0, parserName: 'buildingdetail' };

    // ── HEADER: classifica dinamicamente ogni colonna ──
    const thMatches = dataTable.match(/<th[^>]*>([\s\S]*?)<\/th>/g) || [];
    if (!thMatches.length) return { parsed: 0, parserName: 'buildingdetail' };

    const colKeys   = ['level'];
    const colLabels = ['Livello'];
    const usedKeys  = new Set(['level']);

    for (let i = 1; i < thMatches.length; i++) {
      const { key, label } = classifyColumn(thMatches[i], i, usedKeys);
      colKeys.push(key);
      colLabels.push(label);
    }

    // ── RIGHE DATI ──
    const trMatches = dataTable.match(/<tr[\s\S]*?<\/tr>/g) || [];
    const levels = [];

    for (const trHtml of trMatches) {
      if (/<th/i.test(trHtml) && !/<td/i.test(trHtml)) continue;

      const tdMatches = trHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
      if (!tdMatches.length) continue;

      const levelObj = {};
      let levelNum = null;

      tdMatches.forEach((tdHtml, i) => {
        const key = colKeys[i];
        if (!key) return;
        const inner = tdHtml.replace(/^<td[^>]*>/, '').replace(/<\/td>$/, '');

        if (key === 'level') {
          const n = Number(stripHtml(inner));
          if (!isNaN(n)) levelNum = n;
          levelObj[key] = n;
          return;
        }

        if (key === 'time') {
          levelObj[key] = stripHtml(inner);
          return;
        }

        if (key === 'unit') {
          // Colonna icona-unità (Cantiere Navale/Caserma): nessun numero,
          // l'unità sbloccata è identificata da alt-text o classe dell'immagine
          const imgAlt   = inner.match(/alt="([^"]+)"/);
          const imgClass = inner.match(/class="[^"]*\b(\w+)"[^>]*\/?>(?:\s*<\/td>)?/);
          levelObj.unitUnlocked = imgAlt ? imgAlt[1].trim()
                                : (imgClass ? imgClass[1].trim() : stripHtml(inner) || null);
          return;
        }

        // Colonne soddisfazione (Taverna/Museo): il td contiene icona + valore
        // numerico finale (es. "<img>484"). Estraiamo solo il numero.
        if (key === 'satisfactionBuilding' || key === 'satisfactionGood'
            || key.startsWith('satisfactionBuilding_') || key.startsWith('satisfactionGood_')) {
          levelObj[key] = extractNumericValue(inner, tdHtml);
          return;
        }

        const txt = stripHtml(inner);
        if (txt === '' || txt === '-') {
          levelObj[key] = null;
        } else {
          levelObj[key] = extractNumericValue(inner, tdHtml);
        }
      });

      if (levelNum == null || levelNum <= 0) continue;
      levels.push(levelObj);
    }

    if (!levels.length) return { parsed: 0, parserName: 'buildingdetail' };

    if (colKeys.includes('unit')) {
      const idx = colKeys.indexOf('unit');
      colLabels[idx] = 'Unità sbloccata';
    }

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
      console.log(`[parser_buildingdetail] ${name} (id=${buildingId}): ${levels.length} livelli, colonne: ${colLabels.join(', ')}`);
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

  console.log('[parser_buildingdetail] v2 OK');
})();
