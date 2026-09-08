const CACHE_NAME = 'cg-player-ios-v4-stable-assets';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

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

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
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
        const cached = await caches.match('./index.html');
        if (!cached) throw e;
        const html = await cached.text();
        return new Response(injectMobilePatch(html), {
          headers: {'Content-Type':'text/html; charset=utf-8'}
        });
      }
    })());
    return;
  }

  // Large CG/audio/background data packs should use the browser's normal HTTP
  // cache. Forcing cache:no-store on every request made iOS/4G downloads much
  // less reliable and unnecessarily re-downloaded 10-20 MB files.
  const isRuntimePack = /\/(assets_cg\d+|audio_\d+|backgrounds)\.js$/.test(url.pathname);
  if (isRuntimePack) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (!resp || resp.status !== 200) return resp;
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
        return resp;
      });
    })
  );
});
