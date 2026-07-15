// lib/storage.js — 数据层（v1: 新增 providerId, showUsage, 步骤编辑相关辅助）
const KEYS = {
  SETTINGS: 'lsk_settings_v1',
  CURRENT_TASK: 'lsk_current_task_v1',
  HISTORY: 'lsk_history_v1',
  STATS: 'lsk_stats_v1',
};

const DEFAULTS = {
  [KEYS.SETTINGS]: {
    llm: {
      enabled: false,
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
    },
    theme: 'lazy-sheep',
    soundEnabled: true,
    stepGranularity: 'micro',
    showUsage: true,
  },
  [KEYS.CURRENT_TASK]: null,
  [KEYS.HISTORY]: [],
  [KEYS.STATS]: {
    totalTasksCompleted: 0,
    totalStepsCompleted: 0,
    foodStock: 0,
    petLevel: 1,
    petExp: 0,
    lastActiveAt: 0,
  },
};

function hasChromeStorage() { return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local; }
async function rawGet(key) {
  if (hasChromeStorage()) return new Promise((r) => chrome.storage.local.get([key], (res) => r(res[key])));
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : undefined; } catch { return undefined; }
}
async function rawSet(key, value) {
  if (hasChromeStorage()) return new Promise((r) => chrome.storage.local.set({ [key]: value }, () => r()));
  localStorage.setItem(key, JSON.stringify(value));
}

export const Storage = {
  KEYS,
  async getSettings() {
    const v = await rawGet(KEYS.SETTINGS);
    const merged = { ...DEFAULTS[KEYS.SETTINGS], ...(v || {}) };
    merged.llm = { ...DEFAULTS[KEYS.SETTINGS].llm, ...(v?.llm || {}) };
    return merged;
  },
  async setSettings(settings) {
    const cur = await this.getSettings();
    const merged = { ...cur, ...settings };
    merged.llm = { ...cur.llm, ...(settings.llm || {}) };
    await rawSet(KEYS.SETTINGS, merged);
    return merged;
  },
  async getCurrentTask() { return (await rawGet(KEYS.CURRENT_TASK)) || null; },
  async setCurrentTask(task) { await rawSet(KEYS.CURRENT_TASK, task); return task; },
  async clearCurrentTask() { await rawSet(KEYS.CURRENT_TASK, null); },
  async getHistory() { return (await rawGet(KEYS.HISTORY)) || []; },
  async pushHistory(record) {
    const list = await this.getHistory();
    list.unshift(record);
    await rawSet(KEYS.HISTORY, list.slice(0, 50));
  },
  async getStats() { return { ...DEFAULTS[KEYS.STATS], ...((await rawGet(KEYS.STATS)) || {}) }; },
  async updateStats(patch) {
    const cur = await this.getStats();
    const next = { ...cur, ...patch, lastActiveAt: Date.now() };
    await rawSet(KEYS.STATS, next);
    return next;
  },
  async addStepCompleted(count = 1) {
    const s = await this.getStats();
    const foodAdd = count * 2, expAdd = count * 5;
    let petLevel = s.petLevel, petExp = s.petExp + expAdd;
    while (petExp >= petLevel * 20) { petExp -= petLevel * 20; petLevel += 1; }
    return this.updateStats({ totalStepsCompleted: s.totalStepsCompleted + count, foodStock: s.foodStock + foodAdd, petLevel, petExp });
  },
  async addTaskCompleted() {
    const s = await this.getStats();
    return this.updateStats({ totalTasksCompleted: s.totalTasksCompleted + 1 });
  },
};

export default Storage;
