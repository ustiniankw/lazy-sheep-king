// lib/identity.js — v0.6.0 · 认证瘦身 · 自动昵称 + DiceBear 头像
// -----------------------------------------------------------------------------
// 目标：不再依赖 GitHub / Google OAuth；每个用户默认拿到一个可爱的中文昵称 +
// DiceBear 免费头像。全部函数纯函数化，方便在扩展 / PWA / Node 测试环境跑。
// -----------------------------------------------------------------------------

// 可爱形容词（30+）— 生活化、无 jargon
export const NICKNAME_ADJECTIVES = [
  '会飞的', '打盹的', '干饭的', '爱笑的', '毛茸茸的', '发光的',
  '偷懒的', '爱吃的', '奔跑的', '闪亮的', '眯眯眼的', '甜甜的',
  '呆萌的', '慢吞吞的', '摇尾巴的', '嘟嘴的', '暖乎乎的', '会魔法的',
  '打哈欠的', '爱抱抱的', '躺平的', '弹跳的', '文艺的', '搞笑的',
  '细心的', '勇敢的', '悠闲的', '踏实的', '好奇的', '温柔的',
  '爱冒险的', '爱哼歌的',
];

// 可爱名词（30+）— 水果 / 动物 / 食物 / 自然元素
export const NICKNAME_NOUNS = [
  '橘子', '柚子', '南瓜', '西瓜', '芒果', '荔枝',
  '布丁', '芝士', '奶盖', '珍珠', '汤圆', '麻薯',
  '柴柴', '橘猫', '仓鼠', '海豹', '树懒', '水獭',
  '柠檬', '草莓', '蓝莓', '樱桃', '桃子', '菠萝',
  '云朵', '月亮', '小星', '露珠', '暖阳', '溪水',
  '棉花糖', '小面包', '雪球', '毛豆',
];

const DEFAULT_AVATAR_STYLES = ['thumbs', 'bottts', 'avataaars', 'lorelei'];
const DICEBEAR_BASE = 'https://api.dicebear.com/9.x';
const NICKNAME_STORE_KEY = 'lsk_identity_v1';

/** 生成一个随机中文昵称，例如 "会飞的橘子237" */
export function generateNickname(rnd = Math.random) {
  const adjIdx = Math.floor(rnd() * NICKNAME_ADJECTIVES.length);
  const nounIdx = Math.floor(rnd() * NICKNAME_NOUNS.length);
  const number = Math.floor(rnd() * 900) + 100; // 100-999，三位数
  return `${NICKNAME_ADJECTIVES[adjIdx]}${NICKNAME_NOUNS[nounIdx]}${number}`;
}

/** 生成一个 seed 字符串（用于 DiceBear URL） */
export function makeAvatarSeed() {
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36).slice(-4);
  return `${rand}${t}`;
}

/**
 * 生成 DiceBear 头像 URL（免费、无需 key）。
 * 支持传入 { seed, style } 或纯 seed 字符串。
 */
export function defaultAvatarUrl(input) {
  let seed = '';
  let style = 'thumbs';
  if (typeof input === 'string') {
    seed = input;
  } else if (input && typeof input === 'object') {
    seed = String(input.seed || '');
    if (DEFAULT_AVATAR_STYLES.includes(input.style)) style = input.style;
  }
  if (!seed) seed = makeAvatarSeed();
  return `${DICEBEAR_BASE}/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

export function isDiceBearUrl(url) {
  return typeof url === 'string' && url.startsWith(DICEBEAR_BASE + '/');
}

export function nextAvatarStyle(current) {
  const idx = DEFAULT_AVATAR_STYLES.indexOf(current);
  if (idx < 0) return DEFAULT_AVATAR_STYLES[0];
  return DEFAULT_AVATAR_STYLES[(idx + 1) % DEFAULT_AVATAR_STYLES.length];
}

/**
 * 幂等地确保用户身份存在。storage 只需实现 `getIdentity/setIdentity` 或
 * 兼容 `getGlobal/setGlobal`。返回 `{ nickname, avatarStyle, avatarSeed, avatarUrl, avatarKind }`。
 * avatarKind: 'dicebear' | 'upload'
 */
export async function ensureIdentity(storage) {
  const existing = await readIdentity(storage);
  if (existing && existing.nickname && existing.avatarUrl) {
    // 兼容旧数据补齐
    const patched = {
      avatarKind: existing.avatarKind || (isDiceBearUrl(existing.avatarUrl) ? 'dicebear' : 'upload'),
      avatarStyle: existing.avatarStyle || DEFAULT_AVATAR_STYLES[0],
      avatarSeed: existing.avatarSeed || '',
      ...existing,
    };
    if (patched !== existing) await writeIdentity(storage, patched);
    return patched;
  }
  const nickname = existing?.nickname || generateNickname();
  const avatarStyle = existing?.avatarStyle || DEFAULT_AVATAR_STYLES[0];
  const avatarSeed = existing?.avatarSeed || makeAvatarSeed();
  const identity = {
    nickname,
    avatarKind: 'dicebear',
    avatarStyle,
    avatarSeed,
    avatarUrl: defaultAvatarUrl({ seed: avatarSeed, style: avatarStyle }),
    createdAt: existing?.createdAt || Date.now(),
  };
  await writeIdentity(storage, identity);
  return identity;
}

export async function updateIdentity(storage, patch) {
  const current = (await readIdentity(storage)) || {};
  const next = { ...current, ...(patch || {}) };
  // 如果 patch 涉及 style/seed 且没有传 avatarUrl，则重新计算
  if (
    next.avatarKind !== 'upload' &&
    (patch?.avatarStyle || patch?.avatarSeed || !next.avatarUrl)
  ) {
    next.avatarKind = 'dicebear';
    if (!next.avatarStyle) next.avatarStyle = DEFAULT_AVATAR_STYLES[0];
    if (!next.avatarSeed) next.avatarSeed = makeAvatarSeed();
    next.avatarUrl = defaultAvatarUrl({ seed: next.avatarSeed, style: next.avatarStyle });
  }
  if (!next.nickname) next.nickname = generateNickname();
  if (!next.createdAt) next.createdAt = Date.now();
  next.updatedAt = Date.now();
  await writeIdentity(storage, next);
  return next;
}

export async function rerollNickname(storage) {
  return updateIdentity(storage, { nickname: generateNickname() });
}

export async function rerollAvatar(storage, styleOverride) {
  const current = (await readIdentity(storage)) || {};
  const style = styleOverride || nextAvatarStyle(current.avatarStyle);
  const seed = makeAvatarSeed();
  return updateIdentity(storage, {
    avatarKind: 'dicebear',
    avatarStyle: style,
    avatarSeed: seed,
    avatarUrl: defaultAvatarUrl({ seed, style }),
  });
}

export async function setUploadedAvatar(storage, dataUrl) {
  if (!dataUrl) throw new Error('empty avatar dataUrl');
  return updateIdentity(storage, { avatarKind: 'upload', avatarUrl: dataUrl });
}

export const AVATAR_STYLES = DEFAULT_AVATAR_STYLES.slice();
export const IDENTITY_STORE_KEY = NICKNAME_STORE_KEY;

// ---------------------------------------------------------------------------
// storage 适配层
// ---------------------------------------------------------------------------
async function readIdentity(storage) {
  if (!storage) return null;
  if (typeof storage.getIdentity === 'function') return storage.getIdentity();
  if (typeof storage.getGlobal === 'function') return storage.getGlobal(NICKNAME_STORE_KEY);
  if (typeof storage.get === 'function') return storage.get(NICKNAME_STORE_KEY);
  return null;
}

async function writeIdentity(storage, value) {
  if (!storage) return;
  if (typeof storage.setIdentity === 'function') return storage.setIdentity(value);
  if (typeof storage.setGlobal === 'function') return storage.setGlobal(NICKNAME_STORE_KEY, value);
  if (typeof storage.set === 'function') return storage.set(NICKNAME_STORE_KEY, value);
}

export default {
  generateNickname,
  defaultAvatarUrl,
  ensureIdentity,
  updateIdentity,
  rerollNickname,
  rerollAvatar,
  setUploadedAvatar,
  isDiceBearUrl,
  nextAvatarStyle,
  makeAvatarSeed,
  AVATAR_STYLES,
  NICKNAME_ADJECTIVES,
  NICKNAME_NOUNS,
};
