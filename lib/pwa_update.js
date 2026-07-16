// lib/pwa_update.js — v0.5.2
// 检测 Service Worker 有新版本并弹出「刷新拿最新」横幅。
// 只在 Web / PWA 环境启用，扩展 popup 内跳过。

/**
 * 判断当前是否为 Chrome/Edge 扩展 popup 上下文。
 * 只有 web / PWA 环境才会安装 SW 更新监听。
 * @returns {boolean}
 */
export function isExtensionPopup(win = globalThis) {
  try {
    return !!(win?.chrome?.runtime?.id) && win?.location?.protocol === 'chrome-extension:';
  } catch {
    return false;
  }
}

/**
 * 从一个 ServiceWorkerRegistration 中挑出「刚 installed 且非 active」的 waiting worker。
 * @param {ServiceWorkerRegistration|null|undefined} reg
 * @returns {boolean}
 */
export function hasWaitingUpdate(reg) {
  if (!reg) return false;
  if (reg.waiting && reg.waiting.state === 'installed') return true;
  const installing = reg.installing;
  if (installing && installing.state === 'installed') return true;
  return false;
}

/**
 * 创建一条 iOS 原生风的 top banner DOM，指向 `onReload`。
 * 幂等：文档已有 `.pwa-update-banner` 时直接返回旧节点。
 * @param {Document} doc
 * @param {() => void} onReload
 * @returns {HTMLElement}
 */
export function createUpdateBanner(doc, onReload) {
  const existing = doc.querySelector('.pwa-update-banner');
  if (existing) return existing;

  const el = doc.createElement('div');
  el.className = 'pwa-update-banner';
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', '发现新版本，点击刷新');
  el.textContent = '🔄 发现新版本 · 点这里刷新';

  const trigger = () => {
    try { onReload?.(); } catch {}
  };
  el.addEventListener('click', trigger);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      trigger();
    }
  });

  doc.body.appendChild(el);
  // Trigger CSS transition on next frame.
  setTimeout(() => el.classList.add('show'), 20);
  return el;
}

/**
 * 挂载 SW 更新监听：
 *   1. `updatefound` → `installing.onstatechange === 'installed'` 且 `controller` 已存在 → 有新版本
 *   2. `navigator.serviceWorker.controllerchange` → 已切换到新 SW → 也提示一下
 * 返回一个 cleanup 函数。
 * @param {object} opts
 * @param {Navigator} [opts.nav=navigator]
 * @param {Document} [opts.doc=document]
 * @param {() => void} [opts.onReload=() => location.reload()]
 * @param {(reg: ServiceWorkerRegistration) => void} [opts.onUpdateAvailable]
 * @returns {() => void}
 */
export function installSWUpdateWatcher(opts = {}) {
  const {
    nav = typeof navigator !== 'undefined' ? navigator : null,
    win = typeof window !== 'undefined' ? window : null,
    doc = typeof document !== 'undefined' ? document : null,
    onReload = () => { try { win?.location?.reload(); } catch {} },
    onUpdateAvailable,
  } = opts;

  if (!nav || !nav.serviceWorker || !doc) return () => {};
  if (isExtensionPopup(win)) return () => {};

  let shown = false;
  const show = (reg) => {
    if (shown) return;
    shown = true;
    if (typeof onUpdateAvailable === 'function') {
      try { onUpdateAvailable(reg); } catch {}
    } else {
      createUpdateBanner(doc, onReload);
    }
  };

  const handleReg = (reg) => {
    if (!reg) return;
    if (hasWaitingUpdate(reg)) show(reg);
    try {
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && nav.serviceWorker.controller) {
            show(reg);
          }
        });
      });
    } catch {}
  };

  const readyPromise = nav.serviceWorker.getRegistration
    ? nav.serviceWorker.getRegistration().catch(() => null)
    : Promise.resolve(null);
  readyPromise.then((reg) => handleReg(reg));

  const onControllerChange = () => show(null);
  try {
    nav.serviceWorker.addEventListener('controllerchange', onControllerChange);
  } catch {}

  return () => {
    try {
      nav.serviceWorker.removeEventListener?.('controllerchange', onControllerChange);
    } catch {}
  };
}
