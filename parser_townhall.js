// ═══════════════════════════════════════════════
// parser_townhall.js v1
//
// Gestisce le risposte della pagina Municipio (?view=townHall).
//
// Estrae da updateTemplateData tutti i dati economici e demografici
// della polis (popolazione, felicità, entrate oro, distribuzione
// lavoratori, dettaglio soddisfazione) e li salva in 'town_hall_data'.
//
// Estrae inoltre la benedizione attiva dal Santuario degli Dei se
// presente nelle chiavi "shrineOfOlympus ..." dello stesso payload,
// integrandosi con il timer già gestito da parseShrineOfOlympus in
// parser_globaldata (non duplica la logica timer, aggiunge solo i
// dettagli descrittivi della benedizione al record town_hall_data).
//
// Struttura salvata in 'town_hall_data' (keyPath: cityId):
// {
//   cityId, level,
//   population, maxPopulation, populationGrowth,
//   happiness, happinessText, income, corruption,
//   citizens, woodWorkers, specialWorkers, scientists, priests,
//   woodProduction, woodCost, tgProduction, tgCost,
//   goldCitizens, goldPriests,
//   garrisonLimitLand, garrisonLimitSea,
//   actionPoints, actionPointsMax,
//   satisfaction: { base, research, government, tavern, wine,
//                   overpopulation, corruption, punishment, government_malus,
//                   total },
//   blessing: { godKey, godName, graceText, msLeft, percent } | null,
//   updated
// }
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // ── Nomi italiani degli dei ─────────────────────────────────
  const GOD_NAMES = {
    pan: 'Pan', dionysus: 'Dioniso', tyche: 'Tiche', plutus: 'Pluto',
    theia: 'Tela', hephaestos: 'Efesto', zeus: 'Zeus', ares: 'Ares',
    poseidon: 'Poseidone', hera: 'Era', athena: 'Atena', hermes: 'Ermes',
  };

  // ── Effetti benedizione per dio ─────────────────────────────
  // Nota: gli effetti reali dipendono dal livello del santuario e possono
  // variare; questi sono i bonus base tipici di Ikariam.
  const GOD_EFFECTS = {
    zeus:       'Espansione della guarnigione terrestre',
    poseidon:   'Espansione della guarnigione navale',
    hera:       'Crescita della popolazione aumentata',
    ares:       'Forza delle truppe aumentata',
    athena:     'Ricerca scientifica aumentata',
    hermes:     'Velocità trasporti aumentata',
    plutus:     'Entrate oro aumentate',
    tyche:      'Produzione risorse aumentata',
    pan:        'Soddisfazione aumentata',
    dionysus:   'Consumo vino ridotto',
    hephaestos: 'Velocità costruzioni aumentata',
    theia:      'Riduzione corruzione',
  };

  function numVal(v) {
    if (v == null) return null;
    if (typeof v === 'object') {
      // Alcuni campi arrivano come { text: '2.263' }
      v = v.text ?? v.value ?? '';
    }
    const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function strVal(v) {
    if (v == null) return null;
    if (typeof v === 'object') return v.text ?? null;
    return String(v);
  }

  // "1G 13h" / "13h 45m" → ms
  function gracePeriodToMs(text) {
    if (!text || text === '-') return 0;
    let ms = 0;
    const d = text.match(/(\d+)\s*G/i);
    const h = text.match(/(\d+)\s*h/i);
    const m = text.match(/(\d+)\s*m(?!s)/i);
    if (d) ms += +d[1] * 86400000;
    if (h) ms += +h[1] * 3600000;
    if (m) ms += +m[1] * 60000;
    return ms;
  }

  function getBuildingLevel(data) {
    for (const item of (data || [])) {
      if (!Array.isArray(item) || item[0] !== 'changeView') continue;
      const html = (item[1] || [])[1] || '';
      const m = /Livello\s*<\/div>\s*(\d+)/.exec(html);
      if (m) return +m[1];
    }
    return null;
  }

  function getCityId(url, data) {
    const m = /[?&]cityId=(\d+)/.exec(url || '');
    if (m) return +m[1];
    for (const item of (data || [])) {
      if (Array.isArray(item) && item[0] === 'updateGlobalData'
          && item[1]?.backgroundData?.id) {
        return +item[1].backgroundData.id;
      }
    }
    return null;
  }

  function extractBlessing(td) {
    // Cerca il dio con gracePeriod attivo
    let activeGodKey = null, graceText = null;
    for (const key of Object.keys(td)) {
      const m = /^shrineOfOlympus \.god_(\w+) \.gracePeriod$/.exec(key);
      if (m && td[key] && td[key] !== '-') {
        activeGodKey = m[1];
        graceText    = td[key];
        break;
      }
    }
    if (!activeGodKey) return null;

    const barStyle = td[`shrineOfOlympus .god_${activeGodKey} .bar`]?.style?.width;
    const percent  = barStyle ? parseInt(barStyle, 10) : null;
    const msLeft   = gracePeriodToMs(graceText);
    const godName  = GOD_NAMES[activeGodKey] || activeGodKey;

    return {
      godKey:  activeGodKey,
      godName,
      effect:  GOD_EFFECTS[activeGodKey] || null,
      graceText,
      msLeft,
      percent,
    };
  }

  function extractTemplateData(td) {
    if (!td || typeof td !== 'object') return null;

    // Popolazione e spazio
    const population    = numVal(td.js_TownHallOccupiedSpace);
    const maxPopulation = numVal(td.js_TownHallMaxInhabitants);
    const growthVal     = numVal(td.js_TownHallPopulationGrowthValue);
    const happiness     = numVal(td.js_TownHallHappinessLargeValue);
    const happinessText = strVal(td.js_TownHallHappinessLargeText) ||
                          strVal(td.js_TownHallHappinessSmallText);
    const income        = numVal(td.js_TownHallIncomeGoldValue);
    const corruption    = strVal(td.js_TownHallCorruption);

    // Distribuzione lavoratori
    const citizens       = numVal(td.js_TownHallPopulationGraphCitizenCount
                                ?? td.CitizenCount);
    const woodWorkers    = numVal(td.js_TownHallPopulationGraphResourceWorkerCount
                                ?? td.ResourceWorkerCount);
    const specialWorkers = numVal(td.js_TownHallPopulationGraphSpecialWorkerCount
                                ?? td.SpecialWorkerCount);
    const scientists     = numVal(td.js_TownHallPopulationGraphScientistCount
                                ?? td.ScientistCount);
    const priests        = numVal(td.js_TownHallPopulationGraphPriestCount
                                ?? td.PriestCount);

    // Produzioni / consumi
    const woodProduction = numVal(td.js_TownHallPopulationGraphWoodProduction);
    const woodCost       = numVal(td.js_TownHallPopulationGraphWoodCost);
    const tgProduction   = numVal(td.js_TownHallPopulationGraphTradeGoodProduction);
    const tgCost         = numVal(td.js_TownHallPopulationGraphTradeGoodCost);
    const goldCitizens   = numVal(td.js_TownHallPopulationGraphCitizensGoldProduction);
    const goldPriests    = numVal(td.js_TownHallPopulationGraphPriestsGoldProduction);

    // Guarnigione e azioni
    const garrisonLimitLand = numVal(td.js_TownHallGarrisonLimitLand);
    const garrisonLimitSea  = numVal(td.js_TownHallGarrisonLimitSea);
    const actionPoints      = numVal(td.js_TownHallActionPointsAvailable);
    const actionPointsMax   = numVal(td.js_TownHallMaxActionPointsAvailable);

    // Dettaglio soddisfazione
    const sat = {
      base:           numVal(td.js_TownHallSatisfactionOverviewBaseBoniBaseBonusValue),
      research:       numVal(td.js_TownHallSatisfactionOverviewBaseBoniResearchBonusValue),
      government:     numVal(td.js_TownHallSatisfactionOverviewBaseBoniGovernmentBonusValue),
      capital:        numVal(td.js_TownHallSatisfactionOverviewBaseBoniCapitalBonusValue),
      happening:      numVal(td.js_TownHallSatisfactionOverviewBaseBoniHappeningBonusValue),
      tavern:         numVal(td.js_TownHallSatisfactionOverviewWineBoniTavernBonusValue),
      wine:           numVal(td.js_TownHallSatisfactionOverviewWineBoniServeBonusValue),
      museum:         numVal(td.js_TownHallSatisfactionOverviewCultureBoniMuseumBonusValue),
      treaty:         numVal(td.js_TownHallSatisfactionOverviewCultureBoniTreatyBonusValue),
      overpopulation: numVal(td.js_TownHallSatisfactionOverviewOverpopulationMalusValue),
      corruption:     numVal(td.js_TownHallSatisfactionOverviewCorruptionMalusValue),
      punishment:     numVal(td.js_TownHallSatisfactionOverviewPunishmentMalusValue),
      govMalus:       numVal(td.js_TownHallSatisfactionOverviewGovernmentMalusValue),
    };
    sat.total = happiness;

    // Benedizione santuario
    const blessing = extractBlessing(td);

    return {
      population, maxPopulation, populationGrowth: growthVal,
      happiness, happinessText, income, corruption,
      citizens, woodWorkers, specialWorkers, scientists, priests,
      woodProduction, woodCost, tgProduction, tgCost,
      goldCitizens, goldPriests,
      garrisonLimitLand, garrisonLimitSea,
      actionPoints, actionPointsMax,
      satisfaction: sat,
      blessing,
    };
  }

  async function parse(url, data, meta) {
    const cityId = getCityId(url, data);
    if (!cityId) return { parsed: 0, parserName: 'townhall' };

    const level = getBuildingLevel(data);

    // Cerca updateTemplateData
    let td = null;
    for (const item of (data || [])) {
      if (Array.isArray(item) && item[0] === 'updateTemplateData'
          && item[1] && typeof item[1] === 'object') {
        // Controlla che sia il municipio (ha js_TownHall* o OccupiedSpace)
        if (item[1].js_TownHallOccupiedSpace !== undefined
            || item[1].js_TownHallMaxInhabitants !== undefined) {
          td = item[1];
          break;
        }
      }
    }

    if (!td) return { parsed: 0, parserName: 'townhall' };

    const extracted = extractTemplateData(td);
    if (!extracted) return { parsed: 0, parserName: 'townhall' };

    const record = {
      cityId,
      level,
      ...extracted,
      updated: meta?.date || new Date().toISOString(),
    };

    try {
      await window.IkDB.put('town_hall_data', record);
    } catch (e) {
      console.error('[parser_townhall] DB error:', e.message);
      return { parsed: 0, parserName: 'townhall' };
    }

    const b = extracted.blessing;
    const bStr = b ? ` · ⛩ ${b.godName} ${b.graceText}` : '';
    console.log(`[parser_townhall] city=${cityId} lv=${level} pop=${extracted.population}/${extracted.maxPopulation} sodd=${extracted.happinessText}${bStr}`);

    window.IkApp?.onTownHallUpdated?.(cityId);
    return { parsed: 1, parserName: 'townhall', cityId };
  }

  // Controlla se il changeView è un townHall, oppure se updateTemplateData
  // contiene dati del municipio (js_TownHall*)
  function match(url, data) {
    if (/view=townHall/.test(url || '')) return true;
    if (!Array.isArray(data)) return false;
    return data.some(item => {
      if (!Array.isArray(item)) return false;
      if (item[0] === 'changeView' && Array.isArray(item[1]) && item[1][0] === 'townHall')
        return true;
      if (item[0] === 'updateTemplateData' && item[1]
          && (item[1].js_TownHallOccupiedSpace !== undefined
              || item[1].js_TownHallMaxInhabitants !== undefined))
        return true;
      return false;
    });
  }

  window.IkParsers?.registerParser('townhall', { match, parse });
  console.log('[parser_townhall] v1 OK');
})();
