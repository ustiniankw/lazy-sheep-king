// worker/src/index.js — lsk-sync v0.8.0
// 懒羊羊大王 · 云同步后端（Cloudflare Workers + KV，免费 tier）
// 职责：
//   1) 队伍状态（team code + 成员快照 + 拍一拍）
//   2) E2E 加密用户 blob（vault，服务端不解密，只做存取）
// 设计原则：
//   - 无外部依赖，纯手写路由（原生 fetch handler）
//   - KV-only，无数据库
//   - 响应统一 JSON，携带 CORS 头
//   - 轻量速率限制（每 IP 每分钟 60 次）
//   - 端到端：vault 密文对服务端不可读；vaultToken 由前端 SHA-256 派生

const VERSION = '0.8.0';

// KV TTL：token / vault owner 90 天
const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
// 速率限制窗口 90s（覆盖跨分钟边界）
const RATE_LIMIT_TTL_SECONDS = 90;
const RATE_LIMIT_PER_MINUTE = 60;
// recentPokes 保留条数
const RECENT_POKES_LIMIT = 20;
// 队伍码字符集：避开易混淆 0/O/1/I/L
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
// 创建队伍时最多重试生成不冲突的队伍码
const CODE_CREATE_RETRIES = 6;

// 默认 CORS 白名单（可被 env.CORS_ORIGINS 覆盖）
const DEFAULT_CORS_ORIGINS = [
  'https://ustiniankw.github.io',
  'http://localhost:8787',
];

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
function parseCorsOrigins(env) {
  const raw = (env && typeof env.CORS_ORIGINS === 'string') ? env.CORS_ORIGINS : '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CORS_ORIGINS.slice();
}

function resolveAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return '';
  const allowed = parseCorsOrigins(env);
  // 精确匹配；支持 '*' 通配（若用户显式配置）
  if (allowed.includes('*')) return origin;
  return allowed.includes(origin) ? origin : '';
}

function corsHeaders(request, env) {
  const allowOrigin = resolveAllowedOrigin(request, env);
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  return headers;
}

function jsonResponse(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
    },
  });
}

function errorResponse(status, code, message, request, env) {
  return jsonResponse({ ok: false, error: code, message: message || code }, status, request, env);
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateTeamCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? match[1].trim() : '';
}

async function readJson(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return null; // 解析失败
  }
}

function tokenKey(code, memberId) {
  return `token:${code}:${memberId}`;
}

function teamKey(code) {
  return `team:${code}`;
}

function vaultKey(vaultId) {
  return `vault:${vaultId}`;
}

function vaultOwnerKey(vaultId) {
  return `vaultowner:${vaultId}`;
}

function nowMs() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// 速率限制：每 IP 每分钟 RATE_LIMIT_PER_MINUTE 次
// ---------------------------------------------------------------------------
async function checkRateLimit(request, env) {
  if (!env || !env.KV) return true; // KV 不可用时不拦截
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')
    || 'unknown';
  const minute = Math.floor(nowMs() / 60000);
  const key = `rl:${ip}:${minute}`;
  const current = Number((await env.KV.get(key)) || 0);
  if (current >= RATE_LIMIT_PER_MINUTE) return false;
  await env.KV.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_TTL_SECONDS });
  return true;
}

// ---------------------------------------------------------------------------
// 队伍数据读写
// ---------------------------------------------------------------------------
async function loadTeam(env, code) {
  const raw = await env.KV.get(teamKey(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveTeam(env, team) {
  await env.KV.put(teamKey(team.code), JSON.stringify(team));
}

async function tokenValid(env, code, token) {
  if (!token) return false;
  // 校验 token 是否属于该队伍内的任一成员
  const list = await env.KV.list({ prefix: `token:${code}:` });
  for (const entry of list.keys) {
    const value = await env.KV.get(entry.name);
    if (value) {
      // token 存的是 token 本身作为 value（见签发逻辑）
      if (value === token) return { memberId: entry.name.slice(`token:${code}:`.length) };
    }
  }
  return false;
}

async function issueToken(env, code, memberId) {
  const token = randomBase64Url(32);
  await env.KV.put(tokenKey(code, memberId), token, { expirationTtl: TOKEN_TTL_SECONDS });
  return token;
}

function newMember({ memberId, nickname, avatarSeed, pubKey }) {
  const ts = nowMs();
  return {
    memberId: String(memberId),
    nickname: String(nickname || '懒羊羊伙伴'),
    avatarSeed: avatarSeed ? String(avatarSeed) : '',
    pubKey: pubKey ? String(pubKey) : undefined,
    joinedAt: ts,
    lastSeenAt: ts,
    snapshot: null,
  };
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const out = {
    progress: Number(snapshot.progress || 0),
    mood: snapshot.mood ? String(snapshot.mood) : '',
  };
  if (snapshot.activeTaskTitle) out.activeTaskTitle = String(snapshot.activeTaskTitle).slice(0, 200);
  return out;
}

// ---------------------------------------------------------------------------
// 路由 handlers
// ---------------------------------------------------------------------------
async function handleHealth(request, env) {
  return jsonResponse({ ok: true, version: VERSION }, 200, request, env);
}

async function handleTeamCreate(request, env) {
  const body = await readJson(request);
  if (!body || !body.founderMemberId || !body.founderNickname) {
    return errorResponse(400, 'bad_request', '缺少 founderMemberId / founderNickname', request, env);
  }
  // 生成不冲突的队伍码
  let code = '';
  for (let i = 0; i < CODE_CREATE_RETRIES; i += 1) {
    const candidate = generateTeamCode();
    const existing = await env.KV.get(teamKey(candidate));
    if (!existing) { code = candidate; break; }
  }
  if (!code) return errorResponse(409, 'code_conflict', '队伍码生成冲突，请重试', request, env);

  const founder = newMember({
    memberId: body.founderMemberId,
    nickname: body.founderNickname,
    avatarSeed: body.founderAvatarSeed,
    pubKey: body.founderPubKey,
  });
  const team = {
    code,
    createdAt: nowMs(),
    founderMemberId: String(body.founderMemberId),
    members: [founder],
    recentPokes: [],
    version: 1,
  };
  await saveTeam(env, team);
  const token = await issueToken(env, code, founder.memberId);
  return jsonResponse({ ok: true, code, token, memberId: founder.memberId }, 200, request, env);
}

async function handleTeamJoin(request, env, code) {
  const body = await readJson(request);
  if (!body || !body.memberId) {
    return errorResponse(400, 'bad_request', '缺少 memberId', request, env);
  }
  const team = await loadTeam(env, code);
  if (!team) return errorResponse(404, 'not_found', '队伍不存在', request, env);

  const existingIdx = team.members.findIndex((m) => m.memberId === String(body.memberId));
  if (existingIdx >= 0) {
    // 已在队伍：更新资料 + lastSeenAt
    team.members[existingIdx] = {
      ...team.members[existingIdx],
      nickname: String(body.nickname || team.members[existingIdx].nickname),
      avatarSeed: body.avatarSeed ? String(body.avatarSeed) : team.members[existingIdx].avatarSeed,
      pubKey: body.pubKey ? String(body.pubKey) : team.members[existingIdx].pubKey,
      lastSeenAt: nowMs(),
    };
  } else {
    team.members.push(newMember({
      memberId: body.memberId,
      nickname: body.nickname,
      avatarSeed: body.avatarSeed,
      pubKey: body.pubKey,
    }));
  }
  team.version = Number(team.version || 1) + 1;
  await saveTeam(env, team);
  const token = await issueToken(env, code, String(body.memberId));
  return jsonResponse({ ok: true, code, token, teamSnapshot: team }, 200, request, env);
}

async function handleTeamGet(request, env, code) {
  const token = bearerToken(request);
  const team = await loadTeam(env, code);
  if (!team) return errorResponse(404, 'not_found', '队伍不存在', request, env);
  const valid = await tokenValid(env, code, token);
  if (!valid) return errorResponse(401, 'unauthorized', 'token 无效', request, env);
  return jsonResponse({ ok: true, team }, 200, request, env);
}

async function handleTeamHeartbeat(request, env, code) {
  const token = bearerToken(request);
  const body = await readJson(request);
  if (!body || !body.memberId) return errorResponse(400, 'bad_request', '缺少 memberId', request, env);
  const team = await loadTeam(env, code);
  if (!team) return errorResponse(404, 'not_found', '队伍不存在', request, env);
  const valid = await tokenValid(env, code, token);
  if (!valid) return errorResponse(401, 'unauthorized', 'token 无效', request, env);

  const idx = team.members.findIndex((m) => m.memberId === String(body.memberId));
  if (idx < 0) return errorResponse(404, 'member_not_found', '成员不在队伍中', request, env);
  team.members[idx].snapshot = sanitizeSnapshot(body.snapshot);
  team.members[idx].lastSeenAt = nowMs();
  team.version = Number(team.version || 1) + 1;
  await saveTeam(env, team);
  return jsonResponse({ ok: true, team }, 200, request, env);
}

async function handleTeamPoke(request, env, code) {
  const token = bearerToken(request);
  const body = await readJson(request);
  if (!body || !body.fromMemberId || !body.toMemberId) {
    return errorResponse(400, 'bad_request', '缺少 fromMemberId / toMemberId', request, env);
  }
  const team = await loadTeam(env, code);
  if (!team) return errorResponse(404, 'not_found', '队伍不存在', request, env);
  const valid = await tokenValid(env, code, token);
  if (!valid) return errorResponse(401, 'unauthorized', 'token 无效', request, env);

  const poke = {
    pokeId: `poke_${nowMs().toString(36)}_${randomBase64Url(4)}`,
    fromMemberId: String(body.fromMemberId),
    toMemberId: String(body.toMemberId),
    emoji: String(body.emoji || '👊'),
    ts: nowMs(),
  };
  team.recentPokes = [poke, ...(Array.isArray(team.recentPokes) ? team.recentPokes : [])].slice(0, RECENT_POKES_LIMIT);
  team.version = Number(team.version || 1) + 1;
  await saveTeam(env, team);
  return jsonResponse({ ok: true, poke, team }, 200, request, env);
}

async function handleTeamLeave(request, env, code) {
  const token = bearerToken(request);
  const body = await readJson(request);
  if (!body || !body.memberId) return errorResponse(400, 'bad_request', '缺少 memberId', request, env);
  const team = await loadTeam(env, code);
  if (!team) return errorResponse(404, 'not_found', '队伍不存在', request, env);
  const valid = await tokenValid(env, code, token);
  if (!valid) return errorResponse(401, 'unauthorized', 'token 无效', request, env);

  team.members = team.members.filter((m) => m.memberId !== String(body.memberId));
  team.version = Number(team.version || 1) + 1;
  await env.KV.delete(tokenKey(code, String(body.memberId)));
  await saveTeam(env, team);
  return jsonResponse({ ok: true, team }, 200, request, env);
}

async function handleTeamDelete(request, env, code) {
  const token = bearerToken(request);
  const team = await loadTeam(env, code);
  if (!team) return errorResponse(404, 'not_found', '队伍不存在', request, env);
  // 只允许 founder token
  const founderToken = await env.KV.get(tokenKey(code, team.founderMemberId));
  if (!token || token !== founderToken) {
    return errorResponse(401, 'unauthorized', '只有队长可以解散队伍', request, env);
  }
  // 清理 token 与队伍
  const list = await env.KV.list({ prefix: `token:${code}:` });
  for (const entry of list.keys) await env.KV.delete(entry.name);
  await env.KV.delete(teamKey(code));
  return jsonResponse({ ok: true, deleted: code }, 200, request, env);
}

// ---- vault ----
async function handleVaultPut(request, env, vaultId) {
  const body = await readJson(request);
  if (!body || typeof body.ciphertext !== 'string' || !body.ciphertext) {
    return errorResponse(400, 'bad_request', '缺少 ciphertext', request, env);
  }
  const token = bearerToken(request);
  const owner = await env.KV.get(vaultOwnerKey(vaultId));
  if (!owner) {
    // 首次上传：需 newVaultToken 建立所有权
    const newToken = String(body.newVaultToken || '').trim();
    if (!newToken) return errorResponse(400, 'bad_request', '首次上传需带 newVaultToken', request, env);
    await env.KV.put(vaultOwnerKey(vaultId), newToken, { expirationTtl: TOKEN_TTL_SECONDS });
    await env.KV.put(vaultKey(vaultId), body.ciphertext);
    return jsonResponse({ ok: true, vaultId, created: true }, 200, request, env);
  }
  // 已存在：校验 token
  if (!token || token !== owner) return errorResponse(401, 'unauthorized', 'vaultToken 无效', request, env);
  await env.KV.put(vaultKey(vaultId), body.ciphertext);
  // 续期所有权 TTL
  await env.KV.put(vaultOwnerKey(vaultId), owner, { expirationTtl: TOKEN_TTL_SECONDS });
  return jsonResponse({ ok: true, vaultId, created: false }, 200, request, env);
}

async function handleVaultGet(request, env, vaultId) {
  const token = bearerToken(request);
  const owner = await env.KV.get(vaultOwnerKey(vaultId));
  if (!owner) return errorResponse(404, 'not_found', 'vault 不存在', request, env);
  if (!token || token !== owner) return errorResponse(401, 'unauthorized', 'vaultToken 无效', request, env);
  const ciphertext = await env.KV.get(vaultKey(vaultId));
  if (ciphertext == null) return errorResponse(404, 'not_found', 'vault 不存在', request, env);
  return jsonResponse({ ok: true, vaultId, ciphertext }, 200, request, env);
}

async function handleVaultDelete(request, env, vaultId) {
  const token = bearerToken(request);
  const owner = await env.KV.get(vaultOwnerKey(vaultId));
  if (!owner) return errorResponse(404, 'not_found', 'vault 不存在', request, env);
  if (!token || token !== owner) return errorResponse(401, 'unauthorized', 'vaultToken 无效', request, env);
  await env.KV.delete(vaultKey(vaultId));
  await env.KV.delete(vaultOwnerKey(vaultId));
  return jsonResponse({ ok: true, deleted: vaultId }, 200, request, env);
}

// ---------------------------------------------------------------------------
// 路由分发
// ---------------------------------------------------------------------------
async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  // Preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  // 健康检查
  if (pathname === '/v1/health' && method === 'GET') {
    return handleHealth(request, env);
  }

  // 队伍
  if (pathname === '/v1/team/create' && method === 'POST') {
    return handleTeamCreate(request, env);
  }

  const teamMatch = /^\/v1\/team\/([^/]+)(\/(join|heartbeat|poke|leave))?$/.exec(pathname);
  if (teamMatch) {
    const code = normalizeCode(decodeURIComponent(teamMatch[1]));
    const sub = teamMatch[3];
    if (!sub && method === 'GET') return handleTeamGet(request, env, code);
    if (!sub && method === 'DELETE') return handleTeamDelete(request, env, code);
    if (sub === 'join' && method === 'POST') return handleTeamJoin(request, env, code);
    if (sub === 'heartbeat' && method === 'POST') return handleTeamHeartbeat(request, env, code);
    if (sub === 'poke' && method === 'POST') return handleTeamPoke(request, env, code);
    if (sub === 'leave' && method === 'POST') return handleTeamLeave(request, env, code);
    return errorResponse(404, 'not_found', '路由不存在', request, env);
  }

  // vault
  const vaultMatch = /^\/v1\/vault\/([^/]+)$/.exec(pathname);
  if (vaultMatch) {
    const vaultId = decodeURIComponent(vaultMatch[1]);
    if (method === 'PUT') return handleVaultPut(request, env, vaultId);
    if (method === 'GET') return handleVaultGet(request, env, vaultId);
    if (method === 'DELETE') return handleVaultDelete(request, env, vaultId);
    return errorResponse(404, 'not_found', '路由不存在', request, env);
  }

  return errorResponse(404, 'not_found', '路由不存在', request, env);
}

export default {
  async fetch(request, env) {
    try {
      // KV 绑定检查（除健康检查外）
      const url = new URL(request.url);
      if (!env || !env.KV) {
        if (url.pathname === '/v1/health' && request.method === 'GET') {
          return handleHealth(request, env);
        }
        if (request.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: corsHeaders(request, env) });
        }
        return errorResponse(500, 'kv_unbound', 'KV 未绑定：请在 wrangler.toml 配置 [[kv_namespaces]]', request, env);
      }

      // 速率限制（OPTIONS / health 不计入）
      if (request.method !== 'OPTIONS' && url.pathname !== '/v1/health') {
        const allowed = await checkRateLimit(request, env);
        if (!allowed) return errorResponse(429, 'rate_limited', '请求过于频繁，请稍后再试', request, env);
      }

      return await route(request, env);
    } catch (error) {
      return errorResponse(500, 'internal_error', String(error?.message || error), request, env);
    }
  },
};

// 供本地单测复用的内部函数（Node 环境按需 import）
export const _internal = {
  VERSION,
  generateTeamCode,
  randomBase64Url,
  parseCorsOrigins,
  resolveAllowedOrigin,
  sanitizeSnapshot,
  CODE_ALPHABET,
  CODE_LENGTH,
  RATE_LIMIT_PER_MINUTE,
  RECENT_POKES_LIMIT,
};
