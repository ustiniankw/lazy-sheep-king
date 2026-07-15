// tests/auth.test.mjs — v0.3.5 认证账号系统测试
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.chrome = undefined;

const Auth = await import('../lib/auth.js');
const { MODE } = Auth;

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  ✓', name);
    pass += 1;
  } catch (error) {
    console.error('  ✗', name, '\n    ', error.message);
    fail += 1;
  }
}
function eq(actual, expected, message = '') {
  if (actual !== expected) throw new Error(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(condition, message = '') {
  if (!condition) throw new Error(message || 'expected truthy');
}

console.log('Auth · 本地密码账号');

await t('setupPassphrase 成功后进入 passphrase 模式并解锁会话', async () => {
  const state = await Auth.setupPassphrase('小羊管理员', 'Sheep#2026');
  eq(state.mode, MODE.PASSPHRASE);
  eq(state.accountName, '小羊管理员');
  ok(Auth.getSession() !== null, '创建后会话应解锁');
});

await t('弱密码被拦截（含常见弱口令集）', async () => {
  const r1 = await Auth.setupPassphrase('x', '123456');
  eq(r1.ok, false);
  eq(r1.code, 'WEAK_PASSPHRASE');
});

await t('重复创建强密码账号返回 ALREADY_EXISTS', async () => {
  const r = await Auth.setupPassphrase('again', 'Another#Strong1');
  eq(r.ok, false);
  eq(r.code, 'ALREADY_EXISTS');
});

await t('lockSession 后 getSession 返回 null', async () => {
  Auth.lockSession();
  eq(Auth.getSession(), null);
});

await t('verifyPassphrase 错误密码返回 false 且不解锁', async () => {
  const okWrong = await Auth.verifyPassphrase('wrong-pass');
  eq(okWrong, false);
  eq(Auth.getSession(), null);
});

await t('verifyPassphrase 正确密码返回 true 并解锁', async () => {
  const okRight = await Auth.verifyPassphrase('Sheep#2026');
  eq(okRight, true);
  ok(Auth.getSession() !== null, '正确密码后应解锁');
});

await t('changePassphrase 旧密码错误被拒绝', async () => {
  const r = await Auth.changePassphrase('bad', 'NewSheep#77');
  eq(r.ok, false);
  eq(r.code, 'WRONG_PASSPHRASE');
});

await t('changePassphrase 成功后可用新密码验证、旧密码失效', async () => {
  const r = await Auth.changePassphrase('Sheep#2026', 'NewSheep#77');
  eq(r.ok, true);
  Auth.lockSession();
  eq(await Auth.verifyPassphrase('Sheep#2026'), false);
  eq(await Auth.verifyPassphrase('NewSheep#77'), true);
});

console.log('\nAuth · PBKDF2 / 加密备份');

await t('相同 salt+passphrase 派生相同 key，不同 passphrase 不同', async () => {
  const subtle = globalThis.crypto.subtle;
  const enc = new TextEncoder();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const derive = async (p) => {
    const base = await subtle.importKey('raw', enc.encode(p), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, base, 256);
    return Buffer.from(new Uint8Array(bits)).toString('hex');
  };
  const a1 = await derive('same-pass');
  const a2 = await derive('same-pass');
  const b = await derive('other-pass');
  eq(a1, a2, '相同输入应派生相同 key');
  ok(a1 !== b, '不同 passphrase 应派生不同 key');
  // 不同 salt 也应不同
  const salt2 = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const base = await subtle.importKey('raw', enc.encode('same-pass'), 'PBKDF2', false, ['deriveBits']);
  const bits2 = await subtle.deriveBits({ name: 'PBKDF2', salt: salt2, iterations: 100000, hash: 'SHA-256' }, base, 256);
  ok(Buffer.from(new Uint8Array(bits2)).toString('hex') !== a1, '不同 salt 应派生不同 key');
});

await t('加密备份 roundtrip：plain → enc → plain', async () => {
  ok(await Auth.verifyPassphrase('NewSheep#77'), '先解锁');
  const payload = { tasks: [{ id: 't1', goal: '写周报' }], stats: { total: 3 } };
  const blob = await Auth.encryptBackup(payload);
  eq(blob.enc, true);
  ok(blob.iv && blob.cipherText && blob.salt, '加密块应包含 iv/cipherText/salt');
  const back = await Auth.decryptBackup(blob);
  eq(back.ok, true);
  eq(JSON.stringify(back.payload), JSON.stringify(payload));
});

await t('加密备份可用密码在锁定态解密', async () => {
  const payload = { hello: 'world' };
  const blob = await Auth.encryptBackup(payload);
  Auth.lockSession();
  const needPass = await Auth.decryptBackup(blob);
  eq(needPass.ok, false);
  eq(needPass.code, 'NEED_PASSPHRASE');
  const back = await Auth.decryptBackup(blob, 'NewSheep#77');
  eq(back.ok, true);
  eq(back.payload.hello, 'world');
});

console.log('\nAuth · GitHub Device Flow（mock fetch）');

await t('beginGitHubDeviceFlow 缺 client_id 返回 MISSING_CLIENT_ID', async () => {
  const r = await Auth.beginGitHubDeviceFlow('');
  eq(r.ok, false);
  eq(r.code, 'MISSING_CLIENT_ID');
});

await t('设备流：device/code → pending×2 → access_token → user profile', async () => {
  let pollCount = 0;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/login/device/code')) {
      return { json: async () => ({ device_code: 'DEV-CODE-123', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0.01, expires_in: 900 }) };
    }
    if (String(url).includes('/login/oauth/access_token')) {
      pollCount += 1;
      if (pollCount <= 2) return { json: async () => ({ error: 'authorization_pending' }) };
      return { json: async () => ({ access_token: 'gho_faketoken', token_type: 'bearer' }) };
    }
    if (String(url).includes('api.github.com/user')) {
      return { json: async () => ({ id: 99887766, login: 'lazysheep', name: '懒羊羊本尊', avatar_url: 'https://avatars/lazysheep.png', email: 'lazy@sheep.dev' }) };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const begin = await Auth.beginGitHubDeviceFlow('Iv1.testclientid');
  eq(begin.ok, true);
  eq(begin.userCode, 'ABCD-1234');
  eq(begin.deviceCode, 'DEV-CODE-123');

  const state = await Auth.pollGitHubDeviceFlow({ clientId: 'Iv1.testclientid', deviceCode: begin.deviceCode, interval: begin.interval, expiresIn: begin.expiresIn });
  eq(state.mode, MODE.GITHUB);
  eq(state.provider, 'github');
  eq(state.providerId, '99887766');
  eq(state.login, 'lazysheep');
  eq(state.verified, true);
  ok(pollCount >= 3, '应轮询到拿到 token');

  // token 加密后可解出
  const token = await Auth.getGitHubToken();
  eq(token, 'gho_faketoken');
});

await t('signOut 后回到访客模式', async () => {
  const state = await Auth.signOut();
  eq(state.mode, MODE.GUEST);
  delete globalThis.fetch;
});

await t('beginGitHubDeviceFlow 在 fetch 抛错时优雅降级 NOT_AVAILABLE', async () => {
  globalThis.fetch = async () => { throw new Error('CORS blocked'); };
  const r = await Auth.beginGitHubDeviceFlow('Iv1.testclientid');
  eq(r.ok, false);
  eq(r.code, 'NOT_AVAILABLE');
  ok(r.message.includes('网页试玩'), '应提示网页试玩环境');
  delete globalThis.fetch;
});

console.log('\nAuth · Google 骨架');

await t('signInGoogle 当前返回 NOT_ENABLED', async () => {
  const r = await Auth.signInGoogle();
  eq(r.ok, false);
  eq(r.code, 'NOT_ENABLED');
});

await t('evaluatePassphrase 强度分级', async () => {
  eq(Auth.evaluatePassphrase('123').ok, false);
  eq(Auth.evaluatePassphrase('password').ok, false);
  eq(Auth.evaluatePassphrase('abcdef').level, 'bad');
  eq(Auth.evaluatePassphrase('Str0ng#Passphrase!').level, 'good');
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
