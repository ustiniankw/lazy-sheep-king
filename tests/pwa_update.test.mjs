// tests/pwa_update.test.mjs — v0.5.2
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExtensionPopup,
  hasWaitingUpdate,
  createUpdateBanner,
  installSWUpdateWatcher,
} from '../lib/pwa_update.js';

// ---------- Minimal DOM stubs ----------
function makeStubElement(tag = 'div') {
  const listeners = new Map();
  const attrs = new Map();
  const classSet = new Set();
  const el = {
    tagName: tag.toUpperCase(),
    _className: '',
    classList: {
      add(x) { classSet.add(x); syncClassName(); },
      remove(x) { classSet.delete(x); syncClassName(); },
      contains(x) { return classSet.has(x); },
    },
    textContent: '',
    children: [],
    parent: null,
    setAttribute(k, v) { attrs.set(k, v); },
    getAttribute(k) { return attrs.get(k); },
    appendChild(child) { child.parent = el; el.children.push(child); return child; },
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    removeEventListener(name, fn) {
      const arr = listeners.get(name) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchEvent(evt) {
      const arr = listeners.get(evt.type) || [];
      arr.forEach((fn) => fn(evt));
    },
    _listeners: listeners,
  };
  function syncClassName() { el._className = [...classSet].join(' '); }
  Object.defineProperty(el, 'className', {
    get() { return el._className; },
    set(v) {
      el._className = String(v || '');
      classSet.clear();
      el._className.split(/\s+/).filter(Boolean).forEach((x) => classSet.add(x));
    },
  });
  return el;
}

function makeStubDoc() {
  const body = makeStubElement('body');
  const doc = {
    body,
    _stash: [],
    createElement(tag) { const el = makeStubElement(tag); return el; },
    querySelector(sel) {
      // Very naive: match by className substring
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        return body.children.find((c) => {
          const cn = String(c.className || '');
          const parts = cn.split(/\s+/);
          return parts.includes(cls) || c.classList.contains(cls);
        }) || null;
      }
      return null;
    },
  };
  return doc;
}

function makeStubSW() {
  const listeners = new Map();
  const sw = {
    controller: null,
    _regs: [],
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    removeEventListener(name, fn) {
      const arr = listeners.get(name) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    fire(name, evt = {}) {
      (listeners.get(name) || []).forEach((fn) => fn(evt));
    },
    getRegistration() { return Promise.resolve(sw._regs[0] || null); },
  };
  return sw;
}

function makeRegistration(initial = {}) {
  const listeners = new Map();
  const reg = {
    installing: initial.installing || null,
    waiting: initial.waiting || null,
    active: initial.active || null,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    fire(name, evt = {}) {
      (listeners.get(name) || []).forEach((fn) => fn(evt));
    },
  };
  return reg;
}

function makeWorker(state = 'installing') {
  const listeners = new Map();
  const w = {
    state,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    fire(name, evt = {}) {
      (listeners.get(name) || []).forEach((fn) => fn(evt));
    },
    setState(next) { this.state = next; this.fire('statechange', { target: this }); },
  };
  return w;
}

// ---------- isExtensionPopup ----------
describe('isExtensionPopup', () => {
  it('returns false for a plain web env', () => {
    assert.equal(isExtensionPopup({}), false);
    assert.equal(isExtensionPopup({ location: { protocol: 'https:' } }), false);
  });
  it('returns true only when both chrome.runtime.id and chrome-extension protocol are present', () => {
    const win = {
      chrome: { runtime: { id: 'abcdef' } },
      location: { protocol: 'chrome-extension:' },
    };
    assert.equal(isExtensionPopup(win), true);
  });
  it('returns false when protocol is http even if chrome.runtime.id exists (PWA on http)', () => {
    const win = {
      chrome: { runtime: { id: 'abcdef' } },
      location: { protocol: 'https:' },
    };
    assert.equal(isExtensionPopup(win), false);
  });
});

// ---------- hasWaitingUpdate ----------
describe('hasWaitingUpdate', () => {
  it('returns false for null / empty registration', () => {
    assert.equal(hasWaitingUpdate(null), false);
    assert.equal(hasWaitingUpdate({}), false);
  });
  it('returns true when registration has a waiting worker in installed state', () => {
    assert.equal(hasWaitingUpdate({ waiting: { state: 'installed' } }), true);
  });
  it('returns true when the installing worker just reached installed state', () => {
    assert.equal(hasWaitingUpdate({ installing: { state: 'installed' } }), true);
  });
  it('returns false when installing is still in progress', () => {
    assert.equal(hasWaitingUpdate({ installing: { state: 'installing' } }), false);
  });
});

// ---------- createUpdateBanner ----------
describe('createUpdateBanner', () => {
  it('creates a single .pwa-update-banner and is idempotent', () => {
    const doc = makeStubDoc();
    const a = createUpdateBanner(doc, () => {});
    const b = createUpdateBanner(doc, () => {});
    assert.equal(a, b, 'second call returns the same node');
    assert.equal(doc.body.children.length, 1);
    assert.ok(a.classList.contains('pwa-update-banner'));
    assert.match(a.textContent, /发现新版本/);
  });

  it('click event fires the provided onReload callback', () => {
    const doc = makeStubDoc();
    let clicked = 0;
    const banner = createUpdateBanner(doc, () => { clicked += 1; });
    banner.dispatchEvent({ type: 'click' });
    banner.dispatchEvent({ type: 'click' });
    assert.equal(clicked, 2);
  });

  it('keyboard Enter also triggers reload', () => {
    const doc = makeStubDoc();
    let clicked = 0;
    const banner = createUpdateBanner(doc, () => { clicked += 1; });
    banner.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    assert.equal(clicked, 1);
  });
});

// ---------- installSWUpdateWatcher ----------
describe('installSWUpdateWatcher', () => {
  it('is a no-op in an extension popup context', () => {
    const doc = makeStubDoc();
    const sw = makeStubSW();
    const cleanup = installSWUpdateWatcher({
      nav: { serviceWorker: sw },
      doc,
      win: { chrome: { runtime: { id: 'ext' } }, location: { protocol: 'chrome-extension:' } },
      onReload: () => {},
    });
    // Firing anything should not create a banner
    sw.fire('controllerchange');
    assert.equal(doc.body.children.length, 0);
    cleanup();
  });

  it('is a no-op when navigator or serviceWorker is missing', () => {
    const doc = makeStubDoc();
    const cleanup = installSWUpdateWatcher({ nav: null, doc, win: {} });
    assert.equal(typeof cleanup, 'function');
    cleanup();
  });

  it('creates the banner when updatefound → installing → installed while a controller exists', async () => {
    const doc = makeStubDoc();
    const sw = makeStubSW();
    const installing = makeWorker('installing');
    const reg = makeRegistration({ installing });
    sw._regs.push(reg);
    sw.controller = { scriptURL: 'https://x/service-worker.js' };

    installSWUpdateWatcher({
      nav: { serviceWorker: sw },
      doc,
      win: { location: { protocol: 'https:' } },
      onReload: () => {},
    });
    // Let getRegistration() promise resolve.
    await Promise.resolve();
    await Promise.resolve();

    reg.fire('updatefound');
    installing.setState('installed');

    assert.equal(doc.body.children.length, 1);
    assert.ok(doc.body.children[0].classList.contains('pwa-update-banner'));
  });

  it('creates the banner immediately when there is already a waiting worker', async () => {
    const doc = makeStubDoc();
    const sw = makeStubSW();
    const reg = makeRegistration({ waiting: { state: 'installed' } });
    sw._regs.push(reg);

    installSWUpdateWatcher({
      nav: { serviceWorker: sw },
      doc,
      win: { location: { protocol: 'https:' } },
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(doc.body.children.length, 1);
  });

  it('controllerchange event also shows the banner', async () => {
    const doc = makeStubDoc();
    const sw = makeStubSW();
    sw._regs.push(makeRegistration());
    installSWUpdateWatcher({
      nav: { serviceWorker: sw },
      doc,
      win: { location: { protocol: 'https:' } },
    });
    await Promise.resolve();
    sw.fire('controllerchange');
    assert.equal(doc.body.children.length, 1);
  });

  it('never shows twice even if multiple triggers fire', async () => {
    const doc = makeStubDoc();
    const sw = makeStubSW();
    const reg = makeRegistration({ waiting: { state: 'installed' } });
    sw._regs.push(reg);
    installSWUpdateWatcher({
      nav: { serviceWorker: sw },
      doc,
      win: { location: { protocol: 'https:' } },
    });
    await Promise.resolve();
    sw.fire('controllerchange');
    sw.fire('controllerchange');
    assert.equal(doc.body.children.length, 1);
  });

  it('calls onUpdateAvailable instead of creating a banner when provided', async () => {
    const doc = makeStubDoc();
    const sw = makeStubSW();
    sw._regs.push(makeRegistration({ waiting: { state: 'installed' } }));
    let called = 0;
    installSWUpdateWatcher({
      nav: { serviceWorker: sw },
      doc,
      win: { location: { protocol: 'https:' } },
      onUpdateAvailable: () => { called += 1; },
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(called, 1);
    assert.equal(doc.body.children.length, 0);
  });
});
