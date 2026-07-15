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
    // v0.3.1 · 步骤倒计时（替代 v0.3.0 的番茄钟）
    stepTimer: {
      autoStart: false,          // 进入某一步是否自动开始倒计时
      endSound: true,            // 时间到时提示音
      autoAddOnEnd: false,       // 时间到后自动 +1 分钟继续
    },
    // 兼容 v0.3.0 保留字段（不再使用，等 v0.4 迁移完成后删除）
    pomodoro: { workMinutes: 25, breakMinutes: 5, autoStartNext: true, soundOnEnd: true },
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
    // v0.3.2 · 每日打卡日志：{ 'YYYY-MM-DD': { steps, tasks, food } }
    dailyLog: {},
  },
};

// v0.3.2 · 本地日期 key（供 dailyLog 打卡用）
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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
    merged.stepTimer = { ...DEFAULTS[KEYS.SETTINGS].stepTimer, ...(v?.stepTimer || {}) };
    return merged;
  },
  async setSettings(settings) {
    const cur = await this.getSettings();
    const merged = { ...cur, ...settings };
    merged.llm = { ...cur.llm, ...(settings.llm || {}) };
    merged.pomodoro = { ...cur.pomodoro, ...(settings.pomodoro || {}) };
    merged.stepTimer = { ...cur.stepTimer, ...(settings.stepTimer || {}) };
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
  // v0.3.2 · 把当天的 steps/tasks/food 累加进 stats.dailyLog[today]
  async bumpDaily(patch = {}) {
    const s = await this.getStats();
    const log = { ...(s.dailyLog || {}) };
    const key = todayKey();
    const cur = { steps: 0, tasks: 0, food: 0, ...(log[key] || {}) };
    cur.steps += Math.max(0, Math.round(patch.steps || 0));
    cur.tasks += Math.max(0, Math.round(patch.tasks || 0));
    cur.food += Math.max(0, Math.round(patch.food || 0));
    log[key] = cur;
    return this.updateStats({ dailyLog: log });
  },
  async addStepCompleted(arg = {}) {
    // 兼容两种签名：
    //   addStepCompleted(1)              // 旧：+2*n 养料 / +5*n 经验
    //   addStepCompleted({food, exp})    // v0.3.1：显式指定
    let foodAdd, expAdd;
    if (typeof arg === 'number') {
      const count = arg || 1;
      foodAdd = count * 2; expAdd = count * 5;
    } else {
      foodAdd = Math.max(0, Math.round(arg.food ?? 2));
      expAdd = Math.max(0, Math.round(arg.exp ?? 5));
    }
    const s = await this.getStats();
    let petLevel = s.petLevel, petExp = s.petExp + expAdd;
    while (petExp >= petLevel * 20) { petExp -= petLevel * 20; petLevel += 1; }
    const next = await this.updateStats({ totalStepsCompleted: s.totalStepsCompleted + 1, foodStock: s.foodStock + foodAdd, petLevel, petExp });
    await this.bumpDaily({ steps: 1, food: foodAdd });
    return next;
  },
  async addTaskCompleted(bonus = {}) {
    const foodAdd = Math.max(0, Math.round(bonus.food || 0));
    const expAdd = Math.max(0, Math.round(bonus.exp || 0));
    const s = await this.getStats();
    let petLevel = s.petLevel, petExp = s.petExp + expAdd;
    while (petExp >= petLevel * 20) { petExp -= petLevel * 20; petLevel += 1; }
    const next = await this.updateStats({ totalTasksCompleted: s.totalTasksCompleted + 1, foodStock: s.foodStock + foodAdd, petLevel, petExp });
    await this.bumpDaily({ tasks: 1, food: foodAdd });
    return next;
  },
};

export default Storage;
