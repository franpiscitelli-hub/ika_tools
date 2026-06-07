// ═══════════════════════════════════════════════
// parser_globaldata.js — updateGlobalData Ikariam
// Struttura: array di [action, payload]
// Contiene: risorse, città, costruzioni, timer
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // Mappa risorse: id numerico → nome
  const RES_NAMES = { 1:'Legno', 2:'Vino', 3:'Marmo', 4:'Cristallo', 5:'Zolfo' };

  async function parse(url, data) {
    if (!Array.isArray(data)) return 0;
    let count = 0;

    for (const item of data) {
      if (!Array.isArray(item) || item.length < 2) continue;
      const [action, payload] = item;

      switch (action) {
        case 'updateGlobalData':
          count += await handleGlobalData(payload);
          break;
      }
    }
    return count;
  }

  async function handleGlobalData(p) {
    if (!p || typeof p !== 'object') return 0;
    let count = 0;

    // ── headerData → risorse della città corrente ──
    if (p.headerData) {
      count += await parseHeaderData(p.headerData);
    }

    // ── backgroundData → città + costruzioni ───────
    if (p.backgroundData) {
      count += await parseBackgroundData(p.backgroundData);
    }

    // ── nextETA → timer prossima costruzione ───────
    if (p.nextETA) {
      try {
        const eta = typeof p.nextETA === 'string' ? JSON.parse(p.nextETA) : p.nextETA;
        if (eta.timestamp && eta.cityName) {
          window.IkNotifier?.scheduleTimer({
            id:      `construction_${eta.cityName}`,
            label:   `🏗 Costruzione completata — ${eta.cityName}`,
            endTime: eta.timestamp * 1000,
            type:    'building',
          });
        }
      } catch {}
    }

    return count;
  }

  async function parseHeaderData(hd) {
    // Trova cityId dalla relatedCity
    const cityId = hd.relatedCity?.owncity
      ? Object.keys(hd.relatedCity)[0]
      : null;

    // currentResources: { 1: legno, 2: vino, 3: marmo, 4: cristallo, 5: zolfo, citizens, population }
    const cr  = hd.currentResources || {};
    const max = hd.maxResources     || {};

    const resources = {
      cityId:     Number(cityId) || 0,
      wood:       Number(cr[1] ?? cr['1'] ?? 0),
      wine:       Number(cr[2] ?? cr['2'] ?? 0),
      marble:     Number(cr[3] ?? cr['3'] ?? 0),
      crystal:    Number(cr[4] ?? cr['4'] ?? 0),
      sulfur:     Number(cr[5] ?? cr['5'] ?? 0),
      citizens:   Number(cr.citizens ?? 0),
      population: Number(cr.population ?? 0),
      maxRes:     Number(max[1] ?? max['1'] ?? 0),
      gold:       Number(hd.gold ?? 0),
      income:     Number(hd.income ?? 0),
      upkeep:     Number(hd.upkeep ?? 0),
      ambrosia:   Number(hd.ambrosia ?? 0),
      transports: Number(hd.freeTransporters ?? 0),
      maxTransports: Number(hd.maxTransporters ?? 0),
      updated:    new Date().toISOString(),
    };

    if (resources.cityId || resources.wood || resources.gold) {
      try { await window.IkDB.put('resources', resources); } catch {}
      window.IkApp?.onResourcesUpdated?.(resources.cityId);
    }

    return 1;
  }

  async function parseBackgroundData(bd) {
    if (!bd.id) return 0;
    const cityId = Number(bd.id);

    // Salva città
    await window.IkDB.put('cities', {
      id:       cityId,
      name:     bd.name || '?',
      isCapital:!!bd.isCapital,
      islandId: Number(bd.islandId),
      islandName:bd.islandName || '',
      islandX:  Number(bd.islandXCoord),
      islandY:  Number(bd.islandYCoord),
      ownerId:  Number(bd.ownerId),
      ownerName:bd.ownerName || '',
      updated:  new Date().toISOString(),
    });

    // Costruzioni in corso
    if (bd.constructionListEndDate && bd.constructionListEndDate > 0) {
      const endMs = bd.constructionListEndDate * 1000;
      const remaining = endMs - Date.now();

      if (remaining > 0) {
        // underConstruction = numero edifici in coda
        window.IkNotifier?.scheduleTimer({
          id:      `build_${cityId}`,
          label:   `🏗 ${bd.name || 'Città'} — coda costruzioni`,
          endTime: endMs,
          type:    'building',
        });

        // Salva costruzione
        await window.IkDB.put('constructions', {
          id:      `build_${cityId}`,
          cityId,
          cityName:bd.name || '?',
          count:   Number(bd.underConstruction || 1),
          endTime: endMs,
          updated: new Date().toISOString(),
        });
      }
    }

    // Edifici (position array)
    if (Array.isArray(bd.position)) {
      for (const pos of bd.position) {
        if (!pos || !pos.building) continue;
        await window.IkDB.put('buildings', {
          id:       `${cityId}_${pos.groundId}`,
          cityId,
          building: pos.building,
          name:     pos.name || pos.building,
          level:    Number(pos.level || 0),
          isBusy:   !!pos.isBusy,
          groundId: Number(pos.groundId),
          updated:  new Date().toISOString(),
        });
      }
    }

    window.IkApp?.onCitiesUpdated?.(cityId);
    return 1;
  }

  window.IkParsers?.registerParser('globaldata', {
    match: url => /updateGlobalData|index\.php/i.test(url),
    parse,
  });

  console.log('[parser_globaldata] Caricato');
})();
