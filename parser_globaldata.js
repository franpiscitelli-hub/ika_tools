// ═══════════════════════════════════════════════
// parser_globaldata.js v7
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

      if (item[0] === 'updateGlobalData') {
        const payload = item[1];
        if (!payload || typeof payload !== 'object') continue;
        if (payload.headerData)     count += await parseHeader(payload.headerData);
        if (payload.backgroundData) count += await parseBackground(payload.backgroundData);
      }

      if (item[0] === 'changeView') {
        count += parseChangeView(item[1]);
        count += await parseMilitaryAdvisor(item[1]);
      }

      if (item[0] === 'updateTemplateData') {
        count += await parseShrineOfOlympus(item[1]);
      }
    }

    if (count === 0) return { parsed: 0, parserName: 'globaldata' };
    return { parsed: count, parserName: 'globaldata' };
  }

  // ── changeView: estrae nome player da optionsAccount ──
  function parseChangeView(payload) {
    // payload = [ viewName, htmlString, extras ]
    if (!Array.isArray(payload) || payload[0] !== 'optionsAccount') return 0;
    const html = typeof payload[1] === 'string' ? payload[1] : '';

    // Estrae il nome dal campo input: name="name" value="..."
    const nameMatch = html.match(/name=["']name["'][^>]*value=["']([^"']+)["']/);
    if (!nameMatch) return 0;

    const playerName = nameMatch[1].trim();
    if (!playerName) return 0;

    // Salva in localStorage (stessa chiave usata da saveMyId)
    const existing = localStorage.getItem('ik_my_name');
    if (!existing) {
      // Solo se non già impostato manualmente dall'utente
      localStorage.setItem('ik_my_name', playerName);
      console.log('[parser_globaldata] Nome player auto-rilevato:', playerName);
    }

    // Notifica l'app per aggiornare la UI
    window.IkApp?.onPlayerNameDetected?.(playerName);

    return 1;
  }

  // ── changeView: estrae trasporti merci da militaryAdvisor ──
  // payload = [ 'militaryAdvisor', htmlString, { viewScriptParams: { militaryAndFleetMovements: [...] } } ]
  // Ogni evento con event.missionIconClass === 'transport' rappresenta una nave
  // trasporto propria, in due possibili fasi:
  //   missionState 1 → "Trasporto (Caricamento)": eventTime = fine caricamento (partenza)
  //   missionState 2 → "Trasporto (in corso)":     eventTime = arrivo a destinazione
  const RESOURCE_ICON_NAMES = {
    wood: '🪵 Legno', marble: '🪨 Marmo', glass: '🔷 Cristallo',
    sulfur: '🟡 Zolfo', wine: '🍷 Vino', resource_icon: 'Risorsa',
  };
  function resourceIconToName(cssClass) {
    if (!cssClass) return 'Risorsa';
    for (const key of Object.keys(RESOURCE_ICON_NAMES)) {
      if (key !== 'resource_icon' && cssClass.includes(key)) return RESOURCE_ICON_NAMES[key];
    }
    return 'Risorsa';
  }
  // "15.000" → 15000 (il gioco usa il punto come separatore migliaia in IT)
  function parseGameAmount(str) {
    if (typeof str !== 'string') return Number(str) || 0;
    return Number(str.replace(/\./g, '').replace(',', '.')) || 0;
  }

  // Mappa cssClass unità militari → nome italiano leggibile
  const UNIT_ICON_NAMES = {
    swordsman: '⚔️ Spadaccino', hoplite: '🛡 Opliti', spearman: '🔱 Lanciere',
    slinger: '🪨 Frombolieri', archer: '🏹 Arciere', mortar: '💣 Mortaio',
    catapult: '🎯 Catapulta', balliste: '🏹 Balestra', ram: '🪵 Ariete',
    swordfighter: '⚔️ Spadaccino', gyrocopter: '🚁 Girocottero',
    cannon: '💥 Cannone', steamGiant: '🤖 Gigante a vapore',
    spy: '🕵️ Spia', settler: '🚩 Colono',
  };
  function unitIconToName(cssClass) {
    if (!cssClass) return 'Unità';
    return UNIT_ICON_NAMES[cssClass] || `⚔️ ${cssClass}`;
  }

  // Mappa cssClass navi → nome italiano leggibile (per deployfleet)
  const SHIP_ICON_NAMES = {
    ship_transport: '🚢 Trasporto', ship_paddlespeedship: '🛶 Battello a remi rapido',
    ship_steamfrigate: '🚂 Fregata a vapore', ship_ram: '🛳 Sperone',
    ship_catapultship: '💣 Nave catapulta', ship_diving_boat: '🤿 Nave da sommozzatore',
    ship_balloon_carrier: '🎈 Nave portapallone', ship_destroyer: '⚓ Cacciatorpediniere',
    ship_brigantine: '⛵ Brigantino', ship_demoship: '💥 Nave da demolizione',
    ship_paddlespeedboat: '🛶 Vedetta a remi',
  };
  function shipIconToName(cssClass) {
    if (!cssClass) return 'Nave';
    return SHIP_ICON_NAMES[cssClass] || `🚢 ${cssClass}`;
  }

  async function parseMilitaryAdvisor(payload) {
    if (!Array.isArray(payload) || payload[0] !== 'militaryAdvisor') return 0;
    const extras = payload[2];
    const events  = extras?.viewScriptParams?.militaryAndFleetMovements;
    if (!Array.isArray(events)) return 0;

    // Mappa completa tipi missione → { icona, label IT, timerType }
    const MISSION_META = {
      transport:   { icon: '🚛', label: 'Trasporto merci',      type: 'transport'    },
      deployarmy:  { icon: '🪖', label: 'Schieramento truppe',  type: 'deploy'       },
      deployfleet: { icon: '⛴', label: 'Trasferimento flotta',  type: 'deployfleet'  },
      blockade:    { icon: '🚧', label: 'Blocco porto',          type: 'blockade'     },
      plunder:     { icon: '💰', label: 'Saccheggio',            type: 'plunder'      },
      attack:      { icon: '⚔️', label: 'Attacco',              type: 'attack'       },
      colonize:    { icon: '🚩', label: 'Colonizzazione',        type: 'colonize'     },
      spy:         { icon: '🕵️', label: 'Spionaggio',           type: 'spy'          },
      relocate:    { icon: '🏠', label: 'Ricollocazione',        type: 'relocate'     },
      trade:       { icon: '💼', label: 'Commercio',             type: 'trade'        },
      siege:       { icon: '🏰', label: 'Assedio',               type: 'siege'        },
      piracy:      { icon: '🏴‍☠️', label: 'Pirateria',          type: 'piracy'       },
      support:     { icon: '🛡', label: 'Supporto',              type: 'support'      },
    };

    let count = 0;
    for (const ev of events) {
      const event = ev?.event;
      if (!event) continue;
      if (!ev.isOwnArmyOrFleet) continue; // solo i propri movimenti

      const missionClass = event.missionIconClass;
      const meta = MISSION_META[missionClass];
      if (!meta) continue; // tipo sconosciuto, salta

      const state  = Number(event.missionState);
      const endMs  = Number(ev.eventTime) * 1000;
      if (!endMs || endMs <= Date.now()) continue;

      const origin    = ev.origin?.name || '?';
      const target    = ev.target?.name || '?';
      const shipCount = ev.fleet?.amount || 0;
      const arrow     = state === 1 ? `${origin} ⏳` : `${origin} → ${target}`;
      let detail = '';

      if (missionClass === 'transport') {
        const cargo = Array.isArray(ev.resources)
          ? ev.resources.map(r => `${Math.round(parseGameAmount(r.amount)).toLocaleString('it')} ${resourceIconToName(r.cssClass)}`).join(', ')
          : '';
        detail = cargo ? ` — ${cargo}` : '';
      } else if (missionClass === 'deployarmy') {
        const units = Array.isArray(ev.army?.units)
          ? ev.army.units.map(u => `${Math.round(parseGameAmount(u.amount)).toLocaleString('it')} ${unitIconToName(u.cssClass)}`).join(', ')
          : '';
        detail = units ? ` — ${units}` : '';
      } else if (missionClass === 'deployfleet') {
        const ships = Array.isArray(ev.fleet?.ships)
          ? ev.fleet.ships.map(s => `${Math.round(parseGameAmount(s.amount)).toLocaleString('it')} ${shipIconToName(s.cssClass)}`).join(', ')
          : '';
        detail = ships ? ` — ${ships}` : '';
      } else if (missionClass === 'blockade' || missionClass === 'plunder' || missionClass === 'attack' || missionClass === 'siege') {
        const ships = Array.isArray(ev.fleet?.ships)
          ? ev.fleet.ships.map(s => `${Math.round(parseGameAmount(s.amount)).toLocaleString('it')} ${shipIconToName(s.cssClass)}`).join(', ')
          : '';
        detail = ships ? ` (${ships})` : shipCount ? ` (${shipCount} navi)` : '';
      }

      const label    = `${meta.icon} ${arrow}${shipCount && !detail ? ` (${shipCount} navi)` : ''}${detail}`;
      const timerId  = `${meta.type}_${event.id}_${state}`;

      try {
        await window.IkDB?.put?.('fleets', {
          id:           timerId,
          eventId:      event.id,
          missionClass,
          missionState: state,
          origin, target,
          shipCount,
          label,
          endTime:      endMs,
          isEnemy:      false,
          updated:      new Date().toISOString(),
        });
      } catch (e) {
        console.error('[parser_globaldata] fleets persist error:', e.message);
      }

      window.IkNotifier?.scheduleTimer({
        id:      timerId,
        label,
        endTime: endMs,
        type:    meta.type,
      });

      count++;
    }
    return count;
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
      wineProduction:   Number(hd.producedTradegood) === 1
                          ? Math.round((hd.tradegoodProduction || 0) * 3600)
                          : 0,
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

      // Timer costruzioni → tab Timer (IkNotifier) + persistenza in store 'constructions'
      // L'edificio in costruzione si riconosce dal campo "building" che termina
      // con " constructionSite" (es. "townHall constructionSite"). Quell'elemento
      // ha "name" (nome edificio), "level" (livello DI PARTENZA) e "completed"
      // (timestamp Unix di fine lavori). isBusy resta false per questo elemento.
      if (Array.isArray(bd.position)) {
        const buildingSite = bd.position.find(pos =>
          pos && typeof pos.building === 'string' && pos.building.endsWith(' constructionSite')
        );

        if (buildingSite && buildingSite.completed) {
          const endMs = Number(buildingSite.completed) * 1000;
          if (endMs > Date.now()) {
            const fromLevel = Number(buildingSite.level || 0);
            const toLevel   = fromLevel + 1;
            const bName     = buildingSite.name || buildingSite.building.replace(' constructionSite', '');
            const timerId   = `build_${cityId}`;
            const label      = `🏗 ${bd.name || 'Città'} — ${bName} Lv${fromLevel} → Lv${toLevel}`;

            try {
              const prev = await window.IkDB.get('my_cities', cityId);
              await window.IkDB.put('my_cities', {
                ...(prev || {}),
                cityId,
                constructionEndTime:   endMs,
                constructionBuilding:  bName,
                constructionFromLevel: fromLevel,
                constructionToLevel:   toLevel,
                speedupState:          Number(bd.speedupState || 0),
                updated: new Date().toISOString(),
              });
            } catch {}

            // Persiste in 'constructions' per sopravvivere al reload
            // (notifier.restoreTimers legge da qui all'avvio dell'app)
            try {
              await window.IkDB.put('constructions', {
                id:        timerId,
                cityId,
                cityName:  bd.name || '',
                building:  bName,
                fromLevel,
                toLevel,
                endTime:   endMs,
                label,
                updated:   new Date().toISOString(),
              });
            } catch(e) {
              console.error('[parser_globaldata] constructions persist error:', e.message);
            }

            window.IkNotifier?.scheduleTimer({
              id:      timerId,
              label,
              endTime: endMs,
              type:    'building',
            });
          }
        } else {
          // Nessuna costruzione in corso in questa città: rimuovi eventuale
          // timer/record residuo per non mostrare dati stantii
          const timerId = `build_${cityId}`;
          try { await window.IkDB.deleteRecord('constructions', timerId); } catch {}
          window.IkNotifier?.cancelTimer?.(timerId, true);
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

  // ── SANTUARIO DEGLI DEI: favore divinità con countdown ──
  // updateTemplateData contiene chiavi tipo:
  //   "shrineOfOlympus .god_plutus .gracePeriod" = "1G 13h"  (testo countdown, '-' se non attivo)
  //   "shrineOfOlympus .god_plutus .bar"          = { style: { width: "100%" } }
  //   "shrineOfOlympus .god_plutus .progressbar .text" = 1000 (valore donato)
  // Solo il dio attivo (venerato) ha gracePeriod diverso da '-'.
  const GOD_NAMES = {
    pan: 'Pan', dionysus: 'Dioniso', tyche: 'Tiche', plutus: 'Pluto',
    theia: 'Tela', hephaestos: 'Efesto', zeus: 'Zeus', ares: 'Ares',
    poseidon: 'Poseidone', hera: 'Era', athena: 'Atena', hermes: 'Ermes',
  };

  // "1G 13h" / "13h 45m" / "45m" → millisecondi
  function parseGracePeriodToMs(text) {
    if (!text || text === '-') return 0;
    let ms = 0;
    const dMatch = text.match(/(\d+)\s*G/i);
    const hMatch = text.match(/(\d+)\s*h/i);
    const mMatch = text.match(/(\d+)\s*m(?!s)/i);
    if (dMatch) ms += Number(dMatch[1]) * 86400000;
    if (hMatch) ms += Number(hMatch[1]) * 3600000;
    if (mMatch) ms += Number(mMatch[1]) * 60000;
    return ms;
  }

  // Effetti delle benedizioni (bonus tipici di Ikariam)
  const GOD_EFFECTS = {
    zeus:       'Espansione guarnigione terrestre',
    poseidon:   'Espansione guarnigione navale',
    hera:       'Crescita popolazione aumentata',
    ares:       'Forza truppe aumentata',
    athena:     'Ricerca scientifica aumentata',
    hermes:     'Velocità trasporti aumentata',
    plutus:     'Entrate oro aumentate',
    tyche:      'Produzione risorse aumentata',
    pan:        'Soddisfazione aumentata',
    dionysus:   'Consumo vino ridotto',
    hephaestos: 'Velocità costruzioni aumentata',
    theia:      'Riduzione corruzione',
  };

  async function parseShrineOfOlympus(payload) {
    if (!payload || typeof payload !== 'object') return 0;

    // cityId può arrivare direttamente come campo del payload (view=shrineOfOlympus)
    // oppure va cercato altrove; qui tentiamo entrambe le strade
    const cityId = Number(payload.cityId) || 0;
    if (!cityId) return 0;

    // ── 1. Dio attivo e countdown ──────────────────────────────
    let activeGodKey = null, graceText = null;
    for (const key of Object.keys(payload)) {
      const m = key.match(/^shrineOfOlympus \.god_(\w+) \.gracePeriod$/);
      if (m && payload[key] && payload[key] !== '-') {
        activeGodKey = m[1];
        graceText    = payload[key];
        break;
      }
    }

    const timerId = `shrine_${cityId}`;

    if (!activeGodKey) {
      try { await window.IkDB?.deleteRecord?.('constructions', timerId); } catch {}
      window.IkNotifier?.cancelTimer?.(timerId, true);
      return 0;
    }

    const msLeft = parseGracePeriodToMs(graceText);
    if (msLeft <= 0) return 0;
    const endMs = Date.now() + msLeft;

    // ── 2. Barra donazioni (percentuale) ──────────────────────
    const barStyle = payload[`shrineOfOlympus .god_${activeGodKey} .bar`]?.style?.width;
    const barPct   = barStyle ? parseInt(barStyle, 10) : null;

    // ── 3. Bonus effettivo dai slot di venerazione ────────────
    // I bonus sono nei campi: "shrineOfOlympus .gods.worshiping li[data-number=N] .currentBonus"
    // Prendiamo il valore del primo slot attivo (tutti uguali per lo stesso dio)
    let currentBonus = null;
    const worshipSlots = [];
    const slotBonusRe     = /^shrineOfOlympus \.gods\.worshiping li\[data-number=(\d+)\] \.currentBonus$/;
    const slotGodRe       = /^shrineOfOlympus \.gods\.worshiping li\[data-number=(\d+)\] \.god$/;
    const slotResRe       = /^shrineOfOlympus \.gods\.worshiping li\[data-number=(\d+)\] \.generatedResources$/;
    const slotTimeRe      = /^shrineOfOlympus \.gods\.worshiping li\[data-number=(\d+)\] \.startTime$/;

    const tempSlots = {};
    for (const key of Object.keys(payload)) {
      let m;
      if ((m = slotBonusRe.exec(key)))    { const n = +m[1]; if (!tempSlots[n]) tempSlots[n] = {}; tempSlots[n].bonus = payload[key]; }
      if ((m = slotGodRe.exec(key)))      { const n = +m[1]; const gc = payload[key]?.class || ''; const gm = /god_(\w+)/.exec(gc); if (gm) { if (!tempSlots[n]) tempSlots[n] = {}; tempSlots[n].god = gm[1]; } }
      if ((m = slotResRe.exec(key)))      { const n = +m[1]; if (!tempSlots[n]) tempSlots[n] = {}; tempSlots[n].resources = payload[key]; }
      if ((m = slotTimeRe.exec(key)))     { const n = +m[1]; if (!tempSlots[n]) tempSlots[n] = {}; tempSlots[n].startTime = payload[key]; }
    }

    for (const [n, s] of Object.entries(tempSlots)) {
      if (s.god && s.startTime && s.startTime !== '-') {
        // Normalizza bonus: "67,00" → 67
        const bonusNum = s.bonus ? parseFloat(String(s.bonus).replace(',', '.')) : 0;
        worshipSlots.push({ slot: +n, god: s.god, bonus: bonusNum, resources: s.resources, startTime: s.startTime });
        if (currentBonus === null && bonusNum > 0) currentBonus = bonusNum;
      }
    }
    worshipSlots.sort((a, b) => a.slot - b.slot);

    // ── 4. Dati livello santuario ──────────────────────────────
    const shrineLevel   = payload.nextLevel     ? Number(payload.nextLevel) - 1 : null;
    const currentFavor  = payload.currentFavor  != null ? Number(payload.currentFavor) : null;
    const maxBonusNext  = payload.maximumBonusNextLvl != null ? Number(payload.maximumBonusNextLvl) : null;
    const researchedGods = Array.isArray(payload.researchedGods) ? payload.researchedGods : null;

    // ── 5. Salva in 'constructions' (timer UI) ─────────────────
    const godName = GOD_NAMES[activeGodKey] || activeGodKey;
    const effect  = GOD_EFFECTS[activeGodKey] || null;
    const bonusStr = currentBonus != null ? ` +${currentBonus}%` : '';
    const label   = `⛩ ${godName}${bonusStr} (${graceText})`;

    try {
      await window.IkDB?.put?.('constructions', {
        id: timerId, cityId, cityName: '', building: godName,
        endTime: endMs, label, type: 'shrine',
        godKey:       activeGodKey,
        godName,
        effect,
        graceText,
        msLeft,
        barPct,
        currentBonus,
        shrineLevel,
        currentFavor,
        maxBonusNext,
        researchedGods,
        slotsActive:  worshipSlots.length,
        worshipSlots,
        updated: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[parser_globaldata] shrine persist error:', e.message);
    }

    window.IkNotifier?.scheduleTimer?.({ id: timerId, label, endTime: endMs, type: 'shrine' });

    console.log(`[parser_globaldata] shrine city=${cityId}: ${godName} +${currentBonus}% | ${graceText} | lv=${shrineLevel} favore=${currentFavor} slot attivi=${worshipSlots.length}`);
    window.IkApp?.onBlessingUpdated?.(cityId, { godKey: activeGodKey, godName, graceText, msLeft, barPct, currentBonus, effect, shrineLevel, currentFavor });

    return 1;
  }

  window.IkParsers?.registerParser('globaldata', {
    match: (url, data) => {
      if (!Array.isArray(data)) return false;
      return data.some(item => {
        if (!Array.isArray(item)) return false;
        if (item[0] === 'updateGlobalData' && item[1] && typeof item[1] === 'object'
            && (item[1].headerData || item[1].backgroundData)) return true;
      if (item[0] === 'changeView') {
          if (Array.isArray(item[1]) && /^(templeOfOlympus|shrineOfOlympus|temple|divineFavor)$/i.test(item[1][0] || ''))
            return true;
          return true;
        }
        if (item[0] === 'updateTemplateData' && item[1]
            && Object.keys(item[1]).some(k => k.startsWith('shrineOfOlympus'))) return true;
        return false;
      });
    },
    parse,
  });
  console.log('[parser_globaldata] v7 OK');
})();
