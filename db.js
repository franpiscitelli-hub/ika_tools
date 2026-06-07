// ═══════════════════════════════════════════════
// db.js — IndexedDB manager
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  const DB_NAME    = 'IkariamCompanion';
  const DB_VERSION = 3;
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const d = e.target.result;

        // Tutti i JSON grezzi catturati
        if (!d.objectStoreNames.contains('entries')) {
          const s = d.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
          s.createIndex('type',   'type',   { unique: false });
          s.createIndex('date',   'date',   { unique: false });
          s.createIndex('server', 'server', { unique: false });
        }

        // Isole (da Ikalogs)
        if (!d.objectStoreNames.contains('islands')) {
          const s = d.createObjectStore('islands', { keyPath: 'coords' });
          s.createIndex('name', 'name', { unique: false });
          s.createIndex('resource', 'resource', { unique: false });
        }

        // Città del giocatore
        if (!d.objectStoreNames.contains('cities')) {
          const s = d.createObjectStore('cities', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }

        // Risorse per città
        if (!d.objectStoreNames.contains('resources')) {
          d.createObjectStore('resources', { keyPath: 'cityId' });
        }

        // Costruzioni in corso
        if (!d.objectStoreNames.contains('constructions')) {
          const s = d.createObjectStore('constructions', { keyPath: 'id', autoIncrement: true });
          s.createIndex('cityId',  'cityId',  { unique: false });
          s.createIndex('endTime', 'endTime', { unique: false });
        }

        // Ricerche in corso
        if (!d.objectStoreNames.contains('research')) {
          d.createObjectStore('research', { keyPath: 'id' });
        }

        // Movimenti flotte
        if (!d.objectStoreNames.contains('fleets')) {
          const s = d.createObjectStore('fleets', { keyPath: 'id' });
          s.createIndex('arrivalTime', 'arrivalTime', { unique: false });
        }

        // Giocatori (da Ikalogs)
        if (!d.objectStoreNames.contains('players')) {
          const s = d.createObjectStore('players', { keyPath: 'id' });
          s.createIndex('name',  'name',  { unique: false });
          s.createIndex('state', 'state', { unique: false });
          s.createIndex('score', 'score', { unique: false });
        }

        // Alleanze
        if (!d.objectStoreNames.contains('alliances')) {
          const s = d.createObjectStore('alliances', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }

        // Cambi di stato giocatori
        if (!d.objectStoreNames.contains('state_changes')) {
          const s = d.createObjectStore('state_changes', { keyPath: 'id', autoIncrement: true });
          s.createIndex('playerId',  'playerId',  { unique: false });
          s.createIndex('newUpdate', 'newUpdate', { unique: false });
        }

        // Edifici per città
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
      r.onsuccess = () => resolve(r.result);
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

  // Stima spazio usato
  async function storageInfo() {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return {
      usedMB:  (est.usage  / 1024 / 1024).toFixed(1),
      quotaMB: (est.quota  / 1024 / 1024).toFixed(0),
      pct:     ((est.usage / est.quota) * 100).toFixed(1),
    };
  }

  // Pulizia entry vecchie (mantieni solo ultimi N giorni)
  async function pruneEntries(days = 30) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const all = await getAll('entries');
    const old = all.filter(e => e.date < cutoff);
    for (const e of old) await deleteRecord('entries', e.id);
    return old.length;
  }

  // Esponi globalmente
  window.IkDB = { open, add, put, get, getAll, count, clear, deleteRecord, storageInfo, pruneEntries };
  console.log('[IkDB] Modulo caricato');
})();
