// tests/breakdown_universal.test.mjs — v0.5.1 本地兜底普适化：任意冷门任务都能拆
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.chrome = undefined;

const { localBreakdown, _internal } = await import('../lib/breakdown.js');

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
function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function assertRealSteps(result, label) {
  ok(result && Array.isArray(result.steps), `${label}: 应返回 steps 数组`);
  ok(result.steps.length >= 4, `${label}: 至少 4 步，实际 ${result.steps.length}`);
  result.steps.forEach((s, i) => {
    ok(typeof s.title === 'string' && s.title.trim().length > 0, `${label}: step[${i}] title 非空`);
    ok(Number.isFinite(s.estMinutes) && s.estMinutes >= 1 && s.estMinutes <= 60, `${label}: step[${i}] estMinutes 合理`);
  });
}

console.log('20 个冷门任务都能拆出 ≥ 4 条真实步骤');

const OBSCURE_INPUTS = [
  '跟朋友聊房价',
  '学吉他',
  '减重 3 公斤',
  '陪女儿写作业',
  '整理相册',
  '打理花园',
  '学税务申报',
  '装修客厅',
  '找租客',
  '联系老同学',
  '送礼物',
  '收邮件',
  '报体检',
  '换驾照',
  '学做红烧肉',
  '报保险',
  '备孕体检',
  '联系房东退租',
  '采访 3 位用户',
  '学 SwiftUI',
];

for (const input of OBSCURE_INPUTS) {
  await t(`冷门任务：${input}`, async () => {
    const result = await localBreakdown(input);
    assertRealSteps(result, input);
  });
}

console.log('\n通用模板池：动词启发式挑选正确骨架');

await t('社交类动词命中 social 骨架', async () => {
  ok(_internal.pickGenericTemplateKey('联系老同学叙旧') === 'social', 'social');
});
await t('创作类动词命中 creative 骨架', async () => {
  ok(_internal.pickGenericTemplateKey('设计一张海报') === 'creative', 'creative');
});
await t('研究类动词命中 research 骨架', async () => {
  ok(_internal.pickGenericTemplateKey('了解一下最新政策') === 'research', 'research');
});
await t('深度工作动词命中 deepwork 骨架', async () => {
  ok(_internal.pickGenericTemplateKey('攻克这道算法题') === 'deepwork', 'deepwork');
});
await t('无明显动词回退 lightweight 骨架', async () => {
  ok(_internal.pickGenericTemplateKey('那个东西') === 'lightweight', 'lightweight');
});

await t('每个通用骨架都产出 ≥ 5 步', async () => {
  for (const key of _internal.GENERIC_TEMPLATE_KEYS) {
    const steps = _internal.buildGenericSteps('随便一件事', {}, key);
    ok(steps.length >= 5, `${key} 应 ≥ 5 步`);
  }
});

await t('minutes hint 会替换集中时长', async () => {
  const steps = _internal.buildGenericSteps('随便一件事', { minutes: 45 }, 'lightweight');
  ok(steps.some((s) => /45/.test(s.title)), '应出现 45 分钟');
});

await t('subject 会被填进步骤文案', async () => {
  const steps = _internal.buildGenericSteps('写一本小说', {}, 'deepwork');
  ok(steps.some((s) => (s.title + s.detail).includes('写一本小说')), 'subject 应出现在文案中');
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
