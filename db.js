// ═══════════════════════════════════════════════
// db.js — IndexedDB manager v4
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const DB_NAME    = 'IkariamCompanion';
  const DB_VERSION = 5;
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const d   = e.target.result;
        const old = e.oldVersion;

        // entries — JSON grezzi catturati
        if (!d.objectStoreNames.contains('entries')) {
          const s = d.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
          s.createIndex('type', 'type', { unique: false });
          s.createIndex('date', 'date', { unique: false });
        }

        // islands — keyPath: coords "X:Y"
        if (!d.objectStoreNames.contains('islands')) {
          const s = d.createObjectStore('islands', { keyPath: 'coords' });
          s.createIndex('name', 'name', { unique: false });
        }

        // cities — keyPath: id (numerico o stringa "islandId_cityName")
        if (!d.objectStoreNames.contains('cities')) {
          const s = d.createObjectStore('cities', { keyPath: 'id' });
          s.createIndex('islandX', 'islandX', { unique: false });
          s.createIndex('playerId', 'playerId', { unique: false });
        }

        // resources — keyPath: cityId (numerico, MAI null)
        if (!d.objectStoreNames.contains('resources')) {
          d.createObjectStore('resources', { keyPath: 'cityId' });
        }

        // constructions — keyPath: id STRINGA (es "build_1621"), NON autoIncrement
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

        // players — keyPath: id stringa (player_name se no player_id)
        if (!d.objectStoreNames.contains('players')) {
          const s = d.createObjectStore('players', { keyPath: 'id' });
          s.createIndex('name',  'name',  { unique: false });
          s.createIndex('state', 'state', { unique: false });
          s.createIndex('score', 'score', { unique: false });
        }

        // alliances — keyPath: id stringa (ally_name)
        if (!d.objectStoreNames.contains('alliances')) {
          const s = d.createObjectStore('alliances', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }

        // state_changes — autoIncrement, id numerico
        if (!d.objectStoreNames.contains('state_changes')) {
          const s = d.createObjectStore('state_changes', { keyPath: 'id', autoIncrement: true });
          s.createIndex('playerId',  'playerId',  { unique: false });
          s.createIndex('newUpdate', 'newUpdate', { unique: false });
        }

        // combat_reports — keyPath: combatId
        if (!d.objectStoreNames.contains('combat_reports')) {
          const s = d.createObjectStore('combat_reports', { keyPath: 'combatId' });
          s.createIndex('date',     'date',     { unique: false });
          s.createIndex('attacker', 'attacker', { unique: false });
          s.createIndex('defender', 'defender', { unique: false });
          s.createIndex('result',   'result',   { unique: false });
        }

        // buildings — keyPath: "cityId_groundId"
        if (!d.objectStoreNames.contains('buildings')) {
          const s = d.createObjectStore('buildings', { keyPath: 'id' });
          s.createIndex('cityId',   'cityId',   { unique: false });
          s.createIndex('building', 'building', { unique: false });
        }
      };

      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

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

  // Ultimi N record di uno store
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

  async function storageInfo() {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return {
      usedMB:  (est.usage  / 1024 / 1024).toFixed(1),
      quotaMB: (est.quota  / 1024 / 1024).toFixed(0),
      pct:     ((est.usage / est.quota) * 100).toFixed(1),
    };
  }

  async function pruneEntries(days = 30) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const all    = await getAll('entries');
    const old    = all.filter(e => e.date < cutoff);
    for (const e of old) await deleteRecord('entries', e.id);
    return old.length;
  }

  // Elimina tutti i JSON raw (store entries) per liberare spazio
  // Da chiamare dopo che i parser hanno importato i dati strutturati
  async function clearRawEntries() {
    await clear('entries');
    console.log('[IkDB] Raw entries eliminate');
  }

  // Elimina i raw più vecchi di N minuti (per pulizia automatica)
  async function pruneRawByAge(minutes = 30) {
    const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
    const all    = await getAll('entries');
    const old    = all.filter(e => e.date < cutoff);
    for (const e of old) await deleteRecord('entries', e.id);
    return old.length;
  }

  // Conta tutti gli store
  async function countAll() {
    const stores = ['entries','islands','cities','resources','constructions',
                    'research','fleets','players','alliances','state_changes','buildings','combat_reports'];
    const result = {};
    for (const s of stores) {
      try { result[s] = await count(s); } catch { result[s] = 0; }
    }
    return result;
  }

  window.IkDB = {
    open, add, put, get, getAll, count, clear,
    deleteRecord, getLast, storageInfo, pruneEntries, countAll,
    clearRawEntries, pruneRawByAge,
  };
  console.log('[IkDB] v4 caricato');
})();
