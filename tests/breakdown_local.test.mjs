// tests/breakdown_local.test.mjs — v0.3.3 本地兜底分类/模板/相似任务复用
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.chrome = undefined;

const { analyzeInput, localBreakdown } = await import('../lib/breakdown.js');
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

console.log('normalizeInput / classifyIntent');

await t('能去掉前后礼貌词', async () => {
  const info = analyzeInput('帮我写一下周报呀 谢谢');
  eq(info.normalized, '写一下周报');
  eq(info.intent, 'write.report');
});

const classifyCases = [
  ['写周报', 'write.report'],
  ['帮我写一下周报', 'write.report'],
  ['周报怎么弄啊', 'write.report'],
  ['我该写周报了', 'write.report'],
  ['写技术设计文档', 'write.doc'],
  ['准备答辩 PPT', 'write.ppt'],
  ['回复客户邮件', 'write.email'],
  ['写一篇公众号文章', 'write.article'],
  ['读 arxiv 论文', 'study.read_paper'],
  ['准备考研复习计划', 'study.exam'],
  ['背托福单词', 'study.language'],
  ['排查线上 bug 报错', 'code.debug'],
  ['接入新的支付功能', 'code.feature'],
  ['review 这个 MR', 'code.review'],
  ['初始化 vite 脚手架环境', 'code.setup'],
  ['准备明天的评审会 agenda', 'meeting.prepare'],
  ['写会议纪要和 action items', 'meeting.followup'],
  ['去操场跑步 5km', 'life.workout'],
  ['收拾桌面和房间', 'life.clean'],
  ['买菜采购一周食材', 'life.shopping'],
  ['今晚做饭', 'life.cook'],
  ['规划国庆旅游行程和订票', 'life.travel'],
  ['整理报销发票和预算', 'life.finance'],
  ['准备前端面试', 'career.interview'],
  ['修改求职简历', 'career.resume'],
  ['准备晋升答辩材料', 'career.promotion'],
  ['回客户消息', 'social.reply'],
  ['做季度 OKR 规划', 'mind.plan'],
  ['纠结要不要换工作，帮我做决定', 'mind.decide'],
];

for (const [input, expectedIntent] of classifyCases) {
  await t(`分类：${input} -> ${expectedIntent}`, async () => {
    eq(analyzeInput(input).intent, expectedIntent);
  });
}

console.log('localBreakdown output');

for (const input of [
  '写周报',
  '读 arxiv 论文 12 页',
  '去操场跑步 5km',
  '准备前端面试',
  '整理报销发票',
]) {
  await t(`步骤数量与结构合理：${input}`, async () => {
    const result = await localBreakdown(input);
    ok(result.steps.length >= 4 && result.steps.length <= 8, 'steps 数量应在 4-8');
    result.steps.forEach((stepItem, index) => {
      ok(!!stepItem.title, `step[${index}] title 不能为空`);
      ok(stepItem.estMinutes >= 1 && stepItem.estMinutes <= 60, `step[${index}] estMinutes 应合理`);
    });
  });
}

await t('相似任务可复用最近 skeleton', async () => {
  await Storage.setRecentBreakdowns([
    {
      normalized: '写周报',
      intent: 'write.report',
      stepsSkeleton: [
        { title: '打开' + '{{subject}}' + '模板', detail: '先把 ' + '{{subject}}' + ' 的旧版找出来', estMinutes: 3 },
        { title: '列 3 个要点', detail: '围绕 ' + '{{subject}}' + ' 先写关键词', estMinutes: 5 },
        { title: '补数据和结果', detail: '给 ' + '{{subject}}' + ' 每点补一个数字', estMinutes: 8 },
        { title: '通读一遍后发出', detail: '确认 ' + '{{subject}}' + ' 的语气和日期', estMinutes: 4 },
      ],
      savedAt: Date.now(),
    },
  ]);
  const result = await localBreakdown('帮我写一下周报');
  eq(result.meta.reusedFromCache, true);
  ok(result.steps[0].title.includes('周报'), '应把 subject 重新填回步骤中');
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
