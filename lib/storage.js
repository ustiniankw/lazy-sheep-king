// lib/storage.js — v0.3.0: 多任务并存 + 番茄钟设置
const KEYS = {
  SETTINGS: 'lsk_settings_v1',
  CURRENT_TASK: 'lsk_current_task_v1',   // 兼容 v0.2 · 迁移用
  TASKS: 'lsk_tasks_v1',                 // v0.3.0 · 多任务
  ACTIVE_ID: 'lsk_active_task_id_v1',    // v0.3.0 · 当前聚焦的任务 id
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
    // v0.3.0 · 番茄钟
    pomodoro: {
      workMinutes: 25,
      breakMinutes: 5,
      autoStartNext: true,
      soundOnEnd: true,
    },
  },
  [KEYS.CURRENT_TASK]: null,
  [KEYS.TASKS]: [],
  [KEYS.ACTIVE_ID]: null,
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

// v0.2 → v0.3 数据迁移：把 lsk_current_task_v1 挪进 lsk_tasks_v1
async function migrateIfNeeded() {
  const tasks = await rawGet(KEYS.TASKS);
  if (Array.isArray(tasks)) return; // 已迁移
  const legacy = await rawGet(KEYS.CURRENT_TASK);
  const list = [];
  if (legacy && Array.isArray(legacy.steps)) list.push(legacy);
  await rawSet(KEYS.TASKS, list);
  if (legacy && legacy.id) await rawSet(KEYS.ACTIVE_ID, legacy.id);
}

export const Storage = {
  KEYS,
  async getSettings() {
    const v = await rawGet(KEYS.SETTINGS);
    const merged = { ...DEFAULTS[KEYS.SETTINGS], ...(v || {}) };
    merged.llm = { ...DEFAULTS[KEYS.SETTINGS].llm, ...(v?.llm || {}) };
    merged.pomodoro = { ...DEFAULTS[KEYS.SETTINGS].pomodoro, ...(v?.pomodoro || {}) };
    return merged;
  },
  async setSettings(settings) {
    const cur = await this.getSettings();
    const merged = { ...cur, ...settings };
    merged.llm = { ...cur.llm, ...(settings.llm || {}) };
    merged.pomodoro = { ...cur.pomodoro, ...(settings.pomodoro || {}) };
    await rawSet(KEYS.SETTINGS, merged);
    return merged;
  },

  // ---- v0.3.0 · 多任务 API ----
  async getTasks() { await migrateIfNeeded(); return (await rawGet(KEYS.TASKS)) || []; },
  async setTasks(list) { await rawSet(KEYS.TASKS, list); return list; },
  async saveTask(task) {
    const list = await this.getTasks();
    const idx = list.findIndex((t) => t.id === task.id);
    if (idx >= 0) list[idx] = task; else list.push(task);
    await this.setTasks(list);
    return task;
  },
  async deleteTask(id) {
    const list = (await this.getTasks()).filter((t) => t.id !== id);
    await this.setTasks(list);
    const active = await this.getActiveTaskId();
    if (active === id) {
      const next = list.find((t) => t.currentIndex < t.steps.length);
      await this.setActiveTaskId(next ? next.id : null);
    }
  },
  async getActiveTaskId() { await migrateIfNeeded(); return (await rawGet(KEYS.ACTIVE_ID)) || null; },
  async setActiveTaskId(id) { await rawSet(KEYS.ACTIVE_ID, id); return id; },
  async getActiveTask() {
    const id = await this.getActiveTaskId();
    if (!id) return null;
    const list = await this.getTasks();
    return list.find((t) => t.id === id) || null;
  },

  // ---- 兼容旧调用点（现在改由 tasks + activeId 实现）----
  async getCurrentTask() { return this.getActiveTask(); },
  async setCurrentTask(task) {
    if (!task) return null;
    await this.saveTask(task);
    await this.setActiveTaskId(task.id);
    return task;
  },
  async clearCurrentTask() {
    const id = await this.getActiveTaskId();
    if (id) await this.deleteTask(id);
    await this.setActiveTaskId(null);
  },

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
