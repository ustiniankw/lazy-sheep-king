// lib/llm_client.js — v0.3.4: 共享 OpenAI-compatible ChatCompletion 调用器
export async function chatComplete({ baseUrl, apiKey, model, messages, temperature = 0.5, timeoutMs = 0 }) {
  if (!apiKey || !baseUrl) throw new Error('LLM 尚未配置');
  if (typeof fetch !== 'function') throw new Error('当前环境不支持 fetch');

  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const t0 = Date.now();
  const body = {
    model: model || 'gpt-4o-mini',
    temperature,
    messages,
    response_format: { type: 'json_object' },
  };

  async function request(payload) {
    const controller = timeoutMs > 0 && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: controller?.signal,
      });
    } catch (error) {
      if (controller?.signal?.aborted) {
        throw new Error(`LLM 调用超时（>${timeoutMs}ms）`);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await request(body);
  } catch (error) {
    if (String(error).includes('response_format')) {
      delete body.response_format;
      res = await request(body);
    } else {
      throw error;
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 400 && body.response_format) {
      delete body.response_format;
      const res2 = await request(body);
      if (!res2.ok) {
        const text2 = await res2.text().catch(() => '');
        throw new Error(`LLM 调用失败 ${res2.status}: ${text2.slice(0, 200)}`);
      }
      const data2 = await res2.json();
      return {
        content: data2?.choices?.[0]?.message?.content || '',
        usage: data2?.usage || null,
        model: data2?.model || model,
        elapsedMs: Date.now() - t0,
      };
    }
    throw new Error(`LLM 调用失败 ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    content: data?.choices?.[0]?.message?.content || '',
    usage: data?.usage || null,
    model: data?.model || model,
    elapsedMs: Date.now() - t0,
  };
}

export default { chatComplete };
