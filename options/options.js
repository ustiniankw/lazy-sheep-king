// options.js — v0.3.4: 免费 AI 精修 + 用户 API 降级配置
import { Storage } from '../lib/storage.js';
import { PROVIDERS, findProvider, getWizardProviders } from '../lib/providers.js';
import { detectAvailableTier } from '../lib/ai_rerank.js';
import { chatComplete } from '../lib/llm_client.js';

const $ = (s) => document.querySelector(s);

let currentProviderId = 'openai';

function renderProviders(currentId) {
  const grid = $('#provider-grid');
  grid.innerHTML = '';
  PROVIDERS.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'provider-tile' + (p.id === currentId ? ' active' : '');
    div.dataset.id = p.id;
    div.innerHTML = `
      <div class="provider-name">${p.name}</div>
      <div class="provider-hint">${p.baseUrl || '自己填 URL'}</div>
    `;
    div.addEventListener('click', () => applyProvider(p.id, { userClicked: true }));
    grid.appendChild(div);
  });
}

function applyProvider(id, { userClicked = false } = {}) {
  const p = findProvider(id);
  document.querySelectorAll('.provider-tile').forEach((t) => {
    t.classList.toggle('active', t.dataset.id === id);
  });
  if (userClicked && id !== 'custom') {
    $('#llm-baseUrl').value = p.baseUrl;
    if (!$('#llm-model').value || confirmChangeModel()) {
      $('#llm-model').value = p.defaultModel;
    }
    $('#llm-apiKey').setAttribute('placeholder', p.keyHint || 'sk-...');
  }
  const list = $('#model-list');
  list.innerHTML = '';
  (p.models || []).forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    list.appendChild(opt);
  });
  const hintBase = $('#hint-baseUrl');
  if (p.docsUrl) {
    hintBase.innerHTML = `兼容 OpenAI 协议。<a href="${p.docsUrl}" target="_blank">👉 到 ${p.name} 获取 API Key</a>`;
  } else {
    hintBase.innerHTML = '兼容 OpenAI 协议的任意端点。';
  }
  currentProviderId = id;
}

function confirmChangeModel() {
  return true;
}

async function renderChromeAiStatus() {
  const pill = $('#chrome-ai-status');
  const tier = await detectAvailableTier({ llm: { enabled: false, apiKey: '', baseUrl: '' } });
  const ok = tier === 'chrome-ai';
  pill.textContent = ok ? '可用' : '不可用（Chrome 138+ / flag / Origin Trial）';
  pill.className = 'status-pill ' + (ok ? 'ok' : 'warn');
}

// v0.5.1 · FIX 4：免费 AI 一键接入向导
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderFreeAiWizard() {
  const host = $('#free-ai-wizard');
  if (!host) return;
  host.innerHTML = '';
  getWizardProviders().forEach((p) => {
    const card = document.createElement('div');
    card.className = 'wizard-card';
    const steps = (p.wizardSteps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    card.innerHTML = `
      <div class="wizard-card-head">
        <span class="wizard-card-title">${escapeHtml(p.name)}</span>
        <span class="wizard-free-tag">免费</span>
      </div>
      <div class="wizard-note">${escapeHtml(p.freeNote || '')}</div>
      <ol class="wizard-steps">${steps}</ol>
      <a class="wizard-getkey-link" href="${escapeHtml(p.docsUrl || '#')}" target="_blank" rel="noopener">👉 去拿 ${escapeHtml(p.name)} 的 key</a>
      <div class="wizard-form">
        <input type="password" class="wizard-key-input" placeholder="${escapeHtml(p.keyHint || '把 key 填在这里')}" data-provider="${p.id}" />
        <button class="btn ghost wizard-save-btn" data-provider="${p.id}">保存并测试</button>
      </div>
      <div class="wizard-probe-result" data-provider="${p.id}"></div>
    `;
    host.appendChild(card);
  });
  host.querySelectorAll('.wizard-save-btn').forEach((btn) => {
    btn.addEventListener('click', () => saveAndProbeProvider(btn.dataset.provider));
  });
}

async function saveAndProbeProvider(providerId) {
  const provider = findProvider(providerId);
  const input = document.querySelector(`.wizard-key-input[data-provider="${providerId}"]`);
  const resultEl = document.querySelector(`.wizard-probe-result[data-provider="${providerId}"]`);
  const btn = document.querySelector(`.wizard-save-btn[data-provider="${providerId}"]`);
  const apiKey = (input?.value || '').trim();
  if (!apiKey) {
    resultEl.className = 'wizard-probe-result err';
    resultEl.textContent = '请先粘贴 API key';
    return;
  }
  btn.disabled = true;
  resultEl.className = 'wizard-probe-result';
  resultEl.textContent = '正在保存并发探针请求…';
  const s = await Storage.getSettings().catch(() => ({}));
  const llm = { ...(s.llm || {}), enabled: true, providerId, baseUrl: provider.baseUrl, apiKey, model: provider.defaultModel };
  await Storage.setSettings({ aiRerankEnabled: true, llm });
  try {
    const res = await chatComplete({
      baseUrl: provider.baseUrl,
      apiKey,
      model: provider.defaultModel,
      messages: [{ role: 'user', content: 'hello, respond with the word ready' }],
      temperature: 0,
      timeoutMs: 8000,
    });
    const content = (res?.content || '').trim();
    resultEl.className = 'wizard-probe-result ok';
    resultEl.textContent = `✓ 连接成功（${res.elapsedMs || '?'}ms）：${content.slice(0, 40) || 'ready'}`;
    // 同步表单，方便用户在下方微调
    applyProvider(providerId, { userClicked: true });
    $('#llm-apiKey').value = apiKey;
    $('#llm-enabled').checked = true;
    $('#ai-rerank-enabled').checked = true;
  } catch (error) {
    resultEl.className = 'wizard-probe-result err';
    resultEl.textContent = `✗ 测试失败：${(error?.message || String(error)).slice(0, 180)}`;
  } finally {
    btn.disabled = false;
  }
}

async function load() {
  const s = await Storage.getSettings();
  currentProviderId = s.llm?.providerId || 'openai';
  renderProviders(currentProviderId);
  applyProvider(currentProviderId);
  renderFreeAiWizard();
  await renderChromeAiStatus();

  $('#ai-rerank-enabled').checked = s.aiRerankEnabled !== false;
  $('#llm-enabled').checked = !!s.llm?.enabled;
  $('#llm-baseUrl').value = s.llm?.baseUrl || findProvider(currentProviderId).baseUrl;
  $('#llm-apiKey').value = s.llm?.apiKey || '';
  $('#llm-model').value = s.llm?.model || findProvider(currentProviderId).defaultModel;
  $('#sound-enabled').checked = s.soundEnabled !== false;
  $('#step-granularity').value = s.stepGranularity || 'micro';
  $('#show-usage').checked = s.showUsage !== false;

  const st = s.stepTimer || {};
  $('#stimer-auto').checked = !!st.autoStart;
  $('#stimer-sound').checked = st.endSound !== false;
  $('#stimer-add-on-end').checked = !!st.autoAddOnEnd;
}

async function save() {
  const settings = {
    aiRerankEnabled: $('#ai-rerank-enabled').checked,
    llm: {
      enabled: $('#llm-enabled').checked,
      providerId: currentProviderId,
      baseUrl: $('#llm-baseUrl').value.trim() || 'https://api.openai.com/v1',
      apiKey: $('#llm-apiKey').value.trim(),
      model: $('#llm-model').value.trim() || 'gpt-4o-mini',
    },
    soundEnabled: $('#sound-enabled').checked,
    stepGranularity: $('#step-granularity').value,
    showUsage: $('#show-usage').checked,
    stepTimer: {
      autoStart: $('#stimer-auto').checked,
      endSound: $('#stimer-sound').checked,
      autoAddOnEnd: $('#stimer-add-on-end').checked,
    },
  };
  await Storage.setSettings(settings);
  const tip = $('#save-tip');
  tip.textContent = '已保存 ✅';
  setTimeout(() => (tip.textContent = ''), 1600);
}

async function testLLM() {
  const btn = $('#btn-test');
  const result = $('#test-result');
  result.className = 'test-result';
  result.textContent = '正在测试…';
  const baseUrl = ($('#llm-baseUrl').value.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = $('#llm-apiKey').value.trim();
  const model = $('#llm-model').value.trim() || 'gpt-4o-mini';
  if (!apiKey) {
    result.className = 'test-result err';
    result.textContent = '请先填入 API Key';
    return;
  }
  btn.disabled = true;
  const t0 = Date.now();
  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是一个测试机器人，请只回答"OK"。' },
          { role: 'user', content: 'ping' },
        ],
        max_tokens: 8,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`${res.status} ${t.slice(0, 120)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '(空响应)';
    const dt = Date.now() - t0;
    const u = data?.usage;
    const usageStr = u ? ` · in ${u.prompt_tokens} / out ${u.completion_tokens} tok` : '';
    result.className = 'test-result ok';
    result.textContent = `✅ 连接成功 (${dt}ms${usageStr})：${content.slice(0, 30)}`;
  } catch (e) {
    result.className = 'test-result err';
    result.textContent = '连接失败：' + (e.message || e);
  } finally {
    btn.disabled = false;
  }
}

$('#btn-save').addEventListener('click', save);
$('#btn-test').addEventListener('click', testLLM);

$('#btn-clear-current').addEventListener('click', async () => {
  await Storage.clearCurrentTask();
  alert('已清空当前任务。');
});
$('#btn-clear-history').addEventListener('click', async () => {
  await Storage.setHistory([]);
  alert('已清空历史记录。');
});
$('#btn-clear-all').addEventListener('click', async () => {
  await Storage.resetAllLocalData();
  alert('已重置所有数据。');
  await load();
});

load();
