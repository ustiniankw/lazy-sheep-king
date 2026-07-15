// lib/breakdown.js — 任务拆解逻辑（v1: 支持多 Provider + 二次细化 + 耗时/token 统计）
//
// 主要能力：
// - breakdownTask(goal, settings) → { steps, source, meta }
// - refineStep(goal, step, siblings, settings) → { steps, source, meta }（把一步再拆成多步）
//
// 内置 fallback：无 LLM / LLM 失败 时走本地启发式模板。

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

// ---------- 解析辅助 ----------
function safeJsonParse(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  try { return JSON.parse(raw); } catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
    return null;
  }
}

function validateAndNormalize(obj) {
  if (!obj || !Array.isArray(obj.steps) || obj.steps.length === 0) return null;
  const steps = obj.steps
    .map((s, i) => {
      if (typeof s === 'string') return { title: s.slice(0, 24), detail: '', estMinutes: 3 };
      const title = String(s.title || s.name || `步骤 ${i + 1}`).trim().slice(0, 40);
      const detail = String(s.detail || s.desc || s.description || '').trim().slice(0, 120);
      let estMinutes = Number(s.estMinutes || s.minutes || 3);
      if (!Number.isFinite(estMinutes) || estMinutes <= 0) estMinutes = 3;
      if (estMinutes > 30) estMinutes = 30;
      return { title, detail, estMinutes };
    })
    .filter((s) => s.title);
  if (steps.length === 0) return null;
  return { steps };
}

// ---------- LLM 调用（OpenAI 兼容） ----------
async function chatComplete({ baseUrl, apiKey, model, messages, temperature = 0.5 }) {
  if (!apiKey || !baseUrl) throw new Error('LLM 尚未配置');
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const t0 = Date.now();
  const body = {
    model: model || 'gpt-4o-mini',
    temperature,
    messages,
    response_format: { type: 'json_object' },
  };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // 一些 provider 不认 response_format，自动重试一次
    if (String(e).includes('response_format')) {
      delete body.response_format;
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
    } else {
      throw e;
    }
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    // 400 可能是 response_format 不支持，去掉再试一次
    if (res.status === 400 && body.response_format) {
      delete body.response_format;
      const res2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res2.ok) {
        const t2 = await res2.text().catch(() => '');
        throw new Error(`LLM 调用失败 ${res2.status}: ${t2.slice(0, 200)}`);
      }
      const d2 = await res2.json();
      return {
        content: d2?.choices?.[0]?.message?.content || '',
        usage: d2?.usage || null,
        model: d2?.model || model,
        elapsedMs: Date.now() - t0,
      };
    }
    throw new Error(`LLM 调用失败 ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    content: data?.choices?.[0]?.message?.content || '',
    usage: data?.usage || null,
    model: data?.model || model,
    elapsedMs: Date.now() - t0,
  };
}

async function callLLMForBreakdown(goal, settings) {
  const { baseUrl, apiKey, model } = settings.llm || {};
  const { content, usage, model: modelUsed, elapsedMs } = await chatComplete({
    baseUrl, apiKey, model,
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

async function callLLMForRefine(goal, step, siblings, settings) {
  const { baseUrl, apiKey, model } = settings.llm || {};
  const siblingText = siblings.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
  const user = `【总目标】${goal}
【所有步骤列表】
${siblingText}
【目标步骤（需要再拆成 3-5 步）】
${step.title}${step.detail ? '（' + step.detail + '）' : ''}`;
  const { content, usage, model: modelUsed, elapsedMs } = await chatComplete({
    baseUrl, apiKey, model,
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

// ---------- 本地兜底模板 ----------
const TEMPLATES = [
  {
    match: /(写|做|完成).*(周报|日报|月报|汇报|报告|总结)/,
    build: (goal) => [
      { title: '深呼吸 3 次', detail: '把注意力从别的事情上收回来，告诉自己"就写 5 分钟"。', estMinutes: 1 },
      { title: '打开写作工具', detail: '新建一个空白文档，标题写上"${GOAL}"。', estMinutes: 1 },
      { title: '列出 3 个大点', detail: '不管质量，先把想到的 3 个方向随手写下来。', estMinutes: 3 },
      { title: '每个大点各写 1 句', detail: '不用完整，写一句能让你想起细节的话就行。', estMinutes: 5 },
      { title: '把 1 句扩成 3 句', detail: '挑最想写的那点，扩成 3 句话。', estMinutes: 5 },
      { title: '快速通读一遍', detail: '不改，只标记出你觉得别扭的地方。', estMinutes: 3 },
      { title: '优化标记处', detail: '只改标记的地方，改完就算完成。', estMinutes: 5 },
      { title: '发送 / 提交', detail: '深呼吸，点下发送按钮。', estMinutes: 1 },
    ],
  },
  {
    match: /(学习|复习|看).*(书|视频|课程|论文|文档)/,
    build: () => [
      { title: '拿出学习材料', detail: '把书 / 视频链接 / 文档打开放在最显眼的位置。', estMinutes: 1 },
      { title: '设定 25 分钟计时', detail: '打开番茄钟或系统计时器，25 分钟专心。', estMinutes: 1 },
      { title: '快速浏览目录 / 摘要', detail: '不细看，只知道大概讲了啥。', estMinutes: 5 },
      { title: '挑一小节精读', detail: '选一个你最好奇的一节，认真读一遍。', estMinutes: 10 },
      { title: '写 3 句笔记', detail: '合上材料，用自己的话总结 3 句。', estMinutes: 5 },
      { title: '休息 5 分钟', detail: '起身喝水、看窗外，允许自己什么都不想。', estMinutes: 5 },
    ],
  },
  {
    match: /(运动|健身|跑步|锻炼|减肥)/,
    build: () => [
      { title: '换上运动装备', detail: '换鞋换衣服就好，不用想任何后面的事。', estMinutes: 3 },
      { title: '喝一小杯水', detail: '不多不少，就一小杯。', estMinutes: 1 },
      { title: '动态热身 3 分钟', detail: '肩颈、腰、膝盖各转一转。', estMinutes: 3 },
      { title: '走出门 / 到运动区', detail: '不用想强度，先到目的地就赢了一半。', estMinutes: 3 },
      { title: '开始今日主项 15 分钟', detail: '感觉太累随时可以停。', estMinutes: 15 },
      { title: '收尾拉伸 3 分钟', detail: '重点拉伸主要发力的肌肉群。', estMinutes: 3 },
      { title: '记录一句今日感受', detail: '一句话，例如"今天状态 7 分"。', estMinutes: 1 },
    ],
  },
  {
    match: /(打扫|整理|收拾|清洁|房间|桌面)/,
    build: () => [
      { title: '拿一个空袋子', detail: '垃圾袋 / 空箱子都行。', estMinutes: 1 },
      { title: '桌面清空一半', detail: '只把最右半边（或最乱那半）扫干净。', estMinutes: 5 },
      { title: '扔掉明显是垃圾的东西', detail: '不纠结，能扔就扔。', estMinutes: 3 },
      { title: '把同类物品归到一堆', detail: '书归书、线归线、文件归文件。', estMinutes: 5 },
      { title: '各归各位', detail: '按堆放回它们该在的地方。', estMinutes: 5 },
      { title: '擦一下桌面', detail: '湿巾 or 干布，随便。', estMinutes: 2 },
      { title: '拍张干净照存起来', detail: '将来嫌乱时打开自己看看。', estMinutes: 1 },
    ],
  },
];

function fallbackBreakdown(goal) {
  const tpl = TEMPLATES.find((t) => t.match.test(goal));
  const built = tpl ? tpl.build(goal) : null;
  const steps = built || [
    { title: '深呼吸 3 次', detail: '把手机静音，让自己进入"就干 5 分钟"模式。', estMinutes: 1 },
    { title: '写下真正的目标', detail: `一句话写下：${goal}。写下来就赢了一半。`, estMinutes: 2 },
    { title: '列出 3 个子任务', detail: '想到什么写什么，不用漂亮。', estMinutes: 3 },
    { title: '挑最简单的一个先做', detail: '选那个 5 分钟内就能开始的，先开动。', estMinutes: 5 },
    { title: '干完就打个勾', detail: '不要立刻检查手机，先把这一步彻底做完。', estMinutes: 5 },
    { title: '喝一口水 & 站起来动一动', detail: '肩颈转两圈，眼睛看看远处。', estMinutes: 2 },
    { title: '继续做第 2 个子任务', detail: '同样的节奏，一个个来。', estMinutes: 10 },
    { title: '收尾复盘一句话', detail: '写一句今天做完的感受，例如"没想到没那么难"。', estMinutes: 2 },
  ];
  return validateAndNormalize({
    steps: steps.map((s) => ({ ...s, detail: (s.detail || '').replace(/\$\{GOAL\}/g, goal) })),
  });
}

function fallbackRefine(step) {
  // 通用把一步拆三步的兜底
  return validateAndNormalize({
    steps: [
      { title: `把「${step.title}」拆到最小`, detail: '闭上眼想 10 秒：这步真正的第一个动作是什么。', estMinutes: 1 },
      { title: `只做「${step.title}」的一半`, detail: '不必完美，只要能开始，做到一半就算赢。', estMinutes: 4 },
      { title: `收尾「${step.title}」`, detail: '把剩下的一半也做完。', estMinutes: 4 },
    ],
  });
}

// ---------- 对外主入口 ----------
export async function breakdownTask(goal, settings) {
  if (settings?.llm?.enabled && settings?.llm?.apiKey) {
    try {
      const r = await callLLMForBreakdown(goal, settings);
      return { source: 'llm', ...r };
    } catch (e) {
      const fb = fallbackBreakdown(goal);
      return { source: 'fallback', warning: e.message || String(e), ...fb };
    }
  }
  return { source: 'fallback', ...fallbackBreakdown(goal) };
}

export async function refineStep(goal, step, siblings, settings) {
  if (settings?.llm?.enabled && settings?.llm?.apiKey) {
    try {
      const r = await callLLMForRefine(goal, step, siblings, settings);
      return { source: 'llm', ...r };
    } catch (e) {
      const fb = fallbackRefine(step);
      return { source: 'fallback', warning: e.message || String(e), ...fb };
    }
  }
  return { source: 'fallback', ...fallbackRefine(step) };
}

export const _internal = { safeJsonParse, validateAndNormalize, fallbackBreakdown, fallbackRefine };
