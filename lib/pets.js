// lib/pets.js — v2.1 · 心情系统 + 卡通化滤镜配置
import { Storage } from './storage.js';

export const PET_TYPES = [
  { id: 'sheep', name: '懒羊羊', emoji: '🐑', color: '#e6a940', desc: '就是本插件的吉祥物本尊，圆滚滚，爱睡觉。' },
  { id: 'cat',   name: '橘猫',   emoji: '🐈', color: '#f4a86a', desc: '会撒娇，会翻肚皮，也会踩你的键盘。' },
  { id: 'dog',   name: '柴柴',   emoji: '🐕', color: '#c7723a', desc: '眼睛小小，笑起来嘴一咧，永远开心。' },
  { id: 'custom', name: '自定义', emoji: '🖼️', color: '#8b5a2b', desc: '上传你自己的图片作为宠物，会自动卡通化。' },
];

const PET_KEY = 'lsk_pet_v2';

const DEFAULT_PET_STATE = {
  activeId: 'sheep',
  unlocked: ['sheep'],
  moodOverride: null,       // 手动喂饱后短暂 happy，其它时候动态计算
  customImageDataUrl: '',
  customName: '我的宠物',
  cartoonize: true,         // 是否给自定义图应用卡通化滤镜
  lastFedAt: 0,
  timesFed: 0,
};

function hasChromeStorage() { return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local; }
async function rawGet(key) { if (hasChromeStorage()) return new Promise((r) => chrome.storage.local.get([key], (res) => r(res[key]))); try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : undefined; } catch { return undefined; } }
async function rawSet(key, value) { if (hasChromeStorage()) return new Promise((r) => chrome.storage.local.set({ [key]: value }, () => r())); localStorage.setItem(key, JSON.stringify(value)); }

// v2.1: 动态计算心情
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
  happy:  { emoji: '😊', anim: 'bounce', say: '被你喂饱啦，好爱你！' },
  normal: { emoji: '🙂', anim: 'idle',   say: '嗨～最近还好吗？' },
  sleepy: { emoji: '😴', anim: 'sleepy', say: '呼…好想再睡一会…' },
  sad:    { emoji: '🥺', anim: 'shake',  say: '我肚子饿了，你去干几步任务嘛…' },
};

export const Pets = {
  PET_TYPES,
  MOOD_META,
  computeMood,
  async getState() { const v = await rawGet(PET_KEY); return { ...DEFAULT_PET_STATE, ...(v || {}) }; },
  async setState(patch) { const cur = await this.getState(); const next = { ...cur, ...patch }; await rawSet(PET_KEY, next); return next; },
  async unlock(petId) { const st = await this.getState(); if (!st.unlocked.includes(petId)) st.unlocked.push(petId); return this.setState({ unlocked: st.unlocked }); },
  async setActive(petId) { await this.unlock(petId); return this.setState({ activeId: petId }); },
  async setCustomImage(dataUrl, name) { await this.unlock('custom'); return this.setState({ customImageDataUrl: dataUrl, customName: name || '我的宠物', activeId: 'custom' }); },
  async toggleCartoonize() { const st = await this.getState(); return this.setState({ cartoonize: !st.cartoonize }); },
  async feed(count = 1) {
    const stats = await Storage.getStats();
    const cost = count * 5;
    if (stats.foodStock < cost) return { ok: false, reason: '养料不够啦，去多完成几步任务吧～' };
    await Storage.updateStats({ foodStock: stats.foodStock - cost });
    const st = await this.getState();
    await this.setState({ timesFed: (st.timesFed || 0) + count, moodOverride: 'happy', lastFedAt: Date.now() });
    return { ok: true };
  },
  petTypeById(id) { return PET_TYPES.find((p) => p.id === id) || PET_TYPES[0]; },
};

export default Pets;
