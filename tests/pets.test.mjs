// tests/pets.test.mjs — v0.3.3
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.chrome = undefined;

const { computeMood, computeFeedStreak, MOOD_META, PET_TYPES, Pets, todayFeedTotal } = await import('../lib/pets.js');
const { Storage } = await import('../lib/storage.js');

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
function ok(condition, message) {
  if (!condition) throw new Error(message);
}

const now = Date.now();
const HOUR = 3600_000;

console.log('computeMood()');
await t('刚被喂养 → happy', async () => {
  eq(computeMood({ lastFedAt: now - 1 * HOUR }, { lastActiveAt: 0 }), 'happy');
});
await t('moodOverride=happy 且 2h 内被喂 → happy', async () => {
  eq(computeMood({ lastFedAt: now - 30 * 60_000, moodOverride: 'happy' }, {}), 'happy');
});
await t('近 12h 内活跃且未喂养超过 6h → normal', async () => {
  eq(computeMood({ lastFedAt: now - 10 * HOUR }, { lastActiveAt: now - 1 * HOUR }), 'normal');
});
await t('24-72h 未喂 → sleepy', async () => {
  eq(computeMood({ lastFedAt: now - 30 * HOUR }, { lastActiveAt: 0 }), 'sleepy');
});
await t('从未喂养 → sad', async () => {
  eq(computeMood({ lastFedAt: 0 }, { lastActiveAt: 0 }), 'sad');
});
await t('>72h 未喂 → sad', async () => {
  eq(computeMood({ lastFedAt: now - 100 * HOUR }, { lastActiveAt: 0 }), 'sad');
});

console.log('喂养 streak / today');
await t('computeFeedStreak 能识别昨天连续', async () => {
  eq(computeFeedStreak(now - 26 * HOUR, 3, now), 4);
});
await t('todayFeedTotal 统计当天喂养量', async () => {
  eq(todayFeedTotal([{ ts: now - 1000, petId: 'sheep', amount: 2 }, { ts: now - 2 * 86400000, petId: 'cat', amount: 9 }], now), 2);
});

console.log('Pets.feed()');
await t('喂养会写入 feedLog / 亲密度 / streak / 扣养料', async () => {
  await Storage.setStats({ foodStock: 20, petLevel: 1, petExp: 0 });
  await Pets.replaceState({ activeId: 'cat', unlocked: ['sheep', 'cat'] });
  const summary = await Pets.feed(2, 'cat');
  ok(summary.ok, 'feed 应成功');
  eq(summary.delta, 10);
  eq(summary.totalForPet, 2);
  eq(summary.totalAll, 2);
  eq(summary.streak, 1);
  const stats = await Storage.getStats();
  eq(stats.foodStock, 10, '应扣除 10 养料');
  const state = await Pets.getState();
  eq(state.totalFedByPet.cat, 2);
  eq(state.totalFedAll, 2);
  eq(state.feedLog.length, 1);
});

await t('喂养可触发升级 summary', async () => {
  await Storage.setStats({ foodStock: 10, petLevel: 1, petExp: 18 });
  await Pets.replaceState({ activeId: 'sheep', unlocked: ['sheep'] });
  const summary = await Pets.feed(1, 'sheep');
  eq(summary.ok, true);
  eq(summary.leveledUp, true);
  eq(summary.newLevel, 2);
  const stats = await Storage.getStats();
  eq(stats.petLevel, 2);
  eq(stats.petExp, 3);
});

await t('养料不足时返回 reason', async () => {
  await Storage.setStats({ foodStock: 0, petLevel: 1, petExp: 0 });
  const summary = await Pets.feed(1, 'sheep');
  eq(summary.ok, false);
  ok(String(summary.reason).includes('养料不够'), '应给出不足提示');
});

console.log('MOOD_META / PET_TYPES');
await t('4 种心情 meta 齐全', async () => {
  ['happy', 'normal', 'sleepy', 'sad'].forEach((key) => {
    if (!MOOD_META[key] || !MOOD_META[key].anim || !MOOD_META[key].say) throw new Error(`missing ${key}`);
  });
});
await t('包含 sheep/cat/dog/custom', async () => {
  const ids = PET_TYPES.map((item) => item.id).sort().join(',');
  eq(ids, 'cat,custom,dog,sheep');
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
