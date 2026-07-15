// popup.js — 主逻辑：输入 → 拆解 → 一步一步 → 完成
import { Storage } from '../lib/storage.js';
import { breakdownTask } from '../lib/breakdown.js';
import { celebrateStep, celebrateAll } from '../lib/celebrate.js';

// ------------------------- Router -------------------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function showView(name) {
  $$('.view').forEach((el) => el.classList.toggle('hidden', el.dataset.view !== name));
}

// 支持 ?full=1 打开大屏模式
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('full') === '1') {
  document.body.classList.add('full');
}

// 打开大屏模式（可以离开 popup 弹层，避免误关）
$('#btn-open-full').addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?full=1') });
  } else {
    window.open(location.pathname + '?full=1', '_blank');
  }
});

// 打开设置
$('#btn-options').addEventListener('click', () => openOptions());
$('#link-open-options').addEventListener('click', (e) => {
  e.preventDefault();
  openOptions();
});
function openOptions() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open('../options/options.html', '_blank');
  }
}

// ------------------------- LLM 状态提示 -------------------------
async function refreshLLMHint() {
  const settings = await Storage.getSettings();
  const enabled = settings?.llm?.enabled && settings?.llm?.apiKey;
  const hint = $('#llm-hint');
  const text = $('#llm-hint-text');
  if (enabled) {
    hint.classList.add('ok');
    text.innerHTML = `已启用 LLM 拆解（模型：<b>${escapeHtml(settings.llm.model || '')}</b>）· <a href="#" id="link-open-options">修改</a>`;
    text.querySelector('#link-open-options').addEventListener('click', (e) => { e.preventDefault(); openOptions(); });
  } else {
    hint.classList.remove('ok');
    text.innerHTML = `当前使用「本地兜底模板」拆解。<a href="#" id="link-open-options">配置 LLM 更聪明</a>`;
    text.querySelector('#link-open-options').addEventListener('click', (e) => { e.preventDefault(); openOptions(); });
  }
}

// ------------------------- 输入区 -------------------------
$$('.chip').forEach((c) => {
  c.addEventListener('click', () => {
    $('#task-input').value = c.dataset.example;
    $('#task-input').focus();
  });
});

$('#btn-breakdown').addEventListener('click', async () => {
  const goal = $('#task-input').value.trim();
  if (!goal) {
    $('#task-input').focus();
    $('#task-input').style.borderColor = '#ef476f';
    setTimeout(() => ($('#task-input').style.borderColor = ''), 800);
    return;
  }

  const btn = $('#btn-breakdown');
  const prevLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-emoji">🍃</span>懒羊羊正在拆解中…';

  try {
    const settings = await Storage.getSettings();
    const result = await breakdownTask(goal, settings);
    const task = {
      id: 'task_' + Date.now(),
      goal,
      steps: result.steps.map((s) => ({ ...s, done: false, skipped: false })),
      currentIndex: 0,
      createdAt: Date.now(),
      source: result.source,
    };
    await Storage.setCurrentTask(task);
    if (result.warning) {
      // 静默提示 LLM 失败并已 fallback
      console.warn('breakdown fallback:', result.warning);
    }
    enterStepsView(task);
  } catch (e) {
    alert('拆解失败：' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.innerHTML = prevLabel;
  }
});

// ------------------------- Resume Card -------------------------
async function refreshResumeCard() {
  const cur = await Storage.getCurrentTask();
  const card = $('#resume-card');
  if (!cur || !Array.isArray(cur.steps) || cur.currentIndex >= cur.steps.length) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  $('#resume-goal').textContent = cur.goal;
  const done = cur.steps.filter((s) => s.done).length;
  $('#resume-done').textContent = done;
  $('#resume-total').textContent = cur.steps.length;
}
$('#btn-resume').addEventListener('click', async () => {
  const cur = await Storage.getCurrentTask();
  if (cur) enterStepsView(cur);
});
$('#btn-discard').addEventListener('click', async () => {
  if (!confirm('确定丢弃当前任务？（懒羊羊会有点小失望…）')) return;
  await Storage.clearCurrentTask();
  refreshResumeCard();
});

// ------------------------- Steps View -------------------------
let currentTask = null;

async function enterStepsView(task) {
  currentTask = task;
  showView('steps');
  $('#goal-text').textContent = task.goal;
  renderSteps();
}

async function renderSteps() {
  if (!currentTask) return;
  const t = currentTask;
  const total = t.steps.length;
  const idx = Math.min(t.currentIndex, total - 1);
  const step = t.steps[idx];

  $('#step-index').textContent = String(idx + 1);
  $('#step-total').textContent = String(total);
  const doneCount = t.steps.filter((s) => s.done).length;
  const stats = await Storage.getStats();
  $('#lifetime-steps').textContent = String(stats.totalStepsCompleted);

  const pct = Math.round((doneCount / total) * 100);
  $('#progress-fill').style.width = `${pct}%`;

  $('#step-title').textContent = step.title;
  $('#step-detail').textContent = step.detail || '就这么点事儿，交给你啦！';
  $('#step-est').textContent = `~ ${step.estMinutes || 3} 分钟`;

  const MASCOT_LINES = [
    '"简单到不能再简单啦，来嘛来嘛～"',
    '"完成这一小步，就能马上再偷懒一下下！"',
    '"就当帮懒羊羊一个忙好吗～"',
    '"这一步，闭着眼睛都能做完！"',
    '"3、2、1，开动啦！"',
  ];
  $('#mascot-say').textContent = MASCOT_LINES[idx % MASCOT_LINES.length];

  const list = $('#steps-list');
  list.innerHTML = '';
  t.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = s.title + (s.skipped ? '（已跳过）' : '');
    if (i === idx) li.classList.add('current');
    if (s.done || s.skipped) li.classList.add('done');
    list.appendChild(li);
  });

  // step 卡片播放弹入动画
  const card = $('#step-card');
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
}

$('#btn-done').addEventListener('click', async () => {
  if (!currentTask) return;
  const t = currentTask;
  const step = t.steps[t.currentIndex];
  step.done = true;

  await Storage.setCurrentTask(t);
  await Storage.addStepCompleted(1);

  celebrateStep({ sound: (await Storage.getSettings()).soundEnabled !== false });

  // 稍等动画后再进入下一步
  setTimeout(async () => {
    t.currentIndex += 1;
    if (t.currentIndex >= t.steps.length) {
      await Storage.setCurrentTask(t);
      await Storage.pushHistory({
        id: t.id,
        goal: t.goal,
        stepsCount: t.steps.length,
        completedAt: Date.now(),
      });
      await Storage.addTaskCompleted();
      await Storage.clearCurrentTask();
      enterDoneView();
    } else {
      await Storage.setCurrentTask(t);
      renderSteps();
    }
  }, 650);
});

$('#btn-skip').addEventListener('click', async () => {
  if (!currentTask) return;
  const t = currentTask;
  t.steps[t.currentIndex].skipped = true;
  t.currentIndex += 1;
  if (t.currentIndex >= t.steps.length) {
    await Storage.setCurrentTask(t);
    await Storage.pushHistory({
      id: t.id,
      goal: t.goal,
      stepsCount: t.steps.length,
      completedAt: Date.now(),
      partial: true,
    });
    await Storage.clearCurrentTask();
    enterDoneView({ partial: true });
    return;
  }
  await Storage.setCurrentTask(t);
  renderSteps();
});

$('#btn-quit').addEventListener('click', async () => {
  if (!confirm('确定放弃当前任务吗？下次再打开时任务就不见啦。')) return;
  await Storage.clearCurrentTask();
  currentTask = null;
  showView('input');
  refreshResumeCard();
});

// ------------------------- Done View -------------------------
async function enterDoneView(opts = {}) {
  showView('done');
  const stats = await Storage.getStats();
  $('#stat-steps').textContent = String(stats.totalStepsCompleted);
  $('#stat-tasks').textContent = String(stats.totalTasksCompleted);
  $('#stat-food').textContent = String(stats.foodStock);
  $('#pet-food-2').textContent = String(stats.foodStock);
  $('#pet-lv').textContent = String(stats.petLevel);
  if (opts.partial) {
    $('#done-sub').textContent = '有几步跳过了没关系，能开始就是胜利～';
  }
  celebrateAll({ sound: (await Storage.getSettings()).soundEnabled !== false });
}

$('#btn-new-task').addEventListener('click', () => {
  $('#task-input').value = '';
  showView('input');
  refreshResumeCard();
});

// ------------------------- Helpers -------------------------
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ------------------------- Boot -------------------------
(async function boot() {
  await refreshLLMHint();
  await refreshResumeCard();
  showView('input');

  // 如果有正在进行的任务，直接进入 steps 视图
  const cur = await Storage.getCurrentTask();
  if (cur && cur.currentIndex < cur.steps.length) {
    // 但仅当用户之前打开过大屏模式（避免频繁 popup 抢焦点）
    if (urlParams.get('full') === '1') {
      enterStepsView(cur);
    }
  }
})();
