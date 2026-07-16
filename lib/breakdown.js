// lib/breakdown.js — v0.3.3: LLM + 本地兜底升级（标准化 / 分类 / 模板 / 相似任务复用）
import { Storage } from './storage.js';
import { chatComplete } from './llm_client.js';
import { rerankSteps, detectAvailableTier } from './ai_rerank.js';

// FIX 1（v0.5.1）：AI 精修硬超时（毫秒）。到点即静默回退本地结果，绝不阻塞 CTA。
const AI_RERANK_TIMEOUT_MS = 6000;

// 诊断日志（debug tier）：仅记录非敏感字段，绝不写入任何 apiKey / token。
async function logDebug(entry) {
  try {
    if (entry && (entry.source === 'timeout' || entry.ok === false)) {
      // eslint-disable-next-line no-console
      console.debug?.('[懒羊羊大王][breakdown]', JSON.stringify({ ...entry, input: undefined }));
    }
    await Storage.pushDebugLog(entry);
  } catch {
    /* 日志失败绝不影响主流程 */
  }
}

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
  { intent: 'study.read_paper', keywords: ['论文', 'paper', 'arxiv', '文献', '读论文', '看论文', '综述', 'literature', 'survey', '精读', '文章综述'] },
  { intent: 'study.exam', keywords: ['备考', '复习', '期末', '考研', '公务员', '刷题', '考试', '模拟卷', '真题', '错题', '知识点', '背题', 'exam'] },
  { intent: 'study.language', keywords: ['背单词', '英语', '雅思', '托福', '口语', '单词', '听力', 'ielts', 'toefl', '语法', '发音', '语言', '外语', '日语', '英文'] },
  { intent: 'code.debug', keywords: ['排查', 'bug', '报错', 'debug', 'fix', '错误', '故障', '异常', '崩溃', 'crash', '定位问题', '踩坑', '修复', '报警', 'stacktrace'] },
  { intent: 'code.feature', keywords: ['开发功能', '实现', '接入', '迁移', '重构', '新功能', '需求开发', '写代码', '编码', '写接口', 'api', 'feature', '联调', '开发'] },
  { intent: 'code.review', keywords: ['代码评审', 'review', 'mr', 'pr', 'merge request', 'code review', '看 diff', 'cr', '评审代码', '过一下代码', 'review 代码'] },
  { intent: 'code.setup', keywords: ['搭建', '初始化', '脚手架', '环境配置', '配置环境', 'setup', '安装依赖', '装环境', '配环境', 'init', '跑起来', '本地环境', 'docker'] },
  { intent: 'write.report', keywords: ['周报', '日报', '月报', '年报', '汇报', '总结', '报告', '工作总结', '汇总', '述职报告', 'report', '写总结', '复盘报告'] },
  { intent: 'write.doc', keywords: ['文档', '技术文档', '需求文档', '设计文档', 'prd', '说明文', '说明书', '接口文档', 'readme', 'wiki', '写文档', '方案文档'] },
  { intent: 'write.ppt', keywords: ['ppt', '幻灯片', '演讲稿', 'deck', '汇报材料', '路演', 'keynote', 'slides', '做胶片', '讲稿'] },
  { intent: 'write.email', keywords: ['邮件', 'email', 'mail', '回复邮件', '收邮件', '写邮件', '发邮件', '回邮件', 'e-mail'] },
  { intent: 'write.article', keywords: ['文章', '博客', '公众号', '知乎', '推文', '专栏', 'blog', '推送', '软文', '笔记', '小红书', '写作'] },
  { intent: 'meeting.prepare', keywords: ['准备会议', '开会', '会议', '评审会', 'agenda', '会前', 'sync', '例会', '碰个头', '拉会', '开个会', '议程', 'meeting'] },
  { intent: 'meeting.followup', keywords: ['会议纪要', '复盘', '回顾', 'follow up', '会后', 'action items', '跟进会议', '纪要', 'todo 跟进', 'recap', '会议总结'] },
  { intent: 'life.workout', keywords: ['跑步', '慢跑', '运动', '健身', '锻炼', '减肥', '瑜伽', '训练', '减重', '公斤', '斤', '撸铁', '游泳', '骑行', '徒步', 'workout', '拉伸', '跳绳'] },
  { intent: 'life.clean', keywords: ['打扫', '收拾', '整理房间', '家务', '清洁', '整理桌面', '桌面', '扫地', '拖地', '断舍离', '收纳', '洗衣服', '归置'] },
  { intent: 'life.shopping', keywords: ['购物', '买菜', '采购', '下单', '购买', '囤货', '剁手', '备货', '买东西', '逛超市', 'shopping', '置办'] },
  { intent: 'life.cook', keywords: ['做饭', '做菜', '烹饪', '菜谱', '炒菜', '红烧', '下厨', '煮', '食谱', '烘焙', '炖', '煲汤', '备餐'] },
  { intent: 'life.travel', keywords: ['出行', '旅游', '攻略', '订票', '行程', '酒店', '机票', '旅行', '出游', '自驾', '露营', '签证', '路线', '打卡景点'] },
  { intent: 'life.finance', keywords: ['记账', '理财', '预算', '报销', '发票', '财务', '存钱', '基金', '账单', '算账', '开源节流', '省钱', '收支'] },
  { intent: 'career.interview', keywords: ['面试', '求职', '找工作', '投简历', '笔试', '面经', '面试准备', '八股文', '模拟面试', 'offer', '一面', '二面'] },
  { intent: 'career.resume', keywords: ['简历', '修改简历', '求职简历', 'cv', '履历', '更新简历', '润色简历', 'resume', '写简历'] },
  { intent: 'career.promotion', keywords: ['晋升', '答辩', '绩效', '述职', '升职', '评级', 'kpi', 'performance', '晋升材料', '定级'] },
  { intent: 'career.job_search.followup', keywords: ['跟进', 'followup', 'follow up', '面试跟进', 'hr 跟进', '感谢信', '追问结果', '催offer', '问进度', '跟进 hr', '面完跟进'] },
  { intent: 'social.reply', keywords: ['回消息', '聊天', '客户沟通', '客户', '回复消息', '回微信', '回私信', '回复留言', '处理消息', '回信息', '回复邮件消息'] },
  { intent: 'life.relationship', keywords: ['联系老同学', '老同学', '老朋友', '聚会', '约饭', '维系关系', '相亲', '交友', '破冰', '叙旧', '约见面', '联络感情', '联系朋友'] },
  { intent: 'life.parenting', keywords: ['陪孩子', '陪女儿', '陪儿子', '写作业', '辅导作业', '家长会', '育儿', '带娃', '亲子', '陪读', '孩子作业', '接送孩子', '哄睡'] },
  { intent: 'life.gift', keywords: ['送礼', '礼物', '挑礼物', '生日礼物', 'gift', '伴手礼', '送礼物', '准备礼物', '节日礼物', '回礼', '选礼物'] },
  { intent: 'life.medical', keywords: ['体检', '报体检', '挂号', '看病', '就诊', '预约医生', '复诊', '备孕体检', '疫苗', '打针', '买药', '牙医', '就医', '看医生'] },
  { intent: 'life.legal', keywords: ['换驾照', '驾照', '办证', '签证', '公证', '合同', '法律', '维权', '律师', '办理证件', '身份证', '营业执照', '报警处理'] },
  { intent: 'life.housing', keywords: ['装修', '租房', '找租客', '退租', '房东', '看房', '搬家', '房价', '中介', '物业', '客厅', '收房', '装修客厅', '出租'] },
  { intent: 'life.finance.tax', keywords: ['报税', '个税', '汇算清缴', '税务申报', '纳税', '退税', 'tax', '专项附加扣除', '个人所得税', '税务', '申报个税'] },
  { intent: 'life.hobby.instrument', keywords: ['学吉他', '吉他', '钢琴', '尤克里里', '乐器', '弹唱', '练琴', '小提琴', '架子鼓', '贝斯', '电子琴', '和弦'] },
  { intent: 'life.hobby.craft', keywords: ['手工', '整理相册', '相册', '打理花园', '园艺', '种花', '编织', '画画', '手账', 'diy', '摄影', '插花', '拼图', '折纸'] },
  { intent: 'mind.plan', keywords: ['计划', '规划', '年度总结', 'okr', '路线图', '目标拆解', '排期', 'roadmap', 'todo 清单', '安排一下', '做规划'] },
  { intent: 'mind.decide', keywords: ['选择', '决定', '纠结', '选哪个', '要不要', '对比', '拿主意', '做选择', '两难', '犹豫', '取舍', '选 a 还是 b'] },
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

// ---------------------------------------------------------------------------
// FIX 2 · 本地兜底真正普适化：default.generic 模板池
// 即使没有命中任何意图，也能根据 subject 动词挑选"最贴合"的通用骨架，
// 而不是永远回退到同一套模板。每套骨架都会依据 hints（时间 / 数量）自适应。
// ---------------------------------------------------------------------------
const GENERIC_TEMPLATE_KEYS = ['deepwork', 'lightweight', 'creative', 'research', 'social'];

function focusMinutes(hints) {
  const m = Number(hints?.minutes);
  if (Number.isFinite(m) && m > 0) return Math.min(60, Math.max(5, Math.round(m)));
  return 20;
}

function nextStepCount(hints) {
  const c = Number(hints?.count);
  if (Number.isFinite(c) && c >= 1 && c <= 9) return Math.round(c);
  return 3;
}

function buildGenericSteps(subject, hints = {}, key = 'lightweight') {
  const goal = String(subject || '这件事').trim() || '这件事';
  const mins = focusMinutes(hints);
  const n = nextStepCount(hints);
  const builders = {
    // 轻量：任务描述里就是"顺手能做完"的小事（默认骨架，对应需求给的脚手架）
    lightweight: () => [
      step('明确目标', 3, `用一句话写下"完成「${goal}」后要拿到什么"。`),
      step('拆一下第一小步', 3, '想想现在马上能做的第一个 5 分钟动作。'),
      step('清掉一个小障碍', 3, '把最容易让你分心或卡住的那个东西先挪开。'),
      step(`集中做 ${mins} 分钟`, mins, '关掉打断，把上一步的第一个动作做完。'),
      step('回顾进度', 4, `看看还差什么，列 ${n} 条下一步。`),
      step('收尾整理', 3, '保存成果、记录感受、给自己鼓励。'),
    ],
    // 深度工作：需要长时间专注推进（学习 / 训练 / 开发 / 攻克）
    deepwork: () => [
      step('写下真正目标', 3, `一句话写清「${goal}」要达到什么程度就算过关。`),
      step('准备好环境', 3, '把要用到的工具 / 资料 / 场地先摆好，减少启动摩擦。'),
      step('挑最小的第一步', 4, '找一个 5 分钟就能上手的入口，先动起来。'),
      step(`专注做 ${mins} 分钟`, mins, '设一个计时器，其它全部先放一边。'),
      step('记录卡点', 4, `写下 ${n} 个还没搞定的点，下一轮继续攻。`),
      step('给自己收个尾', 3, '存好进度、标记下次入口，夸自己一句。'),
    ],
    // 创作：偏发散、需要先有素材再成型（写作 / 设计 / 手工 / 布置）
    creative: () => [
      step('写下想要的感觉', 3, `一句话描述「${goal}」做完后想给人什么感觉。`),
      step('随手收集灵感', 5, '找 2-3 个参考 / 例子，先抄够灵感不怕丑。'),
      step('列一个粗骨架', 5, `把「${goal}」拆成 ${n} 个大块，先摆位置。`),
      step(`动手做 ${mins} 分钟`, mins, '先做最有感觉的一块，允许粗糙。'),
      step('退一步看整体', 4, '离远一点看，标出最想改的一处。'),
      step('收尾并留档', 3, '保存版本，记一句下次想怎么优化。'),
    ],
    // 研究/信息：先搞清楚、再决定（了解 / 调研 / 申报 / 对比 / 查流程）
    research: () => [
      step('写下要弄懂的问题', 3, `把「${goal}」变成 ${n} 个具体要回答的问题。`),
      step('找一个可靠来源', 5, '先找官方说明 / 靠谱教程，别一上来到处乱翻。'),
      step(`集中查 ${mins} 分钟`, mins, '边查边把关键信息抄进一个小清单。'),
      step('整理成人话', 5, '用自己的话把结论写成 3-5 句。'),
      step('列出下一步动作', 4, `根据结论写 ${n} 个能马上做的动作。`),
      step('存好备查', 2, '把链接和结论存起来，方便回头再看。'),
    ],
    // 社交/联络：需要主动联系人（联系 / 约 / 沟通 / 采访 / 送礼）
    social: () => [
      step('想清楚目的', 3, `一句话写下联系这次要达成什么（「${goal}」）。`),
      step('列出要联系的人', 4, `把相关的 ${n} 个人 / 对象先列出来。`),
      step('拟一句开场白', 5, '写一句自然、不尴尬的开头，降低开口阻力。'),
      step(`主动发出第一条`, mins, '先联系最容易的那一个，把球踢出去。'),
      step('记下回应与约定', 4, '把对方的回复和下一步约定记清楚。'),
      step('安排跟进提醒', 3, '给自己留一个跟进时间，别让它烂尾。'),
    ],
  };
  const build = builders[key] || builders.lightweight;
  return build();
}

function pickGenericTemplateKey(subject) {
  const s = String(subject || '');
  const hit = (arr) => arr.some((w) => s.includes(w));
  if (hit(['联系', '聊', '约', '沟通', '拜访', '采访', '请教', '找人', '谈', '对接', '邀请', '打电话', '发消息', '送礼'])) return 'social';
  if (hit(['画', '设计', '创作', '拍', '剪', '手工', '布置', '装修', '编', '谱', '唱', '做菜', '烘焙', '排版', '手账'])) return 'creative';
  if (hit(['学', '研究', '查', '了解', '调研', '对比', '申报', '报税', '弄懂', '搞懂', '搜', '读', '看懂', '备考', '复习', '攻略', '流程', '怎么'])) return 'research';
  if (hit(['开发', '攻克', '搞定', '训练', '练', '背', '减', '跑', '建', '修', '刷', '写代码', '完成', '推进', '整'])) return 'deepwork';
  return 'lightweight';
}

function buildTemplates(intent, hints, subject) {
  const goal = quoted(subject);
  const km = hints.kilometers || 0;
  const pages = hints.pages || 0;
  const minutes = hints.minutes || 0;
  switch (intent) {
    case 'life.finance.tax':
      return [
        step('列清要申报的项目', 4, `先写下 ${goal} 涉及的收入 / 扣除 / 附加项。`),
        step('收齐凭证材料', 6, '工资单、专项附加扣除凭证、发票先放一起。'),
        step('打开申报入口', 3, '打开个人所得税 App 或官网，登录进去。'),
        step('照着填一遍', 12, '一项一项对着材料填，拿不准的先标记。'),
        step('核对金额再提交', 6, '重点核对应补 / 应退税额，确认无误再交。'),
        step('保存回执备查', 3, '把申报回执截图存好，以后好查。'),
      ];
    case 'life.parenting':
      return [
        step('放下手机坐下来', 2, `先把手机收起，专心陪 ${goal} 这段时间。`),
        step('问问今天怎么样', 4, '用轻松的话开场，别一上来就查作业。'),
        step('一起定小目标', 4, '和孩子商量今天先搞定哪一件小事。'),
        step('陪做 20 分钟', 20, '在旁边安静陪伴，卡住了才轻轻提示。'),
        step('及时具体地夸', 3, '夸努力和过程，而不是只夸结果。'),
        step('约定明天的一点点', 3, '一起说好明天先从哪开始，留个盼头。'),
      ];
    case 'life.gift':
      return [
        step('确认对象和场合', 3, `先写清 ${goal} 是送谁、什么场合、预算多少。`),
        step('回忆对方的喜好', 4, '想想对方最近提过、缺过、喜欢什么。'),
        step('列 3 个候选', 6, '先粗选 3 个方向，别纠结到完美。'),
        step('比价并下单', 10, '看看到货时间来不来得及，尽早下单。'),
        step('准备一句祝福', 4, '写一句走心的话，比礼物本身更打动人。'),
        step('安排送达方式', 3, '当面送还是快递？确认好时间地点。'),
      ];
    case 'life.medical':
      return [
        step('明确要看什么', 3, `先写下 ${goal} 是常规检查还是有具体不舒服。`),
        step('选好医院或机构', 5, '看看离得近、能约上的，别拖。'),
        step('线上挂号 / 预约', 6, '打开挂号平台，选好科室和时间。'),
        step('准备好证件材料', 4, '身份证、医保卡、以往报告先放包里。'),
        step('列出想问的问题', 4, '把症状和疑问写下来，见医生时不慌。'),
        step('设好出发提醒', 2, '算好路程，提前设个闹钟别迟到。'),
      ];
    case 'life.legal':
      return [
        step('查清办理条件', 5, `先搞清 ${goal} 需要什么资格和前置条件。`),
        step('列材料清单', 6, '照官方要求把所需材料逐条列出来。'),
        step('预约办理时间', 5, '线上预约窗口或选好可办理的时段。'),
        step('把材料备齐', 8, '一项一项准备，复印件、照片先弄好。'),
        step('走完办理流程', 10, '按窗口指引一步步办，拿不准就问工作人员。'),
        step('留好回执和凭证', 3, '保存受理单，记下取件时间。'),
      ];
    case 'life.housing':
      return [
        step('写清需求和预算', 4, `先明确 ${goal} 想要的位置、面积和价格区间。`),
        step('收集房源或方案', 8, '在平台上先存 3-5 个候选，别急着定。'),
        step('列对比清单', 6, '把价格、位置、优缺点排成一张表。'),
        step('实地或线上看一轮', 12, '重点看采光、周边、真实状况。'),
        step('谈条件与细节', 8, '价格、合同、时间点逐条谈清楚。'),
        step('确认下一步动作', 3, '定下签约 / 付款 / 搬家的时间安排。'),
      ];
    case 'life.relationship':
      return [
        step('想清楚为什么联系', 3, `一句话写下这次联系 ${goal} 的初衷。`),
        step('挑一个合适的人', 3, '先从最想聊、最不尴尬的那位开始。'),
        step('拟一句自然开场', 5, '别铺垫太多，一句真诚的问候就够。'),
        step('主动发出消息', 5, '先把消息发出去，把主动权握在手里。'),
        step('聊一件具体的事', 8, '找一个共同话题，避免尬聊。'),
        step('约下一次见面', 3, '聊得好就顺势约个饭或视频，别让关系断线。'),
      ];
    case 'life.hobby.instrument':
      return [
        step('把乐器拿出来', 2, `先把 ${goal} 需要的乐器和谱子放到手边。`),
        step('热身基础练习', 5, '先活动手指 / 练音阶，找回手感。'),
        step('挑一小段来练', 4, '只挑 4-8 小节，别想一次弹完整首。'),
        step('慢速反复练 20 分钟', 20, '放慢速度练熟，再一点点提速。'),
        step('完整走一遍', 5, '连起来弹一次，录下来听听问题在哪。'),
        step('标记明天的重点', 3, '写下今天卡住的地方，下次先攻它。'),
      ];
    case 'life.hobby.craft':
      return [
        step('定今天做到哪', 3, `先给 ${goal} 定一个今天能完成的小目标。`),
        step('准备好材料工具', 5, '把要用的东西一次性摆好，减少中断。'),
        step('先做最容易的一块', 6, '从最简单的部分入手，先获得成就感。'),
        step(`专注做 ${minutes || 25} 分钟`, minutes || 25, '沉浸进去，享受过程别赶进度。'),
        step('拍照记录一下', 3, '拍张照留个纪念，也方便回看进度。'),
        step('收拾并规划下一步', 3, '收好材料，想想下次接着做什么。'),
      ];
    case 'career.job_search.followup':
      return [
        step('确认要跟进谁', 3, `先写清 ${goal} 要跟进的公司 / HR / 面试官。`),
        step('回顾上次进展', 4, '翻一下上次聊到哪、对方说了什么。'),
        step('拟一条得体的话', 6, '简短、礼貌、有重点，别显得催命。'),
        step('发出跟进消息', 4, '在合适的时间点发出去，附上感谢。'),
        step('记下对方回复', 3, '把回应和承诺的时间点记清楚。'),
        step('设定下次提醒', 2, '若没回应，定一个再跟进的时间。'),
      ];
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
      return buildGenericSteps(subject, hints, pickGenericTemplateKey(subject));
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

// FIX 1（v0.5.1）：绝对安全的通用兜底——同步、纯函数、永不抛错、永远 ≥ 4 步。
function safeGenericPlan(subject, hints = {}) {
  // 先把 subject 强制转成一个绝对安全的字符串（防御 toString 抛错等极端输入）。
  let safeSubject = '这件事';
  try {
    const s = String(subject ?? '').trim();
    if (s) safeSubject = s.slice(0, 80);
  } catch {
    safeSubject = '这件事';
  }
  let safeHints = {};
  try { safeHints = hints && typeof hints === 'object' ? hints : {}; } catch { safeHints = {}; }

  let steps;
  try {
    const key = pickGenericTemplateKey(safeSubject);
    const normalized = validateAndNormalize({ steps: buildGenericSteps(safeSubject, safeHints, key) });
    steps = normalized?.steps;
  } catch {
    steps = null;
  }
  if (!Array.isArray(steps) || steps.length < 4) {
    // 最后的最后：写死一套万能 5 步，保证任何情况下都不会空 / 卡住。
    steps = [
      step('明确目标', 3, `用一句话写下"完成「${safeSubject}」后要拿到什么"。`),
      step('拆一下第一小步', 3, '想想现在马上能做的第一个 5 分钟动作。'),
      step('集中做 20 分钟', 20, '关掉打断，把上一步的第一个动作做完。'),
      step('回顾进度', 4, '看看还差什么，列 3 条下一步。'),
      step('收尾整理', 3, '保存成果、记录感受、给自己鼓励。'),
    ];
  }
  return { steps, meta: { intent: 'default.generic', mergedIntents: ['default.generic'], safeFallback: true } };
}

function createPlanFromAnalysis(analysis) {
  try {
    const intents = selectIntentBundle(analysis.intents);
    const built = dedupeSteps(intents.flatMap((intent) => buildTemplates(intent, analysis.hints, analysis.subject))).slice(0, 8);
    const candidate = built.length >= 4 ? built : buildGenericSteps(analysis.subject, analysis.hints, pickGenericTemplateKey(analysis.subject));
    const normalized = validateAndNormalize({ steps: candidate });
    if (!normalized || normalized.steps.length < 4) return safeGenericPlan(analysis.subject, analysis.hints);
    return {
      steps: normalized.steps,
      meta: {
        intent: analysis.intent,
        mergedIntents: intents,
        matchedKeywords: analysis.matchedKeywords,
      },
    };
  } catch {
    return safeGenericPlan(analysis?.subject, analysis?.hints);
  }
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
  try {
    return createPlanFromAnalysis(analyzeInput(goal));
  } catch {
    return safeGenericPlan(goal);
  }
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

// FIX 1（v0.5.1）：给任意 Promise 套一个硬超时。到点即 resolve 一个哨兵值，绝不 reject。
function withTimeout(promise, ms, onTimeoutValue) {
  return Promise.race([
    Promise.resolve(promise).catch((error) => ({ source: 'error', steps: null, error })),
    new Promise((resolve) => { setTimeout(() => resolve(onTimeoutValue), ms); }),
  ]);
}

async function buildBreakdownWithRerank(goal, settings) {
  const startedAt = Date.now();
  const analysis = analyzeInput(goal);
  const local = await localBreakdown(goal);
  const baseMeta = { ...(local.meta || {}), source: 'local' };

  let tier = 'none';
  try { tier = await detectAvailableTier(settings || {}); } catch { tier = 'none'; }

  if (settings?.aiRerankEnabled === false) {
    await logDebug({ input: goal, intent: analysis.intent, source: 'local', latency: Date.now() - startedAt, tier: 'off', ok: true, error: null });
    return { source: 'fallback', steps: local.steps, meta: baseMeta };
  }

  // AI 精修：硬 6s 超时 + Promise.race。超时 / 出错 / 非法 → 静默回退本地结果。
  const refined = await withTimeout(
    rerankSteps({
      subject: analysis.subject,
      steps: local.steps,
      hints: analysis.hints,
      intent: analysis.intent,
    }, { settings }),
    AI_RERANK_TIMEOUT_MS,
    { source: 'timeout', steps: null },
  );

  if (!refined || refined.source === 'timeout' || refined.source === 'error'
      || refined.source === 'skip' || !Array.isArray(refined.steps) || refined.steps.length < 4) {
    await logDebug({
      input: goal,
      intent: analysis.intent,
      source: 'local',
      latency: Date.now() - startedAt,
      tier,
      ok: true,
      error: refined?.source === 'timeout' ? `AI rerank timeout > ${AI_RERANK_TIMEOUT_MS}ms` : (refined?.error ? String(refined.error.message || refined.error) : null),
    });
    return {
      source: 'fallback',
      steps: local.steps,
      meta: { ...baseMeta, aiTimedOut: refined?.source === 'timeout' || undefined },
    };
  }

  const mergedSource = refined.source === 'chrome-ai' ? 'local+chrome-ai' : 'local+user-api';
  await logDebug({ input: goal, intent: analysis.intent, source: mergedSource, latency: Date.now() - startedAt, tier, ok: true, error: null });
  return {
    source: 'fallback',
    steps: mergeRerankedSteps(local.steps, refined.steps),
    meta: {
      ...baseMeta,
      source: mergedSource,
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
  // FIX 1：本地管线永不抛错、永远返回 ≥ 4 步。相似复用失败也静默降级到模板。
  let analysis;
  try {
    analysis = analyzeInput(input);
  } catch {
    return { source: 'local', ...safeGenericPlan(input) };
  }
  try {
    const similar = await retrieveSimilarBreakdown(analysis);
    if (similar && Array.isArray(similar.steps) && similar.steps.length >= 4) {
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
  } catch {
    /* 相似复用失败：忽略，走模板兜底 */
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
    // 兜底管线本身出错：仍返回安全通用模板，绝不把异常抛给 UI。
    let steps;
    let meta;
    try {
      const local = await localBreakdown(goal);
      steps = local.steps;
      meta = { ...(local.meta || {}), source: 'local' };
    } catch {
      const safe = safeGenericPlan(goal);
      steps = safe.steps;
      meta = { ...safe.meta, source: 'local' };
    }
    await logDebug({ input: goal, intent: meta?.intent || 'default.generic', source: 'local', latency: 0, tier: 'none', ok: false, error: error?.message || String(error) });
    return {
      source: 'fallback',
      warning: error?.message || String(error),
      steps,
      meta,
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
  buildGenericSteps,
  pickGenericTemplateKey,
  safeGenericPlan,
  buildTemplates,
  GENERIC_TEMPLATE_KEYS,
};
