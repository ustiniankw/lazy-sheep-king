// lib/sync_client.js — v0.8.0 云同步 fetch 客户端（纯函数）
// 设计：
//  - 每个 API 函数拿到空 backendUrl 时立即抛 SyncDisabledError（调用方 catch 后走本地）
//  - 网络错误自动重试 1 次；每次请求 6s 超时
//  - 不依赖任何框架；浏览器与 Node（node --test）均可运行
import { API_VERSION_PATH } from './sync_config.js';

export const REQUEST_TIMEOUT_MS = 6000;
export const RETRY_COUNT = 1; // 网络错误时额外重试次数

export class SyncDisabledError extends Error {
  constructor(message = '云同步未启用（backendUrl 为空）') {
    super(message);
    this.name = 'SyncDisabledError';
    this.code = 'sync_disabled';
  }
}

export class SyncHttpError extends Error {
  constructor(status, body, message) {
    super(message || `云同步请求失败：HTTP ${status}`);
    this.name = 'SyncHttpError';
    this.status = status;
    this.body = body;
  }
}

function normalizeBase(backendUrl) {
  if (backendUrl == null || backendUrl === '') throw new SyncDisabledError();
  const url = String(backendUrl).trim();
  if (!url) throw new SyncDisabledError();
  return url.replace(/\/+$/, '');
}

function apiUrl(backendUrl, path) {
  const base = normalizeBase(backendUrl);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${API_VERSION_PATH}${suffix}`;
}

// 单次 fetch，带超时。超时 / 网络错误会 throw（供重试判断）。
async function fetchOnce(url, options, timeoutMs) {
  const fetchFn = globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('当前环境没有 fetch');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  if (controller) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const res = await fetchFn(url, { ...options, signal: controller ? controller.signal : undefined });
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 是否属于「值得重试」的错误（网络错误 / 超时 / abort）
function isRetriableError(error) {
  if (!error) return false;
  const name = error.name || '';
  return name === 'AbortError' || name === 'TypeError' || name === 'FetchError' || /network|fetch|timeout/i.test(String(error.message || ''));
}

async function requestJson(backendUrl, path, { method = 'GET', body, token } = {}) {
  const url = apiUrl(backendUrl, path); // 会在 backendUrl 为空时抛 SyncDisabledError
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers };
  if (body !== undefined) options.body = JSON.stringify(body);

  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt += 1) {
    try {
      const res = await fetchOnce(url, options, REQUEST_TIMEOUT_MS);
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new SyncHttpError(res.status, data, data && data.message);
      }
      return data;
    } catch (error) {
      lastError = error;
      // HTTP 错误（有明确状态码）不重试；仅网络错误重试
      if (error instanceof SyncHttpError) throw error;
      if (attempt < RETRY_COUNT && isRetriableError(error)) continue;
      throw error;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// 队伍
// ---------------------------------------------------------------------------
export async function createTeam({ backendUrl, founder }) {
  const f = founder || {};
  return requestJson(backendUrl, '/team/create', {
    method: 'POST',
    body: {
      founderMemberId: f.memberId,
      founderNickname: f.nickname,
      founderAvatarSeed: f.avatarSeed,
      founderAvatarUrl: f.avatarUrl,
      founderAvatarKind: f.avatarKind,
      founderPubKey: f.pubKey,
    },
  });
}

export async function joinTeam({ backendUrl, code, member }) {
  const m = member || {};
  return requestJson(backendUrl, `/team/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: {
      memberId: m.memberId,
      nickname: m.nickname,
      avatarSeed: m.avatarSeed,
      avatarUrl: m.avatarUrl,
      avatarKind: m.avatarKind,
      pubKey: m.pubKey,
    },
  });
}

export async function getTeam({ backendUrl, code, token }) {
  return requestJson(backendUrl, `/team/${encodeURIComponent(code)}`, { method: 'GET', token });
}

export async function heartbeat({ backendUrl, code, token, memberId, snapshot, nickname, avatarSeed, avatarUrl, avatarKind }) {
  return requestJson(backendUrl, `/team/${encodeURIComponent(code)}/heartbeat`, {
    method: 'POST',
    token,
    body: { memberId, snapshot, nickname, avatarSeed, avatarUrl, avatarKind },
  });
}

export async function poke({ backendUrl, code, token, from, to, emoji }) {
  return requestJson(backendUrl, `/team/${encodeURIComponent(code)}/poke`, {
    method: 'POST',
    token,
    body: { fromMemberId: from, toMemberId: to, emoji },
  });
}

export async function leaveTeam({ backendUrl, code, token, memberId }) {
  return requestJson(backendUrl, `/team/${encodeURIComponent(code)}/leave`, {
    method: 'POST',
    token,
    body: { memberId },
  });
}

// ---------------------------------------------------------------------------
// E2E 加密 vault
// ---------------------------------------------------------------------------
export async function putVault({ backendUrl, vaultId, ciphertext, token, newVaultToken }) {
  const body = { ciphertext };
  // 首次上传时用 newVaultToken 建立所有权（若未显式提供，回退用 token）
  if (newVaultToken || token) body.newVaultToken = newVaultToken || token;
  return requestJson(backendUrl, `/vault/${encodeURIComponent(vaultId)}`, {
    method: 'PUT',
    token,
    body,
  });
}

export async function getVault({ backendUrl, vaultId, token }) {
  return requestJson(backendUrl, `/vault/${encodeURIComponent(vaultId)}`, { method: 'GET', token });
}

export async function deleteVault({ backendUrl, vaultId, token }) {
  return requestJson(backendUrl, `/vault/${encodeURIComponent(vaultId)}`, { method: 'DELETE', token });
}

// ---------------------------------------------------------------------------
// 健康检查
// ---------------------------------------------------------------------------
export async function pingHealth({ backendUrl }) {
  return requestJson(backendUrl, '/health', { method: 'GET' });
}

export default {
  SyncDisabledError,
  SyncHttpError,
  REQUEST_TIMEOUT_MS,
  RETRY_COUNT,
  createTeam,
  joinTeam,
  getTeam,
  heartbeat,
  poke,
  leaveTeam,
  putVault,
  getVault,
  deleteVault,
  pingHealth,
};
