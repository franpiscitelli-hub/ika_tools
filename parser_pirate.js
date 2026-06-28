// parser_pirate.js — Intercetta apertura Fortezza dei Pirati
// Estrae il countdown della quest (piracyHighscoreTime) e lo aggiunge ai Timer
// URL: ?view=pirateFortress&...&currentTab=tabBootyQuest

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

      // Cerca updateTemplateData
      let tplData = null;
      if (Array.isArray(data)) {
        for (const item of data) {
          if (Array.isArray(item) && item[0] === 'updateTemplateData') {
            tplData = item[1]; break;
          }
        }
      }
      if (!tplData) return { parsed: 0, parserName: 'pirate' };

      // Countdown highscore quest pirati
      const highscoreTime = tplData.piracyHighscoreTime;
      if (!highscoreTime?.countdown?.enddate) {
        return { parsed: 0, parserName: 'pirate' };
      }

      const enddate = highscoreTime.countdown.enddate; // Unix secondi
      const endMs   = enddate * 1000;
      if (endMs <= Date.now()) return { parsed: 0, parserName: 'pirate' };

      // Nome città dal DB
      let cityName = null;
      if (cityId && window.IkDB) {
        try {
          const rec = await window.IkDB.get('my_cities', cityId);
          if (rec?.name) cityName = rec.name;
        } catch {}
        if (!cityName) {
          // Fallback: dropdown globalData
          if (Array.isArray(data)) {
            for (const item of data) {
              if (Array.isArray(item) && item[0] === 'updateGlobalData') {
                const dropdown = item[1]?.headerData?.cityDropdownMenu || {};
                const entry = dropdown[`city_${cityId}`];
                if (entry) { cityName = entry.name; break; }
              }
            }
          }
        }
      }

      const cityLabel = cityName || (cityId ? `Città #${cityId}` : 'Fortezza');
      const label     = `🏴‍☠️ ${cityLabel} — Missione pirati`;
      const timerId   = `pirate_${cityId || 'unknown'}_${enddate}`;

      // Aggiungi al timer system
      window.IkNotifier?.scheduleTimer({
        id:      timerId,
        label,
        endTime: endMs,
        type:    'piracy',
      });

      console.log(`[parser_pirate] city=${cityId} ${cityLabel} — fine missione: ${new Date(endMs).toLocaleString('it')}`);
      return { parsed: 1, parserName: 'pirate', cityId, enddate };
    }
  });

  console.log('[parser_pirate] Registrato');
})();
