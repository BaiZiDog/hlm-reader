/* 平台探测、PWA 注册与移动端公共状态。 */
'use strict';

(() => {
  const mobile = Boolean(window.__HLM_MOBILE__);
  const root = document.documentElement;

  if (mobile) root.classList.add('platform-mobile');
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    root.classList.add('platform-touch');
  }

  if (mobile) {
    const search = document.getElementById('search-input');
    if (search) search.placeholder = '搜索全文…';
  }

  function updateViewportClass() {
    const narrow = window.innerWidth <= 900;
    const tablet = window.innerWidth > 900 && window.innerWidth <= 1180;
    root.classList.toggle('layout-narrow', narrow);
    root.classList.toggle('layout-tablet', tablet);
    root.classList.toggle('layout-desktop', !narrow && !tablet);
  }
  updateViewportClass();
  window.addEventListener('resize', updateViewportClass, { passive: true });

  // 键盘弹出时把可见视口高度写进 CSS，避免底部输入框被遮住。
  const viewport = window.visualViewport;
  if (viewport) {
    const sync = () => {
      root.style.setProperty('--vvh', `${Math.round(viewport.height)}px`);
      root.style.setProperty('--vv-top', `${Math.round(viewport.offsetTop)}px`);
    };
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
  }

  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    root.classList.add('pwa-installable');
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    root.classList.remove('pwa-installable');
  });
  window.HLM_PWA = {
    canInstall: () => Boolean(installEvent),
    promptInstall: async () => {
      if (!installEvent) return false;
      const event = installEvent;
      installEvent = null;
      event.prompt();
      try {
        const choice = await event.userChoice;
        return choice && choice.outcome === 'accepted';
      } catch {
        return false;
      }
    },
  };

  const ua = navigator.userAgent || '';
  const webview = /; wv\)/i.test(ua) || /Capacitor/i.test(ua);
  const nativeShell = Boolean(
    window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform(),
  ) || (webview && /localhost|127\.0\.0\.1/i.test(window.location.hostname));
  if (nativeShell) root.classList.add('platform-native');

  // APK 内的资源随安装包更新，交给 Capacitor 管理；不要在本地壳里用 Service Worker
  // 缓存旧页面，否则升级 APK 后可能仍打开上一版。
  if (!nativeShell && 'serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('Service Worker 注册失败:', err);
      });
    });
  }
})();
