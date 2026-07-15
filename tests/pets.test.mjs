// tests/pets.test.mjs
// 纯数据层 pets 测试（不依赖 chrome/localStorage）
import { computeMood, MOOD_META, PET_TYPES } from '../lib/pets.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); fail++; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const now = Date.now();
const HOUR = 3600_000;

console.log('computeMood()');
t('刚被喂养 → happy', () => {
  eq(computeMood({ lastFedAt: now - 1 * HOUR }, { lastActiveAt: 0 }), 'happy');
});
t('moodOverride=happy 且 2h 内被喂 → happy', () => {
  eq(computeMood({ lastFedAt: now - 30 * 60_000, moodOverride: 'happy' }, {}), 'happy');
});
t('近 12h 内活跃且未喂养超过 6h → normal', () => {
  eq(computeMood({ lastFedAt: now - 10 * HOUR }, { lastActiveAt: now - 1 * HOUR }), 'normal');
});
t('24-72h 未喂 → sleepy', () => {
  eq(computeMood({ lastFedAt: now - 30 * HOUR }, { lastActiveAt: 0 }), 'sleepy');
});
t('从未喂养 → sad', () => {
  eq(computeMood({ lastFedAt: 0 }, { lastActiveAt: 0 }), 'sad');
});
t('>72h 未喂 → sad', () => {
  eq(computeMood({ lastFedAt: now - 100 * HOUR }, { lastActiveAt: 0 }), 'sad');
});

console.log('MOOD_META');
t('4 种心情 meta 齐全', () => {
  ['happy', 'normal', 'sleepy', 'sad'].forEach((k) => {
    if (!MOOD_META[k] || !MOOD_META[k].anim || !MOOD_META[k].say) {
      throw new Error(`missing ${k}`);
    }
  });
});

console.log('PET_TYPES');
t('包含 sheep/cat/dog/custom', () => {
  const ids = PET_TYPES.map((p) => p.id).sort().join(',');
  eq(ids, 'cat,custom,dog,sheep');
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
