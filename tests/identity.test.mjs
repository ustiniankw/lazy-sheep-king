// tests/identity.test.mjs — v0.6.0 认证瘦身 · 自动昵称 + DiceBear 头像
import assert from 'node:assert/strict';

const Identity = await import('../lib/identity.js');

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

console.log('Identity · generateNickname');

await t('生成的昵称是非空字符串且包含形容词 + 名词 + 数字尾巴', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i += 1) {
    const n = Identity.generateNickname();
    assert.equal(typeof n, 'string');
    assert.ok(n.length >= 3, `nickname ${n} too short`);
    assert.ok(/\d{3}$/.test(n), `nickname ${n} 应该以 3 位数字结尾`);
    // 形容词或名词至少有一个在里面
    const hasAdj = Identity.NICKNAME_ADJECTIVES.some((a) => n.startsWith(a));
    assert.ok(hasAdj, `nickname ${n} 应以已知形容词开头`);
    seen.add(n);
  }
  assert.ok(seen.size >= 5, '30 次生成里至少要有 5 个不同的昵称（形容词/名词各 30+）');
});

await t('形容词与名词表各自 ≥ 30 项', () => {
  assert.ok(Identity.NICKNAME_ADJECTIVES.length >= 30, `adjectives=${Identity.NICKNAME_ADJECTIVES.length}`);
  assert.ok(Identity.NICKNAME_NOUNS.length >= 30, `nouns=${Identity.NICKNAME_NOUNS.length}`);
});

await t('可注入 rnd 得到确定结果', () => {
  const seq = [0.1, 0.2, 0.3];
  let i = 0;
  const rnd = () => seq[i++ % seq.length];
  const a = Identity.generateNickname(rnd);
  i = 0;
  const b = Identity.generateNickname(rnd);
  assert.equal(a, b);
});

console.log('\nIdentity · defaultAvatarUrl');

await t('返回 DiceBear v9.x 免费 URL（默认 thumbs 风格）', () => {
  const url = Identity.defaultAvatarUrl('mySeed');
  assert.match(url, /^https:\/\/api\.dicebear\.com\/9\.x\/thumbs\/svg\?seed=mySeed$/);
});

await t('支持切换风格', () => {
  const url = Identity.defaultAvatarUrl({ seed: 'x', style: 'bottts' });
  assert.match(url, /\/9\.x\/bottts\/svg\?seed=x$/);
});

await t('未识别风格回退到 thumbs', () => {
  const url = Identity.defaultAvatarUrl({ seed: 'x', style: 'unknown-style' });
  assert.match(url, /\/9\.x\/thumbs\/svg\?seed=x$/);
});

await t('未传 seed 也能生成有效 URL', () => {
  const url = Identity.defaultAvatarUrl();
  assert.match(url, /^https:\/\/api\.dicebear\.com\/9\.x\/thumbs\/svg\?seed=[^&]+$/);
});

await t('isDiceBearUrl 能识别 dicebear vs 上传', () => {
  assert.equal(Identity.isDiceBearUrl(Identity.defaultAvatarUrl('a')), true);
  assert.equal(Identity.isDiceBearUrl('data:image/png;base64,xxx'), false);
});

await t('nextAvatarStyle 循环 4 种风格', () => {
  const s0 = Identity.AVATAR_STYLES[0];
  const s1 = Identity.nextAvatarStyle(s0);
  assert.ok(s1 !== s0);
  assert.ok(Identity.AVATAR_STYLES.includes(s1));
  const s2 = Identity.nextAvatarStyle('not-a-style');
  assert.ok(Identity.AVATAR_STYLES.includes(s2));
});

console.log('\nIdentity · ensureIdentity 幂等');

function mockStorage() {
  const box = new Map();
  return {
    box,
    async getGlobal(k) { return box.get(k); },
    async setGlobal(k, v) { box.set(k, v); },
  };
}

await t('首次调用生成 nickname + dicebear 头像并写入 storage', async () => {
  const st = mockStorage();
  const id = await Identity.ensureIdentity(st);
  assert.ok(id.nickname);
  assert.ok(/\d{3}$/.test(id.nickname));
  assert.equal(id.avatarKind, 'dicebear');
  assert.ok(id.avatarUrl.startsWith('https://api.dicebear.com/9.x/'));
  assert.ok(id.avatarSeed);
  assert.ok(id.avatarStyle);
  // 已写入 storage
  const saved = st.box.get(Identity.IDENTITY_STORE_KEY);
  assert.deepEqual(saved.nickname, id.nickname);
});

await t('第二次调用不会覆盖已有 nickname / 头像', async () => {
  const st = mockStorage();
  const first = await Identity.ensureIdentity(st);
  const second = await Identity.ensureIdentity(st);
  assert.equal(first.nickname, second.nickname);
  assert.equal(first.avatarUrl, second.avatarUrl);
  assert.equal(first.avatarSeed, second.avatarSeed);
});

await t('rerollNickname 幂等：昵称变了，头像不变', async () => {
  const st = mockStorage();
  const first = await Identity.ensureIdentity(st);
  const next = await Identity.rerollNickname(st);
  assert.notEqual(next.nickname, ''); // 至少非空
  // avatar 保留
  assert.equal(next.avatarUrl, first.avatarUrl);
  assert.equal(next.avatarSeed, first.avatarSeed);
});

await t('rerollAvatar 换 seed + 换风格', async () => {
  const st = mockStorage();
  const first = await Identity.ensureIdentity(st);
  const next = await Identity.rerollAvatar(st);
  assert.notEqual(next.avatarSeed, first.avatarSeed);
  assert.ok(Identity.AVATAR_STYLES.includes(next.avatarStyle));
  assert.equal(next.avatarKind, 'dicebear');
  assert.ok(next.avatarUrl.includes(next.avatarSeed));
});

await t('setUploadedAvatar 切换到 upload 类型并保留 nickname', async () => {
  const st = mockStorage();
  const first = await Identity.ensureIdentity(st);
  const next = await Identity.setUploadedAvatar(st, 'data:image/png;base64,AAAA');
  assert.equal(next.avatarKind, 'upload');
  assert.equal(next.avatarUrl, 'data:image/png;base64,AAAA');
  assert.equal(next.nickname, first.nickname);
});

await t('setUploadedAvatar 拒绝空 dataUrl', async () => {
  const st = mockStorage();
  let threw = false;
  try { await Identity.setUploadedAvatar(st, ''); } catch { threw = true; }
  assert.equal(threw, true);
});

await t('updateIdentity 只改 nickname 时不影响 avatar', async () => {
  const st = mockStorage();
  const first = await Identity.ensureIdentity(st);
  const next = await Identity.updateIdentity(st, { nickname: '手动定制昵称' });
  assert.equal(next.nickname, '手动定制昵称');
  assert.equal(next.avatarUrl, first.avatarUrl);
});

await t('ensureIdentity 兼容老数据（缺 avatarKind/avatarStyle）', async () => {
  const st = mockStorage();
  st.box.set(Identity.IDENTITY_STORE_KEY, {
    nickname: '会飞的橘子237',
    avatarUrl: 'https://api.dicebear.com/9.x/thumbs/svg?seed=abc',
  });
  const id = await Identity.ensureIdentity(st);
  assert.equal(id.nickname, '会飞的橘子237');
  assert.equal(id.avatarKind, 'dicebear');
  assert.equal(id.avatarUrl, 'https://api.dicebear.com/9.x/thumbs/svg?seed=abc');
  assert.ok(id.avatarStyle);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
