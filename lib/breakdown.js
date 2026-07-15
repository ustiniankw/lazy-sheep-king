// lib/breakdown.js — v0.3.3: LLM + 本地兜底升级（标准化 / 分类 / 模板 / 相似任务复用）
import { Storage } from './storage.js';
import { chatComplete } from './llm_client.js';
import { rerankSteps } from './ai_rerank.js';

const SYSTEM_PROMPT_BREAKDOWN = `你是"懒羊羊大王"——一位温柔又幽默的执行力教练。
你要把用户想做的一件事，拆成一串「傻瓜到不能再傻瓜」的操作步骤，让重度拖延症患者也能一步一步照做。

要求：
1. 每一步都必须是 30 秒到 5 分钟内可以完成的"最小可执行动作"，禁止出现"完成 XXX"、"搞定 YYY"这种含糊指令。
2. 步骤要具体到"打开哪个 App / 拿起哪个东西 / 打几个字 / 写几行字 / 站起来走到哪里"。
3. 步骤开头用动词，如"打开…"、"新建…"、"写下…"、"喝一口水"、"深呼吸 3 次"。
4. 前 1-2 步一定要是"极其简单、几乎无门槛"的启动步骤（比如"拿出手机放在桌面右上角"），用来破除启动阻力。
5. 步骤数量：5 到 10 步之间，普通任务尽量控制在 6-8 步。
6. 语气可爱、俏皮、鼓励，但不废话，一句话讲清一步。
7. 严格输出 JSON，不要 markdown 代码块，不要多余解释。

输出 JSON schema：
{
  "steps": [
    { "title": "步骤名(<=20字)", "detail": "1-2 句可爱的详细说明(<=60字)", "estMinutes": 数字(1-10) }
  ]
}`;

const SYSTEM_PROMPT_REFINE = `你是"懒羊羊大王"的助理，负责把一个已经存在的"步骤"再拆成更小的 3-5 步。
用户觉得当前这一步太难 / 太模糊，需要你把它变成幼儿园难度。

要求：
1. 只针对"目标步骤"再拆，其它步骤不要重复。
2. 每一个子步骤必须 30 秒 ~ 3 分钟可完成。
3. 动词开头，具体到打开哪个 App / 打几个字 / 拿起什么东西。
4. 数量 3-5 步。
5. 语气可爱鼓励。
6. 严格输出 JSON：{ "steps": [ { "title": "...", "detail": "...", "estMinutes": 数字 } ] }`;

const SUBJECT_PLACEHOLDER = '{{subject}}';
const PREFIX_RE = /^(帮我|帮忙|我想|我要|请|需要|我准备|我该怎么|我该如何|怎么|如何|麻烦你|能不能|想要|打算)\s*/;
const SUFFIX_RE = /(谢谢|求助|一下|一下下|呀|啊|呢|嘛|吧|可以吗|行吗|好吗|呗)+$/;

function step(title, estMinutes, detail) {
  return { title, detail, tips: detail, estMinutes };
}

function quoted(subject) {
  return subject ? `「${subject}」` : '这件事';
}

function asciiToHalfWidth(str) {
  return Array.from(str || '').map((char) => {
    const code = char.charCodeAt(0);
    if (code === 12288) return ' ';
    if (code >= 65281 && code <= 65374) return String.fromCharCode(code - 65248);
    return char;
  }).join('');
}

function collapseSpaces(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function normalizeForDisplay(str) {
  return collapseSpaces(
    asciiToHalfWidth(str)
      .replace(/[，、；：]/g, ' ')
      .replace(/[“”‘’]/g, '"')
      .replace(/[（）]/g, ' ')
      .replace(/[？?！!。,.]/g, ' ')
  );
}

function safeJsonParse(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  try {
    return JSON.parse(raw);
  } catch {
    const matched = raw.match(/\{[\s\S]*\}/);
    if (matched) {
      try { return JSON.parse(matched[0]); } catch {}
    }
    return null;
  }
}

function validateAndNormalize(obj) {
  if (!obj || !Array.isArray(obj.steps) || obj.steps.length === 0) return null;
  const steps = obj.steps.map((item, index) => {
    if (typeof item === 'string') {
      return { title: item.slice(0, 40), detail: '', tips: '', estMinutes: 3 };
    }
    const title = String(item.title || item.name || `步骤 ${index + 1}`).trim().slice(0, 40);
    const detail = String(item.detail || item.tips || item.desc || item.description || '').trim().slice(0, 120);
    const tips = String(item.tips || detail || '').trim().slice(0, 120);
    let estMinutes = Number(item.estMinutes || item.minutes || 3);
    if (!Number.isFinite(estMinutes) || estMinutes <= 0) estMinutes = 3;
    if (estMinutes > 60) estMinutes = 60;
    return { title, detail, tips, estMinutes };
  }).filter((item) => item.title);
  if (steps.length === 0) return null;
  return { steps };
}

async function callLLMForBreakdown(goal, settings) {
  const { baseUrl, apiKey, model } = settings.llm || {};
  const { content, usage, model: modelUsed, elapsedMs } = await chatComplete({
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_BREAKDOWN },
      { role: 'user', content: `请把下面这件事拆成傻瓜级步骤：\n---\n${goal}\n---` },
    ],
  });
  const parsed = safeJsonParse(content);
  const normalized = validateAndNormalize(parsed);
  if (!normalized) throw new Error('LLM 返回内容无法解析成步骤');
  return { ...normalized, meta: { usage, model: modelUsed, elapsedMs } };
}

async function callLLMForRefine(goal, stepItem, siblings, settings) {
  const { baseUrl, apiKey, model } = settings.llm || {};
  const siblingText = siblings.map((item, index) => `${index + 1}. ${item.title}`).join('\n');
  const user = `【总目标】${goal}\n【所有步骤列表】\n${siblingText}\n【目标步骤（需要再拆成 3-5 步）】\n${stepItem.title}${stepItem.detail ? '（' + stepItem.detail + '）' : ''}`;
  const { content, usage, model: modelUsed, elapsedMs } = await chatComplete({
    baseUrl,
    apiKey,
    model,
    temperature: 0.4,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_REFINE },
      { role: 'user', content: user },
    ],
  });
  const parsed = safeJsonParse(content);
  const normalized = validateAndNormalize(parsed);
  if (!normalized) throw new Error('LLM 返回内容无法解析成子步骤');
  return { ...normalized, meta: { usage, model: modelUsed, elapsedMs } };
}

const INTENT_RULES = [
  { intent: 'study.read_paper', keywords: ['论文', 'paper', 'arxiv', '文献'] },
  { intent: 'study.exam', keywords: ['备考', '复习', '期末', '考研', '公务员', '刷题', '考试'] },
  { intent: 'study.language', keywords: ['背单词', '英语', '雅思', '托福', '口语', '单词', '听力'] },
  { intent: 'code.debug', keywords: ['排查', 'bug', '报错', 'debug', 'fix', '错误', '故障', '异常'] },
  { intent: 'code.feature', keywords: ['开发功能', '实现', '接入', '迁移', '重构', '新功能', '需求开发'] },
  { intent: 'code.review', keywords: ['代码评审', 'review', 'mr', 'pr', 'merge request', 'code review', '看 diff'] },
  { intent: 'code.setup', keywords: ['搭建', '初始化', '脚手架', '环境配置', '配置环境', 'setup', '安装依赖'] },
  { intent: 'write.report', keywords: ['周报', '日报', '月报', '年报', '汇报', '总结', '报告'] },
  { intent: 'write.doc', keywords: ['文档', '技术文档', '需求文档', '设计文档', 'prd', '说明文'] },
  { intent: 'write.ppt', keywords: ['ppt', '幻灯片', '演讲稿', 'deck'] },
  { intent: 'write.email', keywords: ['邮件', 'email', 'mail', '回复邮件'] },
  { intent: 'write.article', keywords: ['文章', '博客', '公众号', '知乎', '推文', '专栏'] },
  { intent: 'meeting.prepare', keywords: ['准备会议', '开会', '会议', '评审会', 'agenda', '会前', 'sync'] },
  { intent: 'meeting.followup', keywords: ['会议纪要', '复盘', '回顾', 'follow up', '会后', 'action items', '跟进会议'] },
  { intent: 'life.workout', keywords: ['跑步', '慢跑', '运动', '健身', '锻炼', '减肥', '瑜伽', '训练'] },
  { intent: 'life.clean', keywords: ['打扫', '收拾', '整理房间', '家务', '清洁', '整理桌面', '桌面'] },
  { intent: 'life.shopping', keywords: ['购物', '买菜', '采购', '下单', '购买', '囤货'] },
  { intent: 'life.cook', keywords: ['做饭', '做菜', '烹饪', '菜谱', '炒菜'] },
  { intent: 'life.travel', keywords: ['出行', '旅游', '攻略', '订票', '行程', '酒店', '机票'] },
  { intent: 'life.finance', keywords: ['记账', '理财', '预算', '报销', '发票', '财务'] },
  { intent: 'career.interview', keywords: ['面试', '求职', '找工作', '投简历', '笔试', '面经'] },
  { intent: 'career.resume', keywords: ['简历', '修改简历', '求职简历', 'cv', '履历'] },
  { intent: 'career.promotion', keywords: ['晋升', '答辩', '绩效', '述职'] },
  { intent: 'social.reply', keywords: ['回消息', '聊天', '客户沟通', '客户', '回复消息', '回微信'] },
  { intent: 'mind.plan', keywords: ['计划', '规划', '年度总结', 'okr', '路线图'] },
  { intent: 'mind.decide', keywords: ['选择', '决定', '纠结', '选哪个', '要不要', '对比'] },
];

const ALL_KEYWORDS = Array.from(new Set(INTENT_RULES.flatMap((rule) => rule.keywords))).sort((a, b) => b.length - a.length);

function extractHints(normalized) {
  const hints = {};
  const minutes = normalized.match(/(\d+)\s*(分钟|min|mins?)/i);
  const kilometers = normalized.match(/(\d+(?:\.\d+)?)\s*(km|公里)/i);
  const pages = normalized.match(/(\d+)\s*(页|pages?)/i);
  const count = normalized.match(/(\d+)\s*(个|篇|次|条|封|题|章)/i);
  const deadlineMatches = normalized.match(/(明天|后天|今晚|今天|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}点半?|\d{1,2}:\d{2})/g);
  if (minutes) hints.minutes = Number(minutes[1]);
  if (kilometers) hints.kilometers = Number(kilometers[1]);
  if (pages) hints.pages = Number(pages[1]);
  if (count) hints.count = Number(count[1]);
  if (deadlineMatches?.length) hints.deadline = Array.from(new Set(deadlineMatches)).join(' · ');
  return hints;
}

function tokenizeNormalized(normalized) {
  const tokenSet = new Set();
  const text = normalized || '';
  ALL_KEYWORDS.forEach((keyword) => {
    if (text.includes(keyword)) tokenSet.add(keyword);
  });
  const chunks = text.match(/[a-z0-9_+#.-]+|[\u4e00-\u9fa5]{2,}/g) || [];
  chunks.forEach((chunk) => {
    tokenSet.add(chunk);
    const simplified = chunk.replace(/帮我|我想|我要|需要|请|一下下|一下|写|做|准备|安排|处理|开始|今天|明天|马上/g, '').trim();
    if (simplified && simplified !== chunk) tokenSet.add(simplified);
  });
  return Array.from(tokenSet).filter(Boolean);
}

function stripCommonVerbPhrases(text) {
  return text
    .replace(/^(写|做|完成|准备|搞定|安排|处理|开始|学习|复习|看|弄|开发|实现|搭建)/, '')
    .replace(/(怎么做|怎么写|怎么弄|怎么办|该怎么做|该怎么写|了)$/g, '')
    .trim();
}

export function normalizeInput(raw) {
  const original = collapseSpaces(String(raw || ''));
  let cleaned = normalizeForDisplay(original);
  let prev = '';
  while (cleaned && cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(PREFIX_RE, '').replace(SUFFIX_RE, '').trim();
  }
  cleaned = cleaned
    .replace(/^(关于|想做|想写|想学)\s+/, '')
    .replace(/(怎么做|怎么写|怎么弄|怎么办|该怎么做|该怎么写)$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const hints = extractHints(cleaned);
  const tokens = tokenizeNormalized(cleaned);
  const subject = stripCommonVerbPhrases(cleaned) || cleaned || original;
  return { normalized: cleaned || original.toLowerCase(), subject, tokens, hints };
}

export function classifyIntent(normalized, tokens = []) {
  const tokenSet = new Set(tokens || []);
  const ranked = INTENT_RULES.map((rule) => {
    const matchedKeywords = rule.keywords.filter((keyword) => normalized.includes(keyword) || tokenSet.has(keyword));
    let score = matchedKeywords.length;
    if (matchedKeywords.length >= 2) score += 0.35;
    if (matchedKeywords.some((keyword) => keyword.length >= 4)) score += 0.15;
    return {
      intent: rule.intent,
      matchedKeywords,
      score,
      confidence: Math.min(0.99, matchedKeywords.length === 0 ? 0 : 0.22 + score / 3),
    };
  }).sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top || top.score <= 0) {
    return { intent: 'default.generic', confidence: 0.2, matchedKeywords: [], ranked };
  }
  return {
    intent: top.intent,
    confidence: top.confidence,
    matchedKeywords: top.matchedKeywords,
    ranked,
  };
}

export function analyzeInput(input) {
  const normalized = normalizeInput(input);
  const classified = classifyIntent(normalized.normalized, normalized.tokens);
  return {
    raw: String(input || ''),
    normalized: normalized.normalized,
    subject: normalized.subject || normalized.normalized,
    tokens: normalized.tokens,
    hints: normalized.hints,
    intent: classified.intent,
    confidence: classified.confidence,
    matchedKeywords: classified.matchedKeywords,
    intents: classified.ranked,
  };
}

function buildTemplates(intent, hints, subject) {
  const goal = quoted(subject);
  const km = hints.kilometers || 0;
  const pages = hints.pages || 0;
  const minutes = hints.minutes || 0;
  switch (intent) {
    case 'study.read_paper':
      return [
        step('打开论文 PDF', 2, `先把 ${goal} 的 PDF、摘要页和笔记页一起开好。`),
        step('扫一遍标题和摘要', 4, '先只看标题 / 摘要 / 结论，别急着逐段啃。'),
        step(`圈出 ${pages ? Math.min(3, Math.max(1, pages)) : 3} 个核心问题`, 4, '把你最想弄懂的点先圈出来，读起来更有方向。'),
        step('精读方法或实验部分', 10, '只挑一块最关键的部分细看，读懂一块就赚。'),
        step('写下 3 句自己的话', 5, `用自己的语言总结 ${goal} 的核心贡献。`),
        step('补一个待查清单', 3, '把还没懂的术语或公式列成小清单，下轮继续。'),
      ];
    case 'study.exam':
      return [
        step('列考试范围', 4, `把 ${goal} 涉及的章节 / 科目先写成清单。`),
        step('挑今天只攻 1 小块', 3, '只选一章或一题型，先缩小战场。'),
        step('看例题或知识框架', 8, '先看骨架，不要一上来就死磕细节。'),
        step('做 5-10 题小练习', 12, '做题时把不会的点单独圈起来。'),
        step('整理错因 3 条', 6, '写下为什么错、下次怎么避坑。'),
        step('标记明天接着复习的位置', 2, '给下一次学习留一个清晰入口。'),
      ];
    case 'study.language':
      return [
        step('选今天的词表', 3, `从 ${goal} 里只挑今天要啃的 10-15 个词。`),
        step('大声读 2 遍', 4, '耳朵和嘴巴一起上，记得更牢。'),
        step('给每个词配一个短句', 8, '不用高级句子，能用出来就行。'),
        step('遮住中文回忆一遍', 5, '试着靠自己回忆，卡住也没关系。'),
        step('挑 3 个最难词复读', 4, '重点重复最容易忘的那几个。'),
        step('睡前再快速过一轮', 3, '最后轻轻复习一下，给大脑一个睡前提示。'),
      ];
    case 'code.debug':
      return [
        step('复现一次问题', 4, `先稳定复现 ${goal}，别一上来就改代码。`),
        step('记下报错原文', 3, '把报错、日志关键词、触发条件抄下来。'),
        step('缩小怀疑范围', 6, '只圈 1-2 个最可能的模块，不要全盘乱看。'),
        step('打印关键信息', 8, '加最小量日志 / 断点，确认数据在哪一步变坏。'),
        step('改一个最小修复点', 10, '一次只改一处，便于确认因果。'),
        step('复测同路径和边界', 6, '把原问题和一个相邻场景都再走一遍。'),
      ];
    case 'code.feature':
      return [
        step('打开需求和代码入口', 4, `先看清 ${goal} 的输入、输出和入口文件。`),
        step('写 3 个验收点', 5, '先定义什么算完成，后面就不容易跑偏。'),
        step('搭出最小骨架', 8, '先把函数、组件或接口骨架立起来。'),
        step('打通主流程', 12, '先让 happy path 能跑，再补边角。'),
        step('补 1-2 个关键校验', 8, '给最容易翻车的点加保护。'),
        step('自测并记录结果', 5, '把测试路径和结果记一句，方便回顾。'),
      ];
    case 'code.review':
      return [
        step('打开 MR / PR 描述', 3, '先看背景、目标和影响范围。'),
        step('按文件扫一遍 diff', 8, '先整体浏览，不要急着抠细节。'),
        step('标记 3 个风险点', 6, '重点看边界条件、命名、异常处理。'),
        step('验证一处关键逻辑', 8, `挑和 ${goal} 最相关的一段逻辑认真过。`),
        step('写清评论和建议', 5, '评论尽量具体，最好附原因或替代方案。'),
        step('给出结论', 2, '用一句话说明：可过 / 需改 / 建议补测。'),
      ];
    case 'code.setup':
      return [
        step('列环境清单', 4, `把 ${goal} 需要的 runtime / 包管理器 / 仓库先列出来。`),
        step('安装最基础依赖', 8, '先装必要工具，不要一口气全装满。'),
        step('跑一次初始化命令', 6, '把脚手架或项目先拉起来。'),
        step('启动本地示例', 8, '哪怕只是看到首页，也算迈出关键一步。'),
        step('记下缺的配置项', 5, '把报错里缺的 env / token / path 逐条记出来。'),
        step('补一份启动备注', 3, '留一句“下次从哪一步开始”。'),
      ];
    case 'write.report':
      return [
        step('打开上一版参考', 3, '先找旧周报 / 模板，别从纯空白开始。'),
        step('列出本周关键动作 3 条', 5, `围绕 ${goal} 先只写关键词，不求完整。`),
        step('每条补充数据或结果', 8, '给每个动作补一个数字、结果或产出物。'),
        step('写下阻碍与处理', 5, '卡点写一句“怎么处理的”，会更有说服力。'),
        step('写下一周计划 3 条', 5, '每条尽量是能直接执行的小目标。'),
        step('通读一遍润色语气', 4, '删废话、补主语，让老板一眼看懂。'),
        step('发出前给自己复核', 2, '再看一遍日期、称呼和数据，确认就发。'),
      ];
    case 'write.doc':
      return [
        step('写文档目的', 3, `先写一句：这份 ${goal} 是给谁看的、解决什么问题。`),
        step('列目录骨架', 5, '把一级标题先搭出来，空着也没关系。'),
        step('填最关键的一节', 10, '先写你最清楚的一块，别等全想好。'),
        step('补流程或示例', 8, '加一个例子，读者会轻松很多。'),
        step('写风险和待确认点', 4, '先把不确定点摊开，文档更真实。'),
        step('站在读者角度再扫一遍', 4, '删掉只有你自己看得懂的句子。'),
      ];
    case 'write.ppt':
      return [
        step('定 1 句主结论', 3, `先想清楚 ${goal} 最想让别人记住哪一句话。`),
        step('列 5 页大纲', 6, '封面 / 背景 / 核心点 / 数据 / 收尾，先摆出来。'),
        step('给每页写标题句', 6, '每页标题最好单独看也能懂。'),
        step('补 1 个图或数据', 8, '每页只放一个重点，别塞太满。'),
        step('把备注区写成演讲提词', 6, '每页记 1 句你要说的话。'),
        step('顺着讲一遍', 5, '从头讲 1 次，发现卡壳就改标题。'),
      ];
    case 'write.email':
      return [
        step('确认收件人和目标', 3, '先想清楚你这封邮件是通知、请求还是回复。'),
        step('写一句开头', 2, `第一句就点明 ${goal} 的核心目的。`),
        step('列 3 个要点', 5, '每个要点一行，越短越好。'),
        step('补一个明确请求', 4, '告诉对方你希望他什么时候做什么。'),
        step('检查语气和附件', 3, '确认礼貌、附件齐全、称呼无误。'),
        step('发出并留个 follow-up 提醒', 2, '发完给自己留个提醒，避免忘记跟进。'),
      ];
    case 'write.article':
      return [
        step('写标题草案', 4, `先给 ${goal} 起 2-3 个标题，别追求一步到位。`),
        step('列文章 3 段结构', 5, '开头 / 核心观点 / 收尾，先摆骨架。'),
        step('先写开头 5 句', 8, '开头只负责把读者留住。'),
        step('扩写最想写的一段', 10, '先写最有感觉的部分，动力会更足。'),
        step('补一个真实例子', 6, '故事或案例能让文章更有记忆点。'),
        step('删 3 句废话再发布', 4, '能删就删，短一点反而更有力量。'),
      ];
    case 'meeting.prepare':
      return [
        step('写会议目标一句话', 3, `先写清楚 ${goal} 这场会要产出什么。`),
        step('列 3 个议题', 5, '每个议题一句话，避免会上散掉。'),
        step('收齐资料链接', 5, '把需要展示的文档 / 图 / 数据提前放一起。'),
        step('给每个议题安排时间', 4, '哪怕是粗分配，也能救命。'),
        step('预想 3 个可能问题', 6, '提前想一下别人可能会问什么。'),
        step('把议程发出去', 2, '会前发一版 agenda，大家会更有准备。'),
      ];
    case 'meeting.followup':
      return [
        step('收集散落笔记', 4, '先把聊天记录、截图、便签集中到一起。'),
        step('写 3 条会议结论', 5, '先写结论，不要从流水账开始。'),
        step('列 action items', 6, '每项写清 owner、截止时间、下一步。'),
        step('补一条风险提醒', 3, '把最容易被忘掉的依赖或风险写明。'),
        step('发出会议纪要', 3, '越快发越值钱，最好会后 30 分钟内。'),
      ];
    case 'life.workout': {
      const totalKm = km || 0;
      const halfKm = totalKm ? Number((totalKm / 2).toFixed(1)) : 0;
      return [
        step('换上运动装备', 3, '先换鞋换衣服，不用想成绩。'),
        step('喝一小杯水', 1, '轻轻补点水，准备开动。'),
        step('动态热身 5 分钟', 5, '活动脚踝、膝盖、髋和肩。'),
        step(totalKm ? `跑前半程 ${halfKm} km` : `先动起来 ${Math.max(8, Math.round(minutes * 0.5) || 10)} 分钟`, 12, '保持能说完整句子的舒服节奏。'),
        step(totalKm ? `跑后半程 ${Number((totalKm - halfKm).toFixed(1))} km` : '再坚持一个短回合', 12, '如果累了就降速，别和自己硬杠。'),
        step('走 3 分钟收尾', 3, '让心率慢慢降下来。'),
        step('拉伸并记一句感受', 4, '记录今天状态，下次会更容易开始。'),
      ];
    }
    case 'life.clean':
      return [
        step('拿一个空袋子', 1, '垃圾袋 / 空箱子都行。'),
        step('先清出 1 小块台面', 4, '只清一半也算赢，不用一次扫平。'),
        step('扔掉明显垃圾', 3, '不纠结，能扔就先扔。'),
        step('把同类物品归一堆', 5, '书归书、线归线、文件归文件。'),
        step('把每堆放回原位', 5, '只处理这一小块，别到处开新坑。'),
        step('擦一遍表面', 3, '最后擦一下，成就感会更强。'),
      ];
    case 'life.shopping':
      return [
        step('先看现有库存', 3, '冰箱 / 收纳柜先扫一遍，避免重复买。'),
        step('列购物清单', 5, `围绕 ${goal} 只写今天真要买的东西。`),
        step('按区域分组', 3, '把生鲜 / 日用品 / 零食分开，买起来更顺。'),
        step('设一个预算上限', 2, '先定上限，购物时不容易飘。'),
        step('下单或出门采购', 12, '按清单买，看到促销先停 3 秒。'),
        step('回来核对并收纳', 5, '对照清单收好，避免买了又忘。'),
      ];
    case 'life.cook':
      return [
        step('定今天做哪道菜', 3, `先决定 ${goal} 里最容易做的一道。`),
        step('把食材和调料摆出来', 4, '台面准备好，后面不容易手忙脚乱。'),
        step('先洗再切', 8, '处理食材时按“最不脏 → 最脏”顺序来。'),
        step('热锅下主料', 8, '先把主菜做熟，配菜再跟上。'),
        step('调味并试一口', 4, '先少量调味，尝了再补。'),
        step('装盘顺手收台面', 4, '吃前把锅铲和台面简单收一下。'),
      ];
    case 'life.travel':
      return [
        step('定时间和预算', 4, `先写下 ${goal} 的日期、天数和预算上限。`),
        step('列交通方案 2 个', 6, '高铁 / 飞机 / 自驾，先各看一个。'),
        step('选住宿区域', 5, '先看位置，再看价格。'),
        step('列每天 1-2 个重点', 8, '不要把行程塞太满，留出弹性。'),
        step('先订最容易涨价的', 6, '通常是交通和热门酒店。'),
        step('写一张打包清单', 4, '证件、充电器、洗漱包先记上。'),
      ];
    case 'life.finance':
      return [
        step('收齐账单或发票', 4, '先把材料找齐，后面才不会来回翻。'),
        step('记下今天 3 笔支出', 5, '先从最容易想起的几笔开始。'),
        step('分一下类别', 4, '餐饮 / 交通 / 购物 / 订阅，先粗分就好。'),
        step('看一眼本月预算', 4, '确认哪一类已经快超了。'),
        step('补一条控制动作', 3, '给自己写一句最小调整，比如“这周少点 1 次外卖”。'),
        step('需要报销就马上提交', 5, '材料齐时顺手交，最省脑子。'),
      ];
    case 'career.interview':
      return [
        step('重新看 JD', 4, `先看 ${goal} 对方最在意哪 3 个能力。`),
        step('挑 3 段匹配经历', 6, '每段经历都准备“场景-动作-结果”。'),
        step('写 1 分钟自我介绍', 6, '尽量短、具体、有结果。'),
        step('准备 5 个高频问题', 8, '比如项目难点、冲突处理、失败经历。'),
        step('对着手机讲一遍', 6, '录一遍，立刻能发现语气和停顿问题。'),
        step('准备反问 2 个问题', 3, '反问能体现认真，也帮你判断岗位。'),
      ];
    case 'career.resume':
      return [
        step('打开现有简历', 3, '先不要新建空白，从旧版改最快。'),
        step('更新标题和目标岗位', 4, `让 ${goal} 一眼对应到目标岗位。`),
        step('补 3 条最强经历', 10, '每条都尽量写清动作 + 数据结果。'),
        step('删掉不相关内容', 5, '给真正重要的经历腾空间。'),
        step('按 JD 补关键词', 4, '让系统和面试官都更容易看懂你。'),
        step('导出 PDF 再过一遍', 3, '排版跑掉的话马上修。'),
      ];
    case 'career.promotion':
      return [
        step('列 3 个代表性成果', 5, `围绕 ${goal} 先只列名字，不展开。`),
        step('给每个成果补数据', 8, '有数字、有影响范围，就更站得住。'),
        step('补一段个人成长', 5, '写你在哪些地方变强了。'),
        step('列 2 个挑战和解法', 5, '答辩时这部分很容易被问到。'),
        step('整理成 5 页结构', 6, '问题、行动、结果、影响、下一步。'),
        step('顺一遍 3 分钟讲稿', 4, '讲通一遍，心里就会稳很多。'),
      ];
    case 'social.reply':
      return [
        step('打开未回消息列表', 2, '先把所有未回对话摊出来。'),
        step('按紧急程度排一下', 3, '先回最短最明确的那几条。'),
        step('先回 2 条简单消息', 4, '先把启动阻力降下来。'),
        step('处理 1 条复杂沟通', 8, `围绕 ${goal} 先写要点，再组织语气。`),
        step('补一个下一步动作', 3, '比如约时间、补材料、回头再跟。'),
        step('确认没有遗漏关键人', 2, '避免只回了一半。'),
      ];
    case 'mind.plan':
      return [
        step('写清时间范围', 3, `先写 ${goal} 是今天、本周还是本月的计划。`),
        step('列 3 个最重要目标', 5, '超过 3 个就容易失焦。'),
        step('给每个目标配 1 个里程碑', 6, '越具体越容易往前推。'),
        step('挑一个最先启动', 4, '先决定今天只推进哪一件。'),
        step('把第一步写进日程', 3, '写进时间块里，比只想想强很多。'),
        step('留一个复盘提醒', 2, '给未来的自己一个回看入口。'),
      ];
    case 'mind.decide':
      return [
        step('写下选项 A / B / C', 3, '别在脑子里转，先落到纸面。'),
        step('各写 3 个优点', 5, '先看它们能带来什么。'),
        step('各写 3 个代价', 5, '时间、金钱、精力都算。'),
        step('只挑 1 个关键标准', 4, '比如成长、收益、稳定、快乐，只选最重要那个。'),
        step('给每个选项打个分', 3, '粗糙一点也没关系，先有倾向。'),
        step('定一个试运行动作', 3, '如果还犹豫，就安排一个最小试错动作。'),
      ];
    default:
      return [
        step('深呼吸 3 次', 1, '先把注意力从别的事情上收回来。'),
        step('写下一句真正目标', 2, `一句话写下：${goal}。写下来就已经赢一半。`),
        step('列出 3 个子任务', 4, '想到什么就先写什么，不用排序。'),
        step('挑最简单的一个先做', 5, '先动手而不是先想完美方案。'),
        step('做完马上打个勾', 2, '让大脑收到“我开始了”的奖励。'),
        step('继续下一个小动作', 6, '沿着刚才的节奏，再推进一点点。'),
      ];
  }
}

function selectIntentBundle(intents) {
  const positive = (intents || []).filter((item) => item.score > 0);
  if (positive.length === 0) return ['default.generic'];
  const first = positive[0];
  const selected = [first.intent];
  const second = positive[1];
  if (second && second.score >= 1.35 && (first.score - second.score) <= 0.8) {
    selected.push(second.intent);
  }
  return Array.from(new Set(selected)).slice(0, 2);
}

function dedupeSteps(steps) {
  const seen = new Set();
  const deduped = [];
  (steps || []).forEach((item) => {
    const key = String(item.title || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  return deduped;
}

function createPlanFromAnalysis(analysis) {
  const intents = selectIntentBundle(analysis.intents);
  const built = dedupeSteps(intents.flatMap((intent) => buildTemplates(intent, analysis.hints, analysis.subject))).slice(0, 8);
  const normalized = validateAndNormalize({ steps: built.length >= 4 ? built : buildTemplates('default.generic', analysis.hints, analysis.subject) });
  return {
    steps: normalized.steps,
    meta: {
      intent: analysis.intent,
      mergedIntents: intents,
      matchedKeywords: analysis.matchedKeywords,
    },
  };
}

function replaceSubjectPlaceholders(text, subject) {
  return String(text || '').replaceAll(SUBJECT_PLACEHOLDER, subject || '这件事').replace(/\s+/g, ' ').trim();
}

export function createStepsSkeleton(steps, subject) {
  const target = String(subject || '').trim();
  return (steps || []).map((item) => {
    const title = target ? String(item.title || '').split(target).join(SUBJECT_PLACEHOLDER) : String(item.title || '');
    const detail = target ? String(item.detail || '').split(target).join(SUBJECT_PLACEHOLDER) : String(item.detail || '');
    const tips = target ? String(item.tips || item.detail || '').split(target).join(SUBJECT_PLACEHOLDER) : String(item.tips || item.detail || '');
    return { title, detail, tips, estMinutes: Number(item.estMinutes) || 3 };
  });
}

function fillStepsSkeleton(stepsSkeleton, subject) {
  return (stepsSkeleton || []).map((item) => ({
    title: replaceSubjectPlaceholders(item.title, subject),
    detail: replaceSubjectPlaceholders(item.detail || item.tips || '', subject),
    tips: replaceSubjectPlaceholders(item.tips || item.detail || '', subject),
    estMinutes: Number(item.estMinutes) || 3,
  }));
}

function jaccard(tokensA = [], tokensB = []) {
  const a = new Set(tokensA);
  const b = new Set(tokensB);
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  a.forEach((token) => {
    if (b.has(token)) hit += 1;
  });
  return hit / new Set([...a, ...b]).size;
}

async function retrieveSimilarBreakdown(analysis) {
  const cache = await Storage.getRecentBreakdowns().catch(() => []);
  let best = null;
  (cache || []).forEach((entry) => {
    if (!entry?.normalized || !Array.isArray(entry.stepsSkeleton)) return;
    const entryAnalysis = analyzeInput(entry.normalized);
    let similarity = jaccard(analysis.tokens, entryAnalysis.tokens);
    const sameIntent = (entry.intent || entryAnalysis.intent) === analysis.intent;
    const keywordOverlap = analysis.matchedKeywords.some((keyword) => entryAnalysis.matchedKeywords.includes(keyword));
    if (sameIntent && keywordOverlap) similarity = Math.max(similarity, 0.72);
    if (sameIntent && (analysis.normalized.includes(entry.normalized) || entry.normalized.includes(analysis.normalized))) {
      similarity = Math.max(similarity, 0.76);
    }
    if (similarity > 0.65 && (!best || similarity > best.similarity)) {
      best = { entry, similarity };
    }
  });
  if (!best) return null;
  const normalized = validateAndNormalize({ steps: fillStepsSkeleton(best.entry.stepsSkeleton, analysis.subject) });
  if (!normalized) return null;
  return {
    steps: normalized.steps,
    similarity: best.similarity,
    intent: best.entry.intent || analysis.intent,
  };
}

function fallbackBreakdown(goal) {
  return createPlanFromAnalysis(analyzeInput(goal));
}

function mergeRerankedSteps(originalSteps, refinedSteps) {
  if (!Array.isArray(refinedSteps) || refinedSteps.length < 4) return originalSteps;
  return refinedSteps.map((item, index) => {
    const original = originalSteps[index] || {};
    const tips = String(item.tips || item.detail || original.tips || original.detail || '').trim();
    return {
      ...original,
      title: String(item.title || original.title || `步骤 ${index + 1}`).trim(),
      tips,
      detail: tips || String(original.detail || ''),
      estMinutes: Number(item.estMinutes || original.estMinutes || 3) || 3,
    };
  });
}

async function buildBreakdownWithRerank(goal, settings) {
  const analysis = analyzeInput(goal);
  const local = await localBreakdown(goal);
  const baseMeta = { ...(local.meta || {}), source: 'local' };
  if (settings?.aiRerankEnabled === false) {
    return { source: 'fallback', steps: local.steps, meta: baseMeta };
  }

  const refined = await rerankSteps({
    subject: analysis.subject,
    steps: local.steps,
    hints: analysis.hints,
    intent: analysis.intent,
  }, { settings });

  if (refined.source === 'skip' || !Array.isArray(refined.steps) || refined.steps.length < 4) {
    return { source: 'fallback', steps: local.steps, meta: baseMeta };
  }

  return {
    source: 'fallback',
    steps: mergeRerankedSteps(local.steps, refined.steps),
    meta: {
      ...baseMeta,
      source: refined.source === 'chrome-ai' ? 'local+chrome-ai' : 'local+user-api',
      latencyMs: refined.latencyMs,
    },
  };
}

function fallbackRefine(stepItem) {
  return validateAndNormalize({
    steps: [
      step(`打开并观察「${stepItem.title}」`, 1, '先花 10 秒看清这一步真正的入口在哪里。'),
      step(`只做「${stepItem.title}」的第一小截`, 3, '把难度砍半，只推进最前面那一点点。'),
      step(`收尾并确认「${stepItem.title}」`, 3, '检查一下结果，能继续就继续，不行就再拆。'),
    ],
  });
}

export async function localBreakdown(input) {
  const analysis = analyzeInput(input);
  const similar = await retrieveSimilarBreakdown(analysis);
  if (similar) {
    return {
      source: 'local',
      steps: similar.steps,
      meta: {
        intent: similar.intent,
        reusedFromCache: true,
        similarity: Number(similar.similarity.toFixed(3)),
      },
    };
  }
  const built = fallbackBreakdown(input);
  return { source: 'local', steps: built.steps, meta: built.meta };
}

export async function rememberBreakdown(input, steps) {
  const analysis = analyzeInput(input);
  return Storage.rememberRecentBreakdown({
    normalized: analysis.normalized,
    intent: analysis.intent,
    subject: analysis.subject,
    stepsSkeleton: createStepsSkeleton(steps, analysis.subject),
  });
}

export async function breakdownTask(goal, settings) {
  try {
    return await buildBreakdownWithRerank(goal, settings || {});
  } catch (error) {
    const local = await localBreakdown(goal);
    return {
      source: 'fallback',
      warning: error.message || String(error),
      steps: local.steps,
      meta: { ...(local.meta || {}), source: 'local' },
    };
  }
}

export async function refineStep(goal, stepItem, siblings, settings) {
  if (settings?.llm?.enabled && settings?.llm?.apiKey) {
    try {
      const result = await callLLMForRefine(goal, stepItem, siblings, settings);
      return { source: 'llm', ...result };
    } catch (error) {
      const local = fallbackRefine(stepItem);
      return { source: 'fallback', warning: error.message || String(error), ...local };
    }
  }
  return { source: 'fallback', ...fallbackRefine(stepItem) };
}

export const _internal = {
  safeJsonParse,
  validateAndNormalize,
  fallbackBreakdown,
  fallbackRefine,
  normalizeInput,
  classifyIntent,
  createStepsSkeleton,
  fillStepsSkeleton,
  jaccard,
};
