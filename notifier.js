// ═══════════════════════════════════════════════
// notifier.js — Sistema notifiche e timer
// ═══════════════════════════════════════════════
(function () {
  'use strict';

  function log(...a) { console.log('[IkNotifier]', ...a); }

  // Timer attivi: { id → setTimeout handle }
  const timers  = new Map();
  const pending = new Map(); // { id → { label, endTime, type, urgent } }

  // ── RICHIEDI PERMESSO NOTIFICHE ──────────────
  async function requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  // ── MOSTRA NOTIFICA ──────────────────────────
  function notify(title, body, opts = {}) {
    // Notifica nativa se permesso concesso
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: 'https://franpiscitelli-hub.github.io/ika_tools/icon.png',
          badge:'https://franpiscitelli-hub.github.io/ika_tools/icon.png',
          tag:  opts.id || title,
          requireInteraction: opts.urgent || false,
        });
      } catch {}
    }

    // Toast in-app sempre (anche senza permesso)
    window.IkApp?.toast?.(`${opts.urgent ? '🚨' : '🔔'} ${title}: ${body}`, opts.urgent ? 5000 : 3000);
    log(`Notifica: ${title} — ${body}`);
  }

  // ── PROGRAMMA TIMER ──────────────────────────
  function scheduleTimer({ id, label, endTime, type, urgent = false }) {
    if (!endTime) return;

    // Annulla timer esistente con stesso id
    cancelTimer(id);

    // Calcola ms rimanenti
    const end = typeof endTime === 'number' ? endTime : new Date(endTime).getTime();
    const msLeft = end - Date.now();

    if (msLeft <= 0) {
      log(`Timer ${id} già scaduto`);
      return;
    }

    // Salva in pending
    pending.set(id, { label, endTime: end, type, urgent });

    // Avvisa 5 minuti prima se mancano più di 5 min
    if (msLeft > 5 * 60 * 1000) {
      const warn5 = setTimeout(() => {
        notify('⏰ Presto completato', `${label} — 5 minuti`, { id: id+'_warn', urgent: false });
      }, msLeft - 5 * 60 * 1000);
      timers.set(id + '_warn5', warn5);
    }

    // Avviso finale
    const handle = setTimeout(() => {
      notify(
        type === 'fleet_enemy' ? '⚔️ ATTACCO IN ARRIVO' : '✅ Completato',
        label,
        { id, urgent }
      );
      timers.delete(id);
      pending.delete(id);
      window.IkApp?.onTimerExpired?.(id, type);
    }, msLeft);

    timers.set(id, handle);
    log(`Timer [${type}] "${label}" → ${Math.round(msLeft/60000)}min`);

    // Aggiorna UI timer
    window.IkApp?.onTimerAdded?.({ id, label, endTime: end, type, urgent, msLeft });
  }

  // ── CANCELLA TIMER ───────────────────────────
  function cancelTimer(id) {
    if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); }
    if (timers.has(id+'_warn5')) { clearTimeout(timers.get(id+'_warn5')); timers.delete(id+'_warn5'); }
    pending.delete(id);
  }

  // ── LISTA TIMER ATTIVI ───────────────────────
  function getActive() {
    const now = Date.now();
    return Array.from(pending.entries()).map(([id, t]) => ({
      id,
      label:   t.label,
      type:    t.type,
      urgent:  t.urgent,
      endTime: t.endTime,
      msLeft:  Math.max(0, t.endTime - now),
    })).sort((a, b) => a.msLeft - b.msLeft);
  }

  // ── FORMATO TEMPO RIMANENTE ──────────────────
  function formatTime(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  // ── RIPRISTINO DA DB ─────────────────────────
  // Ricarica timer da costruzioni/ricerche salvate
  async function restoreTimers() {
    if (!window.IkDB) return;
    try {
      const [constructions, research, fleets] = await Promise.all([
        window.IkDB.getAll('constructions'),
        window.IkDB.getAll('research'),
        window.IkDB.getAll('fleets'),
      ]);

      for (const c of constructions) {
        if (c.endTime) scheduleTimer({
          id: String(c.id), label: `${c.name} completata`,
          endTime: c.endTime, type: 'building',
        });
      }

      for (const r of research) {
        if (r.endTime) scheduleTimer({
          id: `research_${r.id}`, label: `Ricerca: ${r.name}`,
          endTime: r.endTime, type: 'research',
        });
      }

      for (const f of fleets) {
        if (f.isEnemy && f.arrivalTime) scheduleTimer({
          id: `fleet_${f.id}`, label: `Flotta da ${f.origin}`,
          endTime: f.arrivalTime, type: 'fleet_enemy', urgent: true,
        });
      }

      log(`Ripristinati: ${constructions.length} costruzioni, ${research.length} ricerche, ${fleets.filter(f=>f.isEnemy).length} flotte nemiche`);
    } catch (e) {
      log('Errore ripristino timer:', e.message);
    }
  }

  // Esponi globalmente
  window.IkNotifier = {
    requestPermission,
    notify,
    scheduleTimer,
    cancelTimer,
    getActive,
    formatTime,
    restoreTimers,
  };

  log('Modulo caricato');
})();
