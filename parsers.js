// ═══════════════════════════════════════════════
// parsers.js — Dispatcher centrale
// Carica i sotto-parser da GitHub e smista i dati
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const BASE = 'https://franpiscitelli-hub.github.io/ika_tools';

  // Registro parser: { name, match(url), parse(url,data) }
  const registry = [];

  function registerParser(name, parser) {
    registry.push({ name, ...parser });
    console.log(`[IkParsers] Registrato: ${name}`);
  }

  // Carica sotto-parser da GitHub
  async function loadSubParsers() {
    const subParsers = ['parser_worldmap.js', 'parser_ikalogs.js', 'parser_globaldata.js', 'parser_ranking.js'];
    for (const file of subParsers) {
      try {
        const res = await fetch(`${BASE}/${file}?v=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        // eslint-disable-next-line no-eval
        (0, eval)(text);
        console.log(`[IkParsers] ✅ ${file}`);
      } catch (e) {
        console.error(`[IkParsers] ❌ ${file}:`, e.message);
      }
    }
  }

  // Dispatch: trova parser giusto per URL e chiama parse()
  async function parse(url, data) {
    // Cerca parser registrato
    const parser = registry.find(p => p.match(url));

    if (parser) {
      try {
        const result = await parser.parse(url, data);
        return { type: parser.name, parsed: result || 0 };
      } catch (e) {
        console.error(`[IkParsers] Errore in ${parser.name}:`, e.message);
      }
    }

    // Nessun parser specifico: salva come raw
    try {
      await window.IkDB.add('entries', {
        url,
        type:   'raw',
        date:   new Date().toISOString(),
        server: window.location.hostname,
        data,
      });
    } catch {}

    return { type: 'raw', parsed: 0 };
  }

  function classify(url) {
    const p = registry.find(r => r.match(url));
    return p ? p.name : 'unknown';
  }

  // Esponi
  window.IkParsers = { parse, classify, registerParser, loadSubParsers };
  console.log('[IkParsers] Dispatcher pronto');
})();
