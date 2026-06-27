// parser_temple.js — Intercetta apertura Tempio e salva dati miracolo
// Struttura salvata in 'miracles' (keyPath: cityId):
//   cityId, cityName, godName, enddate, savedAt
// Se nessun miracolo attivo, salva enddate: null

(function () {
  if (!window.IkParsers) return;

  window.IkParsers.registerParser('temple', {
    match(url) {
      return /view=temple/.test(url);
    },

    async parse(url, data, meta) {
      // Ricava cityId dall'URL o dai link interni
      let cityId = null;
      const mUrl = /[?&]cityId=(\d+)/.exec(url);
      if (mUrl) cityId = Number(mUrl[1]);

      // Cerca updateTemplateData nell'array di azioni
      let tplData = null;
      if (Array.isArray(data)) {
        for (const item of data) {
          if (Array.isArray(item) && item[0] === 'updateTemplateData') {
            tplData = item[1]; break;
          }
        }
      }
      if (!tplData) return { parsed: 0, parserName: 'temple' };

      // Fallback cityId dai link interni
      if (!cityId) {
        const btn = tplData.js_WonderViewButton?.href || tplData.js_WonderActivateButton?.href || '';
        const mBtn = /cityId=(\d+)/.exec(btn);
        if (mBtn) cityId = Number(mBtn[1]);
      }
      if (!cityId) return { parsed: 0, parserName: 'temple' };

      // Nome dio
      const godName = tplData.js_WonderTextHead || null;

      // Countdown miracolo attivo
      const dur = tplData.js_WonderTextDuration;
      let enddate = null;
      if (dur && typeof dur === 'object' && dur.countdown?.enddate) {
        enddate = dur.countdown.enddate; // timestamp Unix (secondi)
      }

      // Nome città dal cityDropdownMenu in globalData (se disponibile)
      let cityName = null;
      if (Array.isArray(data)) {
        for (const item of data) {
          if (Array.isArray(item) && item[0] === 'updateGlobalData') {
            const dropdown = item[1]?.headerData?.cityDropdownMenu || {};
            const entry = dropdown[`city_${cityId}`];
            if (entry) cityName = entry.name;
            break;
          }
        }
      }

      // Salva nel DB
      if (window.IkDB) {
        const rec = {
          cityId,
          cityName,
          godName,
          enddate,        // null = nessun miracolo attivo
          savedAt: Date.now(),
        };
        try {
          await window.IkDB.put('miracles', rec);
        } catch (e) {
          // Store potrebbe non esistere ancora — gestito sotto
          console.warn('[parser_temple] DB put fallito:', e.message);
        }
      }

      // Notifica app
      window.IkApp?.onMiracleUpdated?.(cityId, { godName, enddate });

      const status = enddate
        ? `attivo fino a ${new Date(enddate * 1000).toLocaleTimeString('it')}`
        : 'nessun miracolo';
      console.log(`[parser_temple] city=${cityId} ${godName || '?'} — ${status}`);

      return { parsed: 1, parserName: 'temple', cityId, godName, enddate };
    }
  });

  console.log('[parser_temple] Registrato');
})();
