// tests/auth.test.mjs — v0.6.0 认证瘦身版
// 主流程覆盖：guest 匿名 + passphrase 本地密码；GitHub / Google 相关接口下线。
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
  try { await fn(); console.log('  ✓', name); pass += 1; }
  catch (error) { console.error('  ✗', name, '\n    ', error.message); fail += 1; }
}
function eq(actual, expected, message = '') {
  if (actual !== expected) throw new Error(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(condition, message = '') {
  if (!condition) throw new Error(message || 'expected truthy');
}

console.log('Auth · 匿名 + 昵称主流程（v0.6.0）');

await t('初始状态是匿名 GUEST，且自动带上生成的昵称和 dicebear 头像', async () => {
  const state = await Auth.getAuthState();
  eq(state.mode, MODE.GUEST);
  ok(state.userId, '应生成 usr_xxx');
  ok(state.nickname && typeof state.nickname === 'string', '昵称应存在');
  ok(/\d{3}$/.test(state.nickname), '昵称应以三位数字结尾');
  ok(String(state.avatarUrl || '').startsWith('https://api.dicebear.com/9.x/'), '默认头像走 dicebear');
  eq(state.avatarKind, 'dicebear');
});

await t('isSignedIn 在纯匿名模式返回 false', async () => {
  eq(await Auth.isSignedIn(), false);
});

console.log('\nAuth · 本地密码账号');

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

console.log('\nAuth · 退出账户');

await t('signOut 后回到 GUEST（本地数据保留）', async () => {
  const state = await Auth.signOut();
  eq(state.mode, MODE.GUEST);
  ok(state.nickname, '匿名态仍带昵称');
});

console.log('\nAuth · 下线的 OAuth 接口占位');

await t('beginGitHubDeviceFlow 返回 NOT_ENABLED（v0.6.0 起下线）', async () => {
  const r = await Auth.beginGitHubDeviceFlow('Iv1.anything');
  eq(r.ok, false);
  eq(r.code, 'NOT_ENABLED');
});

await t('getGitHubToken 永远返回 null', async () => {
  eq(await Auth.getGitHubToken(), null);
});

await t('signInGoogle 返回 NOT_ENABLED', async () => {
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
