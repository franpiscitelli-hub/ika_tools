// ═══════════════════════════════════════════════
// db.js — IndexedDB manager v5
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const DB_NAME    = 'IkariamCompanion';
  const DB_VERSION = 10;
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const d   = e.target.result;

        // entries — JSON grezzi catturati (autoIncrement)
        if (!d.objectStoreNames.contains('entries')) {
          const s = d.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
          s.createIndex('type', 'type', { unique: false });
          s.createIndex('date', 'date', { unique: false });
        }

        // islands — keyPath: coords "X:Y"
        if (!d.objectStoreNames.contains('islands')) {
          const s = d.createObjectStore('islands', { keyPath: 'coords' });
          s.createIndex('name', 'name', { unique: false });
          s.createIndex('x',    'x',    { unique: false });
          s.createIndex('y',    'y',    { unique: false });
        }

        // cities — keyPath: id
        //   numerico da ikariam  (es. 1621)
        //   stringa da ikalogs   (es. "43:53_NomeCittà")
        if (!d.objectStoreNames.contains('cities')) {
          const s = d.createObjectStore('cities', { keyPath: 'id' });
          s.createIndex('islandX',    'islandX',    { unique: false });
          s.createIndex('islandY',    'islandY',    { unique: false });
          s.createIndex('playerName', 'playerName', { unique: false });
          s.createIndex('source',     'source',     { unique: false });
        }

        // resources — keyPath: cityId (SEMPRE numerico)
        if (!d.objectStoreNames.contains('resources')) {
          d.createObjectStore('resources', { keyPath: 'cityId' });
        }

        // constructions — keyPath: id stringa "build_cityId"
        if (!d.objectStoreNames.contains('constructions')) {
          const s = d.createObjectStore('constructions', { keyPath: 'id' });
          s.createIndex('cityId',  'cityId',  { unique: false });
          s.createIndex('endTime', 'endTime', { unique: false });
        }

        // research — keyPath: id stringa
        if (!d.objectStoreNames.contains('research')) {
          d.createObjectStore('research', { keyPath: 'id' });
        }

        // fleets — keyPath: id stringa
        if (!d.objectStoreNames.contains('fleets')) {
          const s = d.createObjectStore('fleets', { keyPath: 'id' });
          s.createIndex('arrivalTime', 'arrivalTime', { unique: false });
        }

        // players — keyPath: id stringa
        //   "pl_NomePlayer" da ikalogs
        //   "av_avatarId"   da ranking
        if (!d.objectStoreNames.contains('players')) {
          const s = d.createObjectStore('players', { keyPath: 'id' });
          s.createIndex('name',        'name',        { unique: false });
          s.createIndex('status',      'status',      { unique: false });
          s.createIndex('stateSource', 'stateSource', { unique: false });
        }

        // alliances — keyPath: id stringa (nome alleanza)
        if (!d.objectStoreNames.contains('alliances')) {
          const s = d.createObjectStore('alliances', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }

        // state_changes — autoIncrement
        if (!d.objectStoreNames.contains('state_changes')) {
          const s = d.createObjectStore('state_changes', { keyPath: 'id', autoIncrement: true });
          s.createIndex('playerId',  'playerId',  { unique: false });
          s.createIndex('newUpdate', 'newUpdate', { unique: false });
        }

        // buildings — keyPath: "cityId_groundId"
        if (!d.objectStoreNames.contains('buildings')) {
          const s = d.createObjectStore('buildings', { keyPath: 'id' });
          s.createIndex('cityId',   'cityId',   { unique: false });
          s.createIndex('building', 'building', { unique: false });
        }

        // combat_reports — keyPath: combatId stringa
        if (!d.objectStoreNames.contains('combat_reports')) {
          const s = d.createObjectStore('combat_reports', { keyPath: 'combatId' });
          s.createIndex('date',     'date',     { unique: false });
          s.createIndex('attacker', 'attacker', { unique: false });
          s.createIndex('defender', 'defender', { unique: false });
          s.createIndex('result',   'result',   { unique: false });
        }

        // my_cities — città del proprietario dell'account (isOwn:true)
        // dati completi: risorse, economia, edifici, costruzioni
        if (!d.objectStoreNames.contains('my_cities')) {
          const s = d.createObjectStore('my_cities', { keyPath: 'cityId' });
          s.createIndex('ownerId', 'ownerId', { unique: false });
          s.createIndex('name',    'name',    { unique: false });
        }

        // enemy_buildings — città di altri player (isOwn:false)
        // solo edifici + livello, associati a ownerId/ownerName
        if (!d.objectStoreNames.contains('enemy_buildings')) {
          const s = d.createObjectStore('enemy_buildings', { keyPath: 'cityId' });
          s.createIndex('ownerId',   'ownerId',   { unique: false });
          s.createIndex('ownerName', 'ownerName', { unique: false });
        }

        // account_summary — dati globali account (oro totale, navi, income/upkeep)
        // record unico, keyPath fisso 'id' = 'main'
        if (!d.objectStoreNames.contains('account_summary')) {
          d.createObjectStore('account_summary', { keyPath: 'id' });
        }

        // building_data — dati costruzione/caratteristiche edifici per livello
        // keyPath: buildingId (numero intero, da URL buildingId=N)
        if (!d.objectStoreNames.contains('building_data')) {
          const s = d.createObjectStore('building_data', { keyPath: 'buildingId' });
          s.createIndex('name',         'name',         { unique: false });
          s.createIndex('buildingType', 'buildingType', { unique: false });
        }

        // unit_data — dati truppe/navi (attacco, difesa, costo, requisiti)
        // keyPath: id composito "unit_301" / "ship_201" per evitare collisioni
        // tra unitId e shipId che condividono lo stesso spazio numerico.
        if (!d.objectStoreNames.contains('unit_data')) {
          const s = d.createObjectStore('unit_data', { keyPath: 'id' });
          s.createIndex('kind', 'kind', { unique: false }); // 'unit' | 'ship'
          s.createIndex('name', 'name', { unique: false });
        }

        // completed_timers — timer scaduti (costruzioni/ricerche/flotte completate)
        // spostati qui da scheduleTimer/notifier quando msLeft arriva a 0.
        // Rimossi automaticamente dopo 24h (vedi pruneCompletedTimers).
        if (!d.objectStoreNames.contains('completed_timers')) {
          const s = d.createObjectStore('completed_timers', { keyPath: 'id' });
          s.createIndex('completedAt', 'completedAt', { unique: false });
          s.createIndex('type',        'type',        { unique: false });
        }
      };

      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── CRUD base ────────────────────────────────

  function add(store, rec) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const r  = tx.objectStore(store).add(rec);
      r.onsuccess = () => resolve(r.result);
      r.onerror   = () => reject(r.error);
    });
  }

  function put(store, rec) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const r  = tx.objectStore(store).put(rec);
      r.onsuccess = () => resolve(r.result);
      r.onerror   = () => reject(r.error);
    });
  }

  // Scrive molti record in un'unica transazione (molto più rapido
  // di N chiamate separate a put()). records: array di oggetti.
  function putMany(store, records) {
    return new Promise((resolve, reject) => {
      if (!records || !records.length) { resolve(0); return; }
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      let n = 0;
      for (const rec of records) {
        os.put(rec);
        n++;
      }
      tx.oncomplete = () => resolve(n);
      tx.onerror    = () => reject(tx.error);
      tx.onabort    = () => reject(tx.error);
    });
  }

  function get(store, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const r  = tx.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror   = () => reject(r.error);
    });
  }

  function getAll(store) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const r  = tx.objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror   = () => reject(r.error);
    });
  }

  function count(store) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const r  = tx.objectStore(store).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror   = () => reject(r.error);
    });
  }

  function clear(store) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const r  = tx.objectStore(store).clear();
      r.onsuccess = () => resolve();
      r.onerror   = () => reject(r.error);
    });
  }

  function deleteRecord(store, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const r  = tx.objectStore(store).delete(key);
      r.onsuccess = () => resolve();
      r.onerror   = () => reject(r.error);
    });
  }

  // ── Ultimi N record (per il visualizzatore DB) ─

  function getLast(store, n = 3) {
    return new Promise((resolve, reject) => {
      const tx      = db.transaction(store, 'readonly');
      const req     = tx.objectStore(store).openCursor(null, 'prev');
      const results = [];
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (cursor && results.length < n) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ── Storage info ─────────────────────────────

  async function storageInfo() {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return {
      usedMB:  (est.usage  / 1024 / 1024).toFixed(1),
      quotaMB: (est.quota  / 1024 / 1024).toFixed(0),
      pct:     ((est.usage / est.quota) * 100).toFixed(1),
    };
  }

  // ── Pulizia ──────────────────────────────────

  // Elimina entries più vecchie di N giorni
  async function pruneEntries(days = 30) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const all    = await getAll('entries');
    const old    = all.filter(e => e.date < cutoff);
    for (const e of old) await deleteRecord('entries', e.id);
    return old.length;
  }

  // Elimina TUTTI i JSON raw (entries)
  // I dati strutturati nei rispettivi store vengono mantenuti
  async function clearRawEntries() {
    await clear('entries');
    console.log('[IkDB] Raw entries eliminate');
  }

  // Elimina raw più vecchi di N minuti (auto-cleanup)
  async function pruneRawByAge(minutes = 30) {
    const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
    const all    = await getAll('entries');
    const old    = all.filter(e => e.date < cutoff);
    for (const e of old) await deleteRecord('entries', e.id);
    return old.length;
  }

  // Elimina completed_timers più vecchi di N ore (default 24h)
  async function pruneCompletedTimers(hours = 24) {
    const cutoff = Date.now() - hours * 3600000;
    const all    = await getAll('completed_timers');
    const old    = all.filter(t => (t.completedAt || 0) < cutoff);
    for (const t of old) await deleteRecord('completed_timers', t.id);
    return old.length;
  }

  // ── Conteggio tutti gli store ─────────────────

  async function countAll() {
    const stores = [
      'entries', 'islands', 'cities', 'resources',
      'constructions', 'research', 'fleets', 'players',
      'alliances', 'state_changes', 'buildings', 'combat_reports',
      'my_cities', 'enemy_buildings', 'account_summary', 'building_data',
      'completed_timers', 'unit_data',
    ];
    const result = {};
    for (const s of stores) {
      try { result[s] = await count(s); } catch { result[s] = 0; }
    }
    return result;
  }

  // ── Export ───────────────────────────────────

  window.IkDB = {
    open,
    add, put, putMany, get, getAll, count, clear,
    deleteRecord, getLast,
    storageInfo,
    pruneEntries, clearRawEntries, pruneRawByAge, pruneCompletedTimers,
    countAll,
  };

  console.log('[IkDB] v10 caricato');
})();
