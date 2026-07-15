// lib/ai_rerank.js — v0.3.4: 免费 AI 精修（Chrome Prompt API / 用户自配 API / 跳过）
import { chatComplete } from './llm_client.js';

const SYSTEM_PROMPT = `You are refining a task breakdown for productivity app "懒羊羊大王".
Rules:
- Return 4-8 steps.
- Each step: title (≤ 20 汉字, action-first verb), estMinutes (integer 1-60), tips (≤ 25 汉字, encouraging).
- Keep the original intent, but make titles more specific to the subject.
- Return STRICT JSON: {"steps":[{"title":"","estMinutes":1,"tips":""}]}`;

function safeJsonParse(text) {
  if (!text) return null;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : String(text);
  try {
    return JSON.parse(raw);
  } catch {
    const matched = raw.match(/\{[\s\S]*\}/);
    if (!matched) return null;
    try {
      return JSON.parse(matched[0]);
    } catch {
      return null;
    }
  }
}

function normalizeSteps(payload) {
  if (!payload || !Array.isArray(payload.steps)) return null;
  const steps = payload.steps.map((item, index) => {
    const title = String(item?.title || `步骤 ${index + 1}`).trim().slice(0, 20);
    const tips = String(item?.tips || item?.detail || '').trim().slice(0, 25);
    let estMinutes = Number(item?.estMinutes || item?.minutes || 3);
    if (!Number.isFinite(estMinutes) || estMinutes <= 0) estMinutes = 3;
    if (estMinutes > 60) estMinutes = 60;
    return { title, tips, estMinutes, detail: tips };
  }).filter((item) => item.title);
  if (steps.length < 4 || steps.length > 8) return null;
  return steps;
}

function buildPrompt({ subject, steps, hints, intent }) {
  return [
    `Task subject: ${subject || '这件事'}`,
    `Intent: ${intent || 'default.generic'}`,
    `Hints: ${JSON.stringify(hints || {}, null, 0)}`,
    `Draft steps: ${JSON.stringify(steps || [], null, 0)}`,
  ].join('\n');
}

function hasChromeLanguageModel() {
  return !!globalThis.LanguageModel?.create || !!globalThis.chrome?.aiOriginTrial?.languageModel?.create;
}

async function createChromeSession() {
  const direct = globalThis.LanguageModel;
  if (direct?.create) {
    try {
      return await direct.create({ systemPrompt: SYSTEM_PROMPT });
    } catch {
      return direct.create();
    }
  }
  const originTrialModel = globalThis.chrome?.aiOriginTrial?.languageModel;
  if (originTrialModel?.create) {
    try {
      return await originTrialModel.create({ systemPrompt: SYSTEM_PROMPT });
    } catch {
      return originTrialModel.create();
    }
  }
  return null;
}

async function runChromeAi(input) {
  const session = await createChromeSession();
  if (!session?.prompt) throw new Error('Chrome AI session 不可用');
  const userPrompt = buildPrompt(input);
  let content;
  try {
    content = await session.prompt(userPrompt);
  } finally {
    await session.destroy?.().catch?.(() => {});
  }
  return {
    steps: normalizeSteps(safeJsonParse(content)),
    raw: content,
  };
}

async function runUserApi(input, settings, options = {}) {
  if (typeof options.userApiCaller === 'function') {
    const content = await options.userApiCaller({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildPrompt(input),
      settings,
    });
    return {
      steps: normalizeSteps(safeJsonParse(content)),
      raw: content,
    };
  }

  const { content } = await chatComplete({
    baseUrl: settings?.llm?.baseUrl,
    apiKey: settings?.llm?.apiKey,
    model: settings?.llm?.model,
    temperature: 0.2,
    timeoutMs: 8000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(input) },
    ],
  });

  return {
    steps: normalizeSteps(safeJsonParse(content)),
    raw: content,
  };
}

export async function detectAvailableTier(settings = {}) {
  if (hasChromeLanguageModel()) return 'chrome-ai';
  if (settings?.llm?.enabled && settings?.llm?.apiKey && settings?.llm?.baseUrl) return 'user-api';
  return 'none';
}

export async function rerankSteps({ subject, steps, hints, intent }, options = {}) {
  const original = Array.isArray(steps) ? steps.map((item) => ({ ...item })) : [];
  const startedAt = Date.now();
  const settings = options?.settings || options || {};
  const canUseUserApi = settings?.llm?.enabled && settings?.llm?.apiKey && settings?.llm?.baseUrl;

  try {
    const tier = await detectAvailableTier(settings);
    if (tier === 'chrome-ai') {
      try {
        const result = await runChromeAi({ subject, steps: original, hints, intent });
        if (!result.steps) throw new Error('Chrome AI 返回 JSON 非法');
        return { steps: result.steps, source: 'chrome-ai', latencyMs: Date.now() - startedAt };
      } catch (error) {
        console.warn('[懒羊羊大王] Chrome AI rerank skipped:', error?.message || error);
        if (!canUseUserApi) throw error;
      }
    }
    if (tier === 'user-api' || canUseUserApi) {
      const result = await runUserApi({ subject, steps: original, hints, intent }, settings, options);
      if (!result.steps) throw new Error('用户 API 返回 JSON 非法');
      return { steps: result.steps, source: 'user-api', latencyMs: Date.now() - startedAt };
    }
  } catch (error) {
    console.warn('[懒羊羊大王] AI rerank skipped:', error?.message || error);
  }
  return { steps: original, source: 'skip', latencyMs: Date.now() - startedAt };
}

export const _internal = {
  safeJsonParse,
  normalizeSteps,
  buildPrompt,
  hasChromeLanguageModel,
};

export default {
  detectAvailableTier,
  rerankSteps,
};
