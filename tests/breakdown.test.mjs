// tests/breakdown.test.mjs — v1 冒烟测试
import { _internal, breakdownTask, refineStep } from '../lib/breakdown.js';
import { PROVIDERS, findProvider } from '../lib/providers.js';

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.log('  ✗', msg); failed += 1; }
}

console.log('# safeJsonParse');
{
  const raw = '```json\n{"steps":[{"title":"A","detail":"a","estMinutes":2}]}\n```';
  const obj = _internal.safeJsonParse(raw);
  assert(obj && Array.isArray(obj.steps), '可以解析 markdown fenced JSON');
}

console.log('# validateAndNormalize');
{
  const bad = _internal.validateAndNormalize({ steps: [] });
  assert(bad === null, '空 steps 应该返回 null');
  const ok = _internal.validateAndNormalize({ steps: ['s1', { title: 's2', detail: 'd', estMinutes: 4 }] });
  assert(ok && ok.steps.length === 2, '字符串 + 对象混合可以规范化');
  assert(ok.steps[0].estMinutes === 3, '缺失的 estMinutes 应该被填成 3');
}

console.log('# fallbackBreakdown 模板命中');
{
  const r1 = _internal.fallbackBreakdown('这周得把周报写完');
  assert(r1.steps.length >= 5, '周报任务返回 5 步以上');
  const r2 = _internal.fallbackBreakdown('去操场慢跑 30 分钟');
  assert(/装备|水|热身/.test(r2.steps.map(s => s.title + s.detail).join('')), '跑步任务包含运动关键字');
  const r3 = _internal.fallbackBreakdown('随便什么小事');
  assert(r3.steps.length >= 6, '通用兜底至少 6 步');
}

console.log('# fallbackRefine');
{
  const r = _internal.fallbackRefine({ title: '把桌面清空', detail: '' });
  assert(r && r.steps.length === 3, '通用 refine 返回 3 步');
}

console.log('# breakdownTask 无 LLM 走 fallback');
{
  const r = await breakdownTask('把桌面收拾一下', { llm: { enabled: false } });
  assert(r.source === 'fallback', '未启用 LLM 时 source=fallback');
  assert(r.steps.length >= 5, '兜底步骤数量合理');
}

console.log('# refineStep 无 LLM 走 fallback');
{
  const step = { title: '写周报', detail: '', estMinutes: 5 };
  const r = await refineStep('周五前把周报写完', step, [step], { llm: { enabled: false } });
  assert(r.source === 'fallback', 'refineStep fallback');
  assert(r.steps.length === 3, 'refineStep 返回 3 步');
}

console.log('# providers');
{
  assert(PROVIDERS.length >= 5, 'Provider 预设 >= 5 个');
  const p = findProvider('deepseek');
  assert(p && p.baseUrl.includes('deepseek'), 'findProvider deepseek 可用');
  const c = findProvider('non-exist');
  assert(c && c.id === 'custom', 'findProvider fallback 到 custom');
}

console.log('\n');
if (failed) { console.log(`❌ ${failed} 项失败`); process.exit(1); }
else { console.log('✅ 全部通过'); }
