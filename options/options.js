// options.js
import { Storage } from '../lib/storage.js';

const $ = (s) => document.querySelector(s);

async function load() {
  const s = await Storage.getSettings();
  $('#llm-enabled').checked = !!s.llm?.enabled;
  $('#llm-baseUrl').value = s.llm?.baseUrl || '';
  $('#llm-apiKey').value = s.llm?.apiKey || '';
  $('#llm-model').value = s.llm?.model || '';
  $('#sound-enabled').checked = s.soundEnabled !== false;
  $('#step-granularity').value = s.stepGranularity || 'micro';
}

async function save() {
  const settings = {
    llm: {
      enabled: $('#llm-enabled').checked,
      baseUrl: $('#llm-baseUrl').value.trim() || 'https://api.openai.com/v1',
      apiKey: $('#llm-apiKey').value.trim(),
      model: $('#llm-model').value.trim() || 'gpt-4o-mini',
    },
    soundEnabled: $('#sound-enabled').checked,
    stepGranularity: $('#step-granularity').value,
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
  try {
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
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
    result.className = 'test-result ok';
    result.textContent = `连接成功 ✅ 模型回复：${content.slice(0, 30)}`;
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
  if (!confirm('清空当前任务？')) return;
  await Storage.clearCurrentTask();
  alert('已清空当前任务。');
});
$('#btn-clear-history').addEventListener('click', async () => {
  if (!confirm('清空历史记录？')) return;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.remove('lsk_history_v1');
  } else {
    localStorage.removeItem('lsk_history_v1');
  }
  alert('已清空历史记录。');
});
$('#btn-clear-all').addEventListener('click', async () => {
  if (!confirm('确定重置所有数据？（设置、当前任务、历史、统计都会清空！）')) return;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.clear();
  } else {
    ['lsk_settings_v1','lsk_current_task_v1','lsk_history_v1','lsk_stats_v1'].forEach(k => localStorage.removeItem(k));
  }
  alert('已重置所有数据。');
  await load();
});

load();
