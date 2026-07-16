// tests/layout.test.mjs — v0.5.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeBreakpoint, layoutVisibility } from '../lib/layout.js';

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
