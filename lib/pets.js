// lib/pets.js — v2 · Option 1：宠物系统骨架（默认 3 种 + 自定义上传占位）
import { Storage } from './storage.js';

export const PET_TYPES = [
  { id: 'sheep', name: '懒羊羊', emoji: '🐑', color: '#e6a940', desc: '就是本插件的吉祥物本尊，圆滚滚，爱睡觉。' },
  { id: 'cat',   name: '橘猫',   emoji: '🐈', color: '#f4a86a', desc: '会撒娇，会翻肚皮，也会踩你的键盘。' },
  { id: 'dog',   name: '柴柴',   emoji: '🐕', color: '#c7723a', desc: '眼睛小小，笑起来嘴一咧，永远开心。' },
  { id: 'custom', name: '自定义', emoji: '🖼️', color: '#8b5a2b', desc: '上传你自己的图片作为宠物（v2.1 会自动卡通化）。' },
];

const PET_KEY = 'lsk_pet_v2';

const DEFAULT_PET_STATE = {
  activeId: 'sheep',
  unlocked: ['sheep'],
  mood: 'happy',            // happy | normal | sad
  customImageDataUrl: '',   // base64 dataUrl, 用户上传的形象
  customName: '我的宠物',
  lastFedAt: 0,
  timesFed: 0,
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

export const Pets = {
  PET_TYPES,
  async getState() {
    const v = await rawGet(PET_KEY);
    return { ...DEFAULT_PET_STATE, ...(v || {}) };
  },
  async setState(patch) {
    const cur = await this.getState();
    const next = { ...cur, ...patch };
    await rawSet(PET_KEY, next);
    return next;
  },
  async unlock(petId) {
    const st = await this.getState();
    if (!st.unlocked.includes(petId)) st.unlocked.push(petId);
    return this.setState({ unlocked: st.unlocked });
  },
  async setActive(petId) {
    await this.unlock(petId);
    return this.setState({ activeId: petId });
  },
  async setCustomImage(dataUrl, name) {
    await this.unlock('custom');
    return this.setState({
      customImageDataUrl: dataUrl,
      customName: name || '我的宠物',
      activeId: 'custom',
    });
  },
  // 用养料喂宠：消耗 foodStock，累加 timesFed，等级由 storage.getStats 里的 petLevel 决定
  async feed(count = 1) {
    const stats = await Storage.getStats();
    const cost = count * 5;
    if (stats.foodStock < cost) return { ok: false, reason: '养料不够啦，去多完成几步任务吧～' };
    await Storage.updateStats({ foodStock: stats.foodStock - cost });
    const st = await this.getState();
    return this.setState({ timesFed: (st.timesFed || 0) + count, mood: 'happy', lastFedAt: Date.now() });
  },
  petTypeById(id) { return PET_TYPES.find((p) => p.id === id) || PET_TYPES[0]; },
};

export default Pets;
