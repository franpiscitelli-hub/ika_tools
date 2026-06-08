// ═══════════════════════════════════════════════
// parser_globaldata.js v2
// Fix: resources.cityId mai null, constructions id stringa
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const TG = { 1:'Vino', 2:'Marmo', 3:'Cristallo', 4:'Zolfo' };

  async function parse(url, data) {
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const item of data) {
      if (!Array.isArray(item) || item.length < 2) continue;
      if (item[0] !== 'updateGlobalData') continue;
      const payload = item[1];
      if (!payload || typeof payload !== 'object') continue;
      // Passa backgroundData a parseHeader per ottenere cityId
      const cityId = payload.backgroundData?.id ? Number(payload.backgroundData.id) : null;
      if (payload.headerData)     count += await parseHeader(payload.headerData, cityId);
      if (payload.backgroundData) count += await parseBackground(payload.backgroundData);
    }
    return count;
  }

  async function parseHeader(hd, cityId) {
    // cityId ora arriva già da backgroundData, non null
    if (!cityId) return 0; // senza cityId non possiamo salvare risorse

    const cr  = hd.currentResources || {};
    const mr  = hd.maxResources     || {};
    const maxStorage = Number(mr['0'] || mr['1'] || mr['resource'] || 0);

    const woodPerHour = Math.round((hd.resourceProduction  || 0) * 3600);
    const tgPerHour   = Math.round((hd.tradegoodProduction || 0) * 3600);

    // Salva risorse con cityId garantito non-null
    try {
      await window.IkDB.put('resources', {
        cityId,
        wine:       Number(cr['1']        || 0),
        marble:     Number(cr['2']        || 0),
        crystal:    Number(cr['3']        || 0),
        sulfur:     Number(cr['4']        || 0),
        wood:       Number(cr['resource'] || 0),
        citizens:   Number(cr.citizens    || 0),
        population: Number(cr.population  || 0),
        maxStorage,
        gold:             Math.round(hd.gold             || 0),
        income:           Math.round(hd.income           || 0),
        upkeep:           Math.round(hd.upkeep           || 0),
        godGoldResult:    Math.round(hd.godGoldResult    || 0),
        scientistsUpkeep: Math.round(hd.scientistsUpkeep || 0),
        ambrosia:         Number(hd.ambrosia             || 0),
        maxTransporters:  Number(hd.maxTransporters      || 0),
        maxFreighters:    Number(hd.maxFreighters        || 0),
        woodPerHour,
        tgPerHour,
        producedTradegood: Number(hd.producedTradegood || 0),
        tgName:            TG[hd.producedTradegood] || '?',
        wineSpendings:     Number(hd.wineSpendings    || 0),
        badTaxAccountant:  Number(hd.badTaxAccountant || 0),
        maxActionPoints:   Number(hd.maxActionPoints  || 0),
        updated: new Date().toISOString(),
      });
    } catch(e) {
      console.error('[parser_globaldata] resources put error:', e.message);
    }

    // Aggiorna lista città proprie
    const cdm = hd.cityDropdownMenu || {};
    for (const key of Object.keys(cdm)) {
      const c = cdm[key];
      if (c.relationship !== 'ownCity') continue;
      const match = (c.coords || '').match(/\[(\d+):(\d+)\]/);
      const ix = match ? Number(match[1]) : null;
      const iy = match ? Number(match[2]) : null;
      try {
        const existing = await window.IkDB.get('cities', Number(c.id));
        await window.IkDB.put('cities', {
          ...(existing || {}),
          id:        Number(c.id),
          name:      c.name,
          islandX:   ix,
          islandY:   iy,
          tradegood: Number(c.tradegood),
          tgName:    TG[c.tradegood] || '?',
          isOwn:     true,
          updated:   new Date().toISOString(),
        });
      } catch(e) {
        console.error('[parser_globaldata] city put error:', e.message);
      }
    }

    window.IkApp?.onResourcesUpdated?.(cityId);
    return 1;
  }

  async function parseBackground(bd) {
    if (!bd.id) return 0;
    const cityId = Number(bd.id);

    // Salva città
    try {
      const existing = await window.IkDB.get('cities', cityId);
      await window.IkDB.put('cities', {
        ...(existing || {}),
        id:        cityId,
        name:      bd.name || '?',
        isCapital: !!bd.isCapital,
        ownerId:   Number(bd.ownerId),
        ownerName: bd.ownerName || '?',
        islandId:  Number(bd.islandId),
        islandName:bd.islandName || '',
        islandX:   Number(bd.islandXCoord),
        islandY:   Number(bd.islandYCoord),
        phase:     Number(bd.phase),
        buildingSpeedupActive: Number(bd.buildingSpeedupActive || 0),
        updated:   new Date().toISOString(),
      });
    } catch(e) {
      console.error('[parser_globaldata] city background put error:', e.message);
    }

    // Timer costruzioni
    const endDate = bd.constructionListEndDate || bd.endUpgradeTime;
    if (endDate && endDate > 0) {
      const endMs     = endDate * 1000;
      const remaining = endMs - Date.now();
      if (remaining > 0) {
        const constId = `build_${cityId}`; // id STRINGA, non autoIncrement
        try {
          await window.IkDB.put('constructions', {
            id:        constId,            // ← stringa, put() funziona
            cityId,
            cityName:  bd.name || '?',
            count:     Number(bd.underConstruction || 1),
            endTime:   endMs,
            startTime: (bd.constructionListStartDate || 0) * 1000,
            speedupState: Number(bd.speedupState || 0),
            updated:   new Date().toISOString(),
          });
        } catch(e) {
          console.error('[parser_globaldata] construction put error:', e.message);
        }
        window.IkNotifier?.scheduleTimer({
          id:      constId,
          label:   `🏗 ${bd.name || 'Città'} — ${bd.underConstruction || '?'} costruzioni`,
          endTime: endMs,
          type:    'building',
        });
      }
    }

    // Edifici
    if (Array.isArray(bd.position)) {
      for (const pos of bd.position) {
        if (!pos || pos.buildingId === undefined) continue;
        try {
          await window.IkDB.put('buildings', {
            id:        `${cityId}_${pos.groundId}`,
            cityId,
            buildingId:Number(pos.buildingId),
            building:  pos.building  || '',
            name:      pos.name      || '',
            level:     Number(pos.level || 0),
            isBusy:    !!pos.isBusy,
            canUpgrade:!!pos.canUpgrade,
            isMaxLevel:!!pos.isMaxLevel,
            groundId:  Number(pos.groundId),
            updated:   new Date().toISOString(),
          });
        } catch(e) {}
      }
    }

    window.IkApp?.onCitiesUpdated?.(cityId);
    return 1;
  }

  window.IkParsers?.registerParser('globaldata', {
    match: url => /ikariam/i.test(url) && !/WorldMap.*getJSONArea|getJSONWorldMap/i.test(url),
    parse,
  });
  console.log('[parser_globaldata] v2 OK');
})();
