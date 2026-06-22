// ═══════════════════════════════════════════════
// parser_citymilitary.js v1
//
// Gestisce le risposte della pagina "Truppe nella città"
// (?view=cityMilitary&cityId=N&activeTab=tabUnits|tabShips)
//
// Match: changeView[0] === 'cityMilitary'
//
// La pagina mostra, per ciascuna polis, le truppe (tabUnits) e le navi
// (tabShips) attualmente presenti, suddivise in sezioni per "ruolo":
//   tabUnits: Presidio (guarnigione), Difensore (truppe alleate),
//             Forze di occupazione (truppe nemiche)
//   tabShips: Navi (flotta propria), Difensore (navi alleate),
//             Flotte bloccate (navi nemiche)
// Ogni sezione può contenere più righe (una per proprietario, identificato
// da avatarId) e più tabelle affiancate (il gioco spezza la lista unità in
// gruppi da 7-8 colonne): le tabelle della stessa sezione vengono fuse per
// proprietario.
//
// Struttura dati salvata in 'city_military' (keyPath: cityId):
// {
//   cityId:         number,
//   garrisonLimits: { land, landMax, sea, seaMax },
//   land: {
//     garrison:  [ { ownerId, ownerName, units: { unitId: count, ... } } ],
//     allied:    [ ... stessa struttura, truppe alleate ... ],
//     occupying: [ ... stessa struttura, truppe nemiche occupanti ... ],
//   },
//   sea: {
//     own:      [ ... flotta propria ... ],
//     allied:   [ ... navi alleate ... ],
//     blocking: [ ... flotte nemiche bloccate ... ],
//   },
//   updated: string,
// }
//
// In più, i nomi unità/navi letti dagli header delle tabelle vengono usati
// per "seminare" record minimali in 'unit_data' (stesso store popolato da
// parser_unitdescription/parser_workshop) quando non esistono ancora, così
// la vista Truppe può mostrare un nome leggibile anche per unità mai aperte
// dalla pagina "Aiuto".
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  function stripHtml(s) {
    return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  function parseCount(raw) {
    const txt = stripHtml(raw).replace(/\./g, '');
    const n = parseInt(txt, 10);
    return isNaN(n) ? 0 : n;
  }

  // L'URL catturato per questa vista a volte è privo di query string
  // (es. "index.php" semplice, osservato su richieste successive alla prima
  // nella stessa sessione) — non possiamo fare affidamento solo sul parametro
  // cityId nell'URL. La fonte più affidabile è backgroundData.id, che
  // accompagna SEMPRE il changeView di cityMilitary in updateGlobalData.
  function findCityIdFromBackground(data) {
    if (!Array.isArray(data)) return null;
    for (const item of data) {
      if (Array.isArray(item) && item[0] === 'updateGlobalData'
          && item[1] && typeof item[1] === 'object' && item[1].backgroundData?.id) {
        const id = Number(item[1].backgroundData.id);
        if (id) return id;
      }
    }
    return null;
  }

  function findCityIdFromHtml(html) {
    // Il pulsante "Pacchetti sagome" riporta sempre ?view=premiumDummy&cityId=N
    const m = html.match(/view=premiumDummy&cityId=(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function findCityMilitaryHtml(data) {
    if (!Array.isArray(data)) return null;
    for (const item of data) {
      if (Array.isArray(item) && item[0] === 'changeView') {
        const view = item[1];
        if (Array.isArray(view) && view[0] === 'cityMilitary') {
          return typeof view[1] === 'string' ? view[1] : null;
        }
      }
    }
    return null;
  }

  // Limiti guarnigione: arrivano già come numeri puliti in updateTemplateData,
  // preferiti allo scraping HTML (più affidabili, nessun parsing di testo).
  function findGarrisonLimits(data) {
    if (Array.isArray(data)) {
      for (const item of data) {
        if (Array.isArray(item) && item[0] === 'updateTemplateData' && item[1] && typeof item[1] === 'object') {
          const td = item[1];
          if ('js_GarrisonLand' in td || 'js_GarrisonSea' in td) {
            return {
              land:    Number(td.js_GarrisonLand?.text ?? 0) || 0,
              landMax: Number(td.js_TownHallGarrisonLimitLand?.text ?? 0) || 0,
              sea:     Number(td.js_GarrisonSea?.text ?? 0) || 0,
              seaMax:  Number(td.js_TownHallGarrisonLimitSea?.text ?? 0) || 0,
            };
          }
        }
      }
    }
    return null;
  }

  // Fallback: scraping diretto degli <span id="js_..."> nell'HTML,
  // usato solo se updateTemplateData non è presente nel payload.
  function garrisonLimitsFromHtml(html) {
    const g = (id) => {
      const m = html.match(new RegExp(`id="${id}">\\s*([\\d.]+)\\s*<`));
      return m ? parseCount(m[1]) : 0;
    };
    return {
      land:    g('js_GarrisonLand'),
      landMax: g('js_TownHallGarrisonLimitLand'),
      sea:     g('js_GarrisonSea'),
      seaMax:  g('js_TownHallGarrisonLimitSea'),
    };
  }

  // Spezza un blocco HTML in sezioni delimitate da <h3 class="header">Titolo</h3>,
  // affettando per POSIZIONE del titolo invece di provare a bilanciare i tag
  // </div> annidati (le sezioni contengono tabelle/div innestati che renderebbero
  // fragile un match non-greedy su "fino al prossimo </div>").
  function splitByHeaders(html) {
    const re = /<h3 class="header">([^<]*)<\/h3>/g;
    const marks = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      marks.push({ title: m[1].trim(), start: m.index, contentStart: re.lastIndex });
    }
    const sections = [];
    for (let i = 0; i < marks.length; i++) {
      const end = (i + 1 < marks.length) ? marks[i + 1].start : html.length;
      sections.push({ title: marks[i].title, html: html.slice(marks[i].contentStart, end) });
    }
    return sections;
  }

  // Estrae le tabelle "militaryList" di una sezione e le fonde per proprietario
  // (avatarId). namesMap viene popolata in-place con id → nome leggibile.
  function parseSectionTables(html, namesMap) {
    const tables = html.match(/<table class="table01[^"]*">[\s\S]*?<\/table>/g) || [];
    const byOwner = new Map();

    for (const table of tables) {
      const thBlocks = table.match(/<th[^>]*>[\s\S]*?<\/th>/g) || [];
      const cols = [];
      for (let i = 1; i < thBlocks.length; i++) {
        const idMatch   = thBlocks[i].match(/class="(?:army|fleet) s(\d+)"/);
        const nameMatch = thBlocks[i].match(/<div class="tooltip">([^<]*)<\/div>/);
        const id   = idMatch ? Number(idMatch[1]) : null;
        const name = nameMatch ? nameMatch[1].trim() : null;
        if (id != null && name) namesMap.set(id, name);
        cols.push(id);
      }

      const trBlocks = table.match(/<tr class="count">[\s\S]*?<\/tr>/g) || [];
      for (const tr of trBlocks) {
        const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
        if (!tds.length) continue;

        const avatarMatch   = tr.match(/avatarId=(\d+)/);
        const nameLinkMatch = tds[0].match(/<a[^>]*>([^<]*)<\/a>/);
        const ownerId   = avatarMatch ? Number(avatarMatch[1]) : null;
        const ownerName = nameLinkMatch ? nameLinkMatch[1].trim() : (stripHtml(tds[0]) || '?');
        const key = ownerId != null ? `id_${ownerId}` : `name_${ownerName}`;

        if (!byOwner.has(key)) byOwner.set(key, { ownerId, ownerName, units: {} });
        const entry = byOwner.get(key);

        for (let i = 1; i < tds.length; i++) {
          const unitId = cols[i - 1];
          if (unitId == null) continue;
          entry.units[unitId] = (entry.units[unitId] || 0) + parseCount(tds[i]);
        }
      }
    }

    return Array.from(byOwner.values());
  }

  async function parse(url, data, meta) {
    meta = meta || {};
    const html = findCityMilitaryHtml(data);
    if (!html) return { parsed: 0, parserName: 'citymilitary' };

    const urlMatch = (url || '').match(/[?&]cityId=(\d+)/);
    const cityId = findCityIdFromBackground(data)
                || (urlMatch ? Number(urlMatch[1]) : null)
                || findCityIdFromHtml(html);
    if (!cityId) return { parsed: 0, parserName: 'citymilitary' };

    const tabUnitsIdx = html.indexOf('id="tabUnits"');
    const tabShipsIdx = html.indexOf('id="tabShips"');
    if (tabUnitsIdx === -1 || tabShipsIdx === -1) return { parsed: 0, parserName: 'citymilitary' };

    const unitsHtml = html.slice(tabUnitsIdx, tabShipsIdx);
    const shipsHtml = html.slice(tabShipsIdx);

    // Spazio ID condiviso ma non sovrapposto tra truppe (3xx) e navi (2xx):
    // un'unica mappa nome basta per "seminare" entrambi i kind in unit_data.
    const namesMap = new Map();

    const unitSections = splitByHeaders(unitsHtml);
    const shipSections  = splitByHeaders(shipsHtml);

    function sectionFor(sections, keyword) {
      const s = sections.find(s => s.title.includes(keyword));
      return s ? parseSectionTables(s.html, namesMap) : [];
    }

    const land = {
      garrison:  sectionFor(unitSections, 'Presidio'),
      allied:    sectionFor(unitSections, 'Difensore'),
      occupying: sectionFor(unitSections, 'occupazione'),
    };
    const sea = {
      own:      sectionFor(shipSections, 'Navi'),
      allied:   sectionFor(shipSections, 'Difensore'),
      blocking: sectionFor(shipSections, 'bloccate'),
    };

    const garrisonLimits = findGarrisonLimits(data) || garrisonLimitsFromHtml(html);

    const record = {
      cityId,
      garrisonLimits,
      land,
      sea,
      updated: meta.date || new Date().toISOString(),
    };

    try {
      await window.IkDB.put('city_military', record);
    } catch (e) {
      console.error('[parser_citymilitary] DB error:', e.message);
      return { parsed: 0, parserName: 'citymilitary' };
    }

    // Semina nomi base in 'unit_data' SOLO se il record non esiste già o non
    // ha ancora un nome (non sovrascrive dati completi da altri parser).
    let seeded = 0;
    for (const [numId, name] of namesMap) {
      const kind = (numId >= 200 && numId < 300) ? 'ship' : 'unit';
      const id = `${kind}_${numId}`;
      try {
        const existing = await window.IkDB.get('unit_data', id);
        if (existing && existing.name) continue;
        await window.IkDB.put('unit_data', {
          ...(existing || { id, kind, unitId: numId }),
          name,
          updated: existing?.updated || (meta.date || new Date().toISOString()),
        });
        seeded++;
      } catch {}
    }

    const totalRows = land.garrison.length + land.allied.length + land.occupying.length
                     + sea.own.length + sea.allied.length + sea.blocking.length;

    console.log(`[parser_citymilitary] città ${cityId}: ${totalRows} righe proprietario (${seeded} nomi unità seminati)`);

    window.IkApp?.onMilitaryUpdated?.(cityId);

    return { parsed: 1, parserName: 'citymilitary', cityId };
  }

  window.IkParsers?.registerParser('citymilitary', {
    match: (url, data) => {
      if (!Array.isArray(data)) return false;
      return data.some(item =>
        Array.isArray(item) &&
        item[0] === 'changeView' &&
        Array.isArray(item[1]) &&
        item[1][0] === 'cityMilitary'
      );
    },
    parse,
  });

  console.log('[parser_citymilitary] v1 OK');
})();
