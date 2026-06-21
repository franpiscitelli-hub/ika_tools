// ═══════════════════════════════════════════════
// parser_unitdescription.js
//
// Gestisce le risposte della pagina "Descrizione unità"
// (?view=unitdescription&unitId=N oppure &shipId=N)
// Aperta dalla Caserma (truppe) o dal Cantiere Navale (navi),
// mostra costo, requisiti, statistiche di combattimento.
//
// Match: changeView[0] === 'unitdescription'
//
// Struttura dati salvata in 'unit_data' (keyPath: id):
// {
//   id:           string,   // "unit_301" o "ship_201" (prefisso evita collisioni
//                            // tra unitId e shipId che condividono lo stesso range numerico)
//   kind:         'unit' | 'ship',
//   unitId:       number,   // ID numerico grezzo (301, 201, ...)
//   slug:         string,   // es. "slinger" (se ricavabile dall'URL/markup)
//   name:         string,   // es. "Fromboliere"
//   type:         string,   // es. "Combattente a lunga distanza, Umano"
//   isRanged:     boolean,  // true se ha una seconda arma (attacco a distanza)
//   description:  string,
//
//   cost: {                 // costo di costruzione (chiavi presenti solo se applicabili)
//     wood, wine, marble, crystal, sulfur,  // risorse (in base alle classi <li> trovate)
//     citizens, upkeep, weight, buildingLevel, completionTime,
//   },
//
//   stats: {
//     hp, armor, speed, size,
//   },
//
//   weapons: [               // 1 elemento (mischia) o 2 (mischia + distanza)
//     { name, damage, accuracyPercent, ammo },
//   ],
//
//   requirement: { building: string, buildingId: number, level: number } | null,
//
//   updated: string,
// }
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  function stripHtml(s) {
    return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  // Mappa classe <li> → chiave dato costo (in ul.resources dentro #unitRes)
  const RESOURCE_LI_MAP = {
    wood:            'wood',
    wine:            'wine',
    marble:          'marble',
    crystal:         'crystal',
    sulfur:          'sulfur',
    citizens:        'citizens',
    upkeep:          'upkeep',
    weight:          'weight',
    building_level:  'buildingLevel',
    completionTime:  'completionTime',
  };

  function findUnitDescriptionHtml(data) {
    if (!Array.isArray(data)) return null;
    for (const item of data) {
      if (Array.isArray(item) && item[0] === 'changeView') {
        const view = item[1];
        if (Array.isArray(view) && view[0] === 'unitdescription') {
          return typeof view[1] === 'string' ? view[1] : null;
        }
      }
    }
    return null;
  }

  async function parse(url, data, meta) {
    meta = meta || {};
    const html = findUnitDescriptionHtml(data);
    if (!html) return { parsed: 0, parserName: 'unitdescription' };

    // Determina kind + ID da URL (unitId per truppe, shipId per navi)
    const unitMatch = (url || '').match(/[?&]unitId=(\d+)/);
    const shipMatch = (url || '').match(/[?&]shipId=(\d+)/);
    const kind     = shipMatch ? 'ship' : (unitMatch ? 'unit' : null);
    const numId    = shipMatch ? Number(shipMatch[1]) : (unitMatch ? Number(unitMatch[1]) : null);
    if (!kind || !numId) return { parsed: 0, parserName: 'unitdescription' };
    const id = `${kind}_${numId}`;

    // Nome unità: SECONDO <h3 class="header"> (il primo è sempre "Aiuto",
    // titolo generico della pagina, indipendentemente dall'unità mostrata)
    const headerMatches = html.match(/<h3 class="header">(.*?)<\/h3>/gs) || [];
    const name = headerMatches.length > 1
      ? stripHtml(headerMatches[1].replace(/<\/?h3[^>]*>/g, ''))
      : (headerMatches.length === 1 ? stripHtml(headerMatches[0].replace(/<\/?h3[^>]*>/g, '')) : '?');

    // Slug interno: dalla classe del div #unit (es. class="s301") non è leggibile;
    // proviamo invece a estrarlo da eventuali pattern id="button_XXX" nel markup,
    // altrimenti resta null (non critico, l'id numerico è già univoco).
    const slugMatch = html.match(/button_([a-zA-Z]+)["'][^>]*class="[^"]*\bselected\b/);
    const slug = slugMatch ? slugMatch[1] : null;

    // ── COSTI: ul.resources dentro #unitRes ──
    const resBlockMatch = html.match(/<div id="unitRes">([\s\S]*?)<\/div>\s*<\/div>/);
    const cost = {};
    if (resBlockMatch) {
      const liMatches = resBlockMatch[1].match(/<li class="([a-zA-Z_]+)[^"]*"[^>]*>([\s\S]*?)<\/li>/g) || [];
      for (const li of liMatches) {
        const clsMatch = li.match(/<li class="([a-zA-Z_]+)/);
        const cls = clsMatch ? clsMatch[1] : null;
        const key = cls ? RESOURCE_LI_MAP[cls] : null;
        if (!key) continue;
        // Rimuove lo <span class="accesshint">...</span> interno (può avere
        // newline/spazi tra <span e class=, quindi \s+ invece di spazio letterale)
        const withoutHint = li.replace(/<span\s+class="accesshint">.*?<\/span>/s, '');
        const valueText = stripHtml(withoutHint);
        if (key === 'completionTime') {
          cost[key] = valueText; // stringa leggibile, es. "1m 30s"
        } else {
          const n = Number(valueText.replace(/\./g, '').replace(',', '.'));
          cost[key] = isNaN(n) ? valueText : n;
        }
      }
    }

    // ── STATISTICHE: blocco infoBoxContent > div.floatleft.width_150 ──
    const statsBlockMatch = html.match(/<div class="floatleft width_150">([\s\S]*?)<\/div>/);
    const stats = {};
    if (statsBlockMatch) {
      const block = statsBlockMatch[1];
      const hpMatch    = block.match(/Punti vita\s*:?\s*<\/span><b>([^<]*)<\/b>/);
      const armorMatch = block.match(/Armatura:?\s*<\/span><b>([^<]*)<\/b>/);
      const speedMatch = block.match(/Velocità:?\s*<\/span>\s*([^<]*?)\s*<br/);
      const sizeMatch  = block.match(/Dimensione\s*:?\s*<\/span>([^<]*)<br/);
      if (hpMatch)    stats.hp    = Number(stripHtml(hpMatch[1])) || stripHtml(hpMatch[1]);
      if (armorMatch) {
        const armorText = stripHtml(armorMatch[1]);
        stats.armor = armorText === '-' ? null : (Number(armorText) || armorText);
      }
      if (speedMatch) stats.speed = Number(stripHtml(speedMatch[1])) || stripHtml(speedMatch[1]);
      if (sizeMatch)  stats.size  = Number(stripHtml(sizeMatch[1])) || stripHtml(sizeMatch[1]);
    }

    // Tipo unità: <h3> dentro infoBoxContent (diverso dall'header principale,
    // è il PRIMO <h3> dopo "infoBoxContent")
    const infoBoxIdx = html.indexOf('infoBoxContent');
    let type = '';
    if (infoBoxIdx !== -1) {
      const afterInfoBox = html.slice(infoBoxIdx);
      const typeMatch = afterInfoBox.match(/<h3>(.*?)<\/h3>/s);
      if (typeMatch) type = stripHtml(typeMatch[1]);
    }

    // ── ARMI: split sul marker <div class="weaponName"> invece di provare a
    // bilanciare i tag </div> annidati (damageFocusContainer ha la sua chiusura
    // </div> PRIMA del testo "Munizione", quindi un match non-greedy sul primo
    // </div></div> tronca il blocco troppo presto). Tagliamo il segmento di HTML
    // da un marker weaponName al successivo (o alla sezione "Requisito(i)").
    const weapons = [];
    const weaponStartIdx = [];
    const weaponNameRe = /<div class="weaponName">/g;
    let wm;
    while ((wm = weaponNameRe.exec(html)) !== null) weaponStartIdx.push(wm.index);

    const reqIdx = html.indexOf('class="req"');
    for (let i = 0; i < weaponStartIdx.length; i++) {
      const start = weaponStartIdx[i];
      const end   = (i + 1 < weaponStartIdx.length) ? weaponStartIdx[i + 1]
                  : (reqIdx !== -1 ? reqIdx : start + 1000);
      const wb = html.slice(start, end);

      const wNameMatch = wb.match(/<div class="weaponName">([^<]*)<\/div>/);
      const dmgMatch   = wb.match(/Danno\s*:?\s*<\/span>\s*([^<]*?)\s*<br/s);
      const accMatch   = wb.match(/width:\s*(\d+)%/);
      const ammoMatch  = wb.match(/Munizione:?\s*<\/span>\s*([^<]*?)\s*<\/div>/s);
      if (!wNameMatch) continue;

      const weapon = {
        name:            stripHtml(wNameMatch[1]),
        damage:          dmgMatch ? (Number(stripHtml(dmgMatch[1])) || stripHtml(dmgMatch[1])) : null,
        accuracyPercent: accMatch ? Number(accMatch[1]) : null,
      };
      if (ammoMatch) {
        const ammoVal = stripHtml(ammoMatch[1]);
        weapon.ammo = Number(ammoVal) || ammoVal;
      }
      weapons.push(weapon);
    }
    const isRanged = weapons.length > 1;

    // ── REQUISITO: <span class="available"><a href="?view=buildingDetail&buildingId=N...">NomeEdificio ( Lv )</a> ──
    const reqMatch = html.match(/<span class="available">\*?\s*<a[^>]*href="[^"]*buildingId=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/);
    let requirement = null;
    if (reqMatch) {
      const buildingId = Number(reqMatch[1]);
      const reqText    = stripHtml(reqMatch[2]); // es. "Caserma ( 2 )"
      const lvlMatch   = reqText.match(/\(\s*(\d+)\s*\)/);
      const buildingName = reqText.replace(/\(\s*\d+\s*\)/, '').trim();
      requirement = {
        building:   buildingName,
        buildingId,
        level:      lvlMatch ? Number(lvlMatch[1]) : null,
      };
    }

    // ── DESCRIZIONE: div.shortdesc (dopo l'h4 col nome ripetuto) ──
    const descMatch = html.match(/<div class="shortdesc">[\s\S]*?<\/h4>\s*([\s\S]*?)<\/div>/);
    const description = descMatch ? stripHtml(descMatch[1]) : '';

    if (!name || name === '?') return { parsed: 0, parserName: 'unitdescription' };

    try {
      const existing = await window.IkDB.get('unit_data', id);
      await window.IkDB.put('unit_data', {
        ...(existing || {}),
        id,
        kind,
        unitId: numId,
        slug,
        name,
        type,
        isRanged,
        description,
        cost,
        stats,
        weapons,
        requirement,
        updated: meta.date || new Date().toISOString(),
      });
      console.log(`[parser_unitdescription] ${name} (${id}): ${weapons.length} arma/i, ranged=${isRanged}`);
    } catch (e) {
      console.error('[parser_unitdescription] DB error:', e.message);
      return { parsed: 0, parserName: 'unitdescription' };
    }

    return { parsed: 1, parserName: 'unitdescription', id, name, kind };
  }

  window.IkParsers?.registerParser('unitdescription', {
    match: (url, data) => {
      if (!Array.isArray(data)) return false;
      return data.some(item =>
        Array.isArray(item) &&
        item[0] === 'changeView' &&
        Array.isArray(item[1]) &&
        item[1][0] === 'unitdescription'
      );
    },
    parse,
  });

  console.log('[parser_unitdescription] v1 OK');
})();
