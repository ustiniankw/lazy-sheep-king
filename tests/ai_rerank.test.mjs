// tests/ai_rerank.test.mjs — v0.3.4 免费 AI 精修
const { detectAvailableTier, rerankSteps } = await import('../lib/ai_rerank.js');

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

const originalLanguageModel = globalThis.LanguageModel;
const originalChrome = globalThis.chrome;

function resetGlobals() {
  globalThis.LanguageModel = undefined;
  globalThis.chrome = undefined;
}

const draftSteps = [
  { title: '打开文档', detail: '先打开', tips: '先打开', estMinutes: 3 },
  { title: '列要点', detail: '列一下', tips: '列一下', estMinutes: 3 },
  { title: '写初稿', detail: '先写', tips: '先写', estMinutes: 5 },
  { title: '检查并发出', detail: '检查', tips: '检查', estMinutes: 4 },
];

console.log('detectAvailableTier');

await t('LanguageModel 存在时返回 chrome-ai', async () => {
  resetGlobals();
  globalThis.LanguageModel = { create: async () => ({ prompt: async () => '{}' }) };
  eq(await detectAvailableTier({}), 'chrome-ai');
});

await t('chrome.aiOriginTrial.languageModel 存在时返回 chrome-ai', async () => {
  resetGlobals();
  globalThis.chrome = { aiOriginTrial: { languageModel: { create: async () => ({ prompt: async () => '{}' }) } } };
  eq(await detectAvailableTier({}), 'chrome-ai');
});

await t('无 Chrome AI 但配置了用户 API 时返回 user-api', async () => {
  resetGlobals();
  eq(await detectAvailableTier({ llm: { enabled: true, apiKey: 'k', baseUrl: 'https://x.y' } }), 'user-api');
});

await t('都不可用时返回 none', async () => {
  resetGlobals();
  eq(await detectAvailableTier({ llm: { enabled: false, apiKey: '', baseUrl: '' } }), 'none');
});

console.log('rerankSteps');

await t('Chrome AI 可用时优先走 chrome-ai', async () => {
  resetGlobals();
  globalThis.LanguageModel = {
    create: async () => ({
      prompt: async () => JSON.stringify({ steps: [
        { title: '打开周报模板', estMinutes: 2, tips: '先热身一下' },
        { title: '列本周三件事', estMinutes: 4, tips: '先写关键词' },
        { title: '补关键数据', estMinutes: 6, tips: '数字最有说服力' },
        { title: '通读后发出', estMinutes: 3, tips: '勇敢点发送' },
      ] }),
      destroy: async () => {},
    }),
  };
  const result = await rerankSteps({ subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' }, {});
  eq(result.source, 'chrome-ai');
});

await t('Chrome AI 会返回精修后的标题', async () => {
  resetGlobals();
  globalThis.LanguageModel = {
    create: async () => ({
      prompt: async () => JSON.stringify({ steps: [
        { title: '打开周报模板', estMinutes: 2, tips: '先热身一下' },
        { title: '列本周三件事', estMinutes: 4, tips: '先写关键词' },
        { title: '补关键数据', estMinutes: 6, tips: '数字最有说服力' },
        { title: '通读后发出', estMinutes: 3, tips: '勇敢点发送' },
      ] }),
      destroy: async () => {},
    }),
  };
  const result = await rerankSteps({ subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' }, {});
  eq(result.steps[0].title, '打开周报模板');
});

await t('Chrome AI 返回的 tips 会落到 detail', async () => {
  resetGlobals();
  globalThis.LanguageModel = {
    create: async () => ({
      prompt: async () => JSON.stringify({ steps: [
        { title: '打开周报模板', estMinutes: 2, tips: '先热身一下' },
        { title: '列本周三件事', estMinutes: 4, tips: '先写关键词' },
        { title: '补关键数据', estMinutes: 6, tips: '数字最有说服力' },
        { title: '通读后发出', estMinutes: 3, tips: '勇敢点发送' },
      ] }),
      destroy: async () => {},
    }),
  };
  const result = await rerankSteps({ subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' }, {});
  eq(result.steps[0].detail, '先热身一下');
});

await t('无 Chrome AI 时可走 user-api', async () => {
  resetGlobals();
  const result = await rerankSteps(
    { subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' },
    {
      settings: { llm: { enabled: true, apiKey: 'k', baseUrl: 'https://x.y', model: 'demo' } },
      userApiCaller: async () => JSON.stringify({ steps: [
        { title: '打开周报模板', estMinutes: 2, tips: '先热身一下' },
        { title: '列本周三件事', estMinutes: 4, tips: '先写关键词' },
        { title: '补关键数据', estMinutes: 6, tips: '数字最有说服力' },
        { title: '通读后发出', estMinutes: 3, tips: '勇敢点发送' },
      ] }),
    },
  );
  eq(result.source, 'user-api');
});

await t('Chrome AI 报错时会降级到 user-api', async () => {
  resetGlobals();
  globalThis.LanguageModel = { create: async () => ({ prompt: async () => { throw new Error('chrome ai disabled'); } }) };
  const result = await rerankSteps(
    { subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' },
    {
      settings: { llm: { enabled: true, apiKey: 'k', baseUrl: 'https://x.y', model: 'demo' } },
      userApiCaller: async () => JSON.stringify({ steps: [
        { title: '打开周报模板', estMinutes: 2, tips: '先热身一下' },
        { title: '列本周三件事', estMinutes: 4, tips: '先写关键词' },
        { title: '补关键数据', estMinutes: 6, tips: '数字最有说服力' },
        { title: '通读后发出', estMinutes: 3, tips: '勇敢点发送' },
      ] }),
    },
  );
  eq(result.source, 'user-api');
});

await t('Chrome AI 返回非法 JSON 时会回退原始步骤并 source=skip', async () => {
  resetGlobals();
  globalThis.LanguageModel = { create: async () => ({ prompt: async () => 'not-json', destroy: async () => {} }) };
  const result = await rerankSteps({ subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' }, {});
  eq(result.source, 'skip');
  eq(result.steps[0].title, draftSteps[0].title);
});

await t('Chrome AI 返回步骤数不足 4 时会回退原始步骤', async () => {
  resetGlobals();
  globalThis.LanguageModel = { create: async () => ({ prompt: async () => JSON.stringify({ steps: [{ title: '只给一步', estMinutes: 1, tips: '不够' }] }), destroy: async () => {} }) };
  const result = await rerankSteps({ subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' }, {});
  eq(result.source, 'skip');
  eq(result.steps.length, draftSteps.length);
});

await t('user-api 返回非法 JSON 时也会回退原始步骤', async () => {
  resetGlobals();
  const result = await rerankSteps(
    { subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' },
    {
      settings: { llm: { enabled: true, apiKey: 'k', baseUrl: 'https://x.y', model: 'demo' } },
      userApiCaller: async () => 'bad-json',
    },
  );
  eq(result.source, 'skip');
  eq(result.steps[1].title, draftSteps[1].title);
});

await t('无任何 tier 时直接 source=skip', async () => {
  resetGlobals();
  const result = await rerankSteps({ subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' }, {});
  eq(result.source, 'skip');
});

await t('返回结果会带 latencyMs', async () => {
  resetGlobals();
  const result = await rerankSteps({ subject: '写周报', steps: draftSteps, hints: {}, intent: 'write.report' }, {});
  ok(result.latencyMs >= 0, 'latencyMs 应 >= 0');
});

await t('userApiCaller 可拿到 subject / intent / prompt', async () => {
  resetGlobals();
  let captured = null;
  await rerankSteps(
    { subject: '写周报', steps: draftSteps, hints: { minutes: 30 }, intent: 'write.report' },
    {
      settings: { llm: { enabled: true, apiKey: 'k', baseUrl: 'https://x.y', model: 'demo' } },
      userApiCaller: async (payload) => {
        captured = payload;
        return JSON.stringify({ steps: [
          { title: '打开周报模板', estMinutes: 2, tips: '先热身一下' },
          { title: '列本周三件事', estMinutes: 4, tips: '先写关键词' },
          { title: '补关键数据', estMinutes: 6, tips: '数字最有说服力' },
          { title: '通读后发出', estMinutes: 3, tips: '勇敢点发送' },
        ] });
      },
    },
  );
  ok(captured.userPrompt.includes('写周报'), 'prompt 应包含 subject');
  ok(captured.userPrompt.includes('write.report'), 'prompt 应包含 intent');
});

resetGlobals();
globalThis.LanguageModel = originalLanguageModel;
globalThis.chrome = originalChrome;

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
