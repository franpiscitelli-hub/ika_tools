// ═══════════════════════════════════════════════
// parser_workshop.js
//
// Gestisce le risposte della pagina "Officina"
// (?view=workshop&cityId=N&position=9...)
// Mostra i potenziamenti offensivi/difensivi disponibili per ogni
// truppa (tabUnits) o nave (tabShips): livello attuale, prossimo
// livello, costo (oro + cristallo) e durata.
//
// A differenza degli altri parser di dettaglio, qui i dati sono già
// in JSON strutturato dentro updateTemplateData.completeData — non
// serve scraping HTML.
//
// I dati vengono salvati DENTRO il record esistente in 'unit_data'
// (stesso store popolato da parser_unitdescription.js), in un campo
// aggiuntivo "upgrades", così la scheda di un'unità ha sia le
// statistiche base sia i potenziamenti correnti in un unico posto.
// Se il record base non esiste ancora (unità mai aperta da "Aiuto"),
// ne viene creato uno minimale con solo id/kind/unitId/upgrades.
//
// upgrades: {
//   offensive: {
//     statName:     string,  // es. "Danno" (da upgradeTypeDesc)
//     currentLevel: number,
//     currentName:  string,  // es. "Proiettili di Acciaio"
//     currentEffect:number,
//     nextLevel:    number | null,
//     nextName:     string | null,
//     nextEffect:   number | null,
//     goldCost:     number | null,
//     crystalCost:  number | null,
//     duration:     string | null,  // es. "4h"
//     isMaxLevel:   boolean,
//   },
//   defensive: { ...stessa struttura... },
// }
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // Pulisce un numero formattato italiano (es. "1.732.519" → 1732519)
  function parseItNumber(str) {
    if (str == null) return null;
    if (typeof str === 'number') return str;
    const n = Number(String(str).replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  // Estrae i dati di un ramo (offensive/defensive) in formato pulito
  function parseUpgradeBranch(branch) {
    if (!branch) return null;
    const cur = branch.currentLevel || {};
    const nxt = branch.nextLevel || null;

    return {
      statName:      branch.upgradeTypeDesc || branch.upgradeTypeName || '',
      currentLevel:  cur.upgradeLevel ?? null,
      currentName:   cur.upgradeName  ?? null,
      currentEffect: cur.upgradeEffect ?? null,
      nextLevel:     nxt ? (nxt.upgradeLevel ?? null) : null,
      nextName:      nxt ? (nxt.upgradeName  ?? null) : null,
      nextEffect:    nxt ? (nxt.upgradeEffect ?? null) : null,
      goldCost:      nxt ? parseItNumber(nxt.goldCosts)    : null,
      crystalCost:   nxt ? parseItNumber(nxt.crystalCosts) : null,
      duration:      nxt ? (nxt.duration ?? null) : null,
      isMaxLevel:    !nxt,
      errorText:     branch.errorText || null,
    };
  }

  async function parse(url, data, meta) {
    meta = meta || {};
    if (!Array.isArray(data)) return { parsed: 0, parserName: 'workshop' };

    // I dati sono in updateTemplateData (non in changeView/HTML)
    let templateData = null;
    for (const item of data) {
      if (Array.isArray(item) && item[0] === 'updateTemplateData' && item[1] && typeof item[1] === 'object') {
        templateData = item[1];
        break;
      }
    }
    if (!templateData) return { parsed: 0, parserName: 'workshop' };

    const completeData = templateData.completeData;
    if (!completeData || typeof completeData !== 'object') return { parsed: 0, parserName: 'workshop' };

    // Determina se questa è la tab Truppe o Navi dal campo activeTab.
    // 'tabUnits' → truppe (prefisso "unit_"), qualsiasi altra cosa con
    // "ship" nel nome → navi (prefisso "ship_"). Fallback su 'unit' se
    // il valore non è riconosciuto, per non perdere comunque i dati.
    const activeTab = String(templateData.activeTab || '').toLowerCase();
    const kind = activeTab.includes('ship') ? 'ship' : 'unit';
    const prefix = kind === 'ship' ? 'ship_' : 'unit_';

    let count = 0;
    for (const [rawId, branches] of Object.entries(completeData)) {
      const numId = Number(rawId);
      if (!numId) continue;
      const id = `${prefix}${numId}`;

      const upgrades = {
        offensive: parseUpgradeBranch(branches.offensive),
        defensive: parseUpgradeBranch(branches.defensive),
      };

      try {
        const existing = await window.IkDB.get('unit_data', id);
        await window.IkDB.put('unit_data', {
          ...(existing || { id, kind, unitId: numId }),
          upgrades,
          upgradesUpdated: meta.date || new Date().toISOString(),
        });
        count++;
      } catch (e) {
        console.error('[parser_workshop] DB error per', id, ':', e.message);
      }
    }

    if (count > 0) {
      console.log(`[parser_workshop] ${count} potenziamenti ${kind === 'ship' ? 'navi' : 'truppe'} aggiornati`);
    }

    return { parsed: count, parserName: 'workshop' };
  }

  window.IkParsers?.registerParser('workshop', {
    match: (url, data) => {
      if (!Array.isArray(data)) return false;
      return data.some(item =>
        Array.isArray(item) &&
        item[0] === 'updateTemplateData' &&
        item[1] && typeof item[1] === 'object' &&
        item[1].completeData && typeof item[1].completeData === 'object'
      );
    },
    parse,
  });

  console.log('[parser_workshop] v1 OK');
})();
