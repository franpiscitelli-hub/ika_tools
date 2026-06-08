// ═══════════════════════════════════════════════
// parsers.js — Dispatcher centrale
// v2.0 — usa GM_xmlhttpRequest per bypassare CSP
//         dispatch a TUTTI i parser che matchano
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const BASE = 'https://franpiscitelli-hub.github.io/ika_tools';

  // Registro parser: array di { name, match(url), parse(url,data) }
  const registry = [];

  function registerParser(name, parser) {
    registry.push({ name, ...parser });
    console.log(`[IkParsers] Registrato: ${name}`);
  }

  // ── Carica sotto-parser usando GM_xmlhttpRequest ──
  // fetch() è bloccato dalla CSP di Ikariam,
  // GM_xmlhttpRequest bypassa la CSP perché è Tampermonkey
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      // GM_xmlhttpRequest è disponibile nel contesto unsafeWindow
      // tramite il loader Tampermonkey
      const gmReq = window._gmFetch || window.GM_xmlhttpRequest;
      if (!gmReq) {
        // Fallback a fetch se non disponibile (es. durante test)
        fetch(url).then(r => r.text()).then(resolve).catch(reject);
        return;
      }
      gmReq({
        method: 'GET',
        url,
        onload:  r => r.status === 200 ? resolve(r.responseText) : reject(new Error(`HTTP ${r.status}`)),
        onerror: e => reject(new Error('Rete: ' + (e.error || '?'))),
      });
    });
  }

  async function loadSubParsers() {
    const subParsers = [
      'parser_worldmap.js',
      'parser_ikalogs.js',
      'parser_globaldata.js',
      'parser_ranking.js',
    ];

    for (const file of subParsers) {
      try {
        const url  = `${BASE}/${file}?v=${Date.now()}`;
        const text = await gmFetch(url);
        // eval nel contesto globale della pagina
        (0, eval)(text); // eslint-disable-line no-eval
        console.log(`[IkParsers] ✅ ${file}`);
      } catch (e) {
        console.error(`[IkParsers] ❌ ${file}:`, e.message);
      }
    }
  }

  // ── Dispatch: chiama TUTTI i parser che matchano ──
  // (non solo il primo — globaldata E ranking devono
  //  essere entrambi chiamati sullo stesso JSON)
  async function parse(url, data) {
    const matching = registry.filter(p => p.match(url));

    if (matching.length === 0) {
      // Nessun parser: salva come raw
      try {
        await window.IkDB.add('entries', {
          url, type: 'raw',
          date:   new Date().toISOString(),
          server: window.location.hostname,
          data,
        });
      } catch {}
      return { type: 'raw', parsed: 0 };
    }

    let totalParsed = 0;
    const types = [];

    for (const parser of matching) {
      try {
        const result = await parser.parse(url, data);
        totalParsed += result || 0;
        types.push(parser.name);
      } catch (e) {
        console.error(`[IkParsers] Errore in ${parser.name}:`, e.message);
      }
    }

    return { type: types.join('+'), parsed: totalParsed };
  }

  function classify(url) {
    const matches = registry.filter(r => r.match(url));
    return matches.map(r => r.name).join('+') || 'unknown';
  }

  // Esponi GM_xmlhttpRequest ai sotto-parser tramite bridge
  // (i sotto-parser vengono eseguiti nel contesto pagina
  //  e non hanno accesso diretto a GM_xmlhttpRequest)
  function setGmFetch(fn) {
    window._gmFetch = fn;
  }

  window.IkParsers = { parse, classify, registerParser, loadSubParsers, setGmFetch };
  console.log('[IkParsers] Dispatcher v2.0 pronto');
})();
