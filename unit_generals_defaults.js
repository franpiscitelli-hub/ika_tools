// ═══════════════════════════════════════════════
// unit_generals_defaults.js
//
// Valori di default per i "Punti Generale" richiesti da ogni truppa/nave
// per essere comandata in battaglia. Questo dato NON è esposto da nessun
// JSON intercettabile dal gioco — è una tabella statica nota dalla
// community (fonte: IkaLogs, calcolatore truppe/flotta).
//
// I valori vengono applicati una sola volta all'avvio dell'app (vedi
// applyGeneralsDefaults), SOLO se il record unit_data esiste già e NON
// ha già un campo "generals" impostato — così un domani, se il gioco
// dovesse esporre questo dato direttamente, il valore reale non verrebbe
// mai sovrascritto dal default statico.
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  // unitId (truppe di terra) → punti generale
  // Cuoco (310), Guaritore (311), Spartano (319): valore non noto, omessi
  // di proposito — il campo "generals" resterà assente per queste unità
  // finché non verrà fornito un valore corretto.
  const UNIT_GENERALS = {
    301: 1.4,   // Fromboliere
    313: 6.2,   // Arciere
    315: 0.6,   // Giavellottiere
    302: 1.2,   // Spadaccino
    303: 0.4,   // Oplita
    304: 1.1,   // Tiratore fucile a zolfo
    305: 4,     // Mortaio
    306: 4.4,   // Catapulta
    307: 11.2,  // Ariete
    308: 31,    // Gigante a Vapore
    312: 2.5,   // Girocottero
    309: 5.8,   // Pallone aerostatico bombardiere
  };

  // shipId (navi) → punti generale
  const SHIP_GENERALS = {
    210: 5,     // Nave con Ariete
    211: 6.2,   // Nave lanciafiamme
    212: 20.2,  // Sottomarino
    213: 6.8,   // Nave con Balestra
    214: 6.4,   // Nave con Catapulta
    215: 22.4,  // Nave con Mortaio
    216: 24,    // Ariete a vapore
    217: 28,    // Nave lanciamissili
    218: 6.4,   // Ariete con ruote a pale
    219: 28,    // Portapalloni
    220: 16,    // Nave appoggio
  };

  // Applica i default a tutti i record unit_data presenti nel DB che non
  // hanno ancora un campo "generals". Va chiamata una volta all'avvio,
  // dopo l'apertura del DB (vedi app.js → init()).
  async function applyGeneralsDefaults() {
    if (!window.IkDB) return { applied: 0 };

    let applied = 0;
    try {
      const all = await window.IkDB.getAll('unit_data');
      for (const rec of all) {
        if (rec.generals != null) continue; // già impostato (default o reale): non toccare

        const table = rec.kind === 'ship' ? SHIP_GENERALS : UNIT_GENERALS;
        const value = table[rec.unitId];
        if (value == null) continue; // nessun default noto per questa unità

        await window.IkDB.put('unit_data', { ...rec, generals: value, generalsIsDefault: true });
        applied++;
      }
    } catch (e) {
      console.error('[unit_generals_defaults] errore:', e.message);
    }

    if (applied > 0) console.log(`[unit_generals_defaults] Applicati ${applied} valori di default`);
    return { applied };
  }

  window.IkUnitGenerals = { UNIT_GENERALS, SHIP_GENERALS, applyGeneralsDefaults };
  console.log('[unit_generals_defaults] v1 OK');
})();
