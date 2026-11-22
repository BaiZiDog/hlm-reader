/* 红楼梦阅读器 PWA Service Worker：离线缓存界面与本地书源。 */
'use strict';

const CACHE = 'hlm-reader-v2';
const CORE = [
  './',
  './index.html',
  './style.css',
  './ai.css',
  './mobile.css',
  './platform.js',
  './data-import.js',
  './mobile-ai.js',
  './app.js',
  './ai.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon.png',
  './ofm-catalog-seed.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        // 公开仓库或本地开发时可能没有 data.js；核心资源缺失也不应让安装失败。
        console.warn('缓存失败:', url, err);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isBookData(url) {
  return /\/data\.js$/.test(url.pathname) || /\/book\.json$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // AI API 请求不缓存

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  if (isBookData(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      const network = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      }).catch(() => null);
      return cached || (await network) || new Response('', { status: 404 });
    })());
    return;
  }

  const code = /\.(?:js|css|html|webmanifest)$/.test(url.pathname);
  if (code) {
    // 代码资源网络优先，保证更新后下一次打开能拿到新版本；离线时回退缓存。
    event.respondWith((async () => {
      const cached = await caches.match(request);
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});
