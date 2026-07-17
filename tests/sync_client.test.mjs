// tests/sync_client.test.mjs — v0.8.0 云同步 fetch 客户端单测
// 通过 mock globalThis.fetch 覆盖：createTeam / joinTeam / heartbeat / poke /
// vault put+get+delete / health / 超时 / 重试 / SyncDisabledError
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const {
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
  SyncDisabledError,
  SyncHttpError,
} = await import('../lib/sync_client.js');

const BACKEND = 'https://lsk-sync.example.workers.dev';

// ---- fetch mock helpers ----
function jsonRes(data, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() { return data; },
  };
}

let calls = [];
const originalFetch = globalThis.fetch;

function setFetch(fn) {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return fn(url, options);
  };
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('SyncDisabledError（backendUrl 为空立即抛）', () => {
  it('空字符串 backendUrl → 抛 SyncDisabledError', async () => {
    await assert.rejects(() => createTeam({ backendUrl: '', founder: { memberId: 'm1' } }), SyncDisabledError);
  });
  it('null backendUrl → 抛 SyncDisabledError', async () => {
    await assert.rejects(() => pingHealth({ backendUrl: null }), SyncDisabledError);
  });
  it('undefined backendUrl → 抛 SyncDisabledError', async () => {
    await assert.rejects(() => getVault({ backendUrl: undefined, vaultId: 'v1', token: 't' }), SyncDisabledError);
  });
});

describe('createTeam', () => {
  it('POST /v1/team/create 并返回 code/token/memberId', async () => {
    setFetch(() => jsonRes({ ok: true, code: 'XKCD42', token: 'tok', memberId: 'm1' }));
    const res = await createTeam({ backendUrl: BACKEND, founder: { memberId: 'm1', nickname: '队长' } });
    assert.equal(res.code, 'XKCD42');
    assert.equal(res.token, 'tok');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BACKEND}/v1/team/create`);
    assert.equal(calls[0].options.method, 'POST');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.founderMemberId, 'm1');
    assert.equal(body.founderNickname, '队长');
  });
});

describe('joinTeam', () => {
  it('POST /v1/team/:code/join，编码 code', async () => {
    setFetch(() => jsonRes({ ok: true, code: 'ABC123', token: 'tk', teamSnapshot: { code: 'ABC123' } }));
    const res = await joinTeam({ backendUrl: BACKEND, code: 'ABC123', member: { memberId: 'm2', nickname: '小羊' } });
    assert.equal(res.token, 'tk');
    assert.equal(calls[0].url, `${BACKEND}/v1/team/ABC123/join`);
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.memberId, 'm2');
  });
});

describe('getTeam', () => {
  it('GET 带 Authorization Bearer token', async () => {
    setFetch(() => jsonRes({ ok: true, team: { code: 'ABC123' } }));
    const res = await getTeam({ backendUrl: BACKEND, code: 'ABC123', token: 'secret' });
    assert.equal(res.team.code, 'ABC123');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  });
});

describe('heartbeat', () => {
  it('POST snapshot + token', async () => {
    setFetch(() => jsonRes({ ok: true, team: {} }));
    await heartbeat({ backendUrl: BACKEND, code: 'ABC123', token: 'tk', memberId: 'm1', snapshot: { progress: 50, mood: '😀' } });
    assert.equal(calls[0].url, `${BACKEND}/v1/team/ABC123/heartbeat`);
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.snapshot.progress, 50);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer tk');
  });
});

describe('poke', () => {
  it('POST fromMemberId/toMemberId/emoji', async () => {
    setFetch(() => jsonRes({ ok: true, poke: { pokeId: 'p1' } }));
    await poke({ backendUrl: BACKEND, code: 'ABC123', token: 'tk', from: 'm1', to: 'm2', emoji: '🔥' });
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.fromMemberId, 'm1');
    assert.equal(body.toMemberId, 'm2');
    assert.equal(body.emoji, '🔥');
  });
});

describe('leaveTeam', () => {
  it('POST memberId', async () => {
    setFetch(() => jsonRes({ ok: true, team: {} }));
    await leaveTeam({ backendUrl: BACKEND, code: 'ABC123', token: 'tk', memberId: 'm1' });
    assert.equal(calls[0].url, `${BACKEND}/v1/team/ABC123/leave`);
    assert.equal(JSON.parse(calls[0].options.body).memberId, 'm1');
  });
});

describe('vault put + get + delete', () => {
  it('putVault 首次上传带 newVaultToken', async () => {
    setFetch(() => jsonRes({ ok: true, vaultId: 'v1', created: true }));
    const res = await putVault({ backendUrl: BACKEND, vaultId: 'v1', ciphertext: 'CIPHER', newVaultToken: 'vt' });
    assert.equal(res.created, true);
    assert.equal(calls[0].options.method, 'PUT');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.ciphertext, 'CIPHER');
    assert.equal(body.newVaultToken, 'vt');
  });

  it('getVault 带 token 返回密文', async () => {
    setFetch(() => jsonRes({ ok: true, vaultId: 'v1', ciphertext: 'CIPHER' }));
    const res = await getVault({ backendUrl: BACKEND, vaultId: 'v1', token: 'vt' });
    assert.equal(res.ciphertext, 'CIPHER');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer vt');
  });

  it('deleteVault 带 token', async () => {
    setFetch(() => jsonRes({ ok: true, deleted: 'v1' }));
    const res = await deleteVault({ backendUrl: BACKEND, vaultId: 'v1', token: 'vt' });
    assert.equal(res.deleted, 'v1');
    assert.equal(calls[0].options.method, 'DELETE');
  });
});

describe('pingHealth', () => {
  it('GET /v1/health', async () => {
    setFetch(() => jsonRes({ ok: true, version: '0.8.0' }));
    const res = await pingHealth({ backendUrl: BACKEND });
    assert.equal(res.version, '0.8.0');
    assert.equal(calls[0].url, `${BACKEND}/v1/health`);
  });
});

describe('HTTP 错误', () => {
  it('非 2xx → 抛 SyncHttpError 且不重试', async () => {
    setFetch(() => jsonRes({ ok: false, error: 'unauthorized', message: 'token 无效' }, { ok: false, status: 401 }));
    await assert.rejects(
      () => getTeam({ backendUrl: BACKEND, code: 'X', token: 'bad' }),
      (err) => err instanceof SyncHttpError && err.status === 401,
    );
    assert.equal(calls.length, 1, 'HTTP 错误不应重试');
  });
});

describe('重试', () => {
  it('首次网络错误、第二次成功 → 自动重试 1 次', async () => {
    let n = 0;
    setFetch(() => {
      n += 1;
      if (n === 1) {
        const e = new TypeError('network down');
        return Promise.reject(e);
      }
      return Promise.resolve(jsonRes({ ok: true, version: '0.8.0' }));
    });
    const res = await pingHealth({ backendUrl: BACKEND });
    assert.equal(res.version, '0.8.0');
    assert.equal(calls.length, 2, '应重试一次共 2 次调用');
  });

  it('持续网络错误 → 重试后仍抛出', async () => {
    setFetch(() => Promise.reject(new TypeError('network down')));
    await assert.rejects(() => pingHealth({ backendUrl: BACKEND }));
    assert.equal(calls.length, 2, '初次 + 重试 1 次 = 2');
  });
});

describe('超时（AbortError 模拟）', () => {
  it('fetch 抛 AbortError → 视为可重试并最终抛出', async () => {
    setFetch(() => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      return Promise.reject(e);
    });
    await assert.rejects(
      () => pingHealth({ backendUrl: BACKEND }),
      (err) => err.name === 'AbortError',
    );
    assert.equal(calls.length, 2, '超时也会重试一次');
  });
});
