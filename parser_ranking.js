// ═══════════════════════════════════════════════
// parser_ranking.js — Classifica Ikariam
// Legge l'HTML dalla chiave "highscore" o "changeView"
// nei JSON di Ikariam e aggiorna players con:
// - posizione, nome, alleanza, punteggio, stato
// Segnala cambi di stato rispetto al DB
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // Tipi di classifica riconosciuti
  const RANKING_TYPES = {
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

  // Determina stato dal tr title attribute
  function parseState(trTitle) {
    const t = (trTitle || '').toLowerCase();
    if (t.includes('vacanza'))   return 'vacation';
    if (t.includes('non attivo') || t.includes('inactive')) return 'inactive';
    if (t.includes('bannato')   || t.includes('banned'))    return 'banned';
    if (t.includes('eliminato') || t.includes('deleted'))   return 'deleted';
    return 'active';
  }

  // Converti score italiano "5.470.883" → numero
  function parseScore(scoreStr) {
    if (!scoreStr) return 0;
    return Number(scoreStr.replace(/\./g, '').replace(',', '.')) || 0;
  }

  // Estrai tipo classifica dall'HTML (option selected)
  function extractRankingType(html) {
    const m = html.match(/value="([^"]+)"\s+selected(?:="selected")?/);
    return m ? (RANKING_TYPES[m[1]] || m[1]) : 'score';
  }

  // Estrai range posizioni dall'HTML
  function extractRange(html) {
    const m = html.match(/Posizione\s*<b>([^<]+)<\/b>/);
    return m ? m[1].trim() : '?';
  }

  // Parser HTML principale
  function parseHTML(html) {
    const players = [];

    // Estrai tutte le righe <tr...>...</tr>
    const trPattern = /<tr([^>]*)>([\s\S]*?)<\/tr>/g;
    let match;

    while ((match = trPattern.exec(html)) !== null) {
      const trAttrs = match[1];
      const trBody  = match[2];

      // Deve avere una posizione (classe "place bold")
      const placeMatch = trBody.match(/class="place bold">(\d+)/);
      if (!placeMatch) continue;

      const position = Number(placeMatch[1]);

      // Player ID dall'href avatarId
      const pidMatch  = trBody.match(/avatarId=(\d+)/);
      const pid       = pidMatch ? Number(pidMatch[1]) : null;

      // Nome player (avatarName span)
      const nameMatch = trBody.match(/avatarName[^>]*>([^<]+)<\/span>/);
      const name      = nameMatch ? nameMatch[1].trim() : '?';

      // Alleanza (allyLink)
      const allyMatch = trBody.match(/allyLink[^>]*>([^<]+)<\/a>/);
      const allyName  = allyMatch ? allyMatch[1].trim() : null;

      // Ally ID dall'href
      const allyIdMatch = trBody.match(/allyId=(\d+)/);
      const allyId      = allyIdMatch ? Number(allyIdMatch[1]) : null;

      // Score dal title del td.score (formato italiano: "5.470.883")
      const scoreMatch = trBody.match(/class="score"[^>]*title="([\d.]+)"/);
      const score      = scoreMatch ? parseScore(scoreMatch[1]) : 0;

      // Stato dal title del TR
      const trTitleMatch = trAttrs.match(/title="([^"]*)"/);
      const state        = parseState(trTitleMatch ? trTitleMatch[1] : '');

      // Titolo onorifico (tag <i>)
      const titleMatch = trBody.match(/<i>([^<]+)<\/i>/);
      const honorTitle = titleMatch ? titleMatch[1].trim() : null;

      if (pid && name !== '?') {
        players.push({ position, pid, name, allyName, allyId, score, state, honorTitle });
      }
    }

    return players;
  }

  // Salva nel DB e rileva cambi di stato
  async function savePlayers(players, rankingType) {
    const stateChanges = [];
    const now = new Date().toISOString();

    for (const p of players) {
      // Leggi stato precedente
      const existing = await window.IkDB.get('players', p.pid).catch(() => null);

      // Rilevamento cambio stato
      if (existing && existing.state && existing.state !== p.state) {
        stateChanges.push({
          playerId:   p.pid,
          playerName: p.name,
          allyName:   p.allyName || '—',
          prevState:  existing.state,
          newState:   p.state,
          prevUpdate: existing.stateUpdated || existing.updated || '?',
          newUpdate:  now,
          rankingType,
        });
      }

      // Salva/aggiorna player
      await window.IkDB.put('players', {
        ...(existing || {}),
        id:           p.pid,
        name:         p.name,
        allyName:     p.allyName,
        allyId:       p.allyId,
        score:        p.score,
        state:        p.state,
        stateSource:  'ranking',       // stato da classifica = fonte autorevole
        honorTitle:   p.honorTitle,
        stateUpdated: now,
        updated:      now,
        // Salva posizione per tipo classifica
        rankings: {
          ...((existing || {}).rankings || {}),
          [rankingType]: { position: p.position, score: p.score, date: now },
        },
      });
    }

    // Salva cambi di stato
    for (const c of stateChanges) {
      try { await window.IkDB.add('state_changes', c); } catch {}
    }

    return stateChanges;
  }

  // Entry point
  async function parse(url, data) {
    if (!Array.isArray(data)) return 0;
    let totalPlayers = 0;
    let allChanges   = [];

    for (const item of data) {
      if (!Array.isArray(item) || item.length < 2) continue;
      // Cerca azione "highscore" con HTML
      if (!['highscore', 'changeView'].includes(item[0])) continue;
      const html = item[1];
      if (typeof html !== 'string' || html.length < 100) continue;
      // Deve contenere la tabella classifica
      if (!html.includes('class="place bold"')) continue;

      const rankingType = extractRankingType(html);
      const range       = extractRange(html);
      const players     = parseHTML(html);

      if (players.length === 0) continue;

      console.log(`[parser_ranking] ${rankingType} [${range}]: ${players.length} players`);

      const changes = await savePlayers(players, rankingType);
      totalPlayers += players.length;
      allChanges   = allChanges.concat(changes);

      // Notifica cambi di stato
      if (changes.length > 0) {
        window.IkApp?.onStateChanges?.(changes);
      }

      // Aggiorna sezione ranking nel pannello
      window.IkApp?.onRankingUpdated?.({ rankingType, range, players, changes });
    }

    return totalPlayers;
  }

  window.IkParsers?.registerParser('ranking', {
    match: url => /ikariam/i.test(url) && !/WorldMap.*getJSONArea/i.test(url),
    parse,
  });
  console.log('[parser_ranking] OK');
})();
