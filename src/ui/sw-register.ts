/**
 * Registers the offline app-shell service worker (production builds only).
 * "Ready offline" is shown only once the worker for THIS build is active, which (because its
 * install is all-or-nothing) means every app file and the sample folder are in the cache.
 */
export function registerServiceWorker(indicator: HTMLElement): void {
  indicator.hidden = true;
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const version = encodeURIComponent(__BUILD_ID__);
  const isThisBuild = (worker: ServiceWorker | null | undefined): boolean => !!worker && worker.scriptURL.endsWith(`/sw.js?v=${version}`);
  const showReady = (): void => {
    indicator.textContent = 'Ready offline';
    indicator.title = 'The app and the sample folder are cached on this device.';
    indicator.hidden = false;
  };

  navigator.serviceWorker
    .register(`/sw.js?v=${version}`)
    .then((registration) => {
      const check = (): void => {
        if (isThisBuild(registration.active)) showReady();
      };
      const track = (worker: ServiceWorker | null): void => {
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'activated') check();
        });
      };
      check();
      track(registration.installing);
      track(registration.waiting);
      registration.addEventListener('updatefound', () => track(registration.installing));
      navigator.serviceWorker.addEventListener('controllerchange', check);
    })
    .catch(() => {
      indicator.hidden = true;
    });
}

/** Shows "Online" / "Offline: still working on this device". */
export function watchConnectivity(el: HTMLElement): void {
  const update = (): void => {
    const online = navigator.onLine;
    el.textContent = online ? 'Online' : 'Offline: still working on this device';
    el.dataset.state = online ? 'online' : 'offline';
  };
  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
}
