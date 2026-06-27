// ═══════════════════════════════════════════════
// parser_barracks.js v1
//
// Gestisce le risposte delle pagine Caserma (?view=barracks) e
// Cantiere Navale (?view=shipyard).
//
// Per ogni visita estrae:
//   - cityId e tipo edificio (barracks / shipyard)
//   - livello attuale dell'edificio
//   - per ogni slot unità: unitId, nome, tempo addestramento reale,
//     livello minimo richiesto, disponibilità corrente
//
// Salva in 'building_training' (keyPath: composite 'cityId_type'):
// {
//   id:       '1617_barracks',
//   cityId:   1617,
//   type:     'barracks' | 'shipyard',
//   level:    23,
//   units:    [ { unitId, name, timeSec, minLevel, available, locked } ],
//   updated:  ISO string
// }
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  function parseTimeSec(str) {
    if (!str) return null;
    let s = str.trim();
    const h = (/(\d+)h/.exec(s) || [])[1];
    const m = (/(\d+)m/.exec(s) || [])[1];
    const sec = (/(\d+)s/.exec(s) || [])[1];
    const total = (h ? +h * 3600 : 0) + (m ? +m * 60 : 0) + (sec ? +sec : 0);
    return total > 0 ? total : null;
  }

  function getBuildingType(url, data) {
    if (/view=barracks/.test(url))  return 'barracks';
    if (/view=shipyard/.test(url))  return 'shipyard';
    if (!Array.isArray(data)) return null;
    // Fallback da updateTemplateData: se il primo slot è una nave → shipyard
    for (const item of data) {
      if (!Array.isArray(item) || item[0] !== 'updateTemplateData') continue;
      const td = item[1] || {};
      const help = (td.js_barracksUnitHelp1 || {}).href || '';
      if (/shipId=/.test(help))  return 'shipyard';
      if (/unitId=/.test(help))  return 'barracks';
    }
    return null;
  }

  function getBuildingLevel(data) {
    // Metodo 1: dal testo "Livello N" nell'HTML del changeView
    for (const item of (Array.isArray(data) ? data : [])) {
      if (!Array.isArray(item) || item[0] !== 'changeView') continue;
      const html = (item[1] || [])[1] || '';
      const m = /Livello\s*<\/div>\s*(\d+)/.exec(html);
      if (m) return +m[1];
    }
    // Metodo 2: dall'URL del pulsante di upgrade
    for (const item of (Array.isArray(data) ? data : [])) {
      if (!Array.isArray(item) || item[0] !== 'changeView') continue;
      const html = (item[1] || [])[1] || '';
      const m = /level=(\d+)&/.exec(html);
      if (m) return +m[1];
    }
    return null;
  }

  function getCityId(url, data) {
    const mUrl = /[?&]cityId=(\d+)/.exec(url || '');
    if (mUrl) return +mUrl[1];
    // Da backgroundData
    for (const item of (Array.isArray(data) ? data : [])) {
      if (Array.isArray(item) && item[0] === 'updateGlobalData'
          && item[1]?.backgroundData?.id) {
        return +item[1].backgroundData.id;
      }
    }
    return null;
  }

  function extractUnits(data) {
    for (const item of (Array.isArray(data) ? data : [])) {
      if (!Array.isArray(item) || item[0] !== 'updateTemplateData') continue;
      const td = item[1] || {};
      const units = [];
      let i = 1;
      while (td[`js_barracksUnitName${i}`] !== undefined) {
        const nameData    = td[`js_barracksUnitName${i}`]     || {};
        const costData    = td[`js_barracksCosts${i}`]        || {};
        const helpData    = td[`js_barracksUnitHelp${i}`]     || {};
        const availData   = td[`js_barracksUnitUnitsAvailable${i}`] || {};
        const problemData = td[`js_barracksProblemTextfield${i}`]   || {};

        const name     = typeof nameData === 'object' ? (nameData.text || '') : '';
        const costHtml = typeof costData === 'object' ? (costData.text || '') : '';
        const helpHref = typeof helpData === 'object' ? (helpData.href || '') : '';
        const problem  = typeof problemData === 'object' ? (problemData.text || '') : '';
        const available = typeof availData === 'object'
          ? (+(availData.text) || 0) : 0;

        const uidMatch  = /unitId=(\d+)/.exec(helpHref);
        const sidMatch  = /shipId=(\d+)/.exec(helpHref);
        const unitId    = uidMatch ? +uidMatch[1] : (sidMatch ? +sidMatch[1] : null);

        const timeMatch = /Tempo di costruzione[^>]*>\s*<\/span>([^<]+)</.exec(costHtml)
                       || /Tempo di costruzione[^>]+>([^<]+)</.exec(costHtml);
        const timeStr   = timeMatch ? timeMatch[1].trim() : null;
        const timeSec   = parseTimeSec(timeStr);

        const minLvMatch = /livello[^<>]*<b>(\d+)<\/b>/.exec(problem);
        const minLevel   = minLvMatch ? +minLvMatch[1] : null;
        const locked     = !!minLevel;

        if (name && unitId) {
          units.push({ unitId, name, timeSec, minLevel, available, locked });
        }
        i++;
      }
      return units;
    }
    return [];
  }

  async function parse(url, data, meta) {
    const type   = getBuildingType(url, data);
    if (!type) return { parsed: 0, parserName: 'barracks' };

    const cityId = getCityId(url, data);
    if (!cityId) return { parsed: 0, parserName: 'barracks' };

    const level  = getBuildingLevel(data);
    const units  = extractUnits(data);
    if (!units.length) return { parsed: 0, parserName: 'barracks' };

    const record = {
      id:      `${cityId}_${type}`,
      cityId,
      type,
      level,
      units,
      updated: meta?.date || new Date().toISOString(),
    };

    try {
      await window.IkDB.put('building_training', record);
    } catch (e) {
      console.error('[parser_barracks] DB error:', e.message);
      return { parsed: 0, parserName: 'barracks' };
    }

    console.log(`[parser_barracks] city=${cityId} ${type} lv=${level} → ${units.length} unità`);
    window.IkApp?.onBuildingTrainingUpdated?.(cityId, type);

    return { parsed: 1, parserName: 'barracks', cityId, type, level };
  }

  window.IkParsers?.registerParser('barracks', {
    match: (url, data) => {
      if (/view=(barracks|shipyard)/.test(url || '')) return true;
      return getBuildingType(null, data) !== null;
    },
    parse,
  });

  console.log('[parser_barracks] v1 OK');
})();
