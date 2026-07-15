// lib/auth.js — v0.3.5: 认证账号系统（零付费依赖）
// 三种可用模式，全部免费并优雅降级：
//   - guest      : 匿名 userId（与旧版一致）
//   - passphrase : 本地密码账号（Web Crypto PBKDF2 + AES-GCM，任意环境可用）
//   - github     : GitHub OAuth Device Flow（扩展环境优先，Web 试玩遇 CORS 会优雅报错）
//   - google     : Chrome Identity API（骨架，未启用，待发布到商店）
//
// 设计要点：
//   - 所有函数 async、无同步 IO；不在无 guard 的情况下直接使用 chrome.*
//   - 不可用时不抛异常，返回 { ok:false, code, message } 结构
//   - 派生密钥仅存内存（当前 popup 会话），15 分钟无操作自动失效
import { Storage } from './storage.js';
import { createUserId } from './user_id.js';

export const MODE = { GUEST: 'guest', PASSPHRASE: 'passphrase', GITHUB: 'github', GOOGLE: 'google' };

const AUTH_PKEY = 'lsk_auth_v1';
const PBKDF2_ITERS = 100000;
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 分钟无操作自动锁定
const GH_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GH_USER_URL = 'https://api.github.com/user';
const GH_DEFAULT_SCOPE = 'read:user gist';
const WEAK_PASSPHRASES = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'password', 'passw0rd', 'qwerty', 'qwertyui', 'abc123', 'abcdef',
  '111111', '000000', '654321', 'iloveyou', 'admin123', 'letmein',
  '懒羊羊', '000000', 'a123456', '123123', 'aaaaaa',
]);

// ---------------------------------------------------------------------------
// 内存会话（派生密钥永不落盘）
// ---------------------------------------------------------------------------
let session = null; // { keyBytes:Uint8Array, unlockedAt:number, mode, accountKey }

function touchSession() {
  if (session) session.unlockedAt = Date.now();
}

export function getSession() {
  if (!session) return null;
  if (Date.now() - session.unlockedAt > SESSION_TTL_MS) {
    session = null;
    return null;
  }
  return { key: session.keyBytes, mode: session.mode, accountKey: session.accountKey };
}

export function lockSession() {
  session = null;
}

// ---------------------------------------------------------------------------
// 编解码工具
// ---------------------------------------------------------------------------
function getCrypto() {
  return globalThis.crypto || null;
}

function getSubtle() {
  const c = getCrypto();
  return c && c.subtle ? c.subtle : null;
}

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

function err(code, message) {
  return { ok: false, code, message };
}

// ---------------------------------------------------------------------------
// 认证记录（全局，跨账号；不含明文密码/明文密钥）
// ---------------------------------------------------------------------------
function emptyRecord() {
  return {
    version: 1,
    mode: MODE.GUEST,
    guestUserId: '',
    deviceKey: '',
    passphrase: null, // { salt, verifierHash, iters, createdAt, name, userId }
    github: null,     // { providerId, login, name, avatarUrl, email, tokenEnc:{iv,ct}, tokenObtainedAt, boundAt }
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
  // 复用现有 profile 里的匿名 userId（平滑升级：老用户 id 不变）
  const profile = await Storage.getProfile();
  const userId = profile?.userId || createUserId();
  record.guestUserId = userId;
  if (!profile?.userId) {
    await Storage.setProfile({ ...profile, userId, createdAt: profile?.createdAt || Date.now() });
  }
  await writeRecord(record);
  return userId;
}

async function ensureDeviceKey(record) {
  if (record.deviceKey) return fromB64(record.deviceKey);
  const key = randomBytes(32);
  record.deviceKey = toB64(key);
  await writeRecord(record);
  return key;
}

function accountKeyFor(record) {
  if (record.mode === MODE.PASSPHRASE && record.passphrase?.userId) return `p:${record.passphrase.userId}`;
  if (record.mode === MODE.GITHUB && record.github?.providerId) return `gh:${record.github.providerId}`;
  return `guest:${record.guestUserId || 'default'}`;
}

// ---------------------------------------------------------------------------
// PBKDF2 / AES-GCM
// ---------------------------------------------------------------------------
async function deriveKeyBits(passphrase, saltBytes, iters = PBKDF2_ITERS) {
  const subtle = getSubtle();
  if (!subtle) return null;
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey('raw', enc.encode(String(passphrase)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: iters, hash: 'SHA-256' },
    baseKey,
    256,
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

// ---------------------------------------------------------------------------
// 密码强度评估（供 UI 强度条 & 弱密码拦截）
// ---------------------------------------------------------------------------
export function evaluatePassphrase(passphrase) {
  const value = String(passphrase || '');
  if (value.length < 6) {
    return { ok: false, score: 0, level: 'bad', reason: '密码至少 6 位' };
  }
  if (WEAK_PASSPHRASES.has(value.toLowerCase())) {
    return { ok: false, score: 1, level: 'bad', reason: '这个密码太常见啦，换一个吧' };
  }
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
  const base = {
    mode: record.mode || MODE.GUEST,
    userId: record.guestUserId,
    displayName: profile?.displayName || '',
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
  if (record.mode === MODE.GITHUB && record.github) {
    return {
      ...base,
      provider: 'github',
      providerId: record.github.providerId,
      login: record.github.login,
      displayName: profile?.displayName || record.github.name || record.github.login,
      avatarUrl: record.github.avatarUrl || '',
      email: record.github.email || '',
      verified: true,
      boundAt: record.github.boundAt || record.boundAt || 0,
    };
  }
  return base;
}

export async function isSignedIn() {
  const record = await readRecord();
  if (record.mode === MODE.PASSPHRASE) return getSession() !== null;
  if (record.mode === MODE.GITHUB) return !!record.github?.tokenEnc;
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
  const userId = guestUserId; // 平滑升级：沿用匿名 userId

  record.mode = MODE.PASSPHRASE;
  record.passphrase = {
    salt: toB64(salt),
    verifierHash,
    iters: PBKDF2_ITERS,
    createdAt: Date.now(),
    name: String(name || '').trim() || '懒羊羊伙伴',
    userId,
  };
  record.boundAt = Date.now();
  await writeRecord(record);

  // 把访客数据平滑迁移到密码账号命名空间
  const accountKey = `p:${userId}`;
  await Storage.copyAccountData(guestAccountKey, accountKey, { overwrite: false });
  await Storage.switchAccount(accountKey);
  await Storage.setProfile({ ...(await Storage.getProfile()), displayName: record.passphrase.name });

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

// ---------------------------------------------------------------------------
// GitHub OAuth Device Flow
// ---------------------------------------------------------------------------
function ghFetchUnavailable(error) {
  const message = '网页试玩环境无法完成 GitHub 登录，请在安装扩展后使用';
  return { ...err('NOT_AVAILABLE', message), detail: String(error?.message || error || '') };
}

async function githubPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function beginGitHubDeviceFlow(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return err('MISSING_CLIENT_ID', '请先填写你自己的 GitHub OAuth App client_id');
  if (typeof fetch !== 'function') return err('NOT_AVAILABLE', '当前环境不支持网络请求，无法进行 GitHub 登录');
  try {
    const data = await githubPost(GH_DEVICE_CODE_URL, { client_id: id, scope: GH_DEFAULT_SCOPE });
    if (data?.error) return err('GITHUB_ERROR', data.error_description || data.error);
    if (!data?.device_code || !data?.user_code) return err('GITHUB_ERROR', 'GitHub 未返回设备码');
    return {
      ok: true,
      userCode: data.user_code,
      verificationUri: data.verification_uri || 'https://github.com/login/device',
      deviceCode: data.device_code,
      interval: Number(data.interval || 5),
      expiresIn: Number(data.expires_in || 900),
    };
  } catch (error) {
    return ghFetchUnavailable(error);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollGitHubDeviceFlow({ clientId, deviceCode, interval, expiresIn }) {
  const id = String(clientId || '').trim();
  if (!id) throw new Error('MISSING_CLIENT_ID');
  if (!deviceCode) throw new Error('MISSING_DEVICE_CODE');
  if (typeof fetch !== 'function') throw new Error('NOT_AVAILABLE');
  const deadline = Date.now() + Math.max(1, Number(expiresIn || 900)) * 1000;
  let waitMs = Math.max(0, Number(interval || 5)) * 1000;

  while (Date.now() < deadline) {
    await sleep(waitMs);
    let data;
    try {
      data = await githubPost(GH_TOKEN_URL, {
        client_id: id,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
    } catch (error) {
      throw new Error(`NETWORK:${error?.message || error}`);
    }
    if (data?.access_token) {
      return finalizeGitHub(id, data.access_token);
    }
    const e = data?.error;
    if (e === 'authorization_pending') continue;
    if (e === 'slow_down') { waitMs += 5000; continue; }
    if (e === 'expired_token') throw new Error('EXPIRED');
    if (e === 'access_denied') throw new Error('ACCESS_DENIED');
    if (e) throw new Error(String(e));
  }
  throw new Error('EXPIRED');
}

async function finalizeGitHub(clientId, accessToken) {
  let profileData;
  try {
    const res = await fetch(GH_USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    profileData = await res.json();
  } catch (error) {
    throw new Error(`USER_FETCH_FAILED:${error?.message || error}`);
  }
  if (!profileData?.id) throw new Error('USER_FETCH_FAILED');

  const record = await readRecord();
  await ensureGuestUserId(record);
  const guestAccountKey = `guest:${record.guestUserId}`;
  const deviceKey = await ensureDeviceKey(record);
  const tokenEnc = await aesEncrypt(deviceKey, accessToken);

  const providerId = String(profileData.id);
  record.mode = MODE.GITHUB;
  record.github = {
    provider: 'github',
    providerId,
    login: profileData.login || '',
    name: profileData.name || profileData.login || '',
    avatarUrl: profileData.avatar_url || '',
    email: profileData.email || '',
    clientId,
    tokenEnc,
    tokenObtainedAt: Date.now(),
    boundAt: Date.now(),
  };
  record.boundAt = Date.now();
  await writeRecord(record);

  const accountKey = `gh:${providerId}`;
  await Storage.copyAccountData(guestAccountKey, accountKey, { overwrite: false });
  await Storage.switchAccount(accountKey);
  await Storage.setProfile({
    ...(await Storage.getProfile()),
    displayName: (await Storage.getProfile())?.displayName || record.github.name,
  });
  session = { keyBytes: deviceKey, unlockedAt: Date.now(), mode: MODE.GITHUB, accountKey };
  return getAuthState();
}

// 读取解密后的 GitHub token（供后续 Gist 同步；best-effort）
export async function getGitHubToken() {
  const record = await readRecord();
  if (!record.github?.tokenEnc) return null;
  const deviceKey = record.deviceKey ? fromB64(record.deviceKey) : null;
  if (!deviceKey) return null;
  try {
    return await aesDecrypt(deviceKey, record.github.tokenEnc.iv, record.github.tokenEnc.ct);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Google（骨架，未启用）
// ---------------------------------------------------------------------------
export async function signInGoogle() {
  return err('NOT_ENABLED', 'Google 登录需先把扩展发布到 Chrome Web Store 并配置稳定的 OAuth2 client_id');
}

// ---------------------------------------------------------------------------
// 退出账户（回到访客，保留本地数据）
// ---------------------------------------------------------------------------
export async function signOut() {
  const record = await readRecord();
  const guestUserId = await ensureGuestUserId(record);
  if (record.mode === MODE.GITHUB && record.github) {
    // best-effort：撤销 token（Web/CORS 可能失败，忽略）
    try {
      const token = await getGitHubToken();
      if (token && record.github.clientId && typeof fetch === 'function') {
        await fetch(`https://api.github.com/applications/${record.github.clientId}/token`, {
          method: 'DELETE',
          headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: token }),
        }).catch(() => {});
      }
    } catch { /* ignore */ }
    record.github = null;
  }
  record.mode = MODE.GUEST;
  await writeRecord(record);
  lockSession();
  await Storage.switchAccount(`guest:${guestUserId}`);
  return getAuthState();
}

// ---------------------------------------------------------------------------
// 备份加解密
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
  } catch (error) {
    return err('DECRYPT_FAILED', '解密失败：密码可能不正确');
  }
}

export const Auth = {
  MODE,
  getAuthState,
  isSignedIn,
  setupPassphrase,
  verifyPassphrase,
  changePassphrase,
  evaluatePassphrase,
  beginGitHubDeviceFlow,
  pollGitHubDeviceFlow,
  getGitHubToken,
  signInGoogle,
  signOut,
  getSession,
  lockSession,
  encryptBackup,
  decryptBackup,
};

export default Auth;
