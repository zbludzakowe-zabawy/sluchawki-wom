// Aplikacja na telefon (PWA): baner instalacji i komunikat „Dostępna nowa wersja”.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const installBanner = $('install-banner');
  const updateBanner = $('update-banner');
  const DISMISS_KEY = 'sluchawki-install-dismissed';
  let deferred = null; // zdarzenie beforeinstallprompt (Chrome, Edge, Samsung)

  const loadDismissed = () => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  };
  const saveDismissed = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* trudno */ }
  };

  const standalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  // iPhone/iPad: Safari nie pokazuje okna instalacji – trzeba „Udostępnij → Do ekranu początkowego”.
  // iPadOS przedstawia się jako Mac, zdradza go ekran dotykowy.
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  const iosSafari = ios && !/CriOS|FxiOS|EdgiOS/i.test(ua);

  function refreshInstall() {
    let mode = 'none';
    if (!standalone() && !loadDismissed()) {
      if (deferred) mode = 'prompt';
      else if (iosSafari) mode = 'ios';
    }
    installBanner.hidden = mode === 'none';
    installBanner.dataset.mode = mode;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    refreshInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installBanner.hidden = true;
  });
  $('btn-install').addEventListener('click', async () => {
    if (!deferred) return;
    const ev = deferred;
    deferred = null;
    installBanner.hidden = true; // okno instalacji można pokazać tylko raz na zdarzenie
    await ev.prompt();
    await ev.userChoice.catch(() => undefined);
  });
  $('btn-install-close').addEventListener('click', () => {
    saveDismissed();
    installBanner.hidden = true;
  });
  refreshInstall();

  // Service worker: gra offline + informacja o nowej wersji. Tylko na stronie
  // opublikowanej przez HTTPS (lokalnie z pliku lub http://localhost – bez pamięci podręcznej).
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  let waiting = null;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading && waiting) {
      reloading = true;
      location.reload();
    }
  });
  $('btn-update').addEventListener('click', () => {
    updateBanner.hidden = true;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  $('btn-update-later').addEventListener('click', () => {
    updateBanner.hidden = true;
  });

  const offerUpdate = (w) => {
    waiting = w;
    updateBanner.hidden = false;
  };

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const hasController = () => !!navigator.serviceWorker.controller;
      if (reg.waiting && hasController()) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && hasController()) offerUpdate(w);
        });
      });
      // sprawdzaj nową wersję po powrocie do aplikacji i co godzinę
      const check = () => reg.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 60 * 60 * 1000);
    })
    .catch(() => undefined);
})();
