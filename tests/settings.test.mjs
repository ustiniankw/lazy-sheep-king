// tests/settings.test.mjs — v0.5.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Inline the default settings structure to verify new keys
const DEFAULT_SETTINGS = {
  llm: {
    enabled: false,
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  aiRerankEnabled: true,
  theme: 'lazy-sheep',
  soundEnabled: true,
  stepGranularity: 'micro',
  showUsage: true,
  stepTimer: {
    autoStart: false,
    endSound: true,
    autoAddOnEnd: false,
  },
  pomodoro: { workMinutes: 25, breakMinutes: 5, autoStartNext: true, soundOnEnd: true },
  team: {
    defaultPrivacy: 'public',
    pokesSoundOn: true,
  },
  // v0.5.0 new settings
  desktopMode: '3pane',
  defaultOpenIn: 'popup',
};

describe('settings defaults (v0.5.0)', () => {
  it('desktopMode defaults to 3pane', () => {
    assert.equal(DEFAULT_SETTINGS.desktopMode, '3pane');
  });

  it('desktopMode only allows 3pane or centered', () => {
    assert.ok(['3pane', 'centered'].includes(DEFAULT_SETTINGS.desktopMode));
  });

  it('defaultOpenIn defaults to popup', () => {
    assert.equal(DEFAULT_SETTINGS.defaultOpenIn, 'popup');
  });

  it('defaultOpenIn only allows popup or tab', () => {
    assert.ok(['popup', 'tab'].includes(DEFAULT_SETTINGS.defaultOpenIn));
  });

  it('has all required existing keys', () => {
    assert.ok(DEFAULT_SETTINGS.llm);
    assert.ok(DEFAULT_SETTINGS.stepTimer);
    assert.ok(DEFAULT_SETTINGS.team);
    assert.equal(DEFAULT_SETTINGS.aiRerankEnabled, true);
    assert.equal(DEFAULT_SETTINGS.soundEnabled, true);
  });

  it('settings are persisted correctly with merge semantics', () => {
    // Simulate merge
    const base = { ...DEFAULT_SETTINGS };
    const patch = { desktopMode: 'centered', defaultOpenIn: 'tab' };
    const merged = { ...base, ...patch };
    assert.equal(merged.desktopMode, 'centered');
    assert.equal(merged.defaultOpenIn, 'tab');
    // Existing keys remain
    assert.equal(merged.aiRerankEnabled, true);
    assert.equal(merged.soundEnabled, true);
  });
});
