// lib/storage.js — v0.3.4: 多任务 + 用户资料 + AI 精修 + 组队模式 + 备份基础
import { PRIVACY, normalizePrivacy, mergeTeamState } from './team.js';
import { DEFAULT_BACKEND_URL } from './sync_config.js';

const KEYS = {
  SETTINGS: 'lsk_settings_v1',
  CURRENT_TASK: 'lsk_current_task_v1',
  TASKS: 'lsk_tasks_v1',
  ACTIVE_ID: 'lsk_active_task_id_v1',
  HISTORY: 'lsk_history_v1',
  STATS: 'lsk_stats_v1',
  PROFILE: 'lsk_profile_v1',
  SYNC_ENABLED: 'lsk_sync_enabled_v1',
  RECENT_BREAKDOWNS: 'lsk_recent_breakdowns_v1',
  TEAM_SELF: 'lsk_team_self_v1',
  TEAM_STATE: 'lsk_team_state_v1',
  DEBUG_LOG: 'lsk_debug_log_v1',
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
      defaultPrivacy: PRIVACY.PUBLIC,
      pokesSoundOn: true,
    },
    // v0.8.2 · 云端组队默认「自动」：有官方 Worker 地址即视为开启
    cloudSyncEnabled: !!DEFAULT_BACKEND_URL,
    backendUrl: DEFAULT_BACKEND_URL || null,
    // v0.8.2 · 组队会话持久化（连到 Worker），退出/登出时清空
    teamCode: '',
    teamToken: '',
    teamMemberId: '',
    teamPokeSeenTs: 0,
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
    dailyLog: {},
  },
  [KEYS.PROFILE]: {
    userId: '',
    displayName: '',
    createdAt: 0,
    deviceLabel: 'Web',
  },
  [KEYS.SYNC_ENABLED]: false,
  [KEYS.RECENT_BREAKDOWNS]: [],
  [KEYS.TEAM_SELF]: {
    teamCode: '',
    joinedAt: 0,
    syncUrl: '',
    // v0.8.0 · 云同步（Cloudflare Worker）会话
    cloudToken: '',
    cloudMemberId: '',
  },
  [KEYS.TEAM_STATE]: {
    code: '',
    members: {},
    pokes: [],
    updatedAt: 0,
  },
  [KEYS.DEBUG_LOG]: [],
};

const SYNC_KEYS = new Set([KEYS.PROFILE, KEYS.SETTINGS, KEYS.TASKS, KEYS.STATS, KEYS.SYNC_ENABLED]);
const SYNC_MAX_BYTES = 90 * 1024;
const RECENT_BREAKDOWN_LIMIT = 40;
const DEBUG_LOG_LIMIT = 20;
// 日志中允许保留的字段白名单——绝不写入任何 apiKey / token
const DEBUG_LOG_FIELDS = ['ts', 'input', 'intent', 'source', 'latency', 'tier', 'ok', 'error'];

function sanitizeDebugEntry(entry) {
  const out = {};
  DEBUG_LOG_FIELDS.forEach((field) => {
    if (entry?.[field] === undefined) return;
    if (field === 'input') out.input = String(entry.input || '').slice(0, 120);
    else if (field === 'error') out.error = entry.error ? String(entry.error).slice(0, 200) : null;
    else out[field] = entry[field];
  });
  return out;
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hasChromeStorageLocal() {
  return typeof chrome !== 'undefined' && chrome?.storage?.local;
}

function hasChromeStorageSync() {
  return typeof chrome !== 'undefined' && chrome?.storage?.sync;
}

function sameId(a, b) {
  return String(a ?? '') === String(b ?? '');
}

function clone(v) {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v));
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isMeaningful(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return true;
}

function mergeSettingsLike(base, patch) {
  const merged = { ...base, ...(patch || {}) };
  merged.llm = { ...(base?.llm || {}), ...(patch?.llm || {}) };
  merged.pomodoro = { ...(base?.pomodoro || {}), ...(patch?.pomodoro || {}) };
  merged.stepTimer = { ...(base?.stepTimer || {}), ...(patch?.stepTimer || {}) };
  merged.team = { ...(base?.team || {}), ...(patch?.team || {}) };
  merged.team.defaultPrivacy = normalizePrivacy(merged.team.defaultPrivacy, PRIVACY.PUBLIC);
  merged.aiRerankEnabled = patch?.aiRerankEnabled ?? base?.aiRerankEnabled ?? true;
  // v0.8.0 云同步字段（v0.8.2 起默认「自动」——有官方 Worker 地址即开启）
  merged.cloudSyncEnabled = patch?.cloudSyncEnabled ?? base?.cloudSyncEnabled ?? !!DEFAULT_BACKEND_URL;
  if (patch?.backendUrl !== undefined) merged.backendUrl = patch.backendUrl;
  else if (base?.backendUrl !== undefined) merged.backendUrl = base.backendUrl;
  else merged.backendUrl = DEFAULT_BACKEND_URL || null;
  // v0.8.2 组队会话字段
  merged.teamCode = patch?.teamCode ?? base?.teamCode ?? '';
  merged.teamToken = patch?.teamToken ?? base?.teamToken ?? '';
  merged.teamMemberId = patch?.teamMemberId ?? base?.teamMemberId ?? '';
  merged.teamPokeSeenTs = patch?.teamPokeSeenTs ?? base?.teamPokeSeenTs ?? 0;
  return merged;
}

function mergeProfile(localValue, syncValue) {
  if (!isMeaningful(localValue)) return { ...DEFAULTS[KEYS.PROFILE], ...(syncValue || {}) };
  return {
    ...DEFAULTS[KEYS.PROFILE],
    ...(syncValue || {}),
    ...localValue,
    displayName: localValue?.displayName || syncValue?.displayName || '',
  };
}

function normalizeTask(task, defaultPrivacy = PRIVACY.PUBLIC) {
  if (!task || typeof task !== 'object') return task;
  const next = clone(task) || {};
  next.privacy = normalizePrivacy(next.privacy, defaultPrivacy);
  if (Array.isArray(next.steps)) {
    next.steps = next.steps.map((step) => ({ ...step }));
  }
  return next;
}

function normalizeTaskList(tasks, defaultPrivacy = PRIVACY.PUBLIC) {
  return (Array.isArray(tasks) ? tasks : []).map((task) => normalizeTask(task, defaultPrivacy));
}

function taskProgressScore(task) {
  if (!task || !Array.isArray(task.steps)) return 0;
  const done = task.steps.filter((step) => step?.done || step?.skipped).length;
  return done * 1000 + Number(task.currentIndex || 0);
}

function pickBetterTask(a, b) {
  if (!a) return b;
  if (!b) return a;
  const scoreA = taskProgressScore(a);
  const scoreB = taskProgressScore(b);
  if (scoreA !== scoreB) return scoreA > scoreB ? a : b;
  return Number(a.createdAt || 0) >= Number(b.createdAt || 0) ? a : b;
}

function mergeTasks(localTasks, syncTasks) {
  const map = new Map();
  [...(syncTasks || []), ...(localTasks || [])].forEach((task) => {
    if (!task?.id) return;
    const prev = map.get(String(task.id));
    map.set(String(task.id), clone(pickBetterTask(prev, task)));
  });
  return Array.from(map.values()).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function mergeStats(localStats, syncStats) {
  const localValue = { ...DEFAULTS[KEYS.STATS], ...(localStats || {}) };
  const syncValue = { ...DEFAULTS[KEYS.STATS], ...(syncStats || {}) };
  const localDaily = localValue.dailyLog || {};
  const syncDaily = syncValue.dailyLog || {};
  const dailyLog = {};
  new Set([...Object.keys(syncDaily), ...Object.keys(localDaily)]).forEach((date) => {
    dailyLog[date] = {
      steps: Math.max(syncDaily[date]?.steps || 0, localDaily[date]?.steps || 0),
      tasks: Math.max(syncDaily[date]?.tasks || 0, localDaily[date]?.tasks || 0),
      food: Math.max(syncDaily[date]?.food || 0, localDaily[date]?.food || 0),
    };
  });
  return {
    ...DEFAULTS[KEYS.STATS],
    ...syncValue,
    ...localValue,
    totalTasksCompleted: Math.max(syncValue.totalTasksCompleted || 0, localValue.totalTasksCompleted || 0),
    totalStepsCompleted: Math.max(syncValue.totalStepsCompleted || 0, localValue.totalStepsCompleted || 0),
    foodStock: Math.max(syncValue.foodStock || 0, localValue.foodStock || 0),
    petLevel: Math.max(syncValue.petLevel || 1, localValue.petLevel || 1),
    petExp: Math.max(syncValue.petExp || 0, localValue.petExp || 0),
    lastActiveAt: Math.max(syncValue.lastActiveAt || 0, localValue.lastActiveAt || 0),
    dailyLog,
  };
}

function mergeValueForKey(key, localValue, syncValue) {
  if (syncValue === undefined) return clone(localValue);
  if (localValue === undefined) return clone(syncValue);
  if (key === KEYS.SETTINGS) return mergeSettingsLike(mergeSettingsLike(DEFAULTS[KEYS.SETTINGS], syncValue), localValue);
  if (key === KEYS.PROFILE) return mergeProfile(localValue, syncValue);
  if (key === KEYS.TASKS) return mergeTasks(localValue, syncValue);
  if (key === KEYS.STATS) return mergeStats(localValue, syncValue);
  return clone(localValue);
}

function syncSafeValue(key, value) {
  if (key === KEYS.STATS) {
    const stats = { ...DEFAULTS[KEYS.STATS], ...(value || {}) };
    return {
      totalTasksCompleted: stats.totalTasksCompleted || 0,
      totalStepsCompleted: stats.totalStepsCompleted || 0,
      foodStock: stats.foodStock || 0,
      petLevel: stats.petLevel || 1,
      petExp: stats.petExp || 0,
      lastActiveAt: stats.lastActiveAt || 0,
    };
  }
  return value;
}

function normalizeTeamSelfValue(value) {
  const next = { ...DEFAULTS[KEYS.TEAM_SELF], ...(value || {}) };
  next.teamCode = String(next.teamCode || '').trim().toUpperCase();
  next.joinedAt = Number(next.joinedAt || 0);
  next.syncUrl = String(next.syncUrl || '').trim();
  next.cloudToken = String(next.cloudToken || '').trim();
  next.cloudMemberId = String(next.cloudMemberId || '').trim();
  return next;
}

function normalizeTeamStateValue(value, fallbackCode = '') {
  const merged = mergeTeamState(
    { ...DEFAULTS[KEYS.TEAM_STATE], code: String(fallbackCode || '').trim().toUpperCase() },
    value || {},
  );
  merged.code = String(merged.code || fallbackCode || '').trim().toUpperCase();
  merged.updatedAt = Number(merged.updatedAt || 0);
  return merged;
}

// ---------------------------------------------------------------------------
// 多账号命名空间：物理存储键 = `lsk:${accountKey}:${逻辑键}`
// 访客账号可从旧版未加前缀的键平滑迁移（不丢数据）。
// ---------------------------------------------------------------------------
const GUEST_PREFIX = 'guest:';
const ACTIVE_ACCOUNT_PKEY = 'lsk_active_account_v1';
const MIGRATED_PKEY = '_migrated_035';
const LEGACY_KEYS = new Set([
  KEYS.SETTINGS,
  KEYS.CURRENT_TASK,
  KEYS.TASKS,
  KEYS.ACTIVE_ID,
  KEYS.HISTORY,
  KEYS.STATS,
  KEYS.PROFILE,
  KEYS.SYNC_ENABLED,
  KEYS.RECENT_BREAKDOWNS,
  KEYS.TEAM_SELF,
  KEYS.TEAM_STATE,
  KEYS.DEBUG_LOG,
]);

let currentAccountKey = null;
let migrationPromise = null;

function activeAccount() {
  return currentAccountKey || `${GUEST_PREFIX}default`;
}

function isGuestAccount() {
  return activeAccount().startsWith(GUEST_PREFIX);
}

export function keyOf(name) {
  return `lsk:${activeAccount()}:${name}`;
}

async function rawGetPhysical(key) {
  if (hasChromeStorageLocal()) {
    return new Promise((resolve) => chrome.storage.local.get([key], (res) => resolve(res[key])));
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

async function rawSetPhysical(key, value) {
  if (hasChromeStorageLocal()) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, () => resolve()));
  }
  localStorage.setItem(key, JSON.stringify(value));
}

async function rawRemovePhysical(key) {
  if (hasChromeStorageLocal()) {
    return new Promise((resolve) => chrome.storage.local.remove(key, () => resolve()));
  }
  localStorage.removeItem(key);
}

async function ensureMigrated() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const cachedActive = await rawGetPhysical(ACTIVE_ACCOUNT_PKEY);
    if (cachedActive && !currentAccountKey) currentAccountKey = cachedActive;
    const migrated = await rawGetPhysical(MIGRATED_PKEY);
    if (migrated) return;
    const legacyProfile = await rawGetPhysical(KEYS.PROFILE);
    const legacyUserId = legacyProfile?.userId || '';
    if (!currentAccountKey) currentAccountKey = `${GUEST_PREFIX}${legacyUserId || 'default'}`;
    for (const name of LEGACY_KEYS) {
      const legacy = await rawGetPhysical(name);
      if (legacy === undefined) continue;
      const nsKey = `lsk:${currentAccountKey}:${name}`;
      const existing = await rawGetPhysical(nsKey);
      if (existing === undefined) await rawSetPhysical(nsKey, legacy);
    }
    await rawSetPhysical(ACTIVE_ACCOUNT_PKEY, currentAccountKey);
    await rawSetPhysical(MIGRATED_PKEY, true);
  })();
  return migrationPromise;
}

async function rawGet(name) {
  await ensureMigrated();
  const nsKey = keyOf(name);
  let value = await rawGetPhysical(nsKey);
  if (value === undefined && isGuestAccount() && LEGACY_KEYS.has(name)) {
    const legacy = await rawGetPhysical(name);
    if (legacy !== undefined) {
      await rawSetPhysical(nsKey, legacy);
      value = legacy;
    }
  }
  return value;
}

async function rawSet(name, value) {
  await ensureMigrated();
  return rawSetPhysical(keyOf(name), value);
}

async function rawRemove(name) {
  await ensureMigrated();
  return rawRemovePhysical(keyOf(name));
}

async function chromeSyncGet(name) {
  if (!hasChromeStorageSync()) return undefined;
  const key = keyOf(name);
  return new Promise((resolve) => chrome.storage.sync.get([key], (res) => resolve(res[key])));
}

async function chromeSyncSet(name, value) {
  if (!hasChromeStorageSync()) return false;
  const payload = { [keyOf(name)]: value };
  const json = JSON.stringify(payload);
  if (json.length > SYNC_MAX_BYTES) {
    console.warn('[懒羊羊大王] sync skipped: payload too large', json.length);
    return false;
  }
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.set(payload, () => {
        if (chrome.runtime?.lastError) {
          console.warn('[懒羊羊大王] sync set failed:', chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (error) {
      console.warn('[懒羊羊大王] sync unavailable:', error?.message || error);
      resolve(false);
    }
  });
}

async function maybeSyncKey(key, value) {
  if (!SYNC_KEYS.has(key)) return false;
  if (!(await Storage.getSyncEnabled())) return false;
  if (!hasChromeStorageSync()) {
    console.warn('[懒羊羊大王] 当前环境不支持 chrome.storage.sync，已退回本地存储');
    return false;
  }
  return chromeSyncSet(key, syncSafeValue(key, value));
}

async function resolveValue(key, localValue) {
  if (!SYNC_KEYS.has(key)) return localValue;
  if (!(await Storage.getSyncEnabled())) return localValue;
  const syncValue = await chromeSyncGet(key);
  if (syncValue === undefined) return localValue;
  const merged = mergeValueForKey(key, localValue, syncValue);
  const shouldPersist = JSON.stringify(merged) !== JSON.stringify(localValue);
  if (shouldPersist) await rawSet(key, merged);
  return merged;
}

async function mirrorOrHydrateSyncKey(key) {
  const localValue = await rawGet(key);
  const syncValue = await chromeSyncGet(key);
  if (!isMeaningful(localValue) && isMeaningful(syncValue)) {
    const merged = mergeValueForKey(key, localValue, syncValue);
    await rawSet(key, merged);
    return merged;
  }
  if (isMeaningful(localValue)) {
    await chromeSyncSet(key, syncSafeValue(key, localValue));
    return localValue;
  }
  return localValue;
}

async function migrateIfNeeded() {
  const tasks = await rawGet(KEYS.TASKS);
  if (!Array.isArray(tasks)) {
    const legacy = await rawGet(KEYS.CURRENT_TASK);
    const list = [];
    if (legacy && Array.isArray(legacy.steps)) list.push(legacy);
    await rawSet(KEYS.TASKS, list);
    if (legacy?.id) await rawSet(KEYS.ACTIVE_ID, legacy.id);
  }
}

export const Storage = {
  KEYS,
  keyOf,

  async ensureMigrated() {
    await ensureMigrated();
    return activeAccount();
  },

  getCurrentAccountKey() {
    return activeAccount();
  },

  async switchAccount(newAccountKey) {
    await ensureMigrated();
    currentAccountKey = String(newAccountKey || `${GUEST_PREFIX}default`);
    await rawSetPhysical(ACTIVE_ACCOUNT_PKEY, currentAccountKey);
    return currentAccountKey;
  },

  async copyAccountData(fromAccountKey, toAccountKey, { overwrite = false } = {}) {
    if (!fromAccountKey || !toAccountKey || fromAccountKey === toAccountKey) return false;
    for (const name of LEGACY_KEYS) {
      const src = await rawGetPhysical(`lsk:${fromAccountKey}:${name}`);
      if (src === undefined) continue;
      const dstKey = `lsk:${toAccountKey}:${name}`;
      if (!overwrite) {
        const existing = await rawGetPhysical(dstKey);
        if (existing !== undefined) continue;
      }
      await rawSetPhysical(dstKey, src);
    }
    return true;
  },

  // 不加命名空间的全局键（供 auth.js 存放跨账号的认证记录/设备密钥）
  async getGlobal(key) {
    return rawGetPhysical(key);
  },

  async setGlobal(key, value) {
    return rawSetPhysical(key, value);
  },

  async removeGlobal(key) {
    return rawRemovePhysical(key);
  },

  async getSyncEnabled() {
    const localValue = await rawGet(KEYS.SYNC_ENABLED);
    if (typeof localValue === 'boolean') return localValue;
    const syncValue = await chromeSyncGet(KEYS.SYNC_ENABLED);
    if (typeof syncValue === 'boolean') {
      await rawSet(KEYS.SYNC_ENABLED, syncValue);
      return syncValue;
    }
    return false;
  },

  async setSyncEnabled(enabled) {
    const value = !!enabled;
    await rawSet(KEYS.SYNC_ENABLED, value);
    if (!hasChromeStorageSync()) {
      if (value) console.warn('[懒羊羊大王] 当前环境不支持 chrome.storage.sync，已保留本地模式');
      return false;
    }
    await chromeSyncSet(KEYS.SYNC_ENABLED, value);
    if (value) {
      await Promise.all(Array.from(SYNC_KEYS).filter((key) => key !== KEYS.SYNC_ENABLED).map((key) => mirrorOrHydrateSyncKey(key)));
    }
    return value;
  },

  async getSettings() {
    const localValue = await rawGet(KEYS.SETTINGS);
    const resolved = await resolveValue(KEYS.SETTINGS, localValue);
    return mergeSettingsLike(DEFAULTS[KEYS.SETTINGS], resolved || {});
  },

  async setSettings(settings) {
    const current = await this.getSettings();
    const merged = mergeSettingsLike(current, settings || {});
    await rawSet(KEYS.SETTINGS, merged);
    await maybeSyncKey(KEYS.SETTINGS, merged);
    return merged;
  },

  async getProfile() {
    const localValue = await rawGet(KEYS.PROFILE);
    const resolved = await resolveValue(KEYS.PROFILE, localValue);
    return { ...DEFAULTS[KEYS.PROFILE], ...(resolved || {}) };
  },

  async setProfile(profile) {
    const current = await this.getProfile();
    const merged = { ...current, ...(profile || {}) };
    await rawSet(KEYS.PROFILE, merged);
    await maybeSyncKey(KEYS.PROFILE, merged);
    return merged;
  },

  async getTasks() {
    await migrateIfNeeded();
    const localValue = await rawGet(KEYS.TASKS);
    const resolved = (await resolveValue(KEYS.TASKS, Array.isArray(localValue) ? localValue : [])) || [];
    const settings = await this.getSettings();
    const normalized = normalizeTaskList(resolved, settings?.team?.defaultPrivacy || PRIVACY.PUBLIC);
    if (JSON.stringify(normalized) !== JSON.stringify(resolved)) {
      await rawSet(KEYS.TASKS, normalized);
      await maybeSyncKey(KEYS.TASKS, normalized);
    }
    return normalized;
  },

  async setTasks(list) {
    const settings = await this.getSettings();
    const next = normalizeTaskList(list, settings?.team?.defaultPrivacy || PRIVACY.PUBLIC);
    await rawSet(KEYS.TASKS, next);
    await maybeSyncKey(KEYS.TASKS, next);
    return next;
  },

  async saveTask(task) {
    const list = await this.getTasks();
    const settings = await this.getSettings();
    const normalized = normalizeTask(task, settings?.team?.defaultPrivacy || PRIVACY.PUBLIC);
    const idx = list.findIndex((item) => sameId(item?.id, normalized?.id));
    if (idx >= 0) list[idx] = normalized; else list.push(normalized);
    await this.setTasks(list);
    return normalized;
  },

  async deleteTask(id, options = {}) {
    const targetId = String(id ?? '');
    const before = await this.getTasks();
    const removedTask = before.find((task) => sameId(task?.id, targetId)) || null;
    const nextList = before.filter((task) => !sameId(task?.id, targetId));
    await this.setTasks(nextList);
    const active = await this.getActiveTaskId();
    if (sameId(active, targetId)) {
      if (options.keepActiveSelection) {
        const nextOpen = nextList.find((task) => task.currentIndex < task.steps.length);
        await this.setActiveTaskId(nextOpen ? nextOpen.id : null);
      } else {
        await this.setActiveTaskId(null);
      }
    }
    return removedTask;
  },

  async getActiveTaskId() {
    await migrateIfNeeded();
    const raw = await rawGet(KEYS.ACTIVE_ID);
    return raw == null ? null : String(raw);
  },

  async setActiveTaskId(id) {
    const value = id == null ? null : String(id);
    await rawSet(KEYS.ACTIVE_ID, value);
    return value;
  },

  async getActiveTask() {
    const activeId = await this.getActiveTaskId();
    if (!activeId) return null;
    const list = await this.getTasks();
    return list.find((task) => sameId(task?.id, activeId)) || null;
  },

  async getCurrentTask() {
    return this.getActiveTask();
  },

  async setCurrentTask(task) {
    if (!task) return null;
    await this.saveTask(task);
    await this.setActiveTaskId(task.id);
    return task;
  },

  async clearCurrentTask() {
    const activeId = await this.getActiveTaskId();
    if (activeId) await this.deleteTask(activeId);
    await this.setActiveTaskId(null);
  },

  async getHistory() {
    return (await rawGet(KEYS.HISTORY)) || [];
  },

  async setHistory(list) {
    const next = Array.isArray(list) ? list : [];
    await rawSet(KEYS.HISTORY, next);
    return next;
  },

  async pushHistory(record) {
    const list = await this.getHistory();
    list.unshift(record);
    await this.setHistory(list.slice(0, 80));
  },

  async getStats() {
    const localValue = await rawGet(KEYS.STATS);
    const resolved = await resolveValue(KEYS.STATS, localValue);
    return mergeStats(resolved || {}, {});
  },

  async setStats(stats) {
    const next = mergeStats(stats || {}, {});
    await rawSet(KEYS.STATS, next);
    await maybeSyncKey(KEYS.STATS, next);
    return next;
  },

  async updateStats(patch) {
    const current = await this.getStats();
    const next = mergeStats({ ...current, ...(patch || {}), lastActiveAt: Date.now() }, {});
    await rawSet(KEYS.STATS, next);
    await maybeSyncKey(KEYS.STATS, next);
    return next;
  },

  async bumpDaily(patch = {}) {
    const stats = await this.getStats();
    const log = { ...(stats.dailyLog || {}) };
    const key = todayKey();
    const current = { steps: 0, tasks: 0, food: 0, ...(log[key] || {}) };
    current.steps += Math.max(0, Math.round(patch.steps || 0));
    current.tasks += Math.max(0, Math.round(patch.tasks || 0));
    current.food += Math.max(0, Math.round(patch.food || 0));
    log[key] = current;
    return this.updateStats({ dailyLog: log });
  },

  async addStepCompleted(arg = {}) {
    let foodAdd;
    let expAdd;
    if (typeof arg === 'number') {
      const count = arg || 1;
      foodAdd = count * 2;
      expAdd = count * 5;
    } else {
      foodAdd = Math.max(0, Math.round(arg.food ?? 2));
      expAdd = Math.max(0, Math.round(arg.exp ?? 5));
    }
    const stats = await this.getStats();
    let petLevel = stats.petLevel;
    let petExp = stats.petExp + expAdd;
    while (petExp >= petLevel * 20) {
      petExp -= petLevel * 20;
      petLevel += 1;
    }
    const next = await this.updateStats({
      totalStepsCompleted: stats.totalStepsCompleted + 1,
      foodStock: stats.foodStock + foodAdd,
      petLevel,
      petExp,
    });
    await this.bumpDaily({ steps: 1, food: foodAdd });
    return next;
  },

  async addTaskCompleted(bonus = {}) {
    const foodAdd = Math.max(0, Math.round(bonus.food || 0));
    const expAdd = Math.max(0, Math.round(bonus.exp || 0));
    const stats = await this.getStats();
    let petLevel = stats.petLevel;
    let petExp = stats.petExp + expAdd;
    while (petExp >= petLevel * 20) {
      petExp -= petLevel * 20;
      petLevel += 1;
    }
    const next = await this.updateStats({
      totalTasksCompleted: stats.totalTasksCompleted + 1,
      foodStock: stats.foodStock + foodAdd,
      petLevel,
      petExp,
    });
    await this.bumpDaily({ tasks: 1, food: foodAdd });
    return next;
  },

  async getRecentBreakdowns() {
    const list = await rawGet(KEYS.RECENT_BREAKDOWNS);
    return Array.isArray(list) ? list : [];
  },

  async setRecentBreakdowns(list) {
    const next = (Array.isArray(list) ? list : []).slice(0, RECENT_BREAKDOWN_LIMIT);
    await rawSet(KEYS.RECENT_BREAKDOWNS, next);
    return next;
  },

  async rememberRecentBreakdown(entry) {
    if (!entry?.normalized || !Array.isArray(entry?.stepsSkeleton) || entry.stepsSkeleton.length === 0) return this.getRecentBreakdowns();
    const current = await this.getRecentBreakdowns();
    const normalized = String(entry.normalized).trim();
    const filtered = current.filter((item) => item?.normalized !== normalized);
    filtered.unshift({
      normalized,
      intent: entry.intent || 'default.generic',
      subject: entry.subject || normalized,
      stepsSkeleton: clone(entry.stepsSkeleton).slice(0, 8),
      savedAt: Date.now(),
    });
    return this.setRecentBreakdowns(filtered.slice(0, RECENT_BREAKDOWN_LIMIT));
  },

  async getDebugLog() {
    const list = await rawGet(KEYS.DEBUG_LOG);
    return Array.isArray(list) ? list : [];
  },

  async pushDebugLog(entry) {
    try {
      const current = await this.getDebugLog();
      current.unshift(sanitizeDebugEntry({ ts: Date.now(), ...(entry || {}) }));
      const next = current.slice(0, DEBUG_LOG_LIMIT);
      await rawSet(KEYS.DEBUG_LOG, next);
      return next;
    } catch {
      return [];
    }
  },

  async clearDebugLog() {
    await rawSet(KEYS.DEBUG_LOG, []);
    return [];
  },

  async getTeamSelf() {
    const value = await rawGet(KEYS.TEAM_SELF);
    return normalizeTeamSelfValue(value);
  },

  async setTeamSelf(value) {
    const current = await this.getTeamSelf();
    const merged = normalizeTeamSelfValue({ ...current, ...(value || {}) });
    await rawSet(KEYS.TEAM_SELF, merged);
    return merged;
  },

  // v0.8.2 · 组队会话（Worker token / memberId / code）持久化于 settings
  async getTeamSession() {
    const s = await this.getSettings();
    return {
      teamCode: String(s.teamCode || '').trim().toUpperCase(),
      teamToken: String(s.teamToken || ''),
      teamMemberId: String(s.teamMemberId || ''),
      teamPokeSeenTs: Number(s.teamPokeSeenTs || 0),
    };
  },

  async setTeamSession(patch = {}) {
    const next = await this.setSettings({
      ...(patch.teamCode !== undefined ? { teamCode: String(patch.teamCode || '').trim().toUpperCase() } : {}),
      ...(patch.teamToken !== undefined ? { teamToken: String(patch.teamToken || '') } : {}),
      ...(patch.teamMemberId !== undefined ? { teamMemberId: String(patch.teamMemberId || '') } : {}),
      ...(patch.teamPokeSeenTs !== undefined ? { teamPokeSeenTs: Number(patch.teamPokeSeenTs || 0) } : {}),
    });
    return {
      teamCode: next.teamCode,
      teamToken: next.teamToken,
      teamMemberId: next.teamMemberId,
      teamPokeSeenTs: next.teamPokeSeenTs,
    };
  },

  async clearTeamSession() {
    await this.setSettings({ teamCode: '', teamToken: '', teamMemberId: '', teamPokeSeenTs: 0 });
    return { teamCode: '', teamToken: '', teamMemberId: '', teamPokeSeenTs: 0 };
  },

  async getTeamState() {
    const teamSelf = await this.getTeamSelf();
    const value = await rawGet(KEYS.TEAM_STATE);
    return normalizeTeamStateValue(value, teamSelf.teamCode);
  },

  async setTeamState(value) {
    const teamSelf = await this.getTeamSelf();
    const next = normalizeTeamStateValue(value, teamSelf.teamCode);
    await rawSet(KEYS.TEAM_STATE, next);
    return next;
  },

  async pushPokes(pokes) {
    const list = Array.isArray(pokes) ? pokes : [pokes];
    const current = await this.getTeamState();
    const merged = mergeTeamState(current, {
      code: current.code,
      members: {},
      pokes: list,
      updatedAt: Date.now(),
    });
    await rawSet(KEYS.TEAM_STATE, merged);
    return merged;
  },

  async getBackupData() {
    const [settings, tasks, history, stats, profile, syncEnabled, recentBreakdowns, teamSelf, teamState] = await Promise.all([
      this.getSettings(),
      this.getTasks(),
      this.getHistory(),
      this.getStats(),
      this.getProfile(),
      this.getSyncEnabled(),
      this.getRecentBreakdowns(),
      this.getTeamSelf(),
      this.getTeamState(),
    ]);
    return { settings, tasks, history, stats, profile, syncEnabled, recentBreakdowns, teamSelf, teamState };
  },

  async resetAllLocalData() {
    await Promise.all(Object.values(KEYS).map((key) => rawRemove(key)));
  },
};

export default Storage;
