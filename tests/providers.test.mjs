// tests/providers.test.mjs — v0.5.1 免费 provider 预设（Gemini / Groq / DeepSeek）
const { PROVIDERS, findProvider, getWizardProviders, FREE_WIZARD_PROVIDER_IDS } = await import('../lib/providers.js');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓', name); pass += 1; }
  catch (error) { console.error('  ✗', name, '\n    ', error.message); fail += 1; }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m = '') { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

console.log('providers 预设');

t('所有 provider id 唯一', () => {
  const ids = PROVIDERS.map((p) => p.id);
  eq(new Set(ids).size, ids.length, 'id 应唯一');
});

t('包含三个免费 tier 向导 provider', () => {
  eq(FREE_WIZARD_PROVIDER_IDS.length, 3);
  const wiz = getWizardProviders();
  eq(wiz.length, 3, '向导应有 3 个');
  ['gemini', 'groq', 'deepseek'].forEach((id) => {
    ok(wiz.some((p) => p.id === id), `应包含 ${id}`);
  });
});

t('每个向导 provider 都有 baseUrl / defaultModel / 三步说明 / docsUrl', () => {
  getWizardProviders().forEach((p) => {
    ok(/^https:\/\//.test(p.baseUrl), `${p.id} baseUrl 应为 https`);
    ok(!!p.defaultModel, `${p.id} 应有 defaultModel`);
    ok(Array.isArray(p.wizardSteps) && p.wizardSteps.length === 3, `${p.id} 应有三步说明`);
    ok(/^https:\/\//.test(p.docsUrl), `${p.id} docsUrl 应为 https`);
    ok(p.free === true, `${p.id} 应标记 free`);
    eq(p.authHeader, 'Bearer', `${p.id} 应用 Bearer 鉴权（兼容 v1 caller）`);
  });
});

t('gemini / groq / deepseek baseUrl 与 OpenAI 兼容 caller 匹配', () => {
  eq(findProvider('gemini').baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  eq(findProvider('groq').baseUrl, 'https://api.groq.com/openai/v1');
  eq(findProvider('deepseek').baseUrl, 'https://api.deepseek.com/v1');
});

t('findProvider 未知 id 回退到 custom', () => {
  eq(findProvider('nope').id, 'custom');
});

t('保留既有 openai / ollama / 智谱等预设', () => {
  ['openai', 'ollama', 'zhipu', 'moonshot', 'custom'].forEach((id) => {
    ok(PROVIDERS.some((p) => p.id === id), `应保留 ${id}`);
  });
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
