// tests/breakdown_never_stuck.test.mjs — v0.5.1 「永不卡住」兜底保证
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.chrome = undefined;
globalThis.LanguageModel = undefined;

const { breakdownTask, localBreakdown, _internal } = await import('../lib/breakdown.js');
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
function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function assertValid(result, label) {
  ok(result && Array.isArray(result.steps), `${label}: steps 数组`);
  ok(result.steps.length >= 4, `${label}: ≥ 4 步（实际 ${result.steps?.length}）`);
  result.steps.forEach((s, i) => {
    ok(typeof s.title === 'string' && s.title.trim(), `${label}: step[${i}] title 非空`);
    ok(Number.isFinite(s.estMinutes) && s.estMinutes >= 1, `${label}: step[${i}] estMinutes 合理`);
  });
}

console.log('本地管线永远返回结果');

await t('正常输入返回 ≥ 4 步', async () => {
  assertValid(await localBreakdown('写周报'), '写周报');
});

await t('空字符串也不卡住', async () => {
  assertValid(await localBreakdown(''), '空串');
});

await t('极长乱码输入也返回结果', async () => {
  assertValid(await localBreakdown('阿斯顿'.repeat(500)), '超长');
});

await t('safeGenericPlan 对 null / 数字 / 对象都 ≥ 4 步', async () => {
  assertValid(_internal.safeGenericPlan(null), 'null');
  assertValid(_internal.safeGenericPlan(12345), 'number');
  assertValid(_internal.safeGenericPlan({}), 'object');
});

await t('subject 的 toString 抛错也不炸（极端输入）', async () => {
  const evil = { toString() { throw new Error('boom'); } };
  assertValid(_internal.safeGenericPlan(evil), 'evil-toString');
});

console.log('\nStorage 抛错时 localBreakdown 仍返回本地结果');

await t('getRecentBreakdowns 抛错也能降级到模板', async () => {
  const orig = Storage.getRecentBreakdowns;
  Storage.getRecentBreakdowns = async () => { throw new Error('storage down'); };
  try {
    assertValid(await localBreakdown('学吉他'), 'storage-down');
  } finally {
    Storage.getRecentBreakdowns = orig;
  }
});

console.log('\nbreakdownTask：AI 失败 / 抛错 → 永不卡住');

await t('AI 拒绝（mock reject）时回退本地结果', async () => {
  const result = await breakdownTask('写周报', {
    aiRerankEnabled: true,
    llm: { enabled: true, apiKey: 'k', baseUrl: 'https://x.y', model: 'demo' },
    __rejectForTest: true,
  });
  // 没有可用的 chrome AI / 真实网络，rerank 会失败 → source=fallback + 本地步骤
  assertValid(result, 'ai-reject');
  ok(result.source === 'fallback', 'source 应为 fallback');
});

await t('传入会抛错的 settings 也能返回安全模板', async () => {
  const evilSettings = { get aiRerankEnabled() { throw new Error('settings boom'); } };
  const result = await breakdownTask('随便一件事', evilSettings);
  assertValid(result, 'evil-settings');
});

await t('AI 关闭时直接本地兜底', async () => {
  const result = await breakdownTask('学 SwiftUI', { aiRerankEnabled: false });
  assertValid(result, 'ai-off');
  ok(result.source === 'fallback', 'source 应为 fallback');
});

await t('breakdownTask 恒有 meta 且不含任何 key 字段', async () => {
  const result = await breakdownTask('联系老同学', { aiRerankEnabled: false, llm: { apiKey: 'secret-key-123' } });
  const json = JSON.stringify(result);
  ok(!json.includes('secret-key-123'), '结果中不应泄漏 apiKey');
});

console.log('\n诊断日志：写入且不泄漏 key');

await t('拆解后写入 debugLog 环形缓冲', async () => {
  await Storage.clearDebugLog();
  await breakdownTask('写周报', { aiRerankEnabled: false });
  const log = await Storage.getDebugLog();
  ok(log.length >= 1, '应至少 1 条日志');
  const entry = log[0];
  ok('ts' in entry && 'intent' in entry && 'source' in entry && 'ok' in entry, '字段齐全');
});

await t('debugLog 环形缓冲上限 20 条', async () => {
  await Storage.clearDebugLog();
  for (let i = 0; i < 30; i += 1) {
    await Storage.pushDebugLog({ input: `task ${i}`, intent: 'x', source: 'local', ok: true });
  }
  const log = await Storage.getDebugLog();
  ok(log.length === 20, `应上限 20，实际 ${log.length}`);
});

await t('debugLog 绝不写入 apiKey 字段', async () => {
  await Storage.clearDebugLog();
  await Storage.pushDebugLog({ input: 'x', intent: 'y', source: 'local', ok: true, apiKey: 'sk-should-drop', token: 'tok' });
  const log = await Storage.getDebugLog();
  const json = JSON.stringify(log);
  ok(!json.includes('sk-should-drop') && !json.includes('tok'), 'key/token 应被丢弃');
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
