// tests/layout.test.mjs — v0.5.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeBreakpoint, layoutVisibility, contentBottomPadding, floatingCtaBottom } from '../lib/layout.js';

describe('computeBreakpoint', () => {
  it('returns phone for width < 640', () => {
    assert.equal(computeBreakpoint(0), 'phone');
    assert.equal(computeBreakpoint(375), 'phone');
    assert.equal(computeBreakpoint(639), 'phone');
  });

  it('returns tablet for width 640-1023', () => {
    assert.equal(computeBreakpoint(640), 'tablet');
    assert.equal(computeBreakpoint(768), 'tablet');
    assert.equal(computeBreakpoint(1023), 'tablet');
  });

  it('returns desktop for width >= 1024', () => {
    assert.equal(computeBreakpoint(1024), 'desktop');
    assert.equal(computeBreakpoint(1280), 'desktop');
    assert.equal(computeBreakpoint(1920), 'desktop');
  });

  it('returns phone for invalid inputs', () => {
    assert.equal(computeBreakpoint(-1), 'phone');
    assert.equal(computeBreakpoint(NaN), 'phone');
    assert.equal(computeBreakpoint(undefined), 'phone');
    assert.equal(computeBreakpoint('abc'), 'phone');
  });
});

describe('layoutVisibility', () => {
  it('phone: tabbar shown, sidebar/panel hidden', () => {
    const v = layoutVisibility('phone');
    assert.equal(v.tabbar, true);
    assert.equal(v.sidebar, false);
    assert.equal(v.rightPanel, false);
    assert.equal(v.iconRail, false);
    assert.equal(v.topbarQuickActions, true);
  });

  it('tablet: sidebar shown, tabbar hidden', () => {
    const v = layoutVisibility('tablet');
    assert.equal(v.sidebar, true);
    assert.equal(v.tabbar, false);
    assert.equal(v.topbarQuickActions, false);
    assert.equal(v.rightPanel, false);
  });

  it('desktop 3pane: sidebar + right panel', () => {
    const v = layoutVisibility('desktop', '3pane');
    assert.equal(v.sidebar, true);
    assert.equal(v.rightPanel, true);
    assert.equal(v.iconRail, false);
    assert.equal(v.tabbar, false);
  });

  it('desktop centered: icon rail only', () => {
    const v = layoutVisibility('desktop', 'centered');
    assert.equal(v.iconRail, true);
    assert.equal(v.sidebar, false);
    assert.equal(v.rightPanel, false);
    assert.equal(v.tabbar, false);
  });
});

describe('contentBottomPadding (v0.7.0 手机端底部安全区)', () => {
  it('phone: 含 tab bar 高度 + safe-area-inset-bottom', () => {
    const p = contentBottomPadding('phone');
    assert.match(p, /var\(--tabbar-h\)/);
    assert.match(p, /env\(safe-area-inset-bottom\)/);
  });

  it('tablet / desktop: 普通留白，不含 tab bar / safe-area', () => {
    for (const bp of ['tablet', 'desktop']) {
      const p = contentBottomPadding(bp);
      assert.doesNotMatch(p, /var\(--tabbar-h\)/);
      assert.doesNotMatch(p, /safe-area-inset-bottom/);
    }
  });
});

describe('floatingCtaBottom (v0.7.0 底部悬浮 CTA)', () => {
  it('phone: 避开 tab bar + safe-area', () => {
    const b = floatingCtaBottom('phone');
    assert.match(b, /var\(--tabbar-h\)/);
    assert.match(b, /env\(safe-area-inset-bottom\)/);
  });

  it('tablet / desktop: 贴底即可', () => {
    assert.equal(floatingCtaBottom('tablet'), '16px');
    assert.equal(floatingCtaBottom('desktop'), '16px');
  });
});
