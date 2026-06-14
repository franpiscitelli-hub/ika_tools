// ═══════════════════════════════════════════════
// parser_ranking.js v3
// Match basato sul CONTENUTO (non sull'URL, che può variare):
//   - data contiene un blocco ['changeview'|'changeView', ['highscore', html]]
//   - l'HTML contiene la parola "highscore"
// meta.date (timestamp di cattura) viene salvato come
// lastUpdate/lastUpdateDate sui players.
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

  async function savePlayers(parsed, meta) {
    meta = meta || {};
    const { tipoKey, tipoLabel, players } = parsed;
    const stateChanges = [];
    const nowIso = meta.date || new Date().toISOString();
    const nowMs  = new Date(nowIso).getTime() || Date.now();

    // Pre-carica tutti i players in memoria (una sola getAll)
    const allPlayers = await window.IkDB.getAll('players');
    const playerMap  = new Map(allPlayers.map(r => [r.id, r]));

    for (const p of players) {
      const pKey = `av_${p.avatarId}`;
      const prev = playerMap.get(pKey);

      // Rilevamento cambio nome — conserva lo storico
      let nameHistory = prev?.nameHistory || [];
      if (prev && prev.name && prev.name !== p.nome) {
        nameHistory = [...nameHistory, {
          name: prev.name,
          until: nowIso,
        }];
      }

      // Rilevamento cambio stato
      if (prev && prev.status && prev.status !== p.status) {
        stateChanges.push({
          playerId:    p.avatarId,
          playerName:  p.nome,
          prevName:    (prev.name && prev.name !== p.nome) ? prev.name : null,
          allyName:    p.alleanza || '—',
          prevState:   prev.status,
          newState:    p.status,
          prevUpdate:  prev.lastUpdate
            ? new Date(prev.lastUpdate).toISOString()
            : '?',
          newUpdate:   nowIso,
          rankingType: tipoLabel,
        });
      }

      // Aggiorna/crea player — multi-punteggio
      const scores = { ...(prev?.scores || {}) };
      scores[tipoKey] = p.punteggio;

      playerMap.set(pKey, {
        ...(prev || {}),
        id:          pKey,
        avatarId:    p.avatarId,
        name:        p.nome,
        nameHistory,                // storico nomi precedenti
        ally:        p.alleanza,
        scores,                     // multi-punteggio
        status:      p.status,      // stato da classifica = fonte autorevole
        stateSource: 'ranking',
        honorTitle:  p.honorTitle || (prev?.honorTitle || null),
        position:    { ...(prev?.position || {}), [tipoKey]: p.position },
        lastUpdate:  nowMs,
        lastUpdateDate: nowIso,     // data leggibile della cattura
      });
    }

    // Scrittura batch in un'unica transazione
    try {
      await window.IkDB.putMany('players', [...playerMap.values()]);
    } catch (e) {
      console.error('[parser_ranking] putMany error:', e.message);
    }

    // Salva cambi stato
    for (const c of stateChanges) {
      try { await window.IkDB.add('state_changes', c); } catch {}
    }

    return stateChanges;
  }

  // Trova l'eventuale blocco ['changeview'|'changeView', ['highscore', html]]
  // dentro l'array di azioni. Ritorna l'HTML oppure null.
  function findHighscoreHtml(data) {
    if (!Array.isArray(data)) return null;
    for (const item of data) {
      if (!Array.isArray(item) || item.length < 2) continue;

      if (item[0] === 'changeview' || item[0] === 'changeView') {
        const viewData = item[1];
        if (Array.isArray(viewData) && viewData[0] === 'highscore') {
          const html = viewData[1];
          if (typeof html === 'string' && html.includes('highscore')) return html;
        }
        continue;
      }

      // Fallback: highscore direttamente come action
      if (item[0] === 'highscore' && typeof item[1] === 'string'
          && item[1].includes('highscore')) {
        return item[1];
      }
    }
    return null;
  }

  async function parse(url, data, meta) {
    meta = meta || {};
    const html = findHighscoreHtml(data);
    if (!html) return { parsed: 0, parserName: 'ranking' };

    const parsed = parseHtmlBlock(html);
    if (!parsed.players.length) return { parsed: 0, parserName: 'ranking' };

    console.log(`[parser_ranking] ${parsed.tipoLabel} [${parsed.range}]: ${parsed.players.length} players`);
    const changes = await savePlayers(parsed, meta);

    window.IkApp?.onRankingUpdated?.({ ...parsed, changes });
    if (changes.length > 0) window.IkApp?.onStateChanges?.(changes);

    return {
      parsed:     parsed.players.length,
      parserName: 'ranking',
      tipoLabel:  parsed.tipoLabel,
      range:      parsed.range,
      changes:    changes.length,
      date:       meta.date || null,
    };
  }

  // Match basato sul CONTENUTO, non sull'URL (può variare):
  // 1. data deve contenere un blocco changeview/changeView
  // 2. il payload HTML deve contenere la parola "highscore"
  window.IkParsers?.registerParser('ranking', {
    match: (url, data) => findHighscoreHtml(data) !== null,
    parse,
  });
  console.log('[parser_ranking] v3 OK');
})();
