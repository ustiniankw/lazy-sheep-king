// tests/worker.test.mjs — v0.8.0 Cloudflare Worker 路由单测
// 用内存版 KV mock 直接驱动 worker 的 fetch handler，无需 miniflare。
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

const worker = (await import('../worker/src/index.js')).default;
const { _internal } = await import('../worker/src/index.js');

// ---- 内存 KV mock ----
function makeKV() {
  const store = new Map();
  return {
    _store: store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, String(value)); },
    async delete(key) { store.delete(key); },
    async list({ prefix } = {}) {
      const keys = [];
      for (const k of store.keys()) {
        if (!prefix || k.startsWith(prefix)) keys.push({ name: k });
      }
      return { keys };
    },
  };
}

function req(method, path, { body, token, origin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  headers['CF-Connecting-IP'] = '1.2.3.4';
  return new Request(`https://worker.test${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let env;
beforeEach(() => {
  env = { KV: makeKV(), CORS_ORIGINS: 'https://ustiniankw.github.io,http://localhost:8787' };
});

describe('team code 生成', () => {
  it('6 位且避开易混淆字符 0/O/1/I/L', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = _internal.generateTeamCode();
      assert.equal(code.length, 6);
      assert.ok(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(code), `非法队伍码：${code}`);
    }
  });
});

describe('CORS', () => {
  it('OPTIONS 返回 204 + 白名单 Origin', async () => {
    const res = await worker.fetch(req('OPTIONS', '/v1/team/create', { origin: 'https://ustiniankw.github.io' }), env);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://ustiniankw.github.io');
  });
  it('非白名单 Origin 不回显 Allow-Origin', async () => {
    const res = await worker.fetch(req('OPTIONS', '/v1/team/create', { origin: 'https://evil.example' }), env);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  });
});

describe('health', () => {
  it('GET /v1/health', async () => {
    const res = await worker.fetch(req('GET', '/v1/health'), env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.version, '0.8.6');
  });
});

describe('队伍全流程', () => {
  it('create → join → get → heartbeat → poke → leave → delete', async () => {
    // create
    let res = await worker.fetch(req('POST', '/v1/team/create', { body: { founderMemberId: 'm1', founderNickname: '队长' } }), env);
    assert.equal(res.status, 200);
    const created = await res.json();
    assert.ok(created.code && created.token);
    const code = created.code;
    const founderToken = created.token;

    // join
    res = await worker.fetch(req('POST', `/v1/team/${code}/join`, { body: { memberId: 'm2', nickname: '小羊' } }), env);
    assert.equal(res.status, 200);
    const joined = await res.json();
    assert.equal(joined.teamSnapshot.members.length, 2);
    const memberToken = joined.token;

    // get（带 token）
    res = await worker.fetch(req('GET', `/v1/team/${code}`, { token: memberToken }), env);
    assert.equal(res.status, 200);
    const got = await res.json();
    assert.equal(got.team.code, code);

    // get 无 token → 401
    res = await worker.fetch(req('GET', `/v1/team/${code}`), env);
    assert.equal(res.status, 401);

    // heartbeat
    res = await worker.fetch(req('POST', `/v1/team/${code}/heartbeat`, {
      token: memberToken,
      body: { memberId: 'm2', snapshot: { progress: 42, mood: '😀', activeTaskTitle: '写周报' } },
    }), env);
    assert.equal(res.status, 200);
    const hb = await res.json();
    const m2 = hb.team.members.find((m) => m.memberId === 'm2');
    assert.equal(m2.snapshot.progress, 42);

    // poke
    res = await worker.fetch(req('POST', `/v1/team/${code}/poke`, {
      token: founderToken,
      body: { fromMemberId: 'm1', toMemberId: 'm2', emoji: '🔥' },
    }), env);
    assert.equal(res.status, 200);
    const poked = await res.json();
    assert.equal(poked.team.recentPokes.length, 1);
    assert.equal(poked.team.recentPokes[0].emoji, '🔥');

    // leave m2
    res = await worker.fetch(req('POST', `/v1/team/${code}/leave`, { token: memberToken, body: { memberId: 'm2' } }), env);
    assert.equal(res.status, 200);
    const left = await res.json();
    assert.equal(left.team.members.length, 1);

    // delete 非队长 token → 401（m2 token 已随 leave 删除，用假 token）
    res = await worker.fetch(req('DELETE', `/v1/team/${code}`, { token: 'not-founder' }), env);
    assert.equal(res.status, 401);

    // delete 队长 token → 200
    res = await worker.fetch(req('DELETE', `/v1/team/${code}`, { token: founderToken }), env);
    assert.equal(res.status, 200);

    // 已删除 → 404
    res = await worker.fetch(req('GET', `/v1/team/${code}`, { token: founderToken }), env);
    assert.equal(res.status, 404);
  });

  it('create 缺参数 → 400', async () => {
    const res = await worker.fetch(req('POST', '/v1/team/create', { body: { founderMemberId: 'm1' } }), env);
    assert.equal(res.status, 400);
  });

  it('join 不存在的队伍 → 404', async () => {
    const res = await worker.fetch(req('POST', '/v1/team/ZZZZZZ/join', { body: { memberId: 'm9' } }), env);
    assert.equal(res.status, 404);
  });
});

describe('vault', () => {
  it('首次 PUT 建立所有权 → GET → DELETE', async () => {
    // 首次 PUT 需要 newVaultToken
    let res = await worker.fetch(req('PUT', '/v1/vault/vaultA', { body: { ciphertext: 'CIPHER', newVaultToken: 'vt' } }), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).created, true);

    // GET 带正确 token
    res = await worker.fetch(req('GET', '/v1/vault/vaultA', { token: 'vt' }), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ciphertext, 'CIPHER');

    // GET 错误 token → 401
    res = await worker.fetch(req('GET', '/v1/vault/vaultA', { token: 'wrong' }), env);
    assert.equal(res.status, 401);

    // 再次 PUT（已存在）用正确 token 覆盖
    res = await worker.fetch(req('PUT', '/v1/vault/vaultA', { token: 'vt', body: { ciphertext: 'CIPHER2' } }), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).created, false);

    // 再次 PUT 错误 token → 401
    res = await worker.fetch(req('PUT', '/v1/vault/vaultA', { token: 'bad', body: { ciphertext: 'X' } }), env);
    assert.equal(res.status, 401);

    // DELETE
    res = await worker.fetch(req('DELETE', '/v1/vault/vaultA', { token: 'vt' }), env);
    assert.equal(res.status, 200);

    // GET 已删除 → 404
    res = await worker.fetch(req('GET', '/v1/vault/vaultA', { token: 'vt' }), env);
    assert.equal(res.status, 404);
  });

  it('首次 PUT 缺 newVaultToken → 400', async () => {
    const res = await worker.fetch(req('PUT', '/v1/vault/vaultB', { body: { ciphertext: 'X' } }), env);
    assert.equal(res.status, 400);
  });

  it('GET 不存在 vault → 404', async () => {
    const res = await worker.fetch(req('GET', '/v1/vault/none', { token: 't' }), env);
    assert.equal(res.status, 404);
  });
});

describe('速率限制', () => {
  it('超过每分钟 60 次 → 429', async () => {
    // 连续 61 次 health 之外的请求（health 不计入）→ 用不存在 vault GET
    let last;
    for (let i = 0; i < 62; i += 1) {
      last = await worker.fetch(req('GET', '/v1/vault/none', { token: 't' }), env);
    }
    assert.equal(last.status, 429);
  });
});

describe('未知路由 → 404', () => {
  it('GET /v1/unknown', async () => {
    const res = await worker.fetch(req('GET', '/v1/unknown'), env);
    assert.equal(res.status, 404);
  });
});

describe('KV 未绑定', () => {
  it('无 KV 时 health 仍可用，其它 → 500', async () => {
    const emptyEnv = { CORS_ORIGINS: '' };
    let res = await worker.fetch(req('GET', '/v1/health'), emptyEnv);
    assert.equal(res.status, 200);
    res = await worker.fetch(req('POST', '/v1/team/create', { body: { founderMemberId: 'm', founderNickname: 'n' } }), emptyEnv);
    assert.equal(res.status, 500);
  });
});
