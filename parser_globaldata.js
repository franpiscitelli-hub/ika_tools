// ═══════════════════════════════════════════════
// parser_globaldata.js
// Si attiva per tutti i JSON Ikariam eccetto worldmap
// Legge updateGlobalData → headerData + backgroundData
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // Mappa risorse: chiave JSON → nome leggibile
  const RES = { '1':'Vino', '2':'Marmo', '3':'Cristallo', '4':'Zolfo', 'resource':'Legno' };
  const TG  = { 1:'Vino', 2:'Marmo', 3:'Cristallo', 4:'Zolfo' };

  async function parse(url, data) {
    if (!Array.isArray(data)) return 0;
    let count = 0;

    for (const item of data) {
      if (!Array.isArray(item) || item.length < 2) continue;
      if (item[0] !== 'updateGlobalData') continue;
      const payload = item[1];
      if (!payload || typeof payload !== 'object') continue;

      if (payload.headerData)    count += await parseHeader(payload.headerData);
      if (payload.backgroundData) count += await parseBackground(payload.backgroundData);
    }
    return count;
  }

  // ── HEADER DATA ──────────────────────────────
  async function parseHeader(hd) {
    // Identifica la città corrente da relatedCity
    // relatedCity ha una sola chiave: l'id della città se owncity=1
    let cityId = null;
    const rc = hd.relatedCity || {};
    for (const k of Object.keys(rc)) {
      if (k !== 'owncity' && rc.owncity === 1) { cityId = Number(k) || null; break; }
    }
    // Fallback: se relatedCity = { owncity: 1 } senza id esplicito, usiamo backgroundData
    // (verrà abbinato dopo da parseBackground)

    const cr  = hd.currentResources || {};
    const mr  = hd.maxResources     || {};

    // Capienza magazzino: tutti i valori sono uguali, prendiamo il primo
    const maxStorage = Number(mr['0'] || mr['1'] || mr['resource'] || 0);

    // Produzioni orarie (il valore è per secondo, moltiplica x3600)
    const woodPerHour = Math.round((hd.resourceProduction   || 0) * 3600);
    const tgPerHour   = Math.round((hd.tradegoodProduction  || 0) * 3600);

    const resources = {
      cityId,       // null se non identificabile qui, aggiornato da backgroundData
      // Risorse correnti
      wine:       Number(cr['1']        || 0),
      marble:     Number(cr['2']        || 0),
      crystal:    Number(cr['3']        || 0),
      sulfur:     Number(cr['4']        || 0),
      wood:       Number(cr['resource'] || 0),
      citizens:   Number(cr.citizens    || 0),
      population: Number(cr.population  || 0),
      // Capienza magazzino
      maxStorage,
      // Finanze
      gold:             Math.round(hd.gold          || 0),
      income:           Math.round(hd.income        || 0),
      upkeep:           Math.round(hd.upkeep        || 0),
      godGoldResult:    Math.round(hd.godGoldResult || 0),
      scientistsUpkeep: Math.round(hd.scientistsUpkeep || 0),
      ambrosia:         Number(hd.ambrosia          || 0),
      // Trasportatori/mercantili
      maxTransporters:  Number(hd.maxTransporters   || 0),
      maxFreighters:    Number(hd.maxFreighters     || 0),
      // Produzione
      woodPerHour,
      tgPerHour,
      producedTradegood: Number(hd.producedTradegood || 0),
      tgName:            TG[hd.producedTradegood]   || '?',
      wineSpendings:     Number(hd.wineSpendings     || 0),
      badTaxAccountant:  Number(hd.badTaxAccountant  || 0),
      maxActionPoints:   Number(hd.maxActionPoints   || 0),
      // Metadati
      updated: new Date().toISOString(),
    };

    // Aggiorna lista città proprie da cityDropdownMenu
    const cdm = hd.cityDropdownMenu || {};
    for (const key of Object.keys(cdm)) {
      const c = cdm[key];
      if (c.relationship !== 'ownCity') continue;
      // Estrai coordinate da stringa tipo "[43:53] "
      const match = (c.coords || '').match(/\[(\d+):(\d+)\]/);
      const ix = match ? Number(match[1]) : null;
      const iy = match ? Number(match[2]) : null;
      // Salva/aggiorna città propria
      const existing = await window.IkDB.get('cities', c.id).catch(() => null);
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
    }

    // Salva risorse (chiave = cityId, anche se null per ora)
    // backgroundData aggiornerà cityId dopo
    window._ikPendingResources = resources; // temporaneo, abbinato in parseBackground
    try { await window.IkDB.put('resources', resources); } catch {}

    window.IkApp?.onResourcesUpdated?.(cityId);
    return 1;
  }

  // ── BACKGROUND DATA ──────────────────────────
  async function parseBackground(bd) {
    if (!bd.id) return 0;
    const cityId = Number(bd.id);

    // Abbina cityId alle risorse pendenti
    if (window._ikPendingResources) {
      window._ikPendingResources.cityId = cityId;
      try { await window.IkDB.put('resources', window._ikPendingResources); } catch {}
      delete window._ikPendingResources;
    }

    // Salva/aggiorna città
    const existingCity = await window.IkDB.get('cities', cityId).catch(() => null);
    await window.IkDB.put('cities', {
      ...(existingCity || {}),
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

    // Timer costruzioni
    const endDate = bd.constructionListEndDate || bd.endUpgradeTime;
    if (endDate && endDate > 0) {
      const endMs    = endDate * 1000;
      const remaining = endMs - Date.now();
      if (remaining > 0) {
        const constId = `build_${cityId}`;
        await window.IkDB.put('constructions', {
          id:        constId,
          cityId,
          cityName:  bd.name || '?',
          count:     Number(bd.underConstruction || 1),
          endTime:   endMs,
          startTime: (bd.constructionListStartDate || 0) * 1000,
          speedupState: Number(bd.speedupState || 0),
          updated:   new Date().toISOString(),
        });
        window.IkNotifier?.scheduleTimer({
          id:      constId,
          label:   `🏗 ${bd.name || 'Città'} — ${bd.underConstruction || '?'} costruzioni`,
          endTime: endMs,
          type:    'building',
        });
      }
    }

    // Edifici (position)
    if (Array.isArray(bd.position)) {
      for (const pos of bd.position) {
        if (!pos || pos.buildingId === undefined) continue;
        await window.IkDB.put('buildings', {
          id:        `${cityId}_${pos.groundId}`,
          cityId,
          buildingId:Number(pos.buildingId),
          building:  pos.building || '',
          name:      pos.name     || '',
          level:     Number(pos.level || 0),
          isBusy:    !!pos.isBusy,
          canUpgrade:!!pos.canUpgrade,
          isMaxLevel:!!pos.isMaxLevel,
          groundId:  Number(pos.groundId),
          updated:   new Date().toISOString(),
        });
      }
    }

    window.IkApp?.onCitiesUpdated?.(cityId);
    return 1;
  }

  // Match: tutti i JSON Ikariam tranne worldmap
  window.IkParsers?.registerParser('globaldata', {
    match: url => /ikariam/i.test(url) && !/WorldMap.*getJSONArea|getJSONWorldMap/i.test(url),
    parse,
  });
  console.log('[parser_globaldata] OK');
})();
