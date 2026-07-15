// lib/breakdown.js — 任务拆解逻辑
// - 优先调用用户配置的 LLM（OpenAI 兼容协议）
// - 未配置或调用失败时，走本地启发式兜底
//
// 输出统一格式：{ steps: [{ title, detail, estMinutes }] }

const SYSTEM_PROMPT = `你是"懒羊羊大王"——一位温柔又幽默的执行力教练。
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

function safeJsonParse(text) {
  if (!text) return null;
  // 兼容模型可能返回 ```json ... ``` 代码块
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  try {
    return JSON.parse(raw);
  } catch (_) {
    // 尝试宽松匹配第一个大括号块
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* ignore */ }
    }
    return null;
  }
}

function validateAndNormalize(obj) {
  if (!obj || !Array.isArray(obj.steps) || obj.steps.length === 0) return null;
  const steps = obj.steps
    .map((s, i) => {
      if (typeof s === 'string') {
        return { title: s.slice(0, 24), detail: '', estMinutes: 3 };
      }
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

// ------------------------- LLM 调用 -------------------------
async function callLLM(goal, settings) {
  const { baseUrl, apiKey, model } = settings.llm || {};
  if (!apiKey || !baseUrl) throw new Error('LLM 尚未配置');
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';

  const body = {
    model: model || 'gpt-4o-mini',
    temperature: 0.5,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `请把下面这件事拆成傻瓜级步骤：\n---\n${goal}\n---` },
    ],
    response_format: { type: 'json_object' },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM 调用失败 ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const parsed = safeJsonParse(text);
  const normalized = validateAndNormalize(parsed);
  if (!normalized) throw new Error('LLM 返回内容无法解析成步骤');
  return normalized;
}

// ------------------------- 本地启发式兜底 -------------------------
// 思路：根据一些常见任务模板 + 通用"启动/收尾"模板，拼出一份可用的傻瓜步骤。
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
  // 替换 ${GOAL} 占位
  return validateAndNormalize({
    steps: steps.map((s) => ({
      ...s,
      detail: (s.detail || '').replace(/\$\{GOAL\}/g, goal),
    })),
  });
}

// ------------------------- 对外主入口 -------------------------
export async function breakdownTask(goal, settings) {
  if (settings?.llm?.enabled && settings?.llm?.apiKey) {
    try {
      const r = await callLLM(goal, settings);
      return { source: 'llm', ...r };
    } catch (e) {
      // LLM 失败时兜底，同时把错误抛回让 UI 提示
      const fb = fallbackBreakdown(goal);
      return { source: 'fallback', warning: e.message || String(e), ...fb };
    }
  }
  return { source: 'fallback', ...fallbackBreakdown(goal) };
}

export const _internal = { safeJsonParse, validateAndNormalize, fallbackBreakdown };
