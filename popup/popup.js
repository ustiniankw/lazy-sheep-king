// popup.js — v0.3.3: 删除修复 / 宠物反馈 / 用户资料 / 同步基础
import { Storage } from '../lib/storage.js';
import { breakdownTask, refineStep, rememberBreakdown } from '../lib/breakdown.js';
import { celebrateStep, celebrateAll } from '../lib/celebrate.js';
import { createCountdown, fmt as fmtTimer, calcStepReward, calcTaskCompletionBonus } from '../lib/step_timer.js';
import { Pets, PET_TYPES, MOOD_META, computeMood, affinityProgress, todayFeedTotal } from '../lib/pets.js';
import { buildHeatmap, summarize } from '../lib/calendar.js';
import { ensureProfile, setDisplayName, regenerateUserId } from '../lib/user.js';
import * as Auth from '../lib/auth.js';
import { MODE } from '../lib/auth.js';
import { PRIVACY, cyclePrivacy, newTeamCode, buildMyMemberSnapshot, mergeTeamState, makePoke } from '../lib/team.js';
import { detectAvailableTier } from '../lib/ai_rerank.js';

const APP_VERSION = '0.4.0';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const urlParams = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// v0.4.0 · iOS 原生风：视图 ↔ Tab 映射 + 大标题动态切换
// ---------------------------------------------------------------------------
const VIEW_META = {
  home:     { title: '懒羊羊大王', tab: 'home' },
  input:    { title: '新任务',     tab: 'task' },
  plan:     { title: '拆解结果',   tab: 'task' },
  steps:    { title: '专注一步',   tab: 'task' },
  done:     { title: '任务完成',   tab: 'task' },
  pet:      { title: '宠物之家',   tab: 'pet'  },
  calendar: { title: '打卡记录',   tab: 'calendar' },
  team:     { title: '组队模式',   tab: 'my'   },
  my:       { title: '我的',       tab: 'my'   },
};

function updateTopbarTitle(view) {
  const el = $('#topbar-title');
  if (!el) return;
  el.textContent = VIEW_META[view]?.title || '懒羊羊大王';
}
function setActiveTab(tabName) {
  $$('.ios-tabbar-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
}
const MASCOT_LINES = ['简单到不能再简单啦，来嘛来嘛～', '完成这一小步，就能马上再偷懒一下下！', '就当帮懒羊羊一个忙好吗～', '这一步，闭着眼睛都能做完！', '3、2、1，开动啦！'];
const PET_MILESTONES = [10, 50, 100, 500];
const PRIVACY_LABELS = {
  [PRIVACY.PUBLIC]: '🔓 公开',
  [PRIVACY.TITLE_HIDDEN]: '🙈 仅隐藏标题',
  [PRIVACY.FULL_PRIVATE]: '🫥 完全隐私',
};
const TEAM_SYNC_INTERVAL_MS = 60_000;

if (urlParams.get('full') === '1') document.body.classList.add('full');

let currentTask = null;
let settingsCache = null;
let calDays = 30;
let currentView = 'input';
let armedDanger = null;
let teamSyncTimerId = null;
let teamLastAttemptAt = 0;
let teamSyncFailed = false;
let lastUnreadToastKey = '';

function showView(name) {
  currentView = name;
  resetDangerArming();
  $$('.view').forEach((el) => el.classList.toggle('hidden', el.dataset.view !== name));
  updateTopbarTitle(name);
  const tab = VIEW_META[name]?.tab;
  if (tab) setActiveTab(tab);
  // iOS 风格：切换视图时把主内容滚到顶部
  const main = document.querySelector('.ios-main');
  if (main) main.scrollTop = 0;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function sameId(a, b) {
  return String(a ?? '') === String(b ?? '');
}

function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatTimeOnly(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function privacyLabel(privacy) {
  return PRIVACY_LABELS[privacy] || PRIVACY_LABELS[PRIVACY.PUBLIC];
}

function updatePrivacyChip(task = currentTask) {
  const button = $('#btn-privacy-cycle');
  if (!button) return;
  const privacy = task?.privacy || settingsCache?.team?.defaultPrivacy || PRIVACY.PUBLIC;
  button.dataset.privacy = privacy;
  button.textContent = privacyLabel(privacy);
}

function getUnreadPokesForState(teamState, selfUserId) {
  return (teamState?.pokes || []).filter((item) => item?.to === selfUserId && item?.read !== true);
}

function maybeRelativeTime(ts) {
  if (!ts) return '刚刚';
  const delta = Date.now() - Number(ts || 0);
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} 小时前`;
  return formatDateTime(ts);
}

function shortUserId(userId = '') {
  if (!userId) return 'usr_******';
  return userId.length <= 12 ? userId : `${userId.slice(0, 8)}…${userId.slice(-4)}`;
}

function isSyncSupported() {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.sync;
}

function getSettingsCached() {
  return settingsCache;
}

async function primeSettingsCache() {
  settingsCache = await Storage.getSettings();
}

function flash(message, options = {}) {
  const toast = document.createElement('div');
  toast.className = 'lsk-toast lsk-toast-show' + (options.big ? ' lsk-toast-big' : '');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('lsk-toast-show');
    setTimeout(() => toast.remove(), 300);
  }, options.duration || 1900);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const input = document.createElement('textarea');
      input.value = text;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      input.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function armDangerButton(button, text) {
  resetDangerArming();
  armedDanger = {
    button,
    originalHtml: button.innerHTML,
    timeoutId: window.setTimeout(resetDangerArming, 3000),
  };
  button.dataset.armed = '1';
  button.classList.add('armed');
  button.innerHTML = escapeHtml(text || button.dataset.confirmText || '再点一次确认');
}

function resetDangerArming() {
  if (!armedDanger) return;
  clearTimeout(armedDanger.timeoutId);
  armedDanger.button.dataset.armed = '0';
  armedDanger.button.classList.remove('armed');
  armedDanger.button.innerHTML = armedDanger.originalHtml;
  armedDanger = null;
}

function requiresSecondClick(button) {
  if (!button) return false;
  if (armedDanger?.button === button && button.dataset.armed === '1') return true;
  armDangerButton(button, button.dataset.confirmText);
  return false;
}

document.addEventListener('click', (event) => {
  if (!armedDanger) return;
  if (event.target === armedDanger.button || armedDanger.button.contains(event.target)) return;
  resetDangerArming();
});

function openOptions() {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open('../options/options.html', '_blank');
}

async function refreshLLMHint() {
  const settings = await Storage.getSettings();
  const hint = $('#llm-hint');
  const text = $('#llm-hint-text');
  const tier = await detectAvailableTier(settings);
  const enabled = settings.aiRerankEnabled !== false;
  const tierText = tier === 'chrome-ai'
    ? 'Chrome 内置 AI 可用'
    : tier === 'user-api'
      ? `将回退到你的 ${escapeHtml(settings.llm?.providerId || 'API')} 配置`
      : '当前仅使用本地兜底';
  hint.classList.toggle('ok', enabled && tier !== 'none');
  if (enabled) {
    text.innerHTML = `免费 AI 精修：<b>${tierText}</b>，不产生项目方 API 费用。<a href="#" class="link-options">设置</a>`;
  } else {
    text.innerHTML = `已关闭 AI 精修，当前仅使用本地兜底。<a href="#" class="link-options">设置</a>`;
  }
  text.querySelector('.link-options')?.addEventListener('click', (event) => {
    event.preventDefault();
    openOptions();
  });
}

async function refreshUserBadge() {
  const profile = await ensureProfile();
  const badge = $('#user-badge');
  badge.textContent = shortUserId(profile.userId);
  badge.title = `点击复制用户 ID：${profile.userId}`;
}

async function showHome() {
  showView('home');
  await Promise.all([refreshResumeCard(), refreshUserBadge(), renderHomeDashboard()]);
}

async function showTaskInput() {
  showView('input');
  await Promise.all([refreshResumeCard(), refreshUserBadge()]);
}

function todayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 5) return '还没睡呀 🌙';
  if (h < 11) return '早上好 👋';
  if (h < 14) return '中午好 ☀️';
  if (h < 18) return '下午好 🍃';
  if (h < 22) return '晚上好 🌆';
  return '夜深了 🌙';
}

async function renderHomeDashboard() {
  const [stats, tasks, activeTask, teamSelf, petState] = await Promise.all([
    Storage.getStats(),
    Storage.getTasks(),
    Storage.getActiveTask(),
    Storage.getTeamSelf().catch(() => ({})),
    Pets.getState().catch(() => null),
  ]);
  const today = stats.dailyLog?.[todayDateKey()] || { steps: 0, tasks: 0, food: 0 };
  const greetEl = $('#home-greeting-sub');
  const largeEl = document.querySelector('.view-home .ios-large-title');
  if (largeEl) largeEl.textContent = greetingForNow();
  if (greetEl) {
    const openCount = tasks.filter((t) => Array.isArray(t.steps) && t.currentIndex < t.steps.length).length;
    greetEl.textContent = openCount > 0 ? `你有 ${openCount} 个进行中的任务，加油！` : '看看今天要征服哪一件小事？';
  }
  const heroNum = $('#home-hero-num');
  const heroSub = $('#home-hero-sub');
  if (heroNum) heroNum.textContent = String(today.steps || 0);
  if (heroSub) heroSub.textContent = `步骤 · 今日获得 ${today.food || 0} 养料`;
  const stepsEl = $('#home-today-steps'); if (stepsEl) stepsEl.textContent = `${today.steps || 0} 步`;
  const foodEl = $('#home-today-food'); if (foodEl) foodEl.textContent = String(today.food || 0);
  // streak based on dailyLog
  const dailyLog = stats.dailyLog || {};
  let streak = 0;
  const day = new Date();
  for (let i = 0; i < 400; i += 1) {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const v = dailyLog[key];
    if (v && v.steps > 0) { streak += 1; day.setDate(day.getDate() - 1); }
    else { if (i === 0) { day.setDate(day.getDate() - 1); continue; } break; }
  }
  const streakEl = $('#home-streak'); if (streakEl) streakEl.textContent = `${streak} 天`;
  const petSub = $('#home-pet-sub');
  if (petSub) {
    const affinity = petState?.totalFedByPet?.[petState?.activeId] || 0;
    petSub.textContent = `Lv.${stats.petLevel || 1} · 亲密度 ${affinity}`;
  }
  const teamSubEl = $('#home-team-sub');
  if (teamSubEl) teamSubEl.textContent = teamSelf?.teamCode ? `队伍 ${teamSelf.teamCode}` : '和伙伴一起';

  // active task slot
  const slot = $('#home-active-slot');
  if (slot) {
    if (activeTask && Array.isArray(activeTask.steps) && activeTask.currentIndex < activeTask.steps.length) {
      const done = activeTask.steps.filter((s) => s.done).length;
      const total = activeTask.steps.length;
      const cur = activeTask.steps[activeTask.currentIndex] || {};
      slot.innerHTML = `
        <div class="active-task-card fade-in delay-1">
          <div class="active-task-head">
            <div class="active-task-title">${escapeHtml(activeTask.goal)}</div>
            <span class="ios-chip tint-blue">进行中</span>
          </div>
          <div class="active-task-meta">已完成 ${done}/${total} 步 · 当前：${escapeHtml(cur.title || '—')}</div>
          <div class="active-task-progress"><div class="active-task-progress-fill" style="width:${Math.round((done / total) * 100)}%"></div></div>
          <button class="ios-btn ios-btn-primary block" id="home-continue-active">继续这个任务 →</button>
        </div>
      `;
      const btn = $('#home-continue-active');
      if (btn) btn.addEventListener('click', () => openTaskById(activeTask.id));
    } else {
      slot.innerHTML = '';
    }
  }
}

async function openTaskById(taskId) {
  const tasks = await Storage.getTasks();
  const task = tasks.find((item) => sameId(item.id, taskId));
  if (!task) return;
  await Storage.setActiveTaskId(task.id);
  currentTask = task;
  enterStepsView(task);
}

async function discardTaskById(taskId) {
  const tasks = await Storage.getTasks();
  const task = tasks.find((item) => sameId(item.id, taskId));
  if (!task) return;
  const activeId = await Storage.getActiveTaskId();
  const remainingSteps = Math.max(0, (task.steps?.length || 0) - Number(task.currentIndex || 0));
  await Storage.deleteTask(task.id);
  if (sameId(activeId, task.id)) {
    currentTask = null;
    stimer.stop();
    await showHome();
  } else {
    await refreshResumeCard();
  }
  flash(`已丢弃任务 · ${remainingSteps} 步未完成`);
}

async function refreshResumeCard() {
  const tasks = await Storage.getTasks();
  const active = await Storage.getActiveTask();
  const openTasks = tasks.filter((task) => Array.isArray(task.steps) && task.currentIndex < task.steps.length);
  const resumeCard = $('#resume-card');
  const tasksCard = $('#tasks-card');

  if (openTasks.length === 0) {
    resumeCard.classList.add('hidden');
    tasksCard.classList.add('hidden');
    return;
  }

  if (openTasks.length === 1) {
    const task = openTasks[0];
    resumeCard.classList.remove('hidden');
    tasksCard.classList.add('hidden');
    $('#resume-goal').textContent = task.goal;
    $('#resume-done').textContent = String(task.steps.filter((stepItem) => stepItem.done).length);
    $('#resume-total').textContent = String(task.steps.length);
    $('#btn-resume').dataset.taskId = String(task.id);
    $('#btn-discard').dataset.taskId = String(task.id);
    return;
  }

  resumeCard.classList.add('hidden');
  tasksCard.classList.remove('hidden');
  $('#tasks-count').textContent = String(openTasks.length);
  const list = $('#tasks-list');
  list.innerHTML = '';
  openTasks.forEach((task) => {
    const done = task.steps.filter((stepItem) => stepItem.done).length;
    const total = task.steps.length;
    const item = document.createElement('li');
    item.className = 'tasks-item' + (active && sameId(active.id, task.id) ? ' active' : '');
    item.innerHTML = `
      <div class="tasks-item-main">
        <div class="tasks-item-goal">${escapeHtml(task.goal)}</div>
        <div class="tasks-item-sub">已完成 ${done}/${total} 步 · ${formatDateTime(task.createdAt)}</div>
        <div class="tasks-item-bar"><div class="tasks-item-bar-fill" style="width:${Math.round((done / total) * 100)}%"></div></div>
      </div>
      <div class="tasks-item-actions">
        <button class="btn tiny primary btn-task-resume" data-task-id="${escapeHtml(task.id)}">继续</button>
        <button class="btn tiny ghost btn-task-del" data-task-id="${escapeHtml(task.id)}" data-confirm-text="再点一次确认丢弃">丢弃</button>
      </div>
    `;
    list.appendChild(item);
  });
}

async function doBreakdown(goal) {
  const btn = $('#btn-breakdown');
  const prevHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-emoji">🍃</span>懒羊羊正在拆解中…';
  try {
    const settings = await Storage.getSettings();
    const result = await breakdownTask(goal, settings);
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      goal,
      steps: result.steps.map((stepItem) => ({ ...stepItem, done: false, skipped: false })),
      currentIndex: 0,
      createdAt: Date.now(),
      source: result.source,
      privacy: settings?.team?.defaultPrivacy || PRIVACY.PUBLIC,
      meta: result.meta || null,
      warning: result.warning || null,
    };
    await Storage.setCurrentTask(task);
    enterPlanView(task);
  } catch (error) {
    flash(`拆解失败：${error.message || error}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = prevHtml;
  }
}

function renderPlanMeta(task) {
  const box = $('#plan-meta');
  box.innerHTML = '';
  const settings = getSettingsCached();
  const showUsage = settings?.showUsage !== false;
  const metaSource = task.meta?.source || 'local';
  const sourceText = metaSource === 'local+chrome-ai'
    ? '✨ 免费 AI 精修 · Chrome'
    : metaSource === 'local+user-api'
      ? '✨ 免费 AI 精修 · 用户 API'
      : (task.meta?.reusedFromCache ? '♻️ 相似任务复用' : '🍃 本地兜底');
  const parts = [`<span class="meta-tag">${sourceText}</span>`];
  if (task.warning) parts.push(`<span class="meta-warn" title="${escapeHtml(task.warning)}">⚠ 精修失败，已回退</span>`);
  if (task.meta?.mergedIntents?.length) parts.push(`<span class="meta-tag">${task.meta.mergedIntents.join(' + ')}</span>`);
  if (showUsage && (task.meta?.elapsedMs || task.meta?.latencyMs)) parts.push(`<span class="meta-tag">${task.meta.elapsedMs || task.meta.latencyMs} ms</span>`);
  if (showUsage && task.meta?.model) parts.push(`<span class="meta-tag">${escapeHtml(task.meta.model)}</span>`);
  if (showUsage && task.meta?.usage) {
    const usage = task.meta.usage;
    parts.push(`<span class="meta-tag">↓${usage.prompt_tokens || '?'} / ↑${usage.completion_tokens || '?'} tok</span>`);
  }
  box.innerHTML = parts.join(' ');
}

function enterPlanView(task) {
  currentTask = task;
  showView('plan');
  $('#plan-goal').textContent = task.goal;
  renderPlanMeta(task);
  renderPlanList();
}

function persistCurrentTask() {
  if (!currentTask) return Promise.resolve();
  return Storage.setCurrentTask(currentTask);
}

function renderPlanList() {
  if (!currentTask) return;
  const list = $('#plan-list');
  list.innerHTML = '';
  currentTask.steps.forEach((stepItem, index) => {
    const item = document.createElement('li');
    item.className = 'plan-item';
    item.dataset.idx = String(index);
    item.innerHTML = `
      <div class="plan-item-body">
        <input class="plan-title" data-field="title" value="${escapeHtml(stepItem.title)}" />
        <input class="plan-detail" data-field="detail" placeholder="详细说明（可选）" value="${escapeHtml(stepItem.detail || '')}" />
        <div class="plan-item-foot">
          <label class="plan-est">~ <input class="plan-est-input" data-field="estMinutes" type="number" min="1" max="60" value="${stepItem.estMinutes || 3}" /> 分钟</label>
          <div class="plan-item-actions">
            <button class="plan-btn" data-act="up" title="上移">↑</button>
            <button class="plan-btn" data-act="down" title="下移">↓</button>
            <button class="plan-btn danger" data-act="del" title="删除">✕</button>
          </div>
        </div>
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', async () => {
      const item = input.closest('.plan-item');
      const index = Number(item.dataset.idx);
      const field = input.dataset.field;
      const value = field === 'estMinutes' ? Math.max(1, Number(input.value) || 3) : input.value.trim();
      currentTask.steps[index][field] = value;
      await persistCurrentTask();
    });
  });

  list.querySelectorAll('.plan-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = button.closest('.plan-item');
      const index = Number(item.dataset.idx);
      const action = button.dataset.act;
      if (action === 'del') {
        if (currentTask.steps.length <= 1) {
          flash('至少要留一个步骤呀 🐑');
          return;
        }
        currentTask.steps.splice(index, 1);
      } else if (action === 'up' && index > 0) {
        const [removed] = currentTask.steps.splice(index, 1);
        currentTask.steps.splice(index - 1, 0, removed);
      } else if (action === 'down' && index < currentTask.steps.length - 1) {
        const [removed] = currentTask.steps.splice(index, 1);
        currentTask.steps.splice(index + 1, 0, removed);
      }
      await persistCurrentTask();
      renderPlanList();
    });
  });
}

function enterStepsView(task) {
  currentTask = task;
  showView('steps');
  $('#goal-text').textContent = task.goal;
  $('#btn-step-discard').dataset.taskId = String(task.id);
  $('#btn-quit').dataset.taskId = String(task.id);
  renderSteps();
}

async function renderSteps() {
  if (!currentTask) return;
  const task = currentTask;
  const total = task.steps.length;
  const index = Math.min(task.currentIndex, total - 1);
  const stepItem = task.steps[index];
  const stats = await Storage.getStats();
  const doneCount = task.steps.filter((item) => item.done).length;

  $('#step-index').textContent = String(index + 1);
  $('#step-total').textContent = String(total);
  $('#lifetime-steps').textContent = String(stats.totalStepsCompleted);
  $('#progress-fill').style.width = `${Math.round((doneCount / total) * 100)}%`;
  $('#step-title').textContent = stepItem.title;
  $('#step-detail').textContent = stepItem.detail || '就这么点事儿，交给你啦！';
  $('#step-est').textContent = `~ ${stepItem.estMinutes || 3} 分钟`;
  updatePrivacyChip(task);
  $('#mascot-say').textContent = `“${MASCOT_LINES[index % MASCOT_LINES.length]}”`;

  const list = $('#steps-list');
  list.innerHTML = '';
  task.steps.forEach((item, idx) => {
    const li = document.createElement('li');
    li.textContent = item.title + (item.skipped ? '（已跳过）' : '');
    if (idx === index) li.classList.add('current');
    if (item.done || item.skipped) li.classList.add('done');
    list.appendChild(li);
  });

  const card = $('#step-card');
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';

  renderStimer(0, stimer.snapshot());
  const settings = getSettingsCached();
  if (settings?.stepTimer?.autoStart && stimer.snapshot().phase === 'idle') {
    stimer.start(getCurrentStepMinutes());
  }
}

async function enterDoneView(options = {}) {
  showView('done');
  const stats = await Storage.getStats();
  $('#stat-steps').textContent = String(stats.totalStepsCompleted);
  $('#stat-tasks').textContent = String(stats.totalTasksCompleted);
  $('#stat-food').textContent = String(stats.foodStock);
  $('#pet-food-2').textContent = String(stats.foodStock);
  $('#pet-lv').textContent = String(stats.petLevel);
  if (options.partial) {
    $('#done-sub').textContent = '有几步跳过了没关系，能开始就是胜利～';
  } else if (options.bonus) {
    $('#done-sub').textContent = `你已经比 99% 的懒羊羊更勤快啦～ 🎁 完成奖励 +${options.bonus.food} 养料 / +${options.bonus.exp} 经验`;
  } else {
    $('#done-sub').textContent = '你已经比 99% 的懒羊羊更勤快啦～';
  }
  celebrateAll({ sound: (await Storage.getSettings()).soundEnabled !== false });
}

function petLabel(state, petId) {
  if (petId === 'custom') return state.customName || '我的宠物';
  return Pets.petTypeById(petId).name;
}

function renderPetHistory(state) {
  const list = $('#pet-history-list');
  const history = [...(state.feedLog || [])].slice(-10).reverse();
  if (history.length === 0) {
    list.innerHTML = '<li class="pet-history-item"><span>还没有喂养记录</span><span>去点一下喂养吧～</span></li>';
    return;
  }
  list.innerHTML = history.map((item) => {
    const emoji = Pets.petTypeById(item.petId).emoji || '🐑';
    return `<li class="pet-history-item"><span>${new Date(item.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · ${emoji} +${item.amount}</span><span>${escapeHtml(petLabel(state, item.petId))}</span></li>`;
  }).join('');
}

async function renderPet() {
  const state = await Pets.getState();
  const stats = await Storage.getStats();
  const type = Pets.petTypeById(state.activeId);
  const mood = computeMood(state, stats);
  const meta = MOOD_META[mood] || MOOD_META.normal;
  const avatar = $('#pet-avatar');
  avatar.className = 'pet-avatar mood-' + meta.anim;
  const cartoonFilter = state.cartoonize !== false ? 'contrast(1.15) saturate(1.35) brightness(1.02)' : 'none';
  if (state.activeId === 'custom' && state.customImageDataUrl) {
    avatar.innerHTML = `<img src="${state.customImageDataUrl}" alt="custom pet" style="filter:${cartoonFilter}" />`;
    $('#pet-name').textContent = state.customName || '我的宠物';
    $('#pet-desc').textContent = state.cartoonize !== false ? '你上传的专属形象（已自动卡通化 ✨）' : '你上传的专属形象～ 一起加油！';
  } else if (state.activeId === 'sheep') {
    avatar.innerHTML = '<img src="../icons/mascot.png" alt="sheep" />';
    $('#pet-name').textContent = type.name;
    $('#pet-desc').textContent = type.desc;
  } else {
    avatar.textContent = type.emoji;
    $('#pet-name').textContent = type.name;
    $('#pet-desc').textContent = type.desc;
  }
  $('#pet-mood').textContent = `${meta.emoji} ${meta.say}`;
  $('#pet-total-all').textContent = String(state.totalFedAll || 0);
  $('#pet-total-today').textContent = String(todayFeedTotal(state.feedLog || []));
  $('#pet-streak').textContent = String(state.feedStreakDays || 0);
  $('#pet-stat-lv').textContent = String(stats.petLevel);
  $('#pet-stat-food').textContent = String(stats.foodStock);
  $('#pet-stat-fed').textContent = String(state.totalFedAll || state.timesFed || 0);
  renderPetHistory(state);
  // v0.4.0 · milestones
  const msBox = $('#pet-milestones');
  if (msBox) {
    const total = state.totalFedAll || 0;
    msBox.innerHTML = PET_MILESTONES.map((m) => `<span class="pet-milestone ${total >= m ? 'reached' : ''}">${total >= m ? '✓ ' : ''}${m} 养料</span>`).join('');
  }

  const picker = $('#pet-picker');
  picker.innerHTML = '';
  PET_TYPES.forEach((pet) => {
    const unlocked = state.unlocked.includes(pet.id) || pet.id === 'sheep';
    const affinity = state.totalFedByPet?.[pet.id] || 0;
    const progress = affinityProgress(affinity);
    const slot = document.createElement('div');
    slot.className = 'pet-slot' + (sameId(state.activeId, pet.id) ? ' active' : '') + (!unlocked ? ' locked' : '');
    let emojiCell = pet.emoji;
    if (pet.id === 'sheep') emojiCell = '<img src="../icons/mascot.png" alt="sheep">';
    if (pet.id === 'custom' && state.customImageDataUrl) emojiCell = `<img src="${state.customImageDataUrl}" alt="custom">`;
    slot.innerHTML = `
      <div class="pet-slot-top">
        <div class="pet-slot-emoji">${emojiCell}</div>
        <div>
          <div class="pet-slot-name">${escapeHtml(petLabel(state, pet.id))}</div>
          ${unlocked ? '' : '<div class="pet-slot-lock">🔒 待解锁</div>'}
        </div>
      </div>
      <div class="pet-slot-affinity">❤️ 亲密度 <b>${affinity}</b></div>
      <div class="affinity-bar"><div class="affinity-bar-fill ${progress.tier}" style="width:${progress.percent}%"></div></div>
    `;
    slot.addEventListener('click', async () => {
      if (pet.id === 'custom' && !state.customImageDataUrl) {
        $('#pet-upload').click();
        return;
      }
      await Pets.setActive(pet.id);
      renderPet();
    });
    picker.appendChild(slot);
  });
}

function triggerFeedAnimation() {
  const avatar = $('#pet-avatar');
  const layer = $('#pet-heart-layer');
  avatar.classList.remove('feed-pop');
  void avatar.offsetWidth;
  avatar.classList.add('feed-pop');
  layer.innerHTML = '';
  const offsets = [
    ['-40px', '-68px'], ['-12px', '-84px'], ['18px', '-72px'], ['42px', '-58px'], ['-30px', '-48px'], ['22px', '-42px'],
  ];
  offsets.forEach(([dx, dy], index) => {
    const heart = document.createElement('span');
    heart.className = 'heart-particle';
    heart.textContent = index % 2 === 0 ? '💛' : '❤️';
    heart.style.setProperty('--dx', dx);
    heart.style.setProperty('--dy', dy);
    layer.appendChild(heart);
  });
  setTimeout(() => {
    avatar.classList.remove('feed-pop');
    layer.innerHTML = '';
  }, 820);
}

function playFeedJingle() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const start = ctx.currentTime;
    [659, 880, 988].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = index === 1 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + index * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.18, start + index * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.09 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start + index * 0.09);
      osc.stop(start + index * 0.09 + 0.2);
    });
    setTimeout(() => ctx.close?.(), 1200);
  } catch {}
}

async function enterPetView() {
  showView('pet');
  await renderPet();
}

async function renderCalendar(days = 30) {
  calDays = days;
  const stats = await Storage.getStats();
  const dailyLog = stats.dailyLog || {};
  const cells = buildHeatmap(dailyLog, days);
  const summary = summarize(dailyLog, days);
  $('#cal-stat-tasks').textContent = String(summary.totalTasks);
  $('#cal-stat-steps').textContent = String(summary.totalSteps);
  $('#cal-stat-streak').textContent = String(summary.currentStreak);
  $('#cal-stat-food').textContent = String(summary.totalFood);
  $('#cal-range-label').textContent = `近 ${days} 天`;
  $('#btn-cal-30').classList.toggle('active', days === 30);
  $('#btn-cal-90').classList.toggle('active', days === 90);
  const grid = $('#cal-heatmap');
  grid.innerHTML = '';
  const firstWeekday = new Date(cells[0].date + 'T00:00:00').getDay();
  for (let i = 0; i < firstWeekday; i += 1) {
    const pad = document.createElement('div');
    pad.className = 'cal-cell cal-cell-pad';
    grid.appendChild(pad);
  }
  cells.forEach((cell) => {
    const div = document.createElement('div');
    div.className = 'cal-cell';
    div.dataset.level = String(cell.level);
    div.title = `${cell.date} · ${cell.steps} 步 / ${cell.tasks} 任务 / ${cell.food} 养料`;
    grid.appendChild(div);
  });
}

async function enterCalendarView() {
  showView('calendar');
  await renderCalendar(calDays);
}

function normalizeTeamSyncEndpoint(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const headers = { 'Content-Type': 'application/json' };
    if (/jsonbin\.io$/i.test(url.hostname)) {
      const path = url.pathname.replace(/\/latest$/i, '');
      const match = path.match(/\/(?:v3\/b\/)?([A-Za-z0-9]+)/i);
      if (!match) return null;
      const binId = match[1];
      const accessKey = url.searchParams.get('accessKey') || url.searchParams.get('x-access-key');
      const masterKey = url.searchParams.get('masterKey') || url.searchParams.get('x-master-key');
      if (accessKey) headers['X-Access-Key'] = accessKey;
      if (masterKey) headers['X-Master-Key'] = masterKey;
      return {
        getUrl: `https://api.jsonbin.io/v3/b/${binId}/latest?meta=false`,
        putUrl: `https://api.jsonbin.io/v3/b/${binId}`,
        headers,
      };
    }
    return { getUrl: url.href, putUrl: url.href, headers };
  } catch {
    return null;
  }
}

function unwrapTeamSyncPayload(payload) {
  if (payload && typeof payload === 'object' && payload.record && typeof payload.record === 'object') {
    return payload.record;
  }
  return payload;
}

async function ensureLocalTeamState() {
  const [teamSelf, teamState, profile, stats, tasks, activeTask, settings] = await Promise.all([
    Storage.getTeamSelf(),
    Storage.getTeamState(),
    ensureProfile(),
    Storage.getStats(),
    Storage.getTasks(),
    Storage.getActiveTask(),
    Storage.getSettings(),
  ]);
  if (!teamSelf.teamCode) return { teamSelf, teamState };
  const authState = await Auth.getAuthState();
  const snapshot = buildMyMemberSnapshot({
    profile,
    stats,
    tasks,
    dailyLog: stats.dailyLog,
    activeTask,
    privacy: activeTask?.privacy || settings?.team?.defaultPrivacy || PRIVACY.PUBLIC,
    provider: authState.provider === 'github' ? 'github' : '',
  });
  const nextState = mergeTeamState(teamState || {}, {
    code: teamSelf.teamCode,
    members: { [snapshot.userId]: snapshot },
    pokes: [],
    updatedAt: Date.now(),
  });
  if (JSON.stringify(nextState) !== JSON.stringify(teamState || {})) {
    await Storage.setTeamState(nextState);
  }
  return { teamSelf, teamState: nextState };
}

async function updateTeamBellBadge() {
  const [profile, teamState] = await Promise.all([ensureProfile(), Storage.getTeamState()]);
  const unread = getUnreadPokesForState(teamState, profile.userId);
  const badge = $('#team-bell-badge');
  badge.textContent = String(unread.length);
  badge.classList.toggle('hidden', unread.length === 0);
}

async function maybeToastUnreadPokes() {
  const [profile, teamState, settings] = await Promise.all([ensureProfile(), Storage.getTeamState(), Storage.getSettings()]);
  const unread = getUnreadPokesForState(teamState, profile.userId);
  const toastKey = unread.map((item) => item.pokeId).join(',');
  if (!unread.length || toastKey === lastUnreadToastKey) return;
  lastUnreadToastKey = toastKey;
  flash(unread.length === 1 ? '收到 1 个拍一拍 👀' : `收到 ${unread.length} 个拍一拍 👀`);
  if (settings?.team?.pokesSoundOn !== false) {
    try { playFeedJingle(); } catch {}
  }
}

async function syncTeamState({ force = false } = {}) {
  const { teamSelf, teamState } = await ensureLocalTeamState();
  if (!teamSelf.teamCode || !teamSelf.syncUrl) return teamState;
  if (!force && Date.now() - teamLastAttemptAt < TEAM_SYNC_INTERVAL_MS) return teamState;
  teamLastAttemptAt = Date.now();
  const endpoint = normalizeTeamSyncEndpoint(teamSelf.syncUrl);
  if (!endpoint) {
    teamSyncFailed = true;
    return teamState;
  }

  try {
    let remoteState = null;
    try {
      const res = await fetch(endpoint.getUrl, { headers: endpoint.headers });
      if (res.ok) remoteState = unwrapTeamSyncPayload(await res.json());
    } catch {}

    const merged = mergeTeamState(teamState, remoteState || {});
    merged.code = teamSelf.teamCode || merged.code;
    merged.updatedAt = Date.now();
    await Storage.setTeamState(merged);

    const pushRes = await fetch(endpoint.putUrl, {
      method: 'PUT',
      headers: endpoint.headers,
      body: JSON.stringify(merged),
    });
    if (!pushRes.ok) throw new Error(`sync http ${pushRes.status}`);
    teamSyncFailed = false;
    return merged;
  } catch (error) {
    console.warn('[懒羊羊大王] team sync failed:', error?.message || error);
    teamSyncFailed = true;
    return teamState;
  } finally {
    await updateTeamBellBadge();
    if (currentView === 'team') await renderTeam();
  }
}

async function ensureTeamSyncLoop() {
  const teamSelf = await Storage.getTeamSelf();
  if (teamSyncTimerId) {
    clearInterval(teamSyncTimerId);
    teamSyncTimerId = null;
  }
  if (!teamSelf.syncUrl) return;
  teamSyncTimerId = window.setInterval(() => {
    if (currentView !== 'team' && urlParams.get('full') !== '1') return;
    syncTeamState().catch(() => {});
  }, TEAM_SYNC_INTERVAL_MS);
}

async function exportTeamSnapshot() {
  const { teamSelf, teamState } = await ensureLocalTeamState();
  if (!teamSelf.teamCode) {
    flash('还没有队伍可以导出');
    return;
  }
  const payload = {
    version: APP_VERSION,
    type: 'team-snapshot',
    exportedAt: Date.now(),
    teamCode: teamSelf.teamCode,
    teamState,
  };
  downloadJson(payload, `lazy-sheep-king-team-${teamSelf.teamCode}-${new Date().toISOString().slice(0, 10)}.json`);
  flash('队伍快照已导出');
}

async function importTeamSnapshot(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  const incoming = payload?.teamState || payload;
  if (!incoming?.code) throw new Error('不是有效的队伍快照');
  const currentSelf = await Storage.getTeamSelf();
  if (!currentSelf.teamCode) {
    await Storage.setTeamSelf({ teamCode: incoming.code, joinedAt: Date.now() });
  }
  const localState = await Storage.getTeamState();
  await Storage.setTeamState(mergeTeamState(localState, incoming));
  await ensureLocalTeamState();
  await updateTeamBellBadge();
  if (currentView === 'team') await renderTeam();
  flash('队伍快照已导入');
}

async function createTeamFlow() {
  const code = newTeamCode();
  await Storage.setTeamSelf({ teamCode: code, joinedAt: Date.now(), syncUrl: '' });
  await Storage.setTeamState({ code, members: {}, pokes: [], updatedAt: Date.now() });
  await ensureLocalTeamState();
  await ensureTeamSyncLoop();
  await updateTeamBellBadge();
  const copied = await copyText(code);
  flash(copied ? `已创建队伍 ${code}，团队码已复制` : `已创建队伍 ${code}`);
  await renderTeam();
}

async function joinTeamFlow(codeInput) {
  const code = String(codeInput || '').trim().toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(code)) {
    flash('请输入 6 位十六进制队伍码');
    return;
  }
  await Storage.setTeamSelf({ teamCode: code, joinedAt: Date.now() });
  await Storage.setTeamState({ code, members: {}, pokes: [], updatedAt: Date.now() });
  await ensureLocalTeamState();
  await ensureTeamSyncLoop();
  flash(`已加入队伍 ${code}`);
  await renderTeam();
}

async function markPokeRead(pokeId) {
  const teamState = await Storage.getTeamState();
  teamState.pokes = (teamState.pokes || []).map((item) => (item.pokeId === pokeId ? { ...item, read: true } : item));
  await Storage.setTeamState(teamState);
  await syncTeamState({ force: true });
  await updateTeamBellBadge();
  await renderTeam();
}

async function sendTeamPoke(toUserId) {
  const [profile, teamState] = await Promise.all([ensureProfile(), Storage.getTeamState()]);
  if (!toUserId || toUserId === profile.userId) return;
  const poke = makePoke({ from: profile.userId, to: toUserId, message: '继续冲呀！' });
  const merged = mergeTeamState(teamState, { code: teamState.code, members: {}, pokes: [poke], updatedAt: Date.now() });
  await Storage.setTeamState(merged);
  await syncTeamState({ force: true });
  flash('已拍队友 · 待其打开看到');
  if (currentView === 'team') await renderTeam();
}

async function saveTeamSyncUrl(value) {
  await Storage.setTeamSelf({ syncUrl: String(value || '').trim() });
  teamSyncFailed = false;
  await ensureTeamSyncLoop();
  await syncTeamState({ force: true });
  await renderTeam();
}

async function saveTeamDefaultPrivacy(value) {
  settingsCache = await Storage.setSettings({ team: { defaultPrivacy: value } });
  await refreshLLMHint();
  if (currentTask && !currentTask.privacy) {
    currentTask.privacy = value;
    await persistCurrentTask();
  }
  await renderTeam();
}

async function renderTeam() {
  showView('team');
  const root = $('#team-root');
  const [{ teamSelf, teamState }, profile, settings] = await Promise.all([
    ensureLocalTeamState(),
    ensureProfile(),
    Storage.getSettings(),
  ]);
  const unread = getUnreadPokesForState(teamState, profile.userId);

  if (!teamSelf.teamCode) {
    root.innerHTML = `
      <div class="team-empty">
        <div class="team-empty-title">和伙伴一起打卡更有劲</div>
        <div class="team-empty-sub">创建一个 6 位队伍码，或输入队伍码加入。默认使用“手动快照交换”，零后端、零成本。</div>
        <div class="team-empty-actions">
          <button class="btn primary" data-team-act="create">创建组队</button>
          <button class="btn ghost" data-team-act="join-submit">加入组队</button>
        </div>
        <div class="team-join-row">
          <input id="team-join-code" maxlength="6" placeholder="输入 6 位队伍码，如 A1B2C3" />
        </div>
      </div>
    `;
    return;
  }

  const members = Object.values(teamState.members || {}).sort((a, b) => {
    if (a.userId === profile.userId) return -1;
    if (b.userId === profile.userId) return 1;
    return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
  });

  root.innerHTML = `
    <div class="team-card">
      <div class="team-dashboard-head">
        <div>
          <button class="team-code-btn" data-team-act="copy-code">团队码 ${escapeHtml(teamSelf.teamCode)}</button>
          <div class="team-meta-line">
            <span>成员数 ${members.length}</span>
            <span>上次同步 ${formatTimeOnly(teamState.updatedAt)}</span>
          </div>
        </div>
        <div class="team-status-pill ${teamSyncFailed ? 'fail' : ''}">${teamSyncFailed ? '同步失败' : '手动快照 / 免费 URL 同步'}</div>
      </div>
      <div class="team-sync-note">默认推荐：点击下方“导出队伍快照”，把 JSON 发给队友，再由对方“导入队伍快照”。</div>
    </div>

    <div class="team-card">
      <div class="team-pokes-title">🔔 收到的拍一拍${unread.length ? `（${unread.length}）` : ''}</div>
      <div class="team-pokes-list">
        ${unread.length ? unread.map((item) => {
          const fromMember = teamState.members?.[item.from];
          return `
            <div class="team-poke-item">
              <div class="team-poke-item-main">
                <div class="team-poke-item-title">${escapeHtml(fromMember?.name || item.from)} 拍了拍你</div>
                <div class="team-poke-item-sub">${escapeHtml(item.message || '继续冲呀！')} · ${maybeRelativeTime(item.ts)}</div>
              </div>
              <button class="btn tiny ghost" data-team-act="read-poke" data-poke-id="${escapeHtml(item.pokeId)}">👍 已收到</button>
            </div>
          `;
        }).join('') : '<div class="team-no-pokes">暂时没有新的拍一拍，继续冲呀～</div>'}
      </div>
    </div>

    <div class="team-card">
      <div class="team-pokes-title">👥 队友列表</div>
      <div class="team-members">
        ${members.map((member) => `
          <div class="team-member-card ${member.userId === profile.userId ? 'self' : ''}">
            <div class="team-member-main">
              <div class="team-member-head">
                <div class="team-member-name">
                  <span>${escapeHtml(member.name || '懒羊羊伙伴')}</span>
                  ${member.provider === 'github' ? '<span class="team-github-badge" title="GitHub 已验证">🐙</span>' : ''}
                  ${member.userId === profile.userId ? '<span class="team-self-tag">我</span>' : ''}
                </div>
                <span class="team-device-chip">${escapeHtml(member.device || 'Web')}</span>
              </div>
              <div class="team-member-task">
                <span class="team-task-chip ${escapeHtml(member.activeTaskView?.privacy || 'public')}">${privacyLabel(member.activeTaskView?.privacy || PRIVACY.PUBLIC)}</span>
                <span>${escapeHtml(member.activeTaskView?.label || '空闲中')}</span>
              </div>
              <div class="team-member-stats">
                <span class="team-stat-mini">今日已完成 ${Number(member.todaySteps || 0)} 步</span>
                <span class="team-stat-mini">连续打卡 ${Number(member.streak || 0)} 天</span>
                <span class="team-stat-mini">最近活跃 ${escapeHtml(maybeRelativeTime(member.updatedAt || member.lastActiveAt))}</span>
              </div>
            </div>
            <div class="team-member-action">
              <button class="btn tiny ${member.userId === profile.userId ? 'ghost' : 'primary'}" data-team-act="poke" data-user-id="${escapeHtml(member.userId)}" ${member.userId === profile.userId ? 'disabled' : ''}>🫵 拍一拍</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="team-actions-grid">
        <button class="btn ghost" data-team-act="export-snapshot">📤 导出队伍快照</button>
        <button class="btn ghost" data-team-act="import-snapshot">📥 导入队伍快照</button>
      </div>
      <div class="team-sync-box">
        <div class="team-sync-head">
          <div class="team-pokes-title" style="margin-bottom:0;">🔗 配置 URL 同步（免费）</div>
          <button class="btn tiny ghost" data-team-act="sync-now">立即同步</button>
        </div>
        <div class="team-sync-row">
          <input id="team-sync-url" placeholder="粘贴 JSONBin.io / npoint.io URL；留空则完全不走网络" value="${escapeHtml(teamSelf.syncUrl || '')}" />
          <button class="btn tiny primary" data-team-act="save-sync-url">保存</button>
        </div>
        <div class="team-sync-note">若 URL 为空，则不会发起任何网络请求。网络错误会静默处理，只在这里显示“同步失败”小提示。</div>
      </div>
      <div class="team-setting-row">
        <span class="team-setting-label">默认隐私</span>
        <select id="team-default-privacy">
          <option value="public" ${settings?.team?.defaultPrivacy === PRIVACY.PUBLIC ? 'selected' : ''}>公开</option>
          <option value="title-hidden" ${settings?.team?.defaultPrivacy === PRIVACY.TITLE_HIDDEN ? 'selected' : ''}>仅隐藏标题</option>
          <option value="full-private" ${settings?.team?.defaultPrivacy === PRIVACY.FULL_PRIVATE ? 'selected' : ''}>完全隐私</option>
        </select>
      </div>
      <div class="team-muted">当前任务的 🔒 按钮可单独覆盖默认隐私设置。</div>
    </div>
  `;
}

async function enterTeamView() {
  await renderTeam();
  await syncTeamState({ force: true });
  await maybeToastUnreadPokes();
}

function mergeTasks(localTasks = [], incomingTasks = []) {
  const map = new Map();
  [...localTasks, ...incomingTasks].forEach((task) => {
    if (!task?.id) return;
    const prev = map.get(String(task.id));
    const prevDone = prev?.steps?.filter((item) => item.done || item.skipped).length || 0;
    const nextDone = task?.steps?.filter((item) => item.done || item.skipped).length || 0;
    if (!prev || nextDone > prevDone || Number(task.currentIndex || 0) > Number(prev.currentIndex || 0) || Number(task.createdAt || 0) >= Number(prev.createdAt || 0)) {
      map.set(String(task.id), task);
    }
  });
  return Array.from(map.values()).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function mergeHistory(localHistory = [], incomingHistory = []) {
  const map = new Map();
  [...localHistory, ...incomingHistory].forEach((item) => {
    if (!item) return;
    const key = `${item.id || 'hist'}:${item.completedAt || item.ts || item.createdAt || Math.random()}`;
    if (!map.has(key)) map.set(key, item);
  });
  return Array.from(map.values()).sort((a, b) => Number(b.completedAt || b.ts || 0) - Number(a.completedAt || a.ts || 0)).slice(0, 80);
}

function mergeDailyLog(localLog = {}, incomingLog = {}) {
  const merged = {};
  new Set([...Object.keys(localLog || {}), ...Object.keys(incomingLog || {})]).forEach((date) => {
    merged[date] = {
      steps: Math.max(localLog?.[date]?.steps || 0, incomingLog?.[date]?.steps || 0),
      tasks: Math.max(localLog?.[date]?.tasks || 0, incomingLog?.[date]?.tasks || 0),
      food: Math.max(localLog?.[date]?.food || 0, incomingLog?.[date]?.food || 0),
    };
  });
  return merged;
}

function mergeRecentBreakdowns(localList = [], incomingList = []) {
  const map = new Map();
  [...incomingList, ...localList].forEach((item) => {
    if (!item?.normalized) return;
    if (!map.has(item.normalized)) map.set(item.normalized, item);
  });
  return Array.from(map.values()).slice(0, 40);
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBackup() {
  const profile = await ensureProfile();
  const backup = await Storage.getBackupData();
  const pets = await Pets.getState();
  const activeTaskId = await Storage.getActiveTaskId();
  const payload = {
    version: APP_VERSION,
    exportedAt: Date.now(),
    userId: profile.userId,
    profile,
    activeTaskId,
    ...backup,
    pets,
  };
  const datePart = new Date().toISOString().slice(0, 10);
  // 本地密码账号已解锁时，用 AES-GCM 加密备份
  const wrapped = await Auth.encryptBackup(payload);
  if (wrapped.enc) {
    const file = { version: APP_VERSION, exportedAt: Date.now(), userId: profile.userId, enc: true, ...wrapped };
    downloadJson(file, `lazy-sheep-king-backup-${profile.userId}-${datePart}.enc.json`);
    flash('已导出加密备份 🔐');
  } else {
    downloadJson(payload, `lazy-sheep-king-backup-${profile.userId}-${datePart}.json`);
    flash('备份已导出');
  }
}

async function importBackup(file) {
  const text = await file.text();
  let payload = JSON.parse(text);
  // 加密备份：需要密码解密
  if (payload && payload.enc) {
    let pass = null;
    if (Auth.getSession() === null) {
      pass = typeof prompt === 'function' ? prompt('这是加密备份，请输入导出时的密码：') : null;
      if (!pass) throw new Error('已取消：需要密码才能导入加密备份');
    }
    const decrypted = await Auth.decryptBackup(payload, pass);
    if (!decrypted.ok) throw new Error(decrypted.message || '解密失败');
    payload = decrypted.payload;
  }
  if (!payload || !payload.version) throw new Error('不是有效的备份文件');
  // 非访客模式导入需先解锁（防止他人在你锁定时覆盖数据）
  const authState = await Auth.getAuthState();
  if (authState.mode && authState.mode !== MODE.GUEST && Auth.getSession() === null) {
    throw new Error('请先解锁账户再导入备份');
  }
  const currentProfile = await ensureProfile();
  const local = await Storage.getBackupData();
  const localPets = await Pets.getState();
  const mismatch = payload.userId && currentProfile.userId && payload.userId !== currentProfile.userId;
  if (mismatch) {
    flash('⚠️ 备份 userId 与当前不一致，将保留当前身份，仅合并数据', { big: true, duration: 2600 });
  }

  const mergedTasks = mergeTasks(local.tasks, payload.tasks || []);
  const mergedHistory = mergeHistory(local.history, payload.history || []);
  const incomingStats = payload.stats || {};
  const mergedStats = {
    ...local.stats,
    ...incomingStats,
    totalTasksCompleted: Math.max(local.stats.totalTasksCompleted || 0, incomingStats.totalTasksCompleted || 0),
    totalStepsCompleted: Math.max(local.stats.totalStepsCompleted || 0, incomingStats.totalStepsCompleted || 0),
    foodStock: Math.max(local.stats.foodStock || 0, incomingStats.foodStock || 0),
    petLevel: Math.max(local.stats.petLevel || 1, incomingStats.petLevel || 1),
    petExp: Math.max(local.stats.petExp || 0, incomingStats.petExp || 0),
    lastActiveAt: Math.max(local.stats.lastActiveAt || 0, incomingStats.lastActiveAt || 0),
    dailyLog: mergeDailyLog(local.stats.dailyLog || {}, incomingStats.dailyLog || {}),
  };
  const mergedRecent = mergeRecentBreakdowns(local.recentBreakdowns, payload.recentBreakdowns || []);
  const mergedTeamState = mergeTeamState(local.teamState || {}, payload.teamState || {});

  await Storage.setSettings(payload.settings || local.settings);
  await Storage.setTasks(mergedTasks);
  await Storage.setHistory(mergedHistory);
  await Storage.setStats(mergedStats);
  await Storage.setRecentBreakdowns(mergedRecent);
  await Storage.setTeamState(mergedTeamState);
  await Storage.setTeamSelf(payload.teamSelf || local.teamSelf || {});
  await Pets.replaceState(payload.pets || localPets);

  if (!mismatch && payload.profile) {
    await Storage.setProfile(payload.profile);
  } else {
    await Storage.setProfile(currentProfile);
  }

  const candidateActiveId = mergedTasks.some((task) => sameId(task.id, payload.activeTaskId))
    ? payload.activeTaskId
    : (mergedTasks.find((task) => task.currentIndex < task.steps.length)?.id || null);
  await Storage.setActiveTaskId(candidateActiveId);

  if (typeof payload.syncEnabled === 'boolean') {
    await Storage.setSyncEnabled(payload.syncEnabled && isSyncSupported());
  }

  await primeSettingsCache();
  await refreshLLMHint();
  await refreshResumeCard();
  await renderMyView();
  await updateTeamBellBadge();
  currentTask = candidateActiveId ? mergedTasks.find((task) => sameId(task.id, candidateActiveId)) || null : null;
  flash(mismatch ? '已导入备份（保留当前用户 ID）' : '备份导入完成');
}

function initialAvatar(name) {
  const ch = String(name || '懒').trim().charAt(0) || '懒';
  return ch.toUpperCase();
}

async function renderAccountCard() {
  const state = await Auth.getAuthState();
  const profile = await ensureProfile();
  const nameInput = $('#account-display-name');
  const displayName = state.displayName || profile.displayName || '懒羊羊伙伴';
  if (document.activeElement !== nameInput) nameInput.value = displayName;

  // 头像：自定义宠物 > github 头像 > 首字母
  const img = $('#account-avatar-img');
  const fallback = $('#account-avatar-fallback');
  const petState = await Pets.getState().catch(() => null);
  const customImg = petState?.customImage || '';
  const ghAvatar = state.avatarUrl || '';
  if (customImg) {
    img.src = customImg; img.classList.remove('hidden'); fallback.classList.add('hidden');
  } else if (ghAvatar) {
    img.src = ghAvatar; img.classList.remove('hidden'); fallback.classList.add('hidden');
  } else {
    img.classList.add('hidden'); fallback.classList.remove('hidden');
    fallback.textContent = state.mode === MODE.GUEST ? '🐑' : initialAvatar(displayName);
  }

  // 认证模式 chip
  const chip = $('#account-mode-chip');
  chip.className = 'mode-chip';
  const verified = $('#account-verified');
  verified.classList.add('hidden');
  const lockBtn = $('#btn-account-lock');
  lockBtn.classList.add('hidden');
  if (state.mode === MODE.PASSPHRASE) {
    chip.classList.add('mode-passphrase');
    chip.textContent = state.locked ? '🔐 本地账号（已锁定）' : '🔐 本地账号';
    $('#account-sub').textContent = state.locked ? '已锁定 · 解锁后可执行敏感操作' : `本地密码账号 · 创建于 ${formatDate(state.createdAt)}`;
    if (!state.locked) lockBtn.classList.remove('hidden');
  } else if (state.mode === MODE.GITHUB) {
    chip.classList.add('mode-github');
    chip.textContent = '🐙 GitHub';
    verified.classList.remove('hidden');
    $('#account-sub').textContent = `@${state.login || ''} · GitHub 已验证身份`;
  } else {
    chip.classList.add('mode-guest');
    chip.textContent = '👤 访客';
    $('#account-sub').textContent = '匿名模式 · 数据仅保存在本机';
  }

  renderAccountActions(state);
}

function actionButton(label, cls = 'ghost') {
  const btn = document.createElement('button');
  btn.className = `btn ${cls}`;
  btn.textContent = label;
  return btn;
}

function renderAccountActions(state) {
  const box = $('#account-actions');
  box.innerHTML = '';
  const hint = $('#auth-hint-text');

  if (state.mode === MODE.PASSPHRASE) {
    if (state.locked) {
      hint.textContent = '账号已锁定，输入密码解锁后即可执行敏感操作。';
      const input = document.createElement('input');
      input.type = 'password';
      input.className = 'modal-input';
      input.placeholder = '输入密码解锁';
      input.id = 'inline-unlock-pass';
      const unlock = actionButton('🔓 解锁', 'primary');
      unlock.addEventListener('click', async () => {
        const ok = await Auth.verifyPassphrase(input.value);
        if (ok) { flash('已解锁 🎉'); await renderMyView(); }
        else flash('密码不正确', { big: true });
      });
      box.appendChild(input);
      box.appendChild(unlock);
    } else {
      hint.textContent = '本地密码账号已解锁，会话 15 分钟无操作会自动锁定。';
      const change = actionButton('🔑 修改密码');
      change.addEventListener('click', () => openSignInModal('change'));
      const lock = actionButton('🔓 锁定');
      lock.addEventListener('click', async () => { Auth.lockSession(); flash('已锁定'); await renderMyView(); });
      const out = actionButton('🚪 退出账户');
      out.addEventListener('click', signOutFlow);
      box.appendChild(change); box.appendChild(lock); box.appendChild(out);
    }
  } else if (state.mode === MODE.GITHUB) {
    hint.textContent = 'GitHub 已验证身份，令牌加密存于本机（best-effort），用于后续 Gist 同步。';
    const home = actionButton('🐙 打开 GitHub 主页');
    home.addEventListener('click', () => {
      const url = `https://github.com/${state.login || ''}`;
      if (typeof chrome !== 'undefined' && chrome?.tabs?.create) chrome.tabs.create({ url });
      else window.open(url, '_blank');
    });
    const out = actionButton('🚪 退出账户');
    out.addEventListener('click', signOutFlow);
    box.appendChild(home); box.appendChild(out);
  } else {
    hint.textContent = '选择一种免费方式创建账号，多设备也能找回你的进度。';
    const pp = actionButton('🔐 创建本地密码账号', 'primary');
    pp.addEventListener('click', () => openSignInModal('passphrase'));
    const gh = actionButton('🐙 用 GitHub 登录');
    gh.addEventListener('click', () => openSignInModal('github'));
    const google = actionButton('🟢 用 Google 登录（待发布至商店后启用）');
    google.disabled = true;
    google.title = 'Google 登录需先把扩展发布到 Chrome Web Store 并配置稳定的 OAuth2 client_id';
    box.appendChild(pp); box.appendChild(gh); box.appendChild(google);
  }
}

async function signOutFlow() {
  await Auth.signOut();
  flash('已退出账户，回到访客模式（本地数据保留）');
  await renderMyView();
  await refreshUserBadge();
}

async function renderMyView() {
  const profile = await ensureProfile();
  const syncEnabled = await Storage.getSyncEnabled();
  const settings = await Storage.getSettings();
  settingsCache = settings;
  const tier = await detectAvailableTier(settings);
  await renderAccountCard();
  $('#my-user-id').textContent = profile.userId || '—';
  $('#my-device-label').textContent = profile.deviceLabel || 'Web';
  $('#my-created-at').textContent = formatDate(profile.createdAt);
  $('#my-ai-rerank-enabled').checked = settings.aiRerankEnabled !== false;
  $('#ai-status-text').innerHTML = settings.aiRerankEnabled === false
    ? '已关闭 AI 精修，当前只使用本地兜底。'
    : tier === 'chrome-ai'
      ? 'Chrome 内置 AI：<b>可用</b>，优先本地推理，不上传任务内容。'
      : tier === 'user-api'
        ? `Chrome 内置 AI 暂不可用，将回退到你配置的 <b>${escapeHtml(settings.llm?.providerId || 'API')}</b>。`
        : 'Chrome 内置 AI：<b>不可用</b>（Chrome 138+ / flag / Origin Trial）；未配置用户 API 时会直接回退本地兜底。';
  const authState = await Auth.getAuthState();
  $('#backup-enc-hint').textContent = authState.mode === MODE.PASSPHRASE
    ? '导入会合并任务 / 历史 / 统计；本地密码账号已解锁时，导出的备份会用 AES-GCM 加密。'
    : '导入会按合并策略处理任务 / 历史 / 统计；设置、宠物与队伍状态以备份为准。';
  const supportText = $('#sync-support-text');
  const syncButton = $('#btn-sync-toggle');
  if (isSyncSupported()) {
    supportText.textContent = syncEnabled ? '当前已开启：会同步 profile / tasks / settings / 精简 stats。' : '可在支持 chrome.storage.sync 的环境下启用。';
    syncButton.disabled = false;
    syncButton.textContent = syncEnabled ? '☁️ 已开启跨设备同步（点击关闭）' : '🔄 启用跨设备同步（Chrome 账号）';
  } else {
    supportText.textContent = '当前环境不支持 chrome.storage.sync（Web 试玩/部分浏览器会降级为本地模式）。';
    syncButton.disabled = true;
    syncButton.textContent = '当前环境不支持';
  }
  await refreshUserBadge();
}

async function enterMyView() {
  showView('my');
  await renderMyView();
}

function getCurrentStepMinutes() {
  const stepItem = currentTask?.steps?.[currentTask?.currentIndex];
  return Math.max(1, Math.round(stepItem?.estMinutes || 3));
}

function beepDone() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const time = ctx.currentTime;
    [880, 1175, 1568].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, time + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.28, time + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + index * 0.18 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time + index * 0.18);
      osc.stop(time + index * 0.18 + 0.3);
    });
    setTimeout(() => ctx.close?.(), 1500);
  } catch {}
}

function renderStimer(leftMs, state) {
  const card = $('#stimer-card');
  if (!card) return;
  card.dataset.phase = state.phase;
  const mins = getCurrentStepMinutes();
  $('#stimer-plan').textContent = String(mins);
  $('#btn-stimer-plan').textContent = String(mins);
  const badge = $('#stimer-badge');
  const time = $('#stimer-time');
  const startBtn = $('#btn-stimer-start');
  const pauseBtn = $('#btn-stimer-pause');
  const resumeBtn = $('#btn-stimer-resume');
  const addBtn = $('#btn-stimer-add');
  const stopBtn = $('#btn-stimer-stop');

  if (state.phase === 'idle') {
    badge.textContent = '🕐 步骤倒计时 · 未开始';
    time.textContent = '--:--';
  } else if (state.phase === 'running') {
    badge.textContent = '🔥 专注中';
    time.textContent = fmtTimer(leftMs);
  } else if (state.phase === 'paused') {
    badge.textContent = '⏸ 已暂停';
    time.textContent = fmtTimer(leftMs);
  } else if (state.phase === 'ended') {
    badge.textContent = '✅ 时间到';
    time.textContent = '00:00';
  }
  startBtn.classList.toggle('hidden', state.phase === 'running' || state.phase === 'paused');
  pauseBtn.classList.toggle('hidden', state.phase !== 'running');
  resumeBtn.classList.toggle('hidden', state.phase !== 'paused');
  addBtn.classList.toggle('hidden', state.phase === 'idle');
  stopBtn.classList.toggle('hidden', state.phase === 'idle');
}

const stimer = createCountdown({
  onTick: (leftMs, state) => renderStimer(leftMs, state),
  onEnd: () => {
    try {
      const cfg = getSettingsCached()?.stepTimer;
      if (cfg?.endSound !== false) beepDone();
    } catch {}
    flash('⏰ 时间到！可以点「完成」或「＋1 分钟」再来一会儿～');
    if (getSettingsCached()?.stepTimer?.autoAddOnEnd) {
      stimer.addMinutes(1);
      stimer.resume();
    }
  },
});

$('#btn-open-full')?.addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome?.tabs) chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?full=1') });
  else window.open(location.pathname + '?full=1', '_blank');
});
$('#btn-options')?.addEventListener('click', openOptions);
$('#btn-my')?.addEventListener('click', enterMyView);
$('#btn-calendar')?.addEventListener('click', enterCalendarView);
$('#btn-team')?.addEventListener('click', enterTeamView);
$('#btn-topbar-brand')?.addEventListener('click', showHome);
$('#btn-open-options-from-my')?.addEventListener('click', openOptions);
$('#btn-goto-pet')?.addEventListener('click', enterPetView);

// v0.4.0 · Tab bar routing
$$('.ios-tabbar-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === 'home') showHome();
    else if (tab === 'task') showTaskInput();
    else if (tab === 'pet') enterPetView();
    else if (tab === 'calendar') enterCalendarView();
    else if (tab === 'my') enterMyView();
  });
});

// Home 快捷入口
$$('[data-jump-tab]').forEach((el) => {
  el.addEventListener('click', () => {
    const tab = el.dataset.jumpTab;
    if (tab === 'home') showHome();
    else if (tab === 'task') showTaskInput();
    else if (tab === 'pet') enterPetView();
    else if (tab === 'calendar') enterCalendarView();
    else if (tab === 'my') enterMyView();
  });
});
$('#home-quick-team')?.addEventListener('click', enterTeamView);

$('#user-badge')?.addEventListener('click', async () => {
  const profile = await ensureProfile();
  const ok = await copyText(profile.userId);
  flash(ok ? `已复制用户 ID：${shortUserId(profile.userId)}` : '复制失败，请手动长按复制');
});

$$('.chip').forEach((chip) => chip.addEventListener('click', () => {
  $('#task-input').value = chip.dataset.example;
  $('#task-input').focus();
}));

$('#btn-breakdown').addEventListener('click', async () => {
  const goal = $('#task-input').value.trim();
  if (!goal) {
    $('#task-input').focus();
    $('#task-input').style.borderColor = '#b0562c';
    setTimeout(() => { $('#task-input').style.borderColor = ''; }, 800);
    return;
  }
  await doBreakdown(goal);
});

$('#btn-resume').addEventListener('click', async () => {
  const taskId = $('#btn-resume').dataset.taskId;
  if (taskId) await openTaskById(taskId);
});

$('#btn-discard').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const taskId = button.dataset.taskId;
  if (!taskId) return;
  if (!requiresSecondClick(button)) return;
  resetDangerArming();
  await discardTaskById(taskId);
});

$('#tasks-list').addEventListener('click', async (event) => {
  const resumeBtn = event.target.closest('.btn-task-resume');
  if (resumeBtn) {
    await openTaskById(resumeBtn.dataset.taskId);
    return;
  }
  const deleteBtn = event.target.closest('.btn-task-del');
  if (!deleteBtn) return;
  if (!requiresSecondClick(deleteBtn)) return;
  resetDangerArming();
  await discardTaskById(deleteBtn.dataset.taskId);
});

$('#team-root').addEventListener('click', async (event) => {
  const actionEl = event.target.closest('[data-team-act]');
  if (!actionEl) return;
  const action = actionEl.dataset.teamAct;
  if (action === 'create') {
    await createTeamFlow();
    return;
  }
  if (action === 'join-submit') {
    await joinTeamFlow($('#team-join-code')?.value);
    return;
  }
  if (action === 'copy-code') {
    const teamSelf = await Storage.getTeamSelf();
    const ok = await copyText(teamSelf.teamCode || '');
    flash(ok ? `已复制团队码 ${teamSelf.teamCode}` : '复制失败，请手动复制');
    return;
  }
  if (action === 'export-snapshot') {
    await exportTeamSnapshot();
    return;
  }
  if (action === 'import-snapshot') {
    $('#team-snapshot-file-input').click();
    return;
  }
  if (action === 'save-sync-url') {
    await saveTeamSyncUrl($('#team-sync-url')?.value);
    return;
  }
  if (action === 'sync-now') {
    await syncTeamState({ force: true });
    return;
  }
  if (action === 'poke') {
    await sendTeamPoke(actionEl.dataset.userId);
    return;
  }
  if (action === 'read-poke') {
    await markPokeRead(actionEl.dataset.pokeId);
  }
});

$('#team-root').addEventListener('change', async (event) => {
  if (event.target.id === 'team-default-privacy') {
    await saveTeamDefaultPrivacy(event.target.value);
  }
});

$('#btn-add-step').addEventListener('click', async () => {
  if (!currentTask) return;
  currentTask.steps.push({ title: '新步骤', detail: '', tips: '', estMinutes: 3, done: false, skipped: false });
  await persistCurrentTask();
  renderPlanList();
});

$('#btn-rebreakdown').addEventListener('click', async () => {
  if (!currentTask) return;
  await doBreakdown(currentTask.goal);
});

$('#btn-back-input').addEventListener('click', showTaskInput);
$('#btn-start').addEventListener('click', async () => {
  if (!currentTask) return;
  currentTask.currentIndex = 0;
  await persistCurrentTask();
  enterStepsView(currentTask);
});

$('#btn-done').addEventListener('click', async () => {
  if (!currentTask) return;
  const task = currentTask;
  const stepItem = task.steps[task.currentIndex];
  const timerSnap = stimer.snapshot();
  const actualMs = timerSnap.elapsedActiveMs || 0;
  const reward = calcStepReward({ estMinutes: stepItem.estMinutes || 3, actualMs, skipped: false });
  stepItem.done = true;
  stepItem.actualMs = actualMs;
  stepItem.rewardTag = reward.tag;
  await persistCurrentTask();
  await Storage.addStepCompleted({ food: reward.food, exp: reward.exp });
  stimer.stop();
  const tagText = reward.tag === 'on-time' ? '⚡ 效率大王 +50%' : reward.tag === 'over-time' ? '🐢 慢工出细活' : reward.tag === 'no-timer' ? '📝 未计时' : '';
  flash(`+${reward.food} 养料 ${tagText}`.trim());
  celebrateStep({ sound: (await Storage.getSettings()).soundEnabled !== false });

  setTimeout(async () => {
    task.currentIndex += 1;
    if (task.currentIndex >= task.steps.length) {
      await persistCurrentTask();
      const bonus = calcTaskCompletionBonus(task);
      await Storage.pushHistory({ id: task.id, goal: task.goal, stepsCount: task.steps.length, completedAt: Date.now(), taskBonus: bonus });
      await Storage.addTaskCompleted(bonus);
      if (task.source !== 'llm') {
        await rememberBreakdown(task.goal, task.steps);
      }
      await Storage.clearCurrentTask();
      currentTask = null;
      await enterDoneView({ bonus });
      await refreshResumeCard();
    } else {
      await persistCurrentTask();
      renderSteps();
    }
  }, 650);
});

$('#btn-skip').addEventListener('click', async () => {
  if (!currentTask) return;
  const task = currentTask;
  task.steps[task.currentIndex].skipped = true;
  stimer.stop();
  task.currentIndex += 1;
  if (task.currentIndex >= task.steps.length) {
    await persistCurrentTask();
    await Storage.pushHistory({ id: task.id, goal: task.goal, stepsCount: task.steps.length, completedAt: Date.now(), partial: true });
    await Storage.clearCurrentTask();
    currentTask = null;
    await enterDoneView({ partial: true });
    await refreshResumeCard();
    return;
  }
  await persistCurrentTask();
  renderSteps();
});

$('#btn-refine').addEventListener('click', async () => {
  if (!currentTask) return;
  const task = currentTask;
  const index = task.currentIndex;
  const stepItem = task.steps[index];
  const button = $('#btn-refine');
  const prevText = button.innerHTML;
  button.disabled = true;
  button.textContent = '🍃 拆解中…';
  try {
    const settings = await Storage.getSettings();
    const result = await refineStep(task.goal, stepItem, task.steps, settings);
    const subs = result.steps.map((item) => ({ ...item, done: false, skipped: false, _refined: true }));
    task.steps.splice(index, 1, ...subs);
    await persistCurrentTask();
    renderSteps();
    flash(`✨ 已把这一步再拆成 ${subs.length} 小步（${result.source === 'llm' ? 'LLM' : '本地'}）`);
  } catch (error) {
    flash(`细化失败：${error.message || error}`);
  } finally {
    button.disabled = false;
    button.innerHTML = prevText;
  }
});

$('#btn-privacy-cycle').addEventListener('click', async () => {
  if (!currentTask) return;
  currentTask.privacy = cyclePrivacy(currentTask.privacy || settingsCache?.team?.defaultPrivacy || PRIVACY.PUBLIC);
  await persistCurrentTask();
  updatePrivacyChip(currentTask);
  if (currentView === 'team') await renderTeam();
  flash(`当前任务隐私：${privacyLabel(currentTask.privacy)}`);
});

async function handleDiscardCurrent(button) {
  const taskId = button.dataset.taskId || currentTask?.id;
  if (!taskId) return;
  if (!requiresSecondClick(button)) return;
  resetDangerArming();
  await discardTaskById(taskId);
}

$('#btn-step-discard').addEventListener('click', async (event) => handleDiscardCurrent(event.currentTarget));
$('#btn-quit').addEventListener('click', async (event) => handleDiscardCurrent(event.currentTarget));
$('#btn-back-tasks').addEventListener('click', async () => {
  stimer.stop();
  await showHome();
});
$('#btn-new-task').addEventListener('click', async () => {
  $('#task-input').value = '';
  await showTaskInput();
});

$('#btn-feed').addEventListener('click', async () => {
  const result = await Pets.feed(1);
  if (!result.ok) {
    flash(result.reason);
    return;
  }
  triggerFeedAnimation();
  const state = await Pets.getState();
  const petName = petLabel(state, result.petId);
  if (getSettingsCached()?.stepTimer?.endSound !== false) playFeedJingle();
  await renderPet();
  flash(`+${result.delta} 经验 · 累计喂养 ${result.totalForPet} · 连续 ${result.streak} 天${result.leveledUp ? ` · Lv.${result.newLevel}` : ''} 🎉`, { big: result.leveledUp });
  if (PET_MILESTONES.includes(result.totalForPet)) {
    setTimeout(() => flash(`🎉 ${petName} ${result.totalForPet} 养料勋章解锁！`, { big: true, duration: 2400 }), 900);
  }
});

$('#pet-upload').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
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
  event.target.value = '';
});
$('#btn-upload-custom').addEventListener('click', () => $('#pet-upload').click());
$('#btn-toggle-cartoon').addEventListener('click', async () => {
  const state = await Pets.toggleCartoonize();
  flash(state.cartoonize ? '✨ 已开启卡通化' : '已关闭卡通化');
  renderPet();
});

$('#btn-cal-30').addEventListener('click', () => renderCalendar(30));
$('#btn-cal-90').addEventListener('click', () => renderCalendar(90));

$('#btn-account-save-name').addEventListener('click', async () => {
  await setDisplayName($('#account-display-name').value);
  await renderMyView();
  flash('昵称已保存');
});

$('#my-ai-rerank-enabled').addEventListener('change', async (event) => {
  settingsCache = await Storage.setSettings({ aiRerankEnabled: event.target.checked });
  await refreshLLMHint();
  await renderMyView();
  flash(event.target.checked ? '已启用免费 AI 精修' : '已关闭 AI 精修');
});

$('#btn-sync-toggle').addEventListener('click', async () => {
  if (!isSyncSupported()) {
    flash('当前环境不支持跨设备同步');
    return;
  }
  const next = !(await Storage.getSyncEnabled());
  await Storage.setSyncEnabled(next);
  await renderMyView();
  flash(next ? '已启用跨设备同步基础' : '已关闭跨设备同步');
});

$('#btn-export-backup').addEventListener('click', exportBackup);
$('#btn-import-backup').addEventListener('click', () => $('#backup-file-input').click());
$('#backup-file-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importBackup(file);
  } catch (error) {
    flash(`导入失败：${error.message || error}`, { big: true, duration: 2400 });
  } finally {
    event.target.value = '';
  }
});
$('#team-snapshot-file-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importTeamSnapshot(file);
  } catch (error) {
    flash(`队伍导入失败：${error.message || error}`, { big: true, duration: 2400 });
  } finally {
    event.target.value = '';
  }
});

$('#btn-regenerate-user-id').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const state = await Auth.getAuthState();
  if (state.mode && state.mode !== MODE.GUEST && Auth.getSession() === null) {
    resetDangerArming();
    flash('请先解锁账户再生成新用户 ID', { big: true });
    return;
  }
  if (!requiresSecondClick(button)) return;
  resetDangerArming();
  const result = await regenerateUserId();
  if (result && result.ok === false) {
    flash(result.message || '操作被拒绝', { big: true });
    return;
  }
  await renderMyView();
  flash('已生成新的用户 ID');
});

$('#btn-regenerate-user-id').dataset.confirmText = '再点一次确认生成';

$('#btn-stimer-start').addEventListener('click', () => stimer.start(getCurrentStepMinutes()));
$('#btn-stimer-pause').addEventListener('click', () => stimer.pause());
$('#btn-stimer-resume').addEventListener('click', () => stimer.resume());
$('#btn-stimer-add').addEventListener('click', () => stimer.addMinutes(1));
$('#btn-stimer-stop').addEventListener('click', () => stimer.stop());
renderStimer(0, stimer.snapshot());

// ---------------------------------------------------------------------------
// 登录 / 创建账号 弹窗
// ---------------------------------------------------------------------------
let modalMode = 'passphrase';
let ghAborted = false;
let ghCountdownTimer = null;

function setModalTab(tab) {
  const modal = $('#sign-in-modal');
  modal.dataset.tab = tab;
  $$('.modal-tab', modal).forEach((btn) => btn.classList.toggle('active', btn.dataset.modalTab === tab));
  $$('.modal-pane', modal).forEach((pane) => pane.classList.toggle('hidden', pane.dataset.pane !== tab));
}

function ensureOldPassField(show) {
  const pane = $('.modal-pane[data-pane="passphrase"]');
  let field = $('#pp-old-wrap');
  if (show) {
    if (!field) {
      field = document.createElement('div');
      field.id = 'pp-old-wrap';
      field.innerHTML = '<label class="modal-label">原密码</label><input id="pp-old" class="modal-input" type="password" placeholder="输入当前密码" />';
      pane.insertBefore(field, pane.firstChild);
    }
    field.classList.remove('hidden');
  } else if (field) {
    field.classList.add('hidden');
  }
}

function openSignInModal(tab = 'passphrase') {
  modalMode = tab === 'change' ? 'change' : 'setup';
  $('#pp-error').classList.add('hidden');
  $('#gh-error').classList.add('hidden');
  $('#gh-flow').classList.add('hidden');
  ['#pp-pass', '#pp-pass2', '#gh-client-id'].forEach((sel) => { const el = $(sel); if (el) el.value = ''; });
  updateStrengthMeter('');

  const paneTab = tab === 'change' ? 'passphrase' : tab;
  setModalTab(paneTab);

  const nameWrap = $('#pp-name');
  const nameLabel = nameWrap.previousElementSibling;
  if (tab === 'change') {
    $('#sign-in-title').textContent = '修改密码';
    nameWrap.classList.add('hidden');
    if (nameLabel) nameLabel.classList.add('hidden');
    ensureOldPassField(true);
    $('#btn-pp-submit').textContent = '🔑 更新密码';
  } else {
    $('#sign-in-title').textContent = '创建 / 登录账号';
    nameWrap.classList.remove('hidden');
    if (nameLabel) nameLabel.classList.remove('hidden');
    ensureOldPassField(false);
    $('#btn-pp-submit').textContent = '🔐 创建本地密码账号';
  }
  $('#sign-in-modal').classList.remove('hidden');
}

function closeSignInModal() {
  ghAborted = true;
  if (ghCountdownTimer) { clearInterval(ghCountdownTimer); ghCountdownTimer = null; }
  $('#sign-in-modal').classList.add('hidden');
}

function updateStrengthMeter(value) {
  const bar = $('#pp-strength-bar');
  const text = $('#pp-strength-text');
  if (!bar) return;
  if (!value) {
    bar.style.width = '0%';
    bar.className = 'strength-bar';
    text.textContent = '派生使用 PBKDF2 · 100000 次 · SHA-256；密码永不落盘。';
    return;
  }
  const result = Auth.evaluatePassphrase(value);
  const widthMap = { bad: '30%', mid: '65%', good: '100%' };
  bar.style.width = widthMap[result.level] || '30%';
  bar.className = `strength-bar strength-${result.level}`;
  text.textContent = result.ok
    ? (result.level === 'good' ? '强度：强 💪' : '强度：中等，建议再加长/加符号')
    : (result.reason || '强度：弱');
}

async function submitPassphrase() {
  const errBox = $('#pp-error');
  errBox.classList.add('hidden');
  const pass = $('#pp-pass').value;
  const pass2 = $('#pp-pass2').value;
  if (pass !== pass2) {
    errBox.textContent = '两次输入的密码不一致';
    errBox.classList.remove('hidden');
    return;
  }
  let result;
  if (modalMode === 'change') {
    const oldPass = $('#pp-old')?.value || '';
    result = await Auth.changePassphrase(oldPass, pass);
  } else {
    const name = $('#pp-name').value;
    result = await Auth.setupPassphrase(name, pass);
  }
  if (result && result.ok === false) {
    errBox.textContent = result.message || '操作失败';
    errBox.classList.remove('hidden');
    return;
  }
  closeSignInModal();
  flash(modalMode === 'change' ? '密码已更新 🔐' : '本地密码账号已创建 🎉');
  await renderMyView();
  await refreshUserBadge();
}

function renderTextQR(container, text) {
  // 纯文本降级：不引入任何付费/外部依赖，直接展示可点击链接
  container.textContent = '';
  const tip = document.createElement('div');
  tip.className = 'gh-qr-fallback';
  tip.textContent = '📱 手机可直接访问：' + text;
  container.appendChild(tip);
}

async function startGitHubFlow() {
  const errBox = $('#gh-error');
  errBox.classList.add('hidden');
  const clientId = $('#gh-client-id').value.trim();
  const begin = await Auth.beginGitHubDeviceFlow(clientId);
  if (begin.ok === false) {
    errBox.textContent = begin.message || '无法开始 GitHub 登录';
    errBox.classList.remove('hidden');
    return;
  }
  ghAborted = false;
  $('#gh-flow').classList.remove('hidden');
  $('#gh-user-code').textContent = begin.userCode;
  $('#gh-verify-link').href = begin.verificationUri;
  $('#gh-verify-link').textContent = begin.verificationUri.replace(/^https?:\/\//, '');
  renderTextQR($('#gh-qr'), begin.verificationUri);

  // 倒计时
  let remain = begin.expiresIn;
  $('#gh-status').firstChild && ($('#gh-status').childNodes[0].nodeValue = '等待授权中…');
  const countdownEl = $('#gh-countdown');
  if (ghCountdownTimer) clearInterval(ghCountdownTimer);
  ghCountdownTimer = setInterval(() => {
    remain -= 1;
    if (countdownEl) countdownEl.textContent = ` 剩余 ${Math.max(0, remain)}s`;
    if (remain <= 0) { clearInterval(ghCountdownTimer); ghCountdownTimer = null; }
  }, 1000);

  try {
    const state = await Auth.pollGitHubDeviceFlow({
      clientId,
      deviceCode: begin.deviceCode,
      interval: begin.interval,
      expiresIn: begin.expiresIn,
    });
    if (ghAborted) return;
    if (ghCountdownTimer) { clearInterval(ghCountdownTimer); ghCountdownTimer = null; }
    closeSignInModal();
    flash(`GitHub 登录成功：@${state.login} 🐙`);
    await renderMyView();
    await refreshUserBadge();
  } catch (error) {
    if (ghAborted) return;
    if (ghCountdownTimer) { clearInterval(ghCountdownTimer); ghCountdownTimer = null; }
    const msg = String(error?.message || error);
    errBox.textContent = msg.startsWith('EXPIRED') ? '设备码已过期，请重试'
      : msg.startsWith('ACCESS_DENIED') ? '你在 GitHub 上取消了授权'
      : msg.startsWith('NETWORK') || msg.startsWith('NOT_AVAILABLE') ? '网页试玩环境无法完成 GitHub 登录，请在安装扩展后使用'
      : `GitHub 登录失败：${msg}`;
    errBox.classList.remove('hidden');
  }
}

$('#btn-modal-close').addEventListener('click', closeSignInModal);
$('#sign-in-modal').addEventListener('click', (event) => {
  if (event.target === $('#sign-in-modal')) closeSignInModal();
});
$$('.modal-tab').forEach((btn) => btn.addEventListener('click', () => setModalTab(btn.dataset.modalTab)));
$('#pp-pass').addEventListener('input', (event) => updateStrengthMeter(event.target.value));
$('#btn-pp-submit').addEventListener('click', submitPassphrase);
$('#btn-gh-start').addEventListener('click', startGitHubFlow);
$('#btn-gh-copy').addEventListener('click', async () => {
  const code = $('#gh-user-code').textContent;
  try {
    await navigator.clipboard.writeText(code);
    flash('设备码已复制');
  } catch {
    flash('复制失败，请手动输入');
  }
});
$('#btn-account-lock').addEventListener('click', async () => {
  Auth.lockSession();
  flash('已锁定账户');
  await renderMyView();
});

(async function boot() {
  await ensureProfile();
  await primeSettingsCache();
  await refreshLLMHint();
  await refreshResumeCard();
  await refreshUserBadge();
  await updateTeamBellBadge();
  await ensureTeamSyncLoop();
  await syncTeamState({ force: true }).catch(() => {});
  await maybeToastUnreadPokes();
  const current = await Storage.getCurrentTask();
  const startView = urlParams.get('view');
  if (current && current.currentIndex < current.steps.length && urlParams.get('full') === '1' && !startView) {
    enterStepsView(current);
  } else if (startView === 'pet') {
    await enterPetView();
  } else if (startView === 'calendar') {
    await enterCalendarView();
  } else if (startView === 'team') {
    await enterTeamView();
  } else if (startView === 'my') {
    await enterMyView();
  } else if (startView === 'task') {
    await showTaskInput();
  } else {
    await showHome();
  }
})();
