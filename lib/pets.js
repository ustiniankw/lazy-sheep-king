// lib/pets.js — v0.3.3: 喂养反馈 / 亲密度 / 喂养历史
import { Storage } from './storage.js';

export const PET_TYPES = [
  { id: 'sheep', name: '懒羊羊', emoji: '🐑', color: '#e6a940', desc: '就是本插件的吉祥物本尊，圆滚滚，爱睡觉。' },
  { id: 'cat', name: '橘猫', emoji: '🐈', color: '#f4a86a', desc: '会撒娇，会翻肚皮，也会踩你的键盘。' },
  { id: 'dog', name: '柴柴', emoji: '🐕', color: '#c7723a', desc: '眼睛小小，笑起来嘴一咧，永远开心。' },
  { id: 'custom', name: '自定义', emoji: '🖼️', color: '#8b5a2b', desc: '上传你自己的图片作为宠物，会自动卡通化。' },
];

const PET_KEY = 'lsk_pet_v2';
const FEED_LOG_LIMIT = 200;

const DEFAULT_PET_STATE = {
  activeId: 'sheep',
  unlocked: ['sheep'],
  moodOverride: null,
  customImageDataUrl: '',
  customName: '我的宠物',
  cartoonize: true,
  lastFedAt: 0,
  timesFed: 0,
  feedLog: [],
  totalFedByPet: { sheep: 0, cat: 0, dog: 0, custom: 0 },
  totalFedAll: 0,
  feedStreakDays: 0,
};

function hasChromeStorage() {
  return typeof chrome !== 'undefined' && chrome?.storage?.local;
}

async function rawGet(key) {
  if (hasChromeStorage()) {
    return new Promise((resolve) => chrome.storage.local.get([key], (res) => resolve(res[key])));
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
    return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, () => resolve()));
  }
  localStorage.setItem(key, JSON.stringify(value));
}

function dateStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function diffDays(aTs, bTs) {
  return Math.round((dateStart(aTs) - dateStart(bTs)) / 86400000);
}

function normalizeFeedMap(raw = {}) {
  const next = { sheep: 0, cat: 0, dog: 0, custom: 0 };
  Object.entries(raw || {}).forEach(([petId, count]) => {
    next[petId] = Math.max(0, Number(count) || 0);
  });
  return next;
}

function normalizeFeedLog(feedLog = []) {
  return (Array.isArray(feedLog) ? feedLog : [])
    .filter((item) => item && item.petId)
    .map((item) => ({ ts: Number(item.ts) || 0, petId: String(item.petId), amount: Math.max(1, Number(item.amount) || 1) }))
    .slice(-FEED_LOG_LIMIT);
}

function rebuildTotals(state) {
  const totalFedByPet = normalizeFeedMap(state.totalFedByPet);
  let totalFedAll = Math.max(0, Number(state.totalFedAll) || 0);
  const log = normalizeFeedLog(state.feedLog);
  if (!isFinite(totalFedAll) || totalFedAll <= 0) {
    totalFedAll = Object.values(totalFedByPet).reduce((sum, count) => sum + (Number(count) || 0), 0);
  }
  if (!totalFedAll && state.timesFed) totalFedAll = Math.max(0, Number(state.timesFed) || 0);
  const feedStreakDays = Math.max(0, Number(state.feedStreakDays) || 0);
  return {
    ...DEFAULT_PET_STATE,
    ...state,
    unlocked: Array.from(new Set([...(state.unlocked || []), 'sheep'])),
    timesFed: Math.max(totalFedAll, Number(state.timesFed) || 0),
    totalFedByPet,
    totalFedAll,
    feedLog: log,
    feedStreakDays,
    lastFedAt: Number(state.lastFedAt) || 0,
  };
}

export function todayFeedTotal(feedLog = [], now = Date.now()) {
  const start = dateStart(now);
  const end = start + 86400000;
  return normalizeFeedLog(feedLog)
    .filter((item) => item.ts >= start && item.ts < end)
    .reduce((sum, item) => sum + item.amount, 0);
}

export function computeFeedStreak(lastFedAt, currentStreak, now = Date.now()) {
  if (!lastFedAt) return 1;
  const diff = diffDays(now, lastFedAt);
  if (diff <= 0) return Math.max(1, Number(currentStreak) || 1);
  if (diff === 1) return Math.max(1, Number(currentStreak) || 0) + 1;
  return 1;
}

export function affinityProgress(total = 0) {
  const value = Math.max(0, Number(total) || 0);
  if (value >= 100) return { tier: 'high', percent: Math.min(100, 60 + Math.round((value - 100) / 8)) };
  if (value >= 25) return { tier: 'mid', percent: 35 + Math.round(((value - 25) / 75) * 45) };
  return { tier: 'low', percent: Math.min(35, Math.round((value / 25) * 35)) };
}

//  - 6h 内被喂过 或 有 moodOverride='happy'      → happy
//  - 距离上次喂养 <= 24h && 有近期任务活跃         → normal
//  - 24-72h 未喂                                → sleepy
//  - >72h 未喂                                  → sad
export function computeMood(petState, stats) {
  const now = Date.now();
  const fed = petState.lastFedAt || 0;
  const active = stats?.lastActiveAt || 0;
  const HOUR = 3600 * 1000;
  if (petState.moodOverride === 'happy' && now - fed < 2 * HOUR) return 'happy';
  const sinceFed = fed ? (now - fed) : Infinity;
  if (sinceFed < 6 * HOUR) return 'happy';
  if (sinceFed < 24 * HOUR || now - active < 12 * HOUR) return 'normal';
  if (sinceFed < 72 * HOUR) return 'sleepy';
  return 'sad';
}

export const MOOD_META = {
  happy: { emoji: '😊', anim: 'bounce', say: '被你喂饱啦，好爱你！' },
  normal: { emoji: '🙂', anim: 'idle', say: '嗨～最近还好吗？' },
  sleepy: { emoji: '😴', anim: 'sleepy', say: '呼…好想再睡一会…' },
  sad: { emoji: '🥺', anim: 'shake', say: '我肚子饿了，你去干几步任务嘛…' },
};

export const Pets = {
  PET_TYPES,
  MOOD_META,
  computeMood,
  todayFeedTotal,
  affinityProgress,

  async getState() {
    const value = await rawGet(PET_KEY);
    return rebuildTotals(value || {});
  },

  async setState(patch) {
    const current = await this.getState();
    const next = rebuildTotals({ ...current, ...(patch || {}) });
    await rawSet(PET_KEY, next);
    return next;
  },

  async replaceState(state) {
    const next = rebuildTotals(state || {});
    await rawSet(PET_KEY, next);
    return next;
  },

  async unlock(petId) {
    const state = await this.getState();
    if (!state.unlocked.includes(petId)) state.unlocked.push(petId);
    return this.setState({ unlocked: state.unlocked });
  },

  async setActive(petId) {
    await this.unlock(petId);
    return this.setState({ activeId: petId });
  },

  async setCustomImage(dataUrl, name) {
    await this.unlock('custom');
    return this.setState({ customImageDataUrl: dataUrl, customName: name || '我的宠物', activeId: 'custom' });
  },

  async toggleCartoonize() {
    const state = await this.getState();
    return this.setState({ cartoonize: !state.cartoonize });
  },

  async feed(count = 1, petId) {
    const amount = Math.max(1, Math.round(Number(count) || 1));
    const stats = await Storage.getStats();
    const current = await this.getState();
    const targetPetId = petId || current.activeId || 'sheep';
    const cost = amount * 5;
    if (stats.foodStock < cost) {
      return { ok: false, reason: '养料不够啦，去多完成几步任务吧～' };
    }

    const expDelta = amount * 5;
    let petLevel = stats.petLevel || 1;
    let petExp = (stats.petExp || 0) + expDelta;
    const oldLevel = petLevel;
    while (petExp >= petLevel * 20) {
      petExp -= petLevel * 20;
      petLevel += 1;
    }
    await Storage.updateStats({ foodStock: stats.foodStock - cost, petLevel, petExp });

    const totalFedByPet = normalizeFeedMap(current.totalFedByPet);
    totalFedByPet[targetPetId] = (totalFedByPet[targetPetId] || 0) + amount;
    const now = Date.now();
    const feedLog = [...normalizeFeedLog(current.feedLog), { ts: now, petId: targetPetId, amount }].slice(-FEED_LOG_LIMIT);
    const streak = computeFeedStreak(current.lastFedAt, current.feedStreakDays, now);
    const totalAll = Math.max(0, Number(current.totalFedAll) || 0) + amount;
    await this.setState({
      timesFed: (current.timesFed || 0) + amount,
      moodOverride: 'happy',
      lastFedAt: now,
      feedLog,
      totalFedByPet,
      totalFedAll: totalAll,
      feedStreakDays: streak,
    });

    return {
      ok: true,
      delta: expDelta,
      newLevel: petLevel,
      leveledUp: petLevel > oldLevel,
      totalForPet: totalFedByPet[targetPetId] || 0,
      totalAll,
      streak,
      petId: targetPetId,
      cost,
    };
  },

  petTypeById(id) {
    return PET_TYPES.find((pet) => pet.id === id) || PET_TYPES[0];
  },
};

export default Pets;
