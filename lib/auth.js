// lib/auth.js — v0.6.0 · 认证瘦身
// -----------------------------------------------------------------------------
// v0.6.0 起下线 GitHub Device Flow 和 Google OAuth 骨架，主流程只保留：
//   - guest       : 沿用 v0.5.x 的匿名 usr_xxx，用户不感知也可用
//   - passphrase  : 本地密码账号（Web Crypto PBKDF2 + AES-GCM），用于加密备份
// 兼容目的：export 的 MODE 常量 / signInGoogle / beginGitHubDeviceFlow 等外部符号
// 保留占位，返回统一的 { ok:false, code:'NOT_ENABLED' }，让老代码路径优雅无感。
// -----------------------------------------------------------------------------
import { Storage } from './storage.js';
import { createUserId } from './user_id.js';
import { ensureIdentity } from './identity.js';

export const MODE = {
  GUEST: 'guest',
  PASSPHRASE: 'passphrase',
  // 兼容占位，仅为不破坏 import；v0.6.0 起 UI 不再暴露。
  GITHUB: 'github',
  GOOGLE: 'google',
};

const AUTH_PKEY = 'lsk_auth_v1';
const PBKDF2_ITERS = 100000;
const SESSION_TTL_MS = 15 * 60 * 1000;

const WEAK_PASSPHRASES = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'password', 'passw0rd', 'qwerty', 'qwertyui', 'abc123', 'abcdef',
  '111111', '000000', '654321', 'iloveyou', 'admin123', 'letmein',
  '懒羊羊', 'a123456', '123123', 'aaaaaa',
]);

// ---------------------------------------------------------------------------
// 内存会话
// ---------------------------------------------------------------------------
let session = null;

function touchSession() { if (session) session.unlockedAt = Date.now(); }

export function getSession() {
  if (!session) return null;
  if (Date.now() - session.unlockedAt > SESSION_TTL_MS) { session = null; return null; }
  return { key: session.keyBytes, mode: session.mode, accountKey: session.accountKey };
}

export function lockSession() { session = null; }

// ---------------------------------------------------------------------------
// 编解码工具
// ---------------------------------------------------------------------------
function getCrypto() { return globalThis.crypto || null; }
function getSubtle() { const c = getCrypto(); return c && c.subtle ? c.subtle : null; }

function toB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  if (typeof btoa === 'function') return btoa(bin);
  return Buffer.from(arr).toString('base64');
}
function fromB64(str) {
  if (typeof atob === 'function') {
    const bin = atob(str);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) a[i] = bin.charCodeAt(i);
    return a;
  }
  return new Uint8Array(Buffer.from(str, 'base64'));
}
function toHex(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomBytes(n) {
  const c = getCrypto();
  const out = new Uint8Array(n);
  if (c?.getRandomValues) return c.getRandomValues(out);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function err(code, message) { return { ok: false, code, message }; }

// ---------------------------------------------------------------------------
// 认证记录
// ---------------------------------------------------------------------------
function emptyRecord() {
  return {
    version: 2,
    mode: MODE.GUEST,
    guestUserId: '',
    passphrase: null, // { salt, verifierHash, iters, createdAt, name, userId }
    boundAt: 0,
  };
}
async function readRecord() {
  const raw = await Storage.getGlobal(AUTH_PKEY);
  return { ...emptyRecord(), ...(raw || {}) };
}
async function writeRecord(record) {
  await Storage.setGlobal(AUTH_PKEY, record);
  return record;
}
async function ensureGuestUserId(record) {
  if (record.guestUserId) return record.guestUserId;
  const profile = await Storage.getProfile();
  const userId = profile?.userId || createUserId();
  record.guestUserId = userId;
  if (!profile?.userId) {
    await Storage.setProfile({ ...profile, userId, createdAt: profile?.createdAt || Date.now() });
  }
  await writeRecord(record);
  return userId;
}

// ---------------------------------------------------------------------------
// PBKDF2 / AES-GCM（仅用于加密备份 & 本地密码账号）
// ---------------------------------------------------------------------------
async function deriveKeyBits(passphrase, saltBytes, iters = PBKDF2_ITERS) {
  const subtle = getSubtle();
  if (!subtle) return null;
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey('raw', enc.encode(String(passphrase)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: iters, hash: 'SHA-256' },
    baseKey, 256,
  );
  return new Uint8Array(bits);
}
async function sha256Hex(bytes) {
  const subtle = getSubtle();
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}
async function aesEncrypt(keyBytes, plaintextStr) {
  const subtle = getSubtle();
  if (!subtle) return null;
  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = randomBytes(12);
  const enc = new TextEncoder();
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintextStr));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
async function aesDecrypt(keyBytes, ivB64, ctB64) {
  const subtle = getSubtle();
  if (!subtle) return null;
  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64));
  return new TextDecoder().decode(pt);
}

export function evaluatePassphrase(passphrase) {
  const value = String(passphrase || '');
  if (value.length < 6) return { ok: false, score: 0, level: 'bad', reason: '密码至少 6 位' };
  if (WEAK_PASSPHRASES.has(value.toLowerCase())) return { ok: false, score: 1, level: 'bad', reason: '这个密码太常见啦，换一个吧' };
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  const level = score <= 1 ? 'bad' : score <= 3 ? 'mid' : 'good';
  return { ok: true, score, level, reason: '' };
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------
export async function getAuthState() {
  const record = await readRecord();
  await ensureGuestUserId(record);
  const profile = await Storage.getProfile();
  // v0.6.0 起把 identity 昵称/头像作为默认展示
  const identity = await ensureIdentity({
    getGlobal: (k) => Storage.getGlobal(k),
    setGlobal: (k, v) => Storage.setGlobal(k, v),
  });
  const base = {
    mode: record.mode || MODE.GUEST,
    userId: record.guestUserId,
    nickname: identity.nickname,
    avatarUrl: identity.avatarUrl,
    avatarKind: identity.avatarKind,
    avatarStyle: identity.avatarStyle,
    avatarSeed: identity.avatarSeed,
    displayName: profile?.displayName || identity.nickname || '',
    boundAt: record.boundAt || 0,
  };
  if (record.mode === MODE.PASSPHRASE && record.passphrase) {
    return {
      ...base,
      userId: record.passphrase.userId || record.guestUserId,
      accountName: record.passphrase.name || '',
      createdAt: record.passphrase.createdAt || 0,
      locked: getSession() === null,
    };
  }
  return base;
}

export async function isSignedIn() {
  const record = await readRecord();
  if (record.mode === MODE.PASSPHRASE) return getSession() !== null;
  return false;
}

export async function setupPassphrase(name, passphrase) {
  const subtle = getSubtle();
  if (!subtle) return err('NOT_AVAILABLE', '当前环境不支持 Web Crypto，无法创建本地密码账号');
  const strength = evaluatePassphrase(passphrase);
  if (!strength.ok) return err('WEAK_PASSPHRASE', strength.reason);

  const record = await readRecord();
  if (record.passphrase) return err('ALREADY_EXISTS', '本地密码账号已存在，请直接解锁或修改密码');
  const guestUserId = await ensureGuestUserId(record);
  const guestAccountKey = `guest:${guestUserId}`;

  const salt = randomBytes(16);
  const keyBytes = await deriveKeyBits(passphrase, salt);
  const verifierHash = await sha256Hex(keyBytes);
  const userId = guestUserId;

  record.mode = MODE.PASSPHRASE;
  record.passphrase = {
    salt: toB64(salt),
    verifierHash,
    iters: PBKDF2_ITERS,
    createdAt: Date.now(),
    name: String(name || '').trim() || '',
    userId,
  };
  record.boundAt = Date.now();
  await writeRecord(record);

  const accountKey = `p:${userId}`;
  await Storage.copyAccountData(guestAccountKey, accountKey, { overwrite: false });
  await Storage.switchAccount(accountKey);
  if (record.passphrase.name) {
    await Storage.setProfile({ ...(await Storage.getProfile()), displayName: record.passphrase.name });
  }
  session = { keyBytes, unlockedAt: Date.now(), mode: MODE.PASSPHRASE, accountKey };
  return getAuthState();
}

export async function verifyPassphrase(passphrase) {
  const subtle = getSubtle();
  if (!subtle) return false;
  const record = await readRecord();
  if (!record.passphrase) return false;
  const salt = fromB64(record.passphrase.salt);
  const keyBytes = await deriveKeyBits(passphrase, salt, record.passphrase.iters || PBKDF2_ITERS);
  const hash = await sha256Hex(keyBytes);
  if (hash !== record.passphrase.verifierHash) return false;
  const accountKey = `p:${record.passphrase.userId}`;
  session = { keyBytes, unlockedAt: Date.now(), mode: MODE.PASSPHRASE, accountKey };
  if (record.mode !== MODE.PASSPHRASE) {
    record.mode = MODE.PASSPHRASE;
    await writeRecord(record);
  }
  await Storage.switchAccount(accountKey);
  return true;
}

export async function changePassphrase(oldP, newP) {
  const record = await readRecord();
  if (!record.passphrase) return err('NO_ACCOUNT', '尚未创建本地密码账号');
  const okVerify = await verifyPassphrase(oldP);
  if (!okVerify) return err('WRONG_PASSPHRASE', '原密码不正确');
  const strength = evaluatePassphrase(newP);
  if (!strength.ok) return err('WEAK_PASSPHRASE', strength.reason);
  const salt = randomBytes(16);
  const keyBytes = await deriveKeyBits(newP, salt);
  const verifierHash = await sha256Hex(keyBytes);
  record.passphrase.salt = toB64(salt);
  record.passphrase.verifierHash = verifierHash;
  record.passphrase.iters = PBKDF2_ITERS;
  await writeRecord(record);
  session = { keyBytes, unlockedAt: Date.now(), mode: MODE.PASSPHRASE, accountKey: `p:${record.passphrase.userId}` };
  return { ok: true };
}

export async function signOut() {
  const record = await readRecord();
  const guestUserId = await ensureGuestUserId(record);
  record.mode = MODE.GUEST;
  await writeRecord(record);
  lockSession();
  await Storage.switchAccount(`guest:${guestUserId}`);
  return getAuthState();
}

// ---------------------------------------------------------------------------
// 备份加解密（本地密码账号解锁时启用 AES-GCM）
// ---------------------------------------------------------------------------
export async function encryptBackup(payload) {
  const record = await readRecord();
  const s = getSession();
  if (record.mode === MODE.PASSPHRASE && record.passphrase && s?.key) {
    const enc = await aesEncrypt(s.key, JSON.stringify(payload));
    if (!enc) return { enc: false, plain: payload };
    touchSession();
    return {
      enc: true,
      alg: 'AES-GCM',
      kdf: 'PBKDF2',
      iters: record.passphrase.iters || PBKDF2_ITERS,
      salt: record.passphrase.salt,
      iv: enc.iv,
      cipherText: enc.ct,
    };
  }
  return { enc: false, plain: payload };
}

export async function decryptBackup(blob, passphraseIfNeeded) {
  if (!blob || typeof blob !== 'object') return err('BAD_BLOB', '备份内容不可读');
  if (!blob.enc) return { ok: true, payload: blob.plain !== undefined ? blob.plain : blob };
  const subtle = getSubtle();
  if (!subtle) return err('NOT_AVAILABLE', '当前环境不支持解密');
  let keyBytes = null;
  const s = getSession();
  if (s?.key && s.mode === MODE.PASSPHRASE) {
    keyBytes = s.key;
  } else if (passphraseIfNeeded) {
    keyBytes = await deriveKeyBits(passphraseIfNeeded, fromB64(blob.salt), blob.iters || PBKDF2_ITERS);
  } else {
    return err('NEED_PASSPHRASE', '这是加密备份，请输入导出时的密码');
  }
  try {
    const plain = await aesDecrypt(keyBytes, blob.iv, blob.cipherText);
    return { ok: true, payload: JSON.parse(plain) };
  } catch {
    return err('DECRYPT_FAILED', '解密失败：密码可能不正确');
  }
}

// ---------------------------------------------------------------------------
// v0.6.0 起：GitHub / Google OAuth 已下线，占位以保持模块 import 兼容
// ---------------------------------------------------------------------------
export async function beginGitHubDeviceFlow() {
  return err('NOT_ENABLED', 'v0.6.0 起已下线 GitHub 登录，请使用匿名 / 本地密码账号');
}
export async function pollGitHubDeviceFlow() {
  throw new Error('NOT_ENABLED');
}
export async function getGitHubToken() { return null; }
export async function signInGoogle() {
  return err('NOT_ENABLED', 'Google 登录已下线');
}

export const Auth = {
  MODE,
  getAuthState,
  isSignedIn,
  setupPassphrase,
  verifyPassphrase,
  changePassphrase,
  evaluatePassphrase,
  signOut,
  getSession,
  lockSession,
  encryptBackup,
  decryptBackup,
  beginGitHubDeviceFlow,
  pollGitHubDeviceFlow,
  getGitHubToken,
  signInGoogle,
};

export default Auth;
