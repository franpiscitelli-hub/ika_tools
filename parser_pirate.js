// parser_pirate.js — Intercetta apertura Fortezza dei Pirati
// Estrae il countdown della MISSIONE IN CORSO (barra arancione)
// Campo: load_js.params.ongoingMissionTimeRemaining (secondi rimanenti)
// URL: ?view=pirateFortress

(function () {
  if (!window.IkParsers) return;

  window.IkParsers.registerParser('pirate', {
    match(url) {
      return /view=pirateFortress/.test(url);
    },

    async parse(url, data, meta) {
      // cityId dall'URL
      const mCity = /cityId=(\d+)/.exec(url);
      const cityId = mCity ? Number(mCity[1]) : null;

      // Cerca updateTemplateData → load_js → params
      let params = null;
      if (Array.isArray(data)) {
        for (const item of data) {
          if (Array.isArray(item) && item[0] === 'updateTemplateData') {
            const tpl = item[1];
            try {
              const lj = tpl?.load_js;
              if (lj?.params) params = JSON.parse(lj.params);
            } catch {}
            break;
          }
        }
      }
      if (!params) return { parsed: 0, parserName: 'pirate' };

      // Missione in corso?
      if (!params.hasOngoingMission) return { parsed: 0, parserName: 'pirate' };

      const secsRemaining = Number(params.ongoingMissionTimeRemaining);
      if (!secsRemaining || secsRemaining <= 0) return { parsed: 0, parserName: 'pirate' };

      const serverTime = Number(params.serverTime) || Math.floor(Date.now() / 1000);
      const endMs      = (serverTime + secsRemaining) * 1000;

      // Nome del tipo di missione
      const levelIdx   = params.ongoingMissionLevel || 1;
      const levels     = params.pirateCaptureLevels || [];
      const missionDef = levels.find(l => l.buildingLevel === levelIdx);
      const missionName = missionDef?.name || `Livello ${levelIdx}`;

      // Nome città dal DB
      let cityName = null;
      if (cityId && window.IkDB) {
        try {
          const rec = await window.IkDB.get('my_cities', cityId);
          if (rec?.name) cityName = rec.name;
        } catch {}
        if (!cityName) {
          if (Array.isArray(data)) {
            for (const item of data) {
              if (Array.isArray(item) && item[0] === 'updateGlobalData') {
                const entry = item[1]?.headerData?.cityDropdownMenu?.[`city_${cityId}`];
                if (entry) { cityName = entry.name; break; }
              }
            }
          }
        }
      }

      const cityLabel = cityName || (cityId ? `Città #${cityId}` : 'Fortezza');
      const label     = `🏴‍☠️ ${cityLabel} — ${missionName}`;
      const timerId   = `pirate_${cityId || 'x'}_${Math.floor(endMs / 1000)}`;

      window.IkNotifier?.scheduleTimer({
        id:      timerId,
        label,
        endTime: endMs,
        type:    'piracy',
      });

      // Aggiorna UI
      window.IkApp?.onFleetsUpdated?.();
      window.IkApp?.onTimerAdded?.();

      console.log(`[parser_pirate] ${cityLabel} — "${missionName}" fine tra ${secsRemaining}s (${new Date(endMs).toLocaleTimeString('it')})`);
      return { parsed: 1, parserName: 'pirate', cityId, secsRemaining, missionName };
    }
  });

  console.log('[parser_pirate] Registrato');
})();
