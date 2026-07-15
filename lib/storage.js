// lib/storage.js — 统一的 chrome.storage.local 数据访问层
// 兼容不在扩展环境时（如页面里跑测试）自动 fallback 到 localStorage

const KEYS = {
  SETTINGS: 'lsk_settings_v1',
  CURRENT_TASK: 'lsk_current_task_v1',
  HISTORY: 'lsk_history_v1',
  STATS: 'lsk_stats_v1', // for v2: 总步数、养料、宠物状态
};

const DEFAULTS = {
  [KEYS.SETTINGS]: {
    llm: {
      enabled: false,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
    },
    theme: 'lazy-sheep',
    soundEnabled: true,
    // 拆解口味
    stepGranularity: 'micro', // micro | normal
  },
  [KEYS.CURRENT_TASK]: null,
  [KEYS.HISTORY]: [],
  [KEYS.STATS]: {
    totalTasksCompleted: 0,
    totalStepsCompleted: 0,
    foodStock: 0,      // v2 养料
    petLevel: 1,       // v2 宠物等级
    petExp: 0,         // v2 宠物经验
    lastActiveAt: 0,
  },
};

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}

async function rawGet(key) {
  if (hasChromeStorage()) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (res) => resolve(res[key]));
    });
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

async function rawSet(key, value) {
  if (hasChromeStorage()) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  }
  localStorage.setItem(key, JSON.stringify(value));
}

export const Storage = {
  KEYS,

  async getSettings() {
    const v = await rawGet(KEYS.SETTINGS);
    return { ...DEFAULTS[KEYS.SETTINGS], ...(v || {}) };
  },
  async setSettings(settings) {
    const merged = { ...(await this.getSettings()), ...settings };
    await rawSet(KEYS.SETTINGS, merged);
    return merged;
  },

  async getCurrentTask() {
    const v = await rawGet(KEYS.CURRENT_TASK);
    return v || null;
  },
  async setCurrentTask(task) {
    await rawSet(KEYS.CURRENT_TASK, task);
    return task;
  },
  async clearCurrentTask() {
    await rawSet(KEYS.CURRENT_TASK, null);
  },

  async getHistory() {
    return (await rawGet(KEYS.HISTORY)) || [];
  },
  async pushHistory(record) {
    const list = await this.getHistory();
    list.unshift(record);
    // 只保留最近 50 条
    await rawSet(KEYS.HISTORY, list.slice(0, 50));
  },

  async getStats() {
    const v = await rawGet(KEYS.STATS);
    return { ...DEFAULTS[KEYS.STATS], ...(v || {}) };
  },
  async updateStats(patch) {
    const cur = await this.getStats();
    const next = { ...cur, ...patch, lastActiveAt: Date.now() };
    await rawSet(KEYS.STATS, next);
    return next;
  },
  async addStepCompleted(count = 1) {
    const s = await this.getStats();
    const stepsAdd = count;
    // v2 奖励：每完成一步 +2 养料, +5 经验；每 20 经验升 1 级
    const foodAdd = stepsAdd * 2;
    const expAdd = stepsAdd * 5;
    let petLevel = s.petLevel;
    let petExp = s.petExp + expAdd;
    while (petExp >= petLevel * 20) {
      petExp -= petLevel * 20;
      petLevel += 1;
    }
    return this.updateStats({
      totalStepsCompleted: s.totalStepsCompleted + stepsAdd,
      foodStock: s.foodStock + foodAdd,
      petLevel,
      petExp,
    });
  },
  async addTaskCompleted() {
    const s = await this.getStats();
    return this.updateStats({
      totalTasksCompleted: s.totalTasksCompleted + 1,
    });
  },
};

export default Storage;
