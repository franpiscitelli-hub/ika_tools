// ═══════════════════════════════════════════════
// parsers.js — Parser JSON Ikariam + Ikalogs
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // ── UTILITY ─────────────────────────────────
  function log(...a) { console.log('[IkParsers]', ...a); }

  function num(v) { return Number(v) || 0; }

  // Classifica URL
  function classify(url) {
    if (/ikalogs/i.test(url))                          return 'ikalogs';
    if (/action=header/i.test(url))                    return 'header';
    if (/view=city|action=.*[Cc]ity/i.test(url))       return 'city';
    if (/action=.*[Rr]esource|getResources/i.test(url))return 'resources';
    if (/action=.*[Bb]uild|Workshop|Temple/i.test(url))return 'building';
    if (/action=.*[Rr]esearch/i.test(url))             return 'research';
    if (/action=.*[Ff]leet|fleet/i.test(url))          return 'fleet';
    if (/action=.*[Mm]ilitary/i.test(url))             return 'military';
    if (/action=.*[Mm]arket|trade/i.test(url))         return 'market';
    if (/action=.*[Mm]essage/i.test(url))              return 'messages';
    if (/action=.*[Aa]lliance/i.test(url))             return 'alliance';
    if (/ikariam/i.test(url))                          return 'ikariam';
    return 'unknown';
  }

  // ── DISPATCHER ──────────────────────────────
  // Entry point principale: riceve url + dati grezzi
  async function parse(url, data) {
    const type = classify(url);
    let parsed = 0;

    try {
      switch (type) {
        case 'ikalogs':  parsed = await parseIkalogs(data);   break;
        case 'header':   parsed = await parseHeader(data);    break;
        case 'city':     parsed = await parseCity(data);      break;
        case 'resources':parsed = await parseResources(data); break;
        case 'building': parsed = await parseBuilding(data);  break;
        case 'research': parsed = await parseResearch(data);  break;
        case 'fleet':    parsed = await parseFleet(data);     break;
        default: break;
      }
    } catch (e) {
      log(`⚠️ Errore parser [${type}]:`, e.message);
    }

    // Salva entry grezza in ogni caso
    try {
      await window.IkDB.add('entries', {
        url, type,
        date:   new Date().toISOString(),
        server: window.location.hostname,
        data,
      });
    } catch {}

    return { type, parsed };
  }

  // ── PARSER IKALOGS ───────────────────────────
  async function parseIkalogs(data) {
    // Ikalogs può rispondere con strutture diverse
    let islands = [];

    if (Array.isArray(data)) {
      islands = data;
    } else if (data.islands && Array.isArray(data.islands)) {
      islands = data.islands;
    } else if (data.data && Array.isArray(data.data)) {
      islands = data.data;
    } else if (data.result && Array.isArray(data.result)) {
      islands = data.result;
    } else {
      // Prova a cercare array dentro le chiavi di primo livello
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0) {
          const first = data[key][0];
          if ('x' in first || 'coordX' in first || 'coord_x' in first) {
            islands = data[key];
            break;
          }
        }
      }
    }

    if (islands.length === 0) {
      log('Ikalogs: nessuna isola trovata nel JSON');
      return 0;
    }

    let count = 0;
    for (const isl of islands) {
      const x = num(isl.x ?? isl.coordX ?? isl.coord_x);
      const y = num(isl.y ?? isl.coordY ?? isl.coord_y);
      if (!x && !y) continue;

      await window.IkDB.put('islands', {
        coords:   `${x}:${y}`,
        x, y,
        name:     isl.name || isl.islandName || isl.island_name || `[${x}:${y}]`,
        resource: isl.resource || isl.luxury || isl.tradegood || isl.trade_good || '',
        wonder:   isl.wonder   || isl.miracle || '',
        cities:   isl.cities   || isl.towns   || [],
        raw:      isl,
        updated:  new Date().toISOString(),
      });
      count++;
    }

    log(`Ikalogs: ${count} isole salvate`);
    window.IkApp?.onIslandsUpdated?.(count);
    return count;
  }

  // ── PARSER HEADER ────────────────────────────
  // Risposta globale all'apertura del gioco
  async function parseHeader(data) {
    if (!data) return 0;
    const d = data.headerData || data;

    // Città del giocatore
    const cities = d.cities || d.ownCities || [];
    for (const city of cities) {
      await window.IkDB.put('cities', {
        id:         num(city.id || city.cityId),
        name:       city.name || city.cityName || '?',
        islandX:    num(city.islandX || city.coordX),
        islandY:    num(city.islandY || city.coordY),
        islandId:   num(city.islandId),
        position:   num(city.position),
        updated:    new Date().toISOString(),
      });
    }

    log(`Header: ${cities.length} città salvate`);
    window.IkApp?.onCitiesUpdated?.(cities.length);
    return cities.length;
  }

  // ── PARSER CITY ──────────────────────────────
  async function parseCity(data) {
    if (!data) return 0;
    const d = data.city || data;
    if (!d.id && !d.cityId) return 0;

    const cityId = num(d.id || d.cityId);

    await window.IkDB.put('cities', {
      id:       cityId,
      name:     d.name || d.cityName || '?',
      islandX:  num(d.islandX || d.coordX),
      islandY:  num(d.islandY || d.coordY),
      islandId: num(d.islandId),
      position: num(d.position),
      updated:  new Date().toISOString(),
    });

    // Salva risorse se presenti nella risposta città
    if (d.wood !== undefined || d.resources) {
      await parseResourcesFromCity(cityId, d);
    }

    // Salva costruzioni in corso
    const buildings = d.position || d.buildings || [];
    if (Array.isArray(buildings)) {
      for (const b of buildings) {
        if (b.isUpgrading || b.underConstruction) {
          await window.IkDB.put('constructions', {
            id:        `${cityId}_${b.position || b.id}`,
            cityId,
            name:      b.name || b.buildingType || '?',
            level:     num(b.level),
            endTime:   b.endTime || b.constructionEndTime || null,
            updated:   new Date().toISOString(),
          });
        }
      }
    }

    log(`City ${cityId}: salvata`);
    return 1;
  }

  // ── PARSER RESOURCES ─────────────────────────
  async function parseResources(data) {
    if (!data) return 0;
    const d = data.headerData || data.resources || data;
    const cityId = num(d.cityId || d.currentCityId);
    if (!cityId) return 0;
    await parseResourcesFromCity(cityId, d);
    return 1;
  }

  async function parseResourcesFromCity(cityId, d) {
    await window.IkDB.put('resources', {
      cityId,
      wood:       num(d.wood        || d.lumber),
      marble:     num(d.stone       || d.marble),
      wine:       num(d.wine),
      crystal:    num(d.glass       || d.crystal),
      sulfur:     num(d.sulfur      || d.brimstone),
      gold:       num(d.gold        || d.money),
      population: num(d.population  || d.citizens),
      maxWood:    num(d.maxWood     || d.maxLumber),
      maxMarbel:  num(d.maxStone    || d.maxMarble),
      updated:    new Date().toISOString(),
    });
    window.IkApp?.onResourcesUpdated?.(cityId);
  }

  // ── PARSER BUILDING ──────────────────────────
  async function parseBuilding(data) {
    if (!data) return 0;
    const d = data.position || data.building || data;
    const cityId = num(data.cityId || data.currentCityId);
    if (!d || !cityId) return 0;

    if (d.isUpgrading || d.endTime || d.constructionEndTime) {
      const id = `${cityId}_${d.position || d.id}`;
      await window.IkDB.put('constructions', {
        id,
        cityId,
        name:    d.name || d.buildingType || '?',
        level:   num(d.level),
        endTime: d.endTime || d.constructionEndTime || null,
        updated: new Date().toISOString(),
      });

      // Notifica timer costruzione
      if (d.endTime) {
        window.IkNotifier?.scheduleTimer({
          id,
          label:   `${d.name || 'Costruzione'} completata`,
          endTime: d.endTime,
          type:    'building',
        });
      }
    }

    log(`Building [${cityId}]: aggiornato`);
    return 1;
  }

  // ── PARSER RESEARCH ──────────────────────────
  async function parseResearch(data) {
    if (!data) return 0;
    const d = data.currentResearch || data.research || data;
    if (!d || !d.id) return 0;

    await window.IkDB.put('research', {
      id:      String(d.id),
      name:    d.name || d.researchName || '?',
      endTime: d.endTime || d.researchEndTime || null,
      updated: new Date().toISOString(),
    });

    if (d.endTime) {
      window.IkNotifier?.scheduleTimer({
        id:      `research_${d.id}`,
        label:   `Ricerca completata: ${d.name || '?'}`,
        endTime: d.endTime,
        type:    'research',
      });
    }

    log(`Research: ${d.name}`);
    window.IkApp?.onResearchUpdated?.(d);
    return 1;
  }

  // ── PARSER FLEET ─────────────────────────────
  async function parseFleet(data) {
    if (!data) return 0;
    const fleets = data.movements || data.fleets || data.fleet || [];
    if (!Array.isArray(fleets)) return 0;

    let count = 0;
    for (const f of fleets) {
      const id = String(f.id || f.fleetId || Date.now());
      await window.IkDB.put('fleets', {
        id,
        type:        f.type || f.missionType || '?',
        origin:      f.origin || f.startCityName || '?',
        destination: f.destination || f.targetCityName || '?',
        arrivalTime: f.arrivalTime || f.endTime || null,
        isEnemy:     !!f.isEnemy,
        updated:     new Date().toISOString(),
      });

      // Notifica arrivo flotta nemica
      if (f.isEnemy && f.arrivalTime) {
        window.IkNotifier?.scheduleTimer({
          id:      `fleet_${id}`,
          label:   `⚔️ Flotta nemica in arrivo da ${f.origin || '?'}`,
          endTime: f.arrivalTime,
          type:    'fleet_enemy',
          urgent:  true,
        });
      }

      count++;
    }

    log(`Fleet: ${count} movimenti salvati`);
    window.IkApp?.onFleetsUpdated?.(count);
    return count;
  }

  // Esponi globalmente
  window.IkParsers = { parse, classify };
  log('Modulo caricato');
})();
