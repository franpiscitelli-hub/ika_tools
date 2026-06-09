// ═══════════════════════════════════════════════
// parser_ranking.js v2
// Logica basata su DB_highscore.js che funzionava.
// Usa DOMParser invece di regex — più robusto.
// Salva multi-punteggio: players[id].scores[tipo]
// Aggiorna status e rileva cambi di stato.
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const RANKING_LABELS = {
    'score':                    'Punteggio totale',
    'building_score_main':      'Costruttori',
    'building_score_secondary': 'Livelli edifici',
    'research_score_main':      'Scienziati',
    'research_score_secondary': 'Livelli ricerca',
    'army_score_main':          'Generali',
    'trader_score_secondary':   'Quantità oro',
    'offense':                  'Punti attacco',
    'defense':                  'Punti difesa',
    'trade':                    'Mercante',
    'resources':                'Risorse',
    'donations':                'Donazioni',
    'pillaging':                'Saccheggio',
    'piracy':                   'Punti predatore',
  };

  // Logica da processHtmlContent() del vecchio DB_highscore.js
  // ma con DOMParser e rilevamento completo stati
  function parseHtmlBlock(rawHTML) {
    // Pulisci HTML come nel vecchio script
    const cleanHTML = rawHTML
      .replace(/\\"/g,  '"')
      .replace(/\\n/g,  '')
      .replace(/\\t/g,  '');

    const doc = new DOMParser().parseFromString(cleanHTML, 'text/html');

    // Tipo classifica dal select
    const selectEl = doc.querySelector('select#js_highscoreType');
    const tipoKey  = selectEl ? selectEl.value : 'score';
    const tipoLabel = RANKING_LABELS[tipoKey] || tipoKey;

    // Range posizioni
    const rangeEl = doc.querySelector('p');
    const range   = rangeEl ? (rangeEl.textContent.match(/\d+-\d+/) || ['?'])[0] : '?';

    const players = [];

    doc.querySelectorAll('table.table01.highscore tr').forEach(row => {
      // Salta header
      if (row.querySelector('th')) return;

      const nameEl = row.querySelector('.name a');
      if (!nameEl) return;

      // avatarId dal link
      const href     = nameEl.getAttribute('href') || '';
      const avatarId = href.match(/avatarId=(\d+)/)?.[1];
      if (!avatarId) return;

      const nameSpan = row.querySelector('.avatarName');
      const scoreTd  = row.querySelector('.score');
      const allyEl   = row.querySelector('.allytag a');
      const placeTd  = row.querySelector('.place');

      const nome      = nameSpan
        ? nameSpan.textContent.trim()
        : (nameEl.getAttribute('title') || 'N/A');
      const scoreRaw  = scoreTd
        ? (scoreTd.getAttribute('title') || scoreTd.textContent)
        : '0';
      const punteggio = parseInt(scoreRaw.replace(/\./g, ''), 10) || 0;
      const alleanza  = allyEl ? allyEl.textContent.trim() : '';
      const position  = placeTd ? parseInt(placeTd.textContent.trim(), 10) || 0 : 0;

      // Titolo onorifico (tag <i>)
      const titleEl   = row.querySelector('.name i');
      const honorTitle = titleEl ? titleEl.textContent.trim() : null;

      // Stato dal title del TR (logica identica al vecchio script)
      const trTitle  = (row.getAttribute('title') || '').toLowerCase();
      let status = 'active';
      if      (trTitle.includes('vacanza'))   status = 'vacation';
      else if (trTitle.includes('inattivo'))  status = 'inactive';
      else if (trTitle.includes('bannato'))   status = 'banned';
      else if (trTitle.includes('eliminato')) status = 'deleted';

      players.push({ avatarId, nome, alleanza, punteggio, position, tipoKey, status, honorTitle });
    });

    return { tipoKey, tipoLabel, range, players };
  }

  async function savePlayers(parsed) {
    const { tipoKey, tipoLabel, players } = parsed;
    const stateChanges = [];
    const now          = Date.now();

    for (const p of players) {
      const pKey    = `av_${p.avatarId}`;
      const prev    = await window.IkDB.get('players', pKey);

      // Rilevamento cambio stato (come nel vecchio script)
      if (prev && prev.status && prev.status !== p.status) {
        stateChanges.push({
          playerId:   p.avatarId,
          playerName: p.nome,
          allyName:   p.alleanza || '—',
          prevState:  prev.status,
          newState:   p.status,
          prevUpdate: prev.lastUpdate
            ? new Date(prev.lastUpdate).toISOString()
            : '?',
          newUpdate:  new Date(now).toISOString(),
          rankingType: tipoLabel,
        });
      }

      // Aggiorna/crea player — multi-punteggio come nel vecchio script
      const scores = { ...(prev?.scores || {}) };
      scores[tipoKey] = p.punteggio;

      await window.IkDB.put('players', {
        ...(prev || {}),
        id:          pKey,
        avatarId:    p.avatarId,
        name:        p.nome,
        ally:        p.alleanza,
        scores,                     // multi-punteggio
        status:      p.status,      // stato da classifica = fonte autorevole
        stateSource: 'ranking',
        honorTitle:  p.honorTitle || (prev?.honorTitle || null),
        position:    { ...(prev?.position || {}), [tipoKey]: p.position },
        lastUpdate:  now,
      });
    }

    // Salva cambi stato
    for (const c of stateChanges) {
      try { await window.IkDB.add('state_changes', c); } catch {}
    }

    return stateChanges;
  }

  async function parse(url, data) {
    if (!Array.isArray(data)) return 0;
    let total    = 0;
    let allChanges = [];

    for (const item of data) {
      if (!Array.isArray(item) || item.length < 2) continue;

      // Logica dal vecchio script: cerca changeview/changeView
      // che contiene un array ['highscore', html]
      if (item[0] === 'changeview' || item[0] === 'changeView') {
        const viewData = item[1];
        if (Array.isArray(viewData) && viewData[0] === 'highscore') {
          const htmlContent = viewData[1];
          if (typeof htmlContent === 'string' && htmlContent.length > 100) {
            const parsed  = parseHtmlBlock(htmlContent);
            if (parsed.players.length > 0) {
              console.log(`[parser_ranking] ${parsed.tipoLabel} [${parsed.range}]: ${parsed.players.length} players`);
              const changes = await savePlayers(parsed);
              allChanges    = allChanges.concat(changes);
              total        += parsed.players.length;
              window.IkApp?.onRankingUpdated?.({ ...parsed, changes });
            }
          }
        }
        continue;
      }

      // Fallback: highscore direttamente come action
      if (item[0] === 'highscore' && typeof item[1] === 'string') {
        const parsed = parseHtmlBlock(item[1]);
        if (parsed.players.length > 0) {
          const changes = await savePlayers(parsed);
          allChanges    = allChanges.concat(changes);
          total        += parsed.players.length;
          window.IkApp?.onRankingUpdated?.({ ...parsed, changes });
        }
      }
    }

    if (allChanges.length > 0) {
      window.IkApp?.onStateChanges?.(allChanges);
    }

    return total;
  }

  window.IkParsers?.registerParser('ranking', {
    match: url => /ikariam/i.test(url) && !/WorldMap.*getJSONArea/i.test(url),
    parse,
  });
  console.log('[parser_ranking] v2 OK');
})();
