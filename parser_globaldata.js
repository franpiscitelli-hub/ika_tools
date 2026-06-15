// ═══════════════════════════════════════════════
// parser_globaldata.js v6
//
// Gestisce updateGlobalData da Ikariam.
// Attivazione: data contiene ['updateGlobalData', payload]
// con payload.headerData e/o payload.backgroundData.
//
// REGOLE:
// 1. headerData → SEMPRE la città attiva del proprietario
//    dell'account.
//    - Dati GLOBALI account (gold, income, upkeep,
//      godGoldResult, ambrosia, transporters/freighters)
//      → store 'account_summary' (record unico 'main').
//    - Dati PER-POLIS (risorse correnti, produzione/h,
//      wineSpendings, badTaxAccountant, maxActionPoints,
//      scientistsUpkeep) → 'my_cities'[activeCityId].
//    cityDropdownMenu (relationship:'ownCity') definisce
//    l'elenco delle città proprie (myCityIds).
//    cityDropdownMenu.selectedCity = "city_<ID>" indica
//    la città attiva.
// 2. backgroundData:
//    - se bd.id è in myCityIds (isOwn) → merge completo in
//      'my_cities' (identità, edifici, costruzioni→timer).
//    - altrimenti (isOwn:false) → solo edifici+livello in
//      'enemy_buildings', associati a ownerId/ownerName.
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const TG = { 1:'Vino', 2:'Marmo', 3:'Cristallo', 4:'Zolfo' };

  // Set persistente (in memoria) delle città proprie, popolato
  // da cityDropdownMenu ogni volta che arriva headerData.
  const myCityIds = new Set();

  async function parse(url, data) {
    if (!Array.isArray(data)) return { parsed: 0, parserName: 'globaldata' };
    let count = 0;

    for (const item of data) {
      if (!Array.isArray(item) || item.length < 2) continue;
      if (item[0] !== 'updateGlobalData') continue;
      const payload = item[1];
      if (!payload || typeof payload !== 'object') continue;

      if (payload.headerData)     count += await parseHeader(payload.headerData);
      if (payload.backgroundData) count += await parseBackground(payload.backgroundData);
    }

    if (count === 0) return { parsed: 0, parserName: 'globaldata' };
    return { parsed: count, parserName: 'globaldata' };
  }

  // ── headerData: città attiva (sempre propria) ───
  async function parseHeader(hd) {
    // 1. Aggiorna l'elenco delle città proprie da cityDropdownMenu
    const cdm = hd.cityDropdownMenu || {};
    for (const key of Object.keys(cdm)) {
      const c = cdm[key];
      const numId = Number(c?.id);
      if (!numId) continue;
      if (c.relationship === 'ownCity') {
        myCityIds.add(numId);
      }
    }

    // 2. La città attiva è indicata da cityDropdownMenu.selectedCity = "city_<ID>"
    let activeCityId = null;
    const selKey = cdm.selectedCity; // es. "city_1614"
    if (typeof selKey === 'string') {
      const m = selKey.match(/(\d+)/);
      if (m) activeCityId = Number(m[1]);
    }

    // Fallback: relatedCity.owncity (storicamente non sempre un city id valido)
    if (!activeCityId && hd.relatedCity?.owncity) {
      const fallback = Number(hd.relatedCity.owncity);
      if (myCityIds.has(fallback)) activeCityId = fallback;
    }

    if (!activeCityId) return 0; // senza cityId non possiamo salvare risorse

    const cr = hd.currentResources || {};
    const mr = hd.maxResources     || {};
    const maxStorage = Number(mr['0'] || mr['1'] || mr['resource'] || 0);

    // ── Dati GLOBALI account (oro totale, navi, income/upkeep totali) ──
    // Non sono specifici della città attiva: vanno in account_summary.
    try {
      await window.IkDB.put('account_summary', {
        id:               'main',
        gold:             Math.round(Number(hd.gold) || 0),
        income:           Math.round(hd.income           || 0),
        upkeep:           Math.round(hd.upkeep           || 0),
        godGoldResult:    Math.round(hd.godGoldResult    || 0),
        ambrosia:         Number(hd.ambrosia             || 0),
        freeTransporters: Number(hd.freeTransporters     || 0),
        maxTransporters:  Number(hd.maxTransporters      || 0),
        freeFreighters:   Number(hd.freeFreighters       || 0),
        maxFreighters:    Number(hd.maxFreighters        || 0),
        updated:          new Date().toISOString(),
      });
    } catch(e) {
      console.error('[parser_globaldata] account_summary error:', e.message);
    }

    // ── Dati PER-POLIS: relativi alla città attualmente visualizzata ──
    const resourceData = {
      wood:             Number(cr['resource'] || 0),
      wine:             Number(cr['1']        || 0),
      marble:           Number(cr['2']        || 0),
      crystal:          Number(cr['3']        || 0),
      sulfur:           Number(cr['4']        || 0),
      citizens:         Number(cr.citizens    || 0),
      population:       Number(cr.population  || 0),
      maxStorage,
      scientistsUpkeep: Math.round(hd.scientistsUpkeep || 0),
      woodPerHour:      Math.round((hd.resourceProduction  || 0) * 3600),
      tgPerHour:        Math.round((hd.tradegoodProduction || 0) * 3600),
      producedTradegood:Number(hd.producedTradegood    || 0),
      tgName:           TG[hd.producedTradegood]       || '?',
      wineSpendings:    Number(hd.wineSpendings        || 0),
      badTaxAccountant: Number(hd.badTaxAccountant     || 0),
      maxActionPoints:  Number(hd.maxActionPoints      || 0),
    };

    try {
      const prev = await window.IkDB.get('my_cities', activeCityId);
      await window.IkDB.put('my_cities', {
        ...(prev || {}),
        cityId:   activeCityId,
        ...resourceData,
        updated:  new Date().toISOString(),
      });
    } catch(e) {
      console.error('[parser_globaldata] my_cities (header) error:', e.message);
    }

    // Aggiorna anche nome/coords/tradegood per ogni città propria nel dropdown
    for (const key of Object.keys(cdm)) {
      const c = cdm[key];
      if (!c || typeof c !== 'object' || c.relationship !== 'ownCity') continue;
      const numId = Number(c.id);
      if (!numId) continue;
      const match = (c.coords || '').match(/\[(\d+):(\d+)\]/);
      try {
        const prev = await window.IkDB.get('my_cities', numId);
        await window.IkDB.put('my_cities', {
          ...(prev || {}),
          cityId:    numId,
          name:      c.name,
          islandX:   match ? Number(match[1]) : (prev?.islandX || null),
          islandY:   match ? Number(match[2]) : (prev?.islandY || null),
          tradegood: Number(c.tradegood),
          tgName:    TG[c.tradegood] || '?',
          updated:   new Date().toISOString(),
        });
      } catch(e) {
        console.error('[parser_globaldata] my_cities (dropdown) error:', e.message);
      }
    }

    window.IkApp?.onResourcesUpdated?.(activeCityId);
    return 1;
  }

  // ── backgroundData: città attualmente visualizzata ──
  async function parseBackground(bd) {
    if (!bd.id) return 0;
    const cityId  = Number(bd.id);
    const isOwn   = myCityIds.has(cityId);
    const ownerId   = Number(bd.ownerId) || null;
    const ownerName = bd.ownerName || '?';

    if (isOwn) {
      // ── Città propria: merge completo in my_cities ──
      try {
        const prev = await window.IkDB.get('my_cities', cityId);
        await window.IkDB.put('my_cities', {
          ...(prev || {}),
          cityId,
          name:       bd.name || prev?.name || '?',
          isCapital:  !!bd.isCapital,
          ownerId,
          ownerName,
          islandId:   Number(bd.islandId)   || prev?.islandId   || null,
          islandName: bd.islandName || prev?.islandName || '',
          islandX:    Number(bd.islandXCoord) || prev?.islandX || null,
          islandY:    Number(bd.islandYCoord) || prev?.islandY || null,
          phase:      Number(bd.phase) || prev?.phase || null,
          updated:    new Date().toISOString(),
        });
      } catch(e) {
        console.error('[parser_globaldata] my_cities (background) error:', e.message);
      }

      // Timer costruzioni → tab Timer (IkNotifier)
      const endDate = bd.constructionListEndDate || bd.endUpgradeTime;
      if (endDate && endDate > 0) {
        const endMs = endDate * 1000;
        if (endMs > Date.now()) {
          try {
            const prev = await window.IkDB.get('my_cities', cityId);
            await window.IkDB.put('my_cities', {
              ...(prev || {}),
              cityId,
              constructionEndTime:   endMs,
              constructionStartTime:(bd.constructionListStartDate || 0) * 1000,
              constructionCount:     Number(bd.underConstruction || 1),
              speedupState:          Number(bd.speedupState || 0),
              updated: new Date().toISOString(),
            });
          } catch {}
          window.IkNotifier?.scheduleTimer({
            id:      `build_${cityId}`,
            label:   `🏗 ${bd.name || 'Città'} — ${bd.underConstruction||'?'} costruzioni`,
            endTime: endMs,
            type:    'building',
          });
        }
      }

      // Edifici propri → my_cities.buildings[]
      if (Array.isArray(bd.position)) {
        const buildings = bd.position
          .filter(pos => pos && pos.buildingId !== undefined)
          .map(pos => ({
            buildingId: Number(pos.buildingId),
            building:   pos.building   || '',
            name:       pos.name       || '',
            level:      Number(pos.level || 0),
            isBusy:     !!pos.isBusy,
            canUpgrade: !!pos.canUpgrade,
            isMaxLevel: !!pos.isMaxLevel,
            groundId:   Number(pos.groundId),
          }));
        try {
          const prev = await window.IkDB.get('my_cities', cityId);
          await window.IkDB.put('my_cities', {
            ...(prev || {}),
            cityId,
            buildings,
            updated: new Date().toISOString(),
          });
        } catch(e) {
          console.error('[parser_globaldata] my_cities buildings error:', e.message);
        }
      }

      window.IkApp?.onCitiesUpdated?.(cityId);
      return 1;
    }

    // ── Città di altri player: solo edifici + livello ──
    if (Array.isArray(bd.position)) {
      const buildings = bd.position
        .filter(pos => pos && pos.buildingId !== undefined)
        .map(pos => ({
          building: pos.building || '',
          name:     pos.name     || '',
          level:    Number(pos.level || 0),
        }));
      try {
        const prev = await window.IkDB.get('enemy_buildings', cityId);
        await window.IkDB.put('enemy_buildings', {
          ...(prev || {}),
          cityId,
          cityName:  bd.name || prev?.cityName || '?',
          ownerId,
          ownerName,
          islandX:   Number(bd.islandXCoord) || prev?.islandX || null,
          islandY:   Number(bd.islandYCoord) || prev?.islandY || null,
          buildings,
          updated:   new Date().toISOString(),
        });
      } catch(e) {
        console.error('[parser_globaldata] enemy_buildings error:', e.message);
      }
      return 1;
    }

    return 0;
  }

  window.IkParsers?.registerParser('globaldata', {
    match: (url, data) => {
      if (!Array.isArray(data)) return false;
      return data.some(item =>
        Array.isArray(item) && item[0] === 'updateGlobalData'
        && item[1] && typeof item[1] === 'object'
        && (item[1].headerData || item[1].backgroundData)
      );
    },
    parse,
  });
  console.log('[parser_globaldata] v6 OK');
})();
