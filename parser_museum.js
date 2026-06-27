// parser_museum.js — Intercetta la tab "Partner commerciali" del Museo
// Salva in 'cultural_treaties' (keyPath: cityId):
//   { cityId, partners: [{ playerId, playerName, allyTag, capital }], savedAt }

(function () {
  if (!window.IkParsers) return;

  window.IkParsers.registerParser('museum', {
    match(url) {
      return /view=museumTreaties/.test(url);
    },

    async parse(url, data, meta) {
      // cityId dall'URL
      const mCity = /cityId=(\d+)/.exec(url);
      if (!mCity) return { parsed: 0, parserName: 'museum' };
      const cityId = Number(mCity[1]);

      // Trova il blocco changeView con l'HTML del museo
      let html = '';
      if (Array.isArray(data)) {
        for (const item of data) {
          if (Array.isArray(item) && item[0] === 'changeView') {
            html = (item[1] && item[1][1]) || '';
            break;
          }
        }
      }
      if (!html) return { parsed: 0, parserName: 'museum' };

      // Estrai tutti i partner dalla tabella HTML
      // Pattern: avatarName'>NOME ... ally center" >ALLY ... capital center" >CAPITAL ... receiverId=ID
      const rowRe = /avatarName'>([^<]+)<\/span>[\s\S]*?class="ally center" >([^<]*)<\/td>[\s\S]*?class="capital center" >([^<]*)<\/td>[\s\S]*?receiverId=(\d+)/g;
      const partners = [];
      let m;
      while ((m = rowRe.exec(html)) !== null) {
        partners.push({
          playerName: m[1].trim(),
          allyTag:    m[2].trim(),
          capital:    m[3].trim(),
          playerId:   Number(m[4]),
        });
      }

      if (!partners.length) return { parsed: 0, parserName: 'museum' };

      // Recupera nome città dal dropdown globalData
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
        try {
          await window.IkDB.put('cultural_treaties', { cityId, cityName, partners, savedAt: Date.now() });
        } catch (e) {
          console.warn('[parser_museum] DB put fallito:', e.message);
        }
      }

      window.IkApp?.onCulturalTreatiesUpdated?.(cityId, partners);

      console.log(`[parser_museum] city=${cityId} ${cityName||''} — ${partners.length} partner culturali`);
      return { parsed: 1, parserName: 'museum', cityId, count: partners.length };
    }
  });

  console.log('[parser_museum] Registrato');
})();
