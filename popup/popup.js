// popup.js — v1: 拆解预览 & 二次编辑 · 分步执行 · 完成
import { Storage } from '../lib/storage.js';
import { breakdownTask, refineStep } from '../lib/breakdown.js';
import { celebrateStep, celebrateAll } from '../lib/celebrate.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function showView(name) {
  $$('.view').forEach((el) => el.classList.toggle('hidden', el.dataset.view !== name));
}

const urlParams = new URLSearchParams(location.search);
if (urlParams.get('full') === '1') document.body.classList.add('full');

$('#btn-open-full').addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome.tabs) chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?full=1') });
  else window.open(location.pathname + '?full=1', '_blank');
});
function openOptions() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open('../options/options.html', '_blank');
}
$('#btn-options').addEventListener('click', openOptions);

// ---- LLM hint ----
async function refreshLLMHint() {
  const settings = await Storage.getSettings();
  const enabled = settings?.llm?.enabled && settings?.llm?.apiKey;
  const hint = $('#llm-hint'); const text = $('#llm-hint-text');
  if (enabled) {
    hint.classList.add('ok');
    text.innerHTML = `已启用 LLM 拆解 · <b>${escapeHtml(settings.llm.providerId || 'custom')}</b> / <b>${escapeHtml(settings.llm.model || '')}</b> · <a href="#" class="link-options">修改</a>`;
  } else {
    hint.classList.remove('ok');
    text.innerHTML = `当前使用「本地兜底模板」拆解。<a href="#" class="link-options">配置 LLM 更聪明</a>`;
  }
  text.querySelector('.link-options')?.addEventListener('click', (e) => { e.preventDefault(); openOptions(); });
}

// ---- input ----
$$('.chip').forEach((c) => c.addEventListener('click', () => { $('#task-input').value = c.dataset.example; $('#task-input').focus(); }));

$('#btn-breakdown').addEventListener('click', async () => {
  const goal = $('#task-input').value.trim();
  if (!goal) {
    $('#task-input').focus();
    $('#task-input').style.borderColor = '#b0562c';
    setTimeout(() => ($('#task-input').style.borderColor = ''), 800);
    return;
  }
  await doBreakdown(goal);
});

async function doBreakdown(goal) {
  const btn = $('#btn-breakdown');
  const prev = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="btn-emoji">🍃</span>懒羊羊正在拆解中…';
  try {
    const settings = await Storage.getSettings();
    const result = await breakdownTask(goal, settings);
    const task = {
      id: 'task_' + Date.now(), goal,
      steps: result.steps.map((s) => ({ ...s, done: false, skipped: false })),
      currentIndex: 0, createdAt: Date.now(),
      source: result.source, meta: result.meta || null, warning: result.warning || null,
    };
    await Storage.setCurrentTask(task);
    enterPlanView(task);
  } catch (e) {
    alert('拆解失败：' + (e.message || e));
  } finally {
    btn.disabled = false; btn.innerHTML = prev;
  }
}

// ---- resume ----
async function refreshResumeCard() {
  const cur = await Storage.getCurrentTask();
  const card = $('#resume-card');
  if (!cur || !Array.isArray(cur.steps) || cur.currentIndex >= cur.steps.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('#resume-goal').textContent = cur.goal;
  $('#resume-done').textContent = cur.steps.filter((s) => s.done).length;
  $('#resume-total').textContent = cur.steps.length;
}
$('#btn-resume').addEventListener('click', async () => { const cur = await Storage.getCurrentTask(); if (cur) enterStepsView(cur); });
$('#btn-discard').addEventListener('click', async () => {
  if (!confirm('确定丢弃当前任务？（懒羊羊会有点小失望…）')) return;
  await Storage.clearCurrentTask(); refreshResumeCard();
});

// ---- v1 · plan view (二次编辑) ----
let currentTask = null;

async function enterPlanView(task) {
  currentTask = task;
  showView('plan');
  $('#plan-goal').textContent = task.goal;
  renderPlanMeta(task);
  renderPlanList();
}

function renderPlanMeta(task) {
  const box = $('#plan-meta'); box.innerHTML = '';
  const settings = getSettingsCached();
  const showUsage = settings?.showUsage !== false;
  const src = task.source === 'llm' ? '🧠 LLM 拆解' : '🍃 本地兜底';
  const parts = [`<span class="meta-tag">${src}</span>`];
  if (task.warning) parts.push(`<span class="meta-warn" title="${escapeHtml(task.warning)}">⚠ LLM 失败，已 fallback</span>`);
  if (showUsage && task.meta) {
    if (task.meta.elapsedMs) parts.push(`<span class="meta-tag">${task.meta.elapsedMs} ms</span>`);
    if (task.meta.model) parts.push(`<span class="meta-tag">${escapeHtml(task.meta.model)}</span>`);
    if (task.meta.usage) {
      const u = task.meta.usage;
      parts.push(`<span class="meta-tag">↓${u.prompt_tokens || '?'} / ↑${u.completion_tokens || '?'} tok</span>`);
    }
  }
  box.innerHTML = parts.join(' ');
}

function renderPlanList() {
  const list = $('#plan-list'); list.innerHTML = '';
  currentTask.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.dataset.idx = String(i);
    li.innerHTML = `
      <div class="plan-item-body">
        <input class="plan-title" data-field="title" value="${escapeHtml(s.title)}" />
        <input class="plan-detail" data-field="detail" placeholder="详细说明（可选）" value="${escapeHtml(s.detail || '')}" />
        <div class="plan-item-foot">
          <label class="plan-est">
            ~
            <input class="plan-est-input" data-field="estMinutes" type="number" min="1" max="60" value="${s.estMinutes || 3}" /> 分钟
          </label>
          <div class="plan-item-actions">
            <button class="plan-btn" data-act="up" title="上移">↑</button>
            <button class="plan-btn" data-act="down" title="下移">↓</button>
            <button class="plan-btn danger" data-act="del" title="删除">✕</button>
          </div>
        </div>
      </div>
    `;
    list.appendChild(li);
  });

  // bind edits
  list.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', () => {
      const li = inp.closest('.plan-item');
      const idx = Number(li.dataset.idx);
      const field = inp.dataset.field;
      const val = field === 'estMinutes' ? Math.max(1, Number(inp.value) || 3) : inp.value;
      currentTask.steps[idx][field] = val;
      Storage.setCurrentTask(currentTask);
    });
  });
  list.querySelectorAll('.plan-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.closest('.plan-item');
      const idx = Number(li.dataset.idx);
      const act = btn.dataset.act;
      if (act === 'del') {
        if (currentTask.steps.length <= 1) return alert('至少要留一个步骤呀 🐑');
        currentTask.steps.splice(idx, 1);
      } else if (act === 'up' && idx > 0) {
        const [s] = currentTask.steps.splice(idx, 1);
        currentTask.steps.splice(idx - 1, 0, s);
      } else if (act === 'down' && idx < currentTask.steps.length - 1) {
        const [s] = currentTask.steps.splice(idx, 1);
        currentTask.steps.splice(idx + 1, 0, s);
      }
      Storage.setCurrentTask(currentTask);
      renderPlanList();
    });
  });
}

$('#btn-add-step').addEventListener('click', () => {
  currentTask.steps.push({ title: '新步骤', detail: '', estMinutes: 3, done: false, skipped: false });
  Storage.setCurrentTask(currentTask);
  renderPlanList();
});

$('#btn-rebreakdown').addEventListener('click', async () => {
  if (!currentTask) return;
  if (!confirm('重新拆一遍？当前的编辑会被覆盖。')) return;
  await doBreakdown(currentTask.goal);
});

$('#btn-back-input').addEventListener('click', () => {
  showView('input'); refreshResumeCard();
});

$('#btn-start').addEventListener('click', () => {
  if (!currentTask) return;
  currentTask.currentIndex = 0;
  Storage.setCurrentTask(currentTask);
  enterStepsView(currentTask);
});

// ---- steps view ----
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
  $('#progress-fill').style.width = `${Math.round((doneCount / total) * 100)}%`;

  $('#step-title').textContent = step.title;
  $('#step-detail').textContent = step.detail || '就这么点事儿，交给你啦！';
  $('#step-est').textContent = `~ ${step.estMinutes || 3} 分钟`;

  const MASCOT = ['"简单到不能再简单啦，来嘛来嘛～"','"完成这一小步，就能马上再偷懒一下下！"','"就当帮懒羊羊一个忙好吗～"','"这一步，闭着眼睛都能做完！"','"3、2、1，开动啦！"'];
  $('#mascot-say').textContent = MASCOT[idx % MASCOT.length];

  const list = $('#steps-list'); list.innerHTML = '';
  t.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = s.title + (s.skipped ? '（已跳过）' : '');
    if (i === idx) li.classList.add('current');
    if (s.done || s.skipped) li.classList.add('done');
    list.appendChild(li);
  });

  const card = $('#step-card');
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
}

$('#btn-done').addEventListener('click', async () => {
  if (!currentTask) return;
  const t = currentTask;
  t.steps[t.currentIndex].done = true;
  await Storage.setCurrentTask(t);
  await Storage.addStepCompleted(1);
  celebrateStep({ sound: (await Storage.getSettings()).soundEnabled !== false });
  setTimeout(async () => {
    t.currentIndex += 1;
    if (t.currentIndex >= t.steps.length) {
      await Storage.setCurrentTask(t);
      await Storage.pushHistory({ id: t.id, goal: t.goal, stepsCount: t.steps.length, completedAt: Date.now() });
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
    await Storage.pushHistory({ id: t.id, goal: t.goal, stepsCount: t.steps.length, completedAt: Date.now(), partial: true });
    await Storage.clearCurrentTask();
    enterDoneView({ partial: true });
    return;
  }
  await Storage.setCurrentTask(t);
  renderSteps();
});

// v1 refine
$('#btn-refine').addEventListener('click', async () => {
  if (!currentTask) return;
  const t = currentTask;
  const idx = t.currentIndex;
  const step = t.steps[idx];
  const btn = $('#btn-refine');
  const prev = btn.innerHTML; btn.disabled = true; btn.textContent = '🍃 拆解中…';
  try {
    const settings = await Storage.getSettings();
    const res = await refineStep(t.goal, step, t.steps, settings);
    const subs = res.steps.map((s) => ({ ...s, done: false, skipped: false, _refined: true }));
    // 用子步骤替换当前步骤
    t.steps.splice(idx, 1, ...subs);
    await Storage.setCurrentTask(t);
    renderSteps();
    // small toast
    const src = res.source === 'llm' ? 'LLM' : '本地';
    flash(`✨ 已把这一步再拆成 ${subs.length} 小步（${src}）`);
  } catch (e) {
    alert('细化失败：' + (e.message || e));
  } finally {
    btn.disabled = false; btn.innerHTML = prev;
  }
});

$('#btn-quit').addEventListener('click', async () => {
  if (!confirm('确定放弃当前任务吗？下次再打开时任务就不见啦。')) return;
  await Storage.clearCurrentTask();
  currentTask = null;
  showView('input'); refreshResumeCard();
});

// ---- done view ----
async function enterDoneView(opts = {}) {
  showView('done');
  const stats = await Storage.getStats();
  $('#stat-steps').textContent = String(stats.totalStepsCompleted);
  $('#stat-tasks').textContent = String(stats.totalTasksCompleted);
  $('#stat-food').textContent = String(stats.foodStock);
  $('#pet-food-2').textContent = String(stats.foodStock);
  $('#pet-lv').textContent = String(stats.petLevel);
  if (opts.partial) $('#done-sub').textContent = '有几步跳过了没关系，能开始就是胜利～';
  celebrateAll({ sound: (await Storage.getSettings()).soundEnabled !== false });
}

$('#btn-new-task').addEventListener('click', () => { $('#task-input').value = ''; showView('input'); refreshResumeCard(); });

// ---- helpers ----
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

let settingsCache = null;
function getSettingsCached() { return settingsCache; }
async function primeSettingsCache() { settingsCache = await Storage.getSettings(); }

function flash(msg) {
  const t = document.createElement('div');
  t.className = 'lsk-toast lsk-toast-show';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.remove('lsk-toast-show'); setTimeout(() => t.remove(), 300); }, 1800);
}

(async function boot() {
  await primeSettingsCache();
  await refreshLLMHint();
  await refreshResumeCard();
  showView('input');
  const cur = await Storage.getCurrentTask();
  if (cur && cur.currentIndex < cur.steps.length && urlParams.get('full') === '1') enterStepsView(cur);
})();

// ================= v2 · Option 1 · 宠物系统骨架 =================
import { Pets, PET_TYPES, MOOD_META, computeMood } from '../lib/pets.js';

async function enterPetView() {
  showView('pet');
  await renderPet();
}

async function renderPet() {
  const st = await Pets.getState();
  const stats = await Storage.getStats();
  const type = Pets.petTypeById(st.activeId);

  // avatar
  const avatar = $('#pet-avatar');
  const mood = computeMood(st, stats);
  const meta = MOOD_META[mood] || MOOD_META.normal;
  // 心情动画：清空旧的 mood-* class 再赋新的
  avatar.className = 'pet-avatar mood-' + meta.anim;
  const cartoonFilter = (st.cartoonize !== false)
    ? 'contrast(1.15) saturate(1.35) brightness(1.02)'
    : 'none';
  if (st.activeId === 'custom' && st.customImageDataUrl) {
    avatar.innerHTML = `<img src="${st.customImageDataUrl}" alt="custom pet" style="filter:${cartoonFilter}" />`;
    $('#pet-name').textContent = st.customName || '我的宠物';
    $('#pet-desc').textContent = (st.cartoonize !== false)
      ? '你上传的专属形象（已自动卡通化 ✨）'
      : '你上传的专属形象～ 一起加油！';
  } else if (st.activeId === 'sheep') {
    avatar.innerHTML = `<img src="../icons/icon-256.png" alt="sheep" />`;
    $('#pet-name').textContent = type.name;
    $('#pet-desc').textContent = type.desc;
  } else {
    avatar.innerHTML = type.emoji;
    $('#pet-name').textContent = type.name;
    $('#pet-desc').textContent = type.desc;
  }
  $('#pet-mood').textContent = `${meta.emoji} ${meta.say}`;

  $('#pet-stat-lv').textContent = String(stats.petLevel);
  $('#pet-stat-food').textContent = String(stats.foodStock);
  $('#pet-stat-fed').textContent = String(st.timesFed || 0);

  // picker
  const picker = $('#pet-picker');
  picker.innerHTML = '';
  PET_TYPES.forEach((p) => {
    const unlocked = st.unlocked.includes(p.id) || p.id === 'sheep';
    const slot = document.createElement('div');
    slot.className = 'pet-slot' + (st.activeId === p.id ? ' active' : '') + (!unlocked ? ' locked' : '');
    let emojiCell = p.emoji;
    if (p.id === 'sheep') emojiCell = `<img src="../icons/icon-48.png" alt="sheep">`;
    if (p.id === 'custom' && st.customImageDataUrl) emojiCell = `<img src="${st.customImageDataUrl}" alt="custom">`;
    slot.innerHTML = `
      <div class="pet-slot-emoji">${emojiCell}</div>
      <div class="pet-slot-name">${p.name}</div>
      ${unlocked ? '' : '<div class="pet-slot-lock">🔒 待解锁</div>'}
    `;
    // click 切换 / 长按自定义 → 上传
    let pressT = 0;
    slot.addEventListener('mousedown', () => { pressT = Date.now(); });
    slot.addEventListener('mouseup', async () => {
      const dt = Date.now() - pressT;
      if (p.id === 'custom' && dt > 500) {
        $('#pet-upload').click();
      } else {
        await Pets.setActive(p.id);
        renderPet();
      }
    });
    // 移动端 tap
    slot.addEventListener('click', async (e) => {
      // 兼容单击（非长按情况）
      if (Date.now() - pressT < 500) {
        if (p.id === 'custom' && !st.customImageDataUrl) {
          $('#pet-upload').click();
          return;
        }
        await Pets.setActive(p.id);
        renderPet();
      }
    });
    picker.appendChild(slot);
  });
}

$('#btn-pet')?.addEventListener('click', enterPetView);
$('#btn-goto-pet')?.addEventListener('click', enterPetView);
$('#btn-pet-back')?.addEventListener('click', () => showView('input'));

$('#btn-feed')?.addEventListener('click', async () => {
  const r = await Pets.feed(1);
  if (!r.ok) { flash(r.reason); return; }
  flash('喂了一口！🍼 宠物好开心');
  renderPet();
});

$('#pet-upload')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    const name = prompt('给你的宠物起个名字？', '我的宠物') || '我的宠物';
    await Pets.setCustomImage(dataUrl, name);
    flash('自定义形象已绑定 🎉');
    renderPet();
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});
