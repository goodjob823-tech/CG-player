const SHELL_CACHE = 'cg-player-shell-v5-offline';
const OFFLINE_CACHE = 'cg-player-offline-library-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const OFFLINE_ASSETS = [
  './assets_cg01.js',
  './assets_cg02.js?v=20260908-cg02fix3',
  './assets_cg03.js',
  './assets_cg04.js',
  './assets_cg05.js',
  './backgrounds.js',
  './audio_1.js',
  './audio_2.js',
  './audio_3.js'
];

const MOBILE_PATCH = `
<style id="cg-mobile-clean-view-patch">
@media (pointer:coarse), (max-width:900px) {
  #mobileToolbar { display:none !important; }
  body.ui-hidden #mobileToolbar { display:none !important; }
  body.ui-hidden #hint { display:none !important; }
  #hint { bottom:calc(12px + env(safe-area-inset-bottom,0px)) !important; }
}
</style>
<script>
(function(){
  const mobileLike = window.matchMedia('(pointer:coarse), (max-width:900px)').matches;
  if (!mobileLike) return;
  function applyCleanView(){
    const toolbar = document.getElementById('mobileToolbar');
    if (toolbar) toolbar.style.setProperty('display','none','important');
    try {
      if (typeof setUiHidden === 'function') setUiHidden(true);
      else document.body.classList.add('ui-hidden');
    } catch(e) {
      document.body.classList.add('ui-hidden');
    }
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = '手機操作：點左半部＝前一個動作／點右半部＝下一個動作／拖曳＝移動／雙指開合＝縮放';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyCleanView, {once:true});
  else applyCleanView();
  window.addEventListener('load', () => setTimeout(applyCleanView, 50), {once:true});
})();
<\/script>
`;

function injectMobilePatch(html) {
  if (html.includes('cg-mobile-clean-view-patch')) return html;
  const marker = '</body>';
  return html.includes(marker) ? html.replace(marker, MOBILE_PATCH + marker) : html + MOBILE_PATCH;
}

function absoluteUrl(relative) {
  return new URL(relative, self.registration.scope).href;
}

async function fetchWithRetries(request, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await fetch(request);
      if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 'unknown'}`);
      return response;
    } catch (e) {
      lastError = e;
      if (i < attempts) await new Promise(resolve => setTimeout(resolve, 600 * i));
    }
  }
  throw lastError || new Error('download failed');
}

async function sendOfflineStatus(client) {
  const cache = await caches.open(OFFLINE_CACHE);
  let count = 0;
  for (const item of OFFLINE_ASSETS) {
    if (await cache.match(absoluteUrl(item))) count++;
  }
  client?.postMessage({type:'OFFLINE_STATUS', count, total:OFFLINE_ASSETS.length, complete:count === OFFLINE_ASSETS.length});
}

async function downloadOfflineLibrary(client, force = false) {
  const cache = await caches.open(OFFLINE_CACHE);
  const total = OFFLINE_ASSETS.length;
  for (let i = 0; i < total; i++) {
    const item = OFFLINE_ASSETS[i];
    const url = absoluteUrl(item);
    const existing = await cache.match(url);
    if (!existing || force) {
      client?.postMessage({type:'OFFLINE_PROGRESS', index:i, total, item, stage:'downloading'});
      const request = new Request(url, {cache:'reload'});
      const response = await fetchWithRetries(request, 3);
      await cache.put(url, response.clone());
    }
    client?.postMessage({type:'OFFLINE_PROGRESS', index:i + 1, total, item, stage:'saved'});
  }
  // Refresh the app shell too, so the offline copy matches the current player UI.
  const shellCache = await caches.open(SHELL_CACHE);
  for (const item of SHELL) {
    try {
      const url = absoluteUrl(item);
      const response = await fetchWithRetries(new Request(url, {cache:'reload'}), 2);
      await shellCache.put(url, response.clone());
    } catch (e) {
      // The install cache already has a usable shell; don't fail the whole library for this.
    }
  }
  client?.postMessage({type:'OFFLINE_DONE', total});
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => {
      // Keep the persistent offline library across future service-worker updates.
      if (key === SHELL_CACHE || key === OFFLINE_CACHE) return Promise.resolve();
      if (key.startsWith('cg-player-shell-') || key.startsWith('cg-player-ios-')) return caches.delete(key);
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  const client = event.source;
  if (data.type === 'GET_OFFLINE_STATUS') {
    event.waitUntil(sendOfflineStatus(client));
    return;
  }
  if (data.type === 'DOWNLOAD_OFFLINE') {
    event.waitUntil(
      downloadOfflineLibrary(client, !!data.force)
        .catch(error => client?.postMessage({type:'OFFLINE_ERROR', message:String(error && error.message ? error.message : error)}))
    );
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isMainDocument = event.request.mode === 'navigate' &&
    (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));

  if (isMainDocument) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, {cache:'no-store'});
        const html = await response.text();
        return new Response(injectMobilePatch(html), {
          status: response.status,
          statusText: response.statusText,
          headers: {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'}
        });
      } catch (e) {
        const cached = await caches.match(absoluteUrl('./index.html')) || await caches.match(absoluteUrl('./'));
        if (!cached) throw e;
        const html = await cached.text();
        return new Response(injectMobilePatch(html), {headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
    })());
    return;
  }

  const isRuntimePack = /\/(assets_cg\d+|audio_\d+|backgrounds)\.js$/.test(url.pathname);
  if (isRuntimePack) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response && response.ok) {
          const cache = await caches.open(OFFLINE_CACHE);
          cache.put(event.request, response.clone()).catch(()=>{});
        }
        return response;
      } catch (e) {
        // For CG02, try the versioned offline key if an unversioned request is made.
        if (url.pathname.endsWith('/assets_cg02.js')) {
          const fallback = await caches.match(absoluteUrl('./assets_cg02.js?v=20260908-cg02fix3'));
          if (fallback) return fallback;
        }
        throw e;
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put(event.request, copy)).catch(()=>{});
        return response;
      });
    })
  );
});
