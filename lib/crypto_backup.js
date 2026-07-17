// lib/crypto_backup.js — v0.7.0 备份短语 + 端到端加密（纯函数、可测）
// 设计目标：
//  - 完全离线；不依赖任何服务器。加密数据只在本地下载。
//  - 短语（助记词）永不落磁盘明文；storage 只保存 mnemonicHash（SHA-256）用于校验。
//  - 兼容浏览器（globalThis.crypto）与 Node（Node20+ 有 globalThis.crypto；Node<20 由调用方
//    用 `import { webcrypto } from 'node:crypto'` 兜底注入 globalThis.crypto）。
import { WORDLIST, WORDLIST_SET } from './wordlist.js';

export const DEFAULT_WORD_COUNT = 14;
export const PBKDF2_ITERS = 100000;
const IV_BYTES = 12;
const DEFAULT_SALT = 'lazy-sheep-king-backup-v1';

// ---------------------------------------------------------------------------
// WebCrypto 兜底获取
// ---------------------------------------------------------------------------
let _cryptoObj = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle)
  ? globalThis.crypto
  : null;

async function getCrypto() {
  if (_cryptoObj && _cryptoObj.subtle) return _cryptoObj;
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    _cryptoObj = globalThis.crypto;
    return _cryptoObj;
  }
  // Node < 20 兜底：动态引入 node:crypto（浏览器里 import 会失败，被 catch 掉）
  try {
    const mod = await import('node:crypto');
    if (mod?.webcrypto?.subtle) {
      _cryptoObj = mod.webcrypto;
      return _cryptoObj;
    }
  } catch {
    /* 浏览器环境：忽略 */
  }
  throw new Error('WebCrypto 不可用：当前环境缺少 crypto.subtle');
}

function fillRandom(view) {
  const c = _cryptoObj
    || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('WebCrypto getRandomValues 不可用');
  }
  return c.getRandomValues(view);
}

// ---------------------------------------------------------------------------
// base64 / hex helpers（浏览器 & Node 双兼容）
// ---------------------------------------------------------------------------
function bytesToB64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}

function b64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(String(b64 || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(String(b64 || ''), 'base64'));
}

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// 助记词（备份短语）
// ---------------------------------------------------------------------------
export function normalizeMnemonic(mnemonic) {
  return String(mnemonic == null ? '' : mnemonic)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * 生成备份短语。词表 512 词（2^9），uint32 % 512 无模偏差。
 * @param {number} wordCount 词数，默认 14（≈126 bit 熵）
 * @returns {string} 以空格分隔的短语
 */
export function generateMnemonic(wordCount = DEFAULT_WORD_COUNT) {
  const n = Math.max(1, Math.floor(Number(wordCount) || DEFAULT_WORD_COUNT));
  const rnd = new Uint32Array(n);
  fillRandom(rnd);
  const size = WORDLIST.length;
  const words = new Array(n);
  for (let i = 0; i < n; i += 1) words[i] = WORDLIST[rnd[i] % size];
  return words.join(' ');
}

/**
 * 校验短语：词数正确 + 每个单词都在词表内。
 * @param {string} mnemonic
 * @param {number} expectedWordCount 期望词数，默认 14
 * @returns {boolean}
 */
export function validateMnemonic(mnemonic, expectedWordCount = DEFAULT_WORD_COUNT) {
  if (typeof mnemonic !== 'string') return false;
  const words = normalizeMnemonic(mnemonic).split(' ').filter(Boolean);
  if (words.length !== expectedWordCount) return false;
  return words.every((w) => WORDLIST_SET.has(w));
}

/**
 * 短语的 SHA-256 hex，用于校验用户后续输入是否是同一短语（不落明文）。
 * @param {string} mnemonic
 * @returns {Promise<string>} 64 位十六进制
 */
export async function mnemonicHash(mnemonic) {
  const crypto = await getCrypto();
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(normalizeMnemonic(mnemonic)));
  return toHex(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// 密钥派生 + 加解密
// ---------------------------------------------------------------------------
/**
 * PBKDF2-SHA256 100k rounds → 32 byte AES-GCM CryptoKey。
 * @param {string} mnemonic 备份短语
 * @param {string|Uint8Array} [salt] 盐值，默认内置常量
 * @returns {Promise<CryptoKey>}
 */
export async function mnemonicToKey(mnemonic, salt = DEFAULT_SALT) {
  const crypto = await getCrypto();
  const enc = new TextEncoder();
  const saltBytes = salt instanceof Uint8Array ? salt : enc.encode(String(salt ?? DEFAULT_SALT));
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(normalizeMnemonic(mnemonic)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * AES-GCM 加密。随机 12-byte IV。输出 base64（iv + ct）。
 * @param {string|object} data 明文（对象会 JSON.stringify）
 * @param {CryptoKey} key
 * @returns {Promise<{v:number, alg:string, iv:string, ct:string}>}
 */
export async function encryptBlob(data, key) {
  const crypto = await getCrypto();
  const iv = new Uint8Array(IV_BYTES);
  fillRandom(iv);
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { v: 1, alg: 'AES-GCM', iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
}

/**
 * AES-GCM 解密。密钥不匹配 / 数据被篡改会 reject。
 * @param {{iv:string, ct:string}} blob encryptBlob 的输出
 * @param {CryptoKey} key
 * @returns {Promise<string>} 明文字符串
 */
export async function decryptBlob(blob, key) {
  if (!blob || typeof blob.iv !== 'string' || typeof blob.ct !== 'string') {
    throw new Error('无效的加密数据块');
  }
  const crypto = await getCrypto();
  const iv = b64ToBytes(blob.iv);
  const ct = b64ToBytes(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(new Uint8Array(pt));
}

// ---------------------------------------------------------------------------
// 便捷组合：直接用短语加/解密（UI 使用）
// ---------------------------------------------------------------------------
export async function encryptWithMnemonic(data, mnemonic, salt = DEFAULT_SALT) {
  const key = await mnemonicToKey(mnemonic, salt);
  const blob = await encryptBlob(data, key);
  return { ...blob, salt: typeof salt === 'string' ? salt : DEFAULT_SALT };
}

export async function decryptWithMnemonic(blob, mnemonic) {
  const salt = blob && typeof blob.salt === 'string' ? blob.salt : DEFAULT_SALT;
  const key = await mnemonicToKey(mnemonic, salt);
  const text = await decryptBlob(blob, key);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export default {
  DEFAULT_WORD_COUNT,
  PBKDF2_ITERS,
  generateMnemonic,
  validateMnemonic,
  normalizeMnemonic,
  mnemonicHash,
  mnemonicToKey,
  encryptBlob,
  decryptBlob,
  encryptWithMnemonic,
  decryptWithMnemonic,
};
