// popup.js — v0.6.0: 认证瘦身 + 2C 化落地页 + 自动昵称/DiceBear 头像
import { Storage } from '../lib/storage.js';
import { breakdownTask, refineStep, rememberBreakdown, localBreakdown } from '../lib/breakdown.js';
import { celebrateStep, celebrateAll } from '../lib/celebrate.js';
import { createCountdown, fmt as fmtTimer, calcStepReward, calcTaskCompletionBonus } from '../lib/step_timer.js';
import { Pets, PET_TYPES, MOOD_META, computeMood, affinityProgress, todayFeedTotal } from '../lib/pets.js';
import { buildHeatmap, summarize } from '../lib/calendar.js';
import {
  ensureProfile,
  setDisplayName,
  regenerateUserId,
  getIdentity,
  rollNewNickname,
  rollNewAvatar,
  useUploadedAvatar,
  pickAvatarStyle,
} from '../lib/user.js';
import * as Auth from '../lib/auth.js';
import { MODE } from '../lib/auth.js';
import { PRIVACY, cyclePrivacy, newTeamCode, buildMyMemberSnapshot, mergeTeamState, makePoke } from '../lib/team.js';
import { detectAvailableTier, chromePromptApiAvailable } from '../lib/ai_rerank.js';
import { getWizardProviders, findProvider } from '../lib/providers.js';
import { chatComplete } from '../lib/llm_client.js';
import { computeBreakpoint } from '../lib/layout.js';
import { installSWUpdateWatcher } from '../lib/pwa_update.js';
import { AVATAR_STYLES, IDENTITY_STORE_KEY } from '../lib/identity.js';
import * as CryptoBackup from '../lib/crypto_backup.js';

const APP_VERSION = '0.7.0';
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

if (urlParams.get('full') === '1' || urlParams.get('pwa') === '1') document.body.classList.add('full', 'full-page');

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
  // Update sidebar + icon rail active state
  updateSidebarActive(tab || name);
  // iOS 风格：切换视图时把主内容滚到顶部
  const main = document.querySelector('.ios-main');
  if (main) main.scrollTop = 0;
}

function updateSidebarActive(navId) {
  // Map tab names to nav data
  const navMap = { home: 'home', task: 'task', pet: 'pet', calendar: 'calendar', team: 'team', my: 'my' };
  const activeNav = navMap[navId] || navId;
  $$('.ios-sidebar-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.nav === activeNav));
  $$('.ios-rail-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.nav === activeNav));
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
    ? 'Chrome AI（实验性）可用'
    : tier === 'user-api'
      ? `使用你的 ${escapeHtml(settings.llm?.providerId || 'API')} 配置`
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

// FIX 6：CTA 兜底——超过 8s 无响应就用本地结果，绝不让按钮永久转圈。
const CTA_MAX_WAIT_MS = 8000;
function ctaTimeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve({ __ctaTimeout: true }), ms));
}
function toggleBreakdownSkeleton(show) {
  const skeleton = $('#breakdown-skeleton');
  if (skeleton) skeleton.classList.toggle('hidden', !show);
}
function taskFromResult(goal, result, settings) {
  return {
    id: `task_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
    goal,
    steps: (result.steps || []).map((stepItem) => ({ ...stepItem, done: false, skipped: false })),
    currentIndex: 0,
    createdAt: Date.now(),
    source: result.source,
    privacy: settings?.team?.defaultPrivacy || PRIVACY.PUBLIC,
    meta: result.meta || null,
    warning: result.warning || null,
  };
}

async function doBreakdown(goal) {
  const btn = $('#btn-breakdown');
  const prevHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-emoji">🍃</span>拆解中…';
  toggleBreakdownSkeleton(true);
  let settings = {};
  try {
    settings = await Storage.getSettings().catch(() => ({}));
    // 主管线：breakdownTask 内部已含 6s AI 超时与本地兜底；此处再套 8s CTA 兜底。
    let result = await Promise.race([
      breakdownTask(goal, settings),
      ctaTimeout(CTA_MAX_WAIT_MS),
    ]);
    if (result && result.__ctaTimeout) {
      // 极端情况下主管线仍未返回：立即出本地结果，绝不卡住。
      result = await localBreakdown(goal);
      flash('AI 精修超时，已使用本地拆解结果', { big: true });
    }
    const task = taskFromResult(goal, result, settings);
    await Storage.setCurrentTask(task);
    enterPlanView(task);
  } catch (error) {
    // 兜底的兜底：仍然给出通用模板，绝不把异常暴露成"卡住"。
    try {
      const fallback = await localBreakdown(goal);
      const task = taskFromResult(goal, { ...fallback, warning: error?.message || String(error) }, settings);
      await Storage.setCurrentTask(task);
      enterPlanView(task);
      flash('拆解遇到异常，已使用通用模板 · 详情见诊断', { big: true });
    } catch (fatal) {
      flash(`拆解失败：${fatal.message || fatal}`);
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = prevHtml;
    toggleBreakdownSkeleton(false);
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
  const snapshot = buildMyMemberSnapshot({
    profile,
    stats,
    tasks,
    dailyLog: stats.dailyLog,
    activeTask,
    privacy: activeTask?.privacy || settings?.team?.defaultPrivacy || PRIVACY.PUBLIC,
    provider: '',
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
  await applyBackupPayload(payload);
}

async function applyBackupPayload(payload) {
  if (!payload || !payload.version) throw new Error('不是有效的备份文件');
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

  // 恢复 identity（昵称 / 头像），仅在非 userId 冲突时覆盖，避免串号
  if (!mismatch && payload.identity && typeof payload.identity === 'object') {
    try { await Storage.setGlobal(IDENTITY_STORE_KEY, payload.identity); } catch { /* ignore */ }
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

// ---------------------------------------------------------------------------
// v0.7.0 · 端到端加密备份（备份短语 + AES-GCM）
// 短语明文永不落盘：只在 modal 显示一次；storage 里仅存 mnemonicHash(SHA-256)。
// ---------------------------------------------------------------------------
const MNEMONIC_HASH_KEY = 'lsk_backup_mnemonic_hash_v1';
let pendingMnemonic = null;          // 生成后短暂驻留内存；用户勾选"已保存"后清除
let phraseModalSubmit = null;        // 短语输入弹窗的提交回调

async function getStoredMnemonicHash() {
  try {
    const v = await Storage.getGlobal(MNEMONIC_HASH_KEY);
    return typeof v === 'string' && v.length === 64 ? v : '';
  } catch {
    return '';
  }
}

async function hasBackupMnemonic() {
  return !!(await getStoredMnemonicHash());
}

function downloadTextFile(text, filename, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 收集全部本地数据（tasks / pets / stats / dailyLog / feedLog / team / settings / identity）
async function collectFullBackupData() {
  const profile = await ensureProfile();
  const identity = await getIdentity().catch(() => ({}));
  const backup = await Storage.getBackupData();
  const pets = await Pets.getState();
  const activeTaskId = await Storage.getActiveTaskId();
  return {
    version: APP_VERSION,
    exportedAt: Date.now(),
    userId: profile.userId,
    profile,
    identity,
    activeTaskId,
    ...backup, // settings / tasks / history / stats(含 dailyLog) / recentBreakdowns / teamSelf / teamState / syncEnabled
    pets,      // 含 feedLog
  };
}

function renderMnemonicModal(words) {
  const grid = $('#mnemonic-grid');
  grid.innerHTML = '';
  words.forEach((w) => {
    const li = document.createElement('li');
    li.textContent = w;
    grid.appendChild(li);
  });
  const check = $('#mnemonic-saved-check');
  const done = $('#btn-mnemonic-done');
  check.checked = false;
  done.disabled = true;
  $('#mnemonic-modal').classList.remove('hidden');
}

function closeMnemonicModal() {
  $('#mnemonic-modal').classList.add('hidden');
  $('#mnemonic-grid').innerHTML = '';
}

async function generateBackupMnemonic() {
  const existing = await hasBackupMnemonic();
  if (existing) {
    const proceed = typeof confirm === 'function'
      ? confirm('已有一套备份短语。重新生成后，用旧短语加密的备份将无法再导入。确定要换一套吗？')
      : true;
    if (!proceed) return;
  }
  pendingMnemonic = CryptoBackup.generateMnemonic(14);
  renderMnemonicModal(pendingMnemonic.split(' '));
}

// 打开短语输入弹窗（导入 / 导出复用）
function openPhraseModal({ title, label, onSubmit }) {
  $('#phrase-modal-title').textContent = title;
  $('#phrase-modal-label').textContent = label;
  $('#phrase-input').value = '';
  const err = $('#phrase-error');
  err.classList.add('hidden');
  err.textContent = '';
  phraseModalSubmit = onSubmit;
  $('#phrase-modal').classList.remove('hidden');
  setTimeout(() => $('#phrase-input').focus(), 50);
}

function closePhraseModal() {
  $('#phrase-modal').classList.add('hidden');
  phraseModalSubmit = null;
}

function showPhraseError(message) {
  const err = $('#phrase-error');
  err.textContent = message;
  err.classList.remove('hidden');
}

// 导出加密备份：要求输入短语并校验 hash 匹配后加密下载
async function exportEncryptedBackup() {
  const storedHash = await getStoredMnemonicHash();
  if (!storedHash) {
    flash('请先生成备份短语', { big: true });
    return;
  }
  openPhraseModal({
    title: '📤 导出加密备份',
    label: '输入你的 14 词备份短语以加密全部数据',
    onSubmit: async (phrase) => {
      if (!CryptoBackup.validateMnemonic(phrase)) {
        showPhraseError('短语格式不对：需要 14 个词，且都在词表内');
        return;
      }
      const inputHash = await CryptoBackup.mnemonicHash(phrase);
      if (inputHash !== storedHash) {
        showPhraseError('这句短语和你生成的那套不一致');
        return;
      }
      const data = await collectFullBackupData();
      const blob = await CryptoBackup.encryptWithMnemonic(data, phrase);
      const file = {
        app: 'lazy-sheep-king',
        format: 'lsk-e2e-backup',
        version: APP_VERSION,
        exportedAt: Date.now(),
        wordCount: 14,
        ...blob, // v / alg / iv / ct / salt
      };
      const datePart = new Date().toISOString().slice(0, 10);
      downloadTextFile(JSON.stringify(file, null, 2), `lazy-sheep-king-${datePart}.lsk-backup`, 'application/octet-stream');
      closePhraseModal();
      flash('已导出加密备份 🔐');
    },
  });
}

// 导入加密备份：读文件 → 输入短语 → 解密 → 应用
async function importEncryptedBackup(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('文件损坏或不是有效的加密备份');
  }
  if (!parsed || parsed.format !== 'lsk-e2e-backup' || !parsed.ct || !parsed.iv) {
    throw new Error('这不是懒羊羊大王的加密备份文件');
  }
  openPhraseModal({
    title: '📥 导入加密备份',
    label: '输入导出时用的 14 词备份短语以解密',
    onSubmit: async (phrase) => {
      if (!CryptoBackup.validateMnemonic(phrase)) {
        showPhraseError('短语格式不对：需要 14 个词，且都在词表内');
        return;
      }
      let payload;
      try {
        payload = await CryptoBackup.decryptWithMnemonic(parsed, phrase);
      } catch {
        showPhraseError('解密失败：短语不正确，或文件已损坏');
        return;
      }
      try {
        await applyBackupPayload(payload);
      } catch (error) {
        showPhraseError(`导入失败：${error.message || error}`);
        return;
      }
      closePhraseModal();
    },
  });
}

async function renderE2eBackupCard() {
  const has = await hasBackupMnemonic();
  const exportBtn = $('#btn-export-encrypted');
  const status = $('#e2e-backup-status');
  if (!exportBtn || !status) return;
  if (has) {
    exportBtn.classList.remove('hidden');
    status.textContent = '已生成备份短语 ✅ 现在可以导出/导入加密备份。短语请妥善保管，我们不保存明文。';
  } else {
    exportBtn.classList.add('hidden');
    status.textContent = '请先生成备份短语，再导出加密备份。短语只在本机、只显示一次，务必抄好——丢了就无法恢复。';
  }
}

function initialAvatar(name) {
  const ch = String(name || '懒').trim().charAt(0) || '懒';
  return ch.toUpperCase();
}

async function renderAccountCard() {
  const state = await Auth.getAuthState();
  const identity = await getIdentity();
  const profile = await ensureProfile();
  const nameInput = $('#account-display-name');
  const displayName = state.displayName || identity.nickname || profile.displayName || '懒羊羊伙伴';
  if (document.activeElement !== nameInput) nameInput.value = displayName;

  // 头像：自定义宠物 > identity 头像（DiceBear / 上传） > emoji 兜底
  const img = $('#account-avatar-img');
  const fallback = $('#account-avatar-fallback');
  const petState = await Pets.getState().catch(() => null);
  const customImg = petState?.customImage || '';
  const identityAvatar = identity.avatarUrl || '';
  if (customImg) {
    img.src = customImg; img.classList.remove('hidden'); fallback.classList.add('hidden');
  } else if (identityAvatar) {
    img.src = identityAvatar; img.classList.remove('hidden'); fallback.classList.add('hidden');
  } else {
    img.classList.add('hidden'); fallback.classList.remove('hidden');
    fallback.textContent = '🐑';
  }

  // 认证模式 chip
  const chip = $('#account-mode-chip');
  chip.className = 'mode-chip';
  const lockBtn = $('#btn-account-lock');
  lockBtn.classList.add('hidden');
  if (state.mode === MODE.PASSPHRASE) {
    chip.classList.add('mode-passphrase');
    chip.textContent = state.locked ? '🔐 本地密码（已锁定）' : '🔐 本地密码';
    $('#account-sub').textContent = state.locked
      ? '已锁定 · 解锁后可执行敏感操作'
      : `已挂本地密码 · 备份将自动加密`;
    if (!state.locked) lockBtn.classList.remove('hidden');
  } else {
    chip.classList.add('mode-guest');
    chip.textContent = '👤 匿名';
    $('#account-sub').textContent = '数据只保存在本机 · 想加密备份可点下面「挂本地密码」';
  }

  renderAccountActions(state);
  renderIdentityEditor(identity);
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
      hint.textContent = '本地密码已挂上，15 分钟无操作会自动锁定，用于加密备份。';
      const change = actionButton('🔑 修改密码');
      change.addEventListener('click', () => openSignInModal('change'));
      const lock = actionButton('🔓 锁定');
      lock.addEventListener('click', async () => { Auth.lockSession(); flash('已锁定'); await renderMyView(); });
      const out = actionButton('🚪 清除本地密码');
      out.addEventListener('click', signOutFlow);
      box.appendChild(change); box.appendChild(lock); box.appendChild(out);
    }
  } else {
    hint.textContent = '默认匿名即可用；如果想让备份文件自带 AES-GCM 加密，可以挂一个本地密码（只保存在本机）。';
    const pp = actionButton('🔐 挂一个本地密码', 'primary');
    pp.addEventListener('click', () => openSignInModal('passphrase'));
    box.appendChild(pp);
  }
}

function renderIdentityEditor(identity) {
  const previewImg = $('#avatar-editor-img');
  if (previewImg) previewImg.src = identity.avatarUrl || '';
  const styleRow = $('#avatar-style-row');
  if (styleRow) {
    const activeStyle = identity.avatarKind === 'upload' ? '' : identity.avatarStyle;
    styleRow.querySelectorAll('.avatar-style-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.avatarStyle === activeStyle);
      btn.disabled = false;
    });
  }
}

async function signOutFlow() {
  await Auth.signOut();
  flash('已退出账户，回到访客模式（本地数据保留）');
  await renderMyView();
  await refreshUserBadge();
}

// ---------------------------------------------------------------------------
// v0.5.1 · FIX 4：免费 AI 一键向导 + FIX 5：拆解诊断面板
// ---------------------------------------------------------------------------
let wizardRendered = false;

function renderFreeAiWizard() {
  const host = $('#free-ai-wizard');
  if (!host || wizardRendered) return;
  const providers = getWizardProviders();
  host.innerHTML = '';
  providers.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'wizard-card';
    card.dataset.provider = p.id;
    const steps = (p.wizardSteps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    card.innerHTML = `
      <div class="wizard-card-head">
        <span class="wizard-card-title">${escapeHtml(p.name)}</span>
        <span class="wizard-free-tag">免费</span>
      </div>
      <div class="my-card-sub">${escapeHtml(p.freeNote || '')}</div>
      <ol class="wizard-steps">${steps}</ol>
      <a class="wizard-getkey-link" href="${escapeHtml(p.docsUrl || '#')}" target="_blank" rel="noopener">👉 去拿 ${escapeHtml(p.name)} 的 key</a>
      <div class="wizard-form">
        <input type="password" class="wizard-key-input" placeholder="${escapeHtml(p.keyHint || '把 key 填在这里')}" data-provider="${p.id}" />
        <button class="ios-btn small ios-btn-primary wizard-save-btn" data-provider="${p.id}">保存并测试</button>
      </div>
      <div class="wizard-probe-result" data-provider="${p.id}"></div>
    `;
    host.appendChild(card);
  });
  host.querySelectorAll('.wizard-save-btn').forEach((btn) => {
    btn.addEventListener('click', () => saveAndProbeProvider(btn.dataset.provider));
  });
  wizardRendered = true;
}

async function saveAndProbeProvider(providerId) {
  const provider = findProvider(providerId);
  const input = $(`.wizard-key-input[data-provider="${providerId}"]`);
  const resultEl = $(`.wizard-probe-result[data-provider="${providerId}"]`);
  const btn = $(`.wizard-save-btn[data-provider="${providerId}"]`);
  const apiKey = (input?.value || '').trim();
  if (!apiKey) {
    resultEl.className = 'wizard-probe-result err';
    resultEl.textContent = '请先粘贴 API key';
    return;
  }
  btn.disabled = true;
  resultEl.className = 'wizard-probe-result';
  resultEl.textContent = '正在保存并发探针请求…';
  // 先保存配置：启用 AI 精修 + 用户 API 优先
  const settings = await Storage.getSettings().catch(() => ({}));
  const llm = {
    ...(settings.llm || {}),
    enabled: true,
    providerId,
    baseUrl: provider.baseUrl,
    apiKey,
    model: provider.defaultModel,
  };
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
    flash('免费 AI 已接入并测试通过 🎉', { big: true });
    await renderMyView();
  } catch (error) {
    resultEl.className = 'wizard-probe-result err';
    resultEl.textContent = `✗ 测试失败：${(error?.message || String(error)).slice(0, 160)}`;
  } finally {
    btn.disabled = false;
  }
}

async function renderDiagPanel(settings) {
  $('#diag-chrome-ai').textContent = chromePromptApiAvailable() ? '可用' : '不可用';
  $('#diag-ai-enabled').textContent = settings?.aiRerankEnabled === false ? '已关闭' : '已启用';
  const llm = settings?.llm || {};
  $('#diag-provider').textContent = (llm.enabled && llm.providerId) ? llm.providerId : '未配置';
  $('#diag-model').textContent = llm.model || '—';
  $('#diag-base').textContent = llm.baseUrl || '—';
  const log = await Storage.getDebugLog().catch(() => []);
  const list = $('#diag-log-list');
  list.innerHTML = '';
  const recent = log.slice(-5).reverse();
  if (!recent.length) {
    const li = document.createElement('li');
    li.className = 'diag-log-item';
    li.textContent = '暂无拆解记录，拆一个任务后再来看看。';
    list.appendChild(li);
  } else {
    recent.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'diag-log-item';
      const dot = entry.ok ? '<span class="ok-dot">●</span>' : '<span class="err-dot">●</span>';
      const t = new Date(entry.ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
      li.innerHTML = `${dot} ${escapeHtml(t)} · ${escapeHtml(String(entry.input || '').slice(0, 20))} · ${escapeHtml(entry.intent || '?')} · ${escapeHtml(entry.source || '?')} · ${escapeHtml(String(entry.tier || '?'))} · ${entry.latency || 0}ms${entry.error ? ' · ' + escapeHtml(String(entry.error).slice(0, 40)) : ''}`;
      list.appendChild(li);
    });
  }
}

async function updateAiNudge(settings, tier) {
  const nudge = $('#ai-nudge');
  if (!nudge) return;
  const hasUserApi = !!(settings?.llm?.enabled && settings?.llm?.apiKey);
  const aiOff = settings?.aiRerankEnabled === false;
  // 只有在完全没有可用 AI（未配置用户 API 且非 chrome-ai）时才提示
  const showNudge = !hasUserApi && tier !== 'chrome-ai' && !aiOff;
  nudge.classList.toggle('hidden', !showNudge);
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
    : tier === 'user-api'
      ? `优先使用你配置的 <b>${escapeHtml(settings.llm?.providerId || 'API')}</b> 做精修（推荐）。`
      : tier === 'chrome-ai'
        ? 'Chrome AI（实验性）：<b>可用</b>，本地推理不上传任务内容；建议同时接入免费 API 更稳定。'
        : '暂无可用 AI：会直接用本地兜底。👇 用下方「一键接入免费 AI」3 分钟接一个 Gemini / Groq / DeepSeek。';
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
  // v0.5.1：渲染免费 AI 向导 + 诊断面板 + 柔性引导
  renderFreeAiWizard();
  await renderDiagPanel(settings);
  await updateAiNudge(settings, tier);
  await renderE2eBackupCard();
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

// Open in Tab button
$('#btn-open-tab')?.addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome?.tabs && chrome?.runtime?.id) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?full=1') });
    window.close();
  } else {
    window.open(location.pathname + '?full=1', '_blank');
  }
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

$('#btn-account-reroll-name')?.addEventListener('click', async () => {
  const next = await rollNewNickname();
  $('#account-display-name').value = next.nickname;
  await setDisplayName(next.nickname);
  await renderMyView();
  flash('已换一个新昵称 🎲');
});

// v0.6.0 · 头像编辑器
$('#avatar-editor-preview')?.addEventListener('click', async () => {
  await rollNewAvatar();
  await renderMyView();
});
$('#avatar-editor-preview')?.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    await rollNewAvatar();
    await renderMyView();
  }
});
$$('.avatar-style-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const style = btn.dataset.avatarStyle;
    if (!AVATAR_STYLES.includes(style)) return;
    await pickAvatarStyle(style);
    await rollNewAvatar(style);
    await renderMyView();
  });
});
$('#btn-avatar-reroll')?.addEventListener('click', async () => {
  await rollNewAvatar();
  await renderMyView();
  flash('换了一个新头像 ✨');
});
$('#btn-avatar-upload')?.addEventListener('click', () => $('#avatar-upload-input')?.click());
$('#avatar-upload-input')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 512 * 1024) {
    flash('图片超过 512KB，试试小一点的');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await useUploadedAvatar(String(reader.result || ''));
      await renderMyView();
      flash('头像已更新 📸');
    } catch (error) {
      flash('上传失败：' + (error?.message || error));
    }
  };
  reader.readAsDataURL(file);
  event.target.value = '';
});

$('#my-ai-rerank-enabled').addEventListener('change', async (event) => {
  settingsCache = await Storage.setSettings({ aiRerankEnabled: event.target.checked });
  await refreshLLMHint();
  await renderMyView();
  flash(event.target.checked ? '已启用免费 AI 精修' : '已关闭 AI 精修');
});

// v0.5.1 · FIX 4.5：柔性引导点击 → 展开向导所在的「我的」并聚焦
$('#ai-nudge')?.addEventListener('click', () => {
  const wizard = $('#free-ai-wizard');
  if (wizard) wizard.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// v0.5.1 · FIX 5：诊断面板 复制 / 清空
$('#btn-diag-copy')?.addEventListener('click', async () => {
  const [settings, log] = await Promise.all([
    Storage.getSettings().catch(() => ({})),
    Storage.getDebugLog().catch(() => []),
  ]);
  const llm = settings?.llm || {};
  const payload = {
    app: '懒羊羊大王',
    version: APP_VERSION,
    ts: new Date().toISOString(),
    chromePromptApi: chromePromptApiAvailable(),
    aiRerankEnabled: settings?.aiRerankEnabled !== false,
    provider: (llm.enabled && llm.providerId) ? llm.providerId : null,
    model: llm.model || null,
    baseUrl: llm.baseUrl || null,
    recent: log.slice(-20),
  };
  const ok = await copyText(JSON.stringify(payload, null, 2));
  flash(ok ? '诊断信息已复制，可粘贴反馈 📋' : '复制失败，请手动截图');
});

$('#btn-diag-clear')?.addEventListener('click', async () => {
  await Storage.clearDebugLog().catch(() => {});
  const settings = await Storage.getSettings().catch(() => ({}));
  await renderDiagPanel(settings);
  flash('已清空诊断记录');
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

// v0.7.0 · 端到端加密备份交互
$('#btn-gen-mnemonic').addEventListener('click', () => { generateBackupMnemonic().catch((e) => flash(`生成失败：${e.message || e}`)); });
$('#btn-export-encrypted').addEventListener('click', () => { exportEncryptedBackup().catch((e) => flash(`导出失败：${e.message || e}`, { big: true })); });
$('#btn-import-encrypted').addEventListener('click', () => $('#e2e-import-file-input').click());
$('#e2e-import-file-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importEncryptedBackup(file);
  } catch (error) {
    flash(`导入失败：${error.message || error}`, { big: true, duration: 2400 });
  } finally {
    event.target.value = '';
  }
});

// 备份短语弹窗：复制 / 下载 / 勾选"已保存"后才能关闭
$('#btn-copy-mnemonic').addEventListener('click', async () => {
  if (!pendingMnemonic) return;
  const ok = await copyText(pendingMnemonic);
  flash(ok ? '已复制到剪贴板' : '复制失败，请手动抄写');
});
$('#btn-download-mnemonic').addEventListener('click', () => {
  if (!pendingMnemonic) return;
  const words = pendingMnemonic.split(' ');
  const numbered = words.map((w, i) => `${String(i + 1).padStart(2, '0')}. ${w}`).join('\n');
  const content = `懒羊羊大王 · 备份短语（请妥善保管，切勿泄露）\n生成时间：${new Date().toLocaleString()}\n\n${numbered}\n\n提示：导入加密备份时按顺序输入这 14 个词（空格分隔）即可。丢失后无法恢复。`;
  downloadTextFile(content, `lazy-sheep-king-recovery-phrase-${new Date().toISOString().slice(0, 10)}.txt`);
  flash('备份短语已下载');
});
$('#mnemonic-saved-check').addEventListener('change', (event) => {
  $('#btn-mnemonic-done').disabled = !event.target.checked;
});
$('#btn-mnemonic-done').addEventListener('click', async () => {
  if (!$('#mnemonic-saved-check').checked || !pendingMnemonic) return;
  try {
    const hash = await CryptoBackup.mnemonicHash(pendingMnemonic);
    await Storage.setGlobal(MNEMONIC_HASH_KEY, hash);
  } catch (error) {
    flash(`保存校验失败：${error.message || error}`);
    return;
  }
  pendingMnemonic = null; // 清除内存中的明文短语
  closeMnemonicModal();
  await renderE2eBackupCard();
  flash('备份短语已就绪，可以导出加密备份啦 🔐');
});

// 短语输入弹窗（导入 / 导出复用）
$('#btn-phrase-submit').addEventListener('click', async () => {
  const phrase = $('#phrase-input').value;
  if (typeof phraseModalSubmit === 'function') {
    try {
      await phraseModalSubmit(phrase);
    } catch (error) {
      showPhraseError(`操作失败：${error.message || error}`);
    }
  }
});
$('#btn-phrase-close').addEventListener('click', closePhraseModal);
$('#phrase-modal').addEventListener('click', (event) => {
  if (event.target === $('#phrase-modal')) closePhraseModal();
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
// 登录 / 创建账号 弹窗（v0.6.0 · 仅本地密码）
// ---------------------------------------------------------------------------
let modalMode = 'passphrase';

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
  ['#pp-pass', '#pp-pass2'].forEach((sel) => { const el = $(sel); if (el) el.value = ''; });
  updateStrengthMeter('');

  setModalTab('passphrase');

  const nameWrap = $('#pp-name');
  const nameLabel = nameWrap.previousElementSibling;
  if (tab === 'change') {
    $('#sign-in-title').textContent = '修改密码';
    nameWrap.classList.add('hidden');
    if (nameLabel) nameLabel.classList.add('hidden');
    ensureOldPassField(true);
    $('#btn-pp-submit').textContent = '🔑 更新密码';
  } else {
    $('#sign-in-title').textContent = '挂一个本地密码';
    nameWrap.classList.remove('hidden');
    if (nameLabel) nameLabel.classList.remove('hidden');
    ensureOldPassField(false);
    $('#btn-pp-submit').textContent = '🔐 挂本地密码';
  }
  $('#sign-in-modal').classList.remove('hidden');
}

function closeSignInModal() {
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
  flash(modalMode === 'change' ? '密码已更新 🔐' : '本地密码已挂上 🎉');
  await renderMyView();
  await refreshUserBadge();
}

$('#btn-modal-close').addEventListener('click', closeSignInModal);
$('#sign-in-modal').addEventListener('click', (event) => {
  if (event.target === $('#sign-in-modal')) closeSignInModal();
});
$$('.modal-tab').forEach((btn) => btn.addEventListener('click', () => setModalTab(btn.dataset.modalTab)));
$('#pp-pass').addEventListener('input', (event) => updateStrengthMeter(event.target.value));
$('#btn-pp-submit').addEventListener('click', submitPassphrase);
$('#btn-account-lock').addEventListener('click', async () => {
  Auth.lockSession();
  flash('已锁定账户');
  await renderMyView();
});

// ---------------------------------------------------------------------------
// v0.5.0 · Sidebar + Icon Rail navigation
// ---------------------------------------------------------------------------
function handleNavClick(navId) {
  if (navId === 'home') showHome();
  else if (navId === 'task') showTaskInput();
  else if (navId === 'pet') enterPetView();
  else if (navId === 'calendar') enterCalendarView();
  else if (navId === 'team') enterTeamView();
  else if (navId === 'my') enterMyView();
}
$$('.ios-sidebar-item').forEach((btn) => {
  btn.addEventListener('click', () => handleNavClick(btn.dataset.nav));
});
$$('.ios-rail-item').forEach((btn) => {
  btn.addEventListener('click', () => handleNavClick(btn.dataset.nav));
});

// ---------------------------------------------------------------------------
// v0.5.0 · Desktop mode setting
// ---------------------------------------------------------------------------
function applyDesktopMode(mode) {
  document.body.classList.remove('desktop-mode-3pane', 'desktop-mode-centered');
  if (mode === 'centered') document.body.classList.add('desktop-mode-centered');
  else document.body.classList.add('desktop-mode-3pane');
  $$('#desktop-mode-segmented .seg-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
}

$('#desktop-mode-segmented')?.addEventListener('click', async (event) => {
  const btn = event.target.closest('.seg-btn');
  if (!btn) return;
  const mode = btn.dataset.mode;
  settingsCache = await Storage.setSettings({ desktopMode: mode });
  applyDesktopMode(mode);
  flash(mode === 'centered' ? '已切换为单列极简' : '已切换为三栏');
});

// ---------------------------------------------------------------------------
// v0.5.0 · Open-in setting (popup vs tab)
// ---------------------------------------------------------------------------
$('#open-in-segmented')?.addEventListener('click', async (event) => {
  const btn = event.target.closest('.seg-btn');
  if (!btn) return;
  const openIn = btn.dataset.openin;
  settingsCache = await Storage.setSettings({ defaultOpenIn: openIn });
  $$('#open-in-segmented .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.openin === openIn));
  flash(openIn === 'tab' ? '默认在新标签页打开' : '默认弹窗打开');
});

// ---------------------------------------------------------------------------
// v0.5.0 · Open-in-Tab visibility
// ---------------------------------------------------------------------------
function updateOpenTabButton() {
  const btn = $('#btn-open-tab');
  if (!btn) return;
  const isFull = urlParams.get('full') === '1' || urlParams.get('pwa') === '1';
  btn.classList.toggle('hidden', isFull);
}

// ---------------------------------------------------------------------------
// v0.5.0 · PWA
// ---------------------------------------------------------------------------
let deferredPrompt = null;

if ('serviceWorker' in navigator && !('chrome' in window && chrome.runtime?.id)) {
  navigator.serviceWorker.register('../service-worker.js').catch(() => {});
  installSWUpdateWatcher({
    onReload: () => { try { location.reload(); } catch {} },
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  const btn = $('#btn-pwa-install');
  if (btn) btn.classList.remove('hidden');
});

$('#btn-pwa-install')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  if (result.outcome === 'accepted') flash('已安装为 App 🎉');
  deferredPrompt = null;
  $('#btn-pwa-install')?.classList.add('hidden');
});

function maybeShowIOSInstallHint() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!isIOS || isStandalone) return;
  if (localStorage.getItem('pwa_install_hint_dismissed')) return;
  const hint = document.createElement('div');
  hint.className = 'pwa-ios-hint';
  hint.innerHTML = '<p>📲 将「懒羊羊大王」添加到主屏幕：<br/>点击底部 <b>分享按钮 ⎙</b> → <b>添加到主屏幕</b></p><button class="ios-btn ios-btn-primary small" id="ios-hint-dismiss">知道了</button>';
  document.body.appendChild(hint);
  hint.querySelector('#ios-hint-dismiss').addEventListener('click', () => {
    localStorage.setItem('pwa_install_hint_dismissed', '1');
    hint.remove();
  });
}

function updateOnlineStatus() {
  const chip = $('#offline-chip');
  if (chip) chip.classList.toggle('hidden', navigator.onLine !== false);
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ---------------------------------------------------------------------------
// v0.5.0 · Right panel data refresh
// ---------------------------------------------------------------------------
async function refreshRightPanel() {
  const stats = await Storage.getStats();
  const today = stats.dailyLog?.[todayDateKey()] || { steps: 0, food: 0 };
  const petState = await Pets.getState().catch(() => null);
  const avatarEl = $('#right-pet-avatar');
  if (avatarEl) avatarEl.textContent = '🐑';
  const nameEl = $('#right-pet-name');
  if (nameEl) nameEl.textContent = petState?.activeId ? (Pets.petTypeById(petState.activeId)?.name || '懒羊羊') : '懒羊羊';
  const lvEl = $('#right-pet-level');
  if (lvEl) lvEl.textContent = `Lv.${stats.petLevel || 1}`;
  const stepsEl = $('#right-today-steps'); if (stepsEl) stepsEl.textContent = String(today.steps || 0);
  const foodEl = $('#right-today-food'); if (foodEl) foodEl.textContent = String(today.food || 0);
  const dailyLog = stats.dailyLog || {};
  let streak = 0;
  const day = new Date();
  for (let i = 0; i < 400; i++) {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const v = dailyLog[key];
    if (v && v.steps > 0) { streak++; day.setDate(day.getDate() - 1); }
    else { if (i === 0) { day.setDate(day.getDate() - 1); continue; } break; }
  }
  const streakEl = $('#right-streak'); if (streakEl) streakEl.textContent = String(streak);
  const strip = $('#right-heatmap-strip');
  if (strip) {
    const cells = buildHeatmap(dailyLog, 14);
    strip.innerHTML = cells.map((c) => `<div class="cal-cell" data-level="${c.level}" title="${c.date}: ${c.steps} 步"></div>`).join('');
  }
}

(async function boot() {
  await ensureProfile();
  await primeSettingsCache();

  // v0.5.0 · Apply desktop mode + open-tab visibility + auto-redirect
  const desktopMode = settingsCache?.desktopMode || '3pane';
  applyDesktopMode(desktopMode);
  updateOpenTabButton();
  updateOnlineStatus();
  maybeShowIOSInstallHint();

  // Auto-redirect to tab if defaultOpenIn === 'tab' and we're in extension popup
  const isExtPopup = typeof chrome !== 'undefined' && chrome?.runtime?.id && window.location.protocol === 'chrome-extension:';
  if (isExtPopup && settingsCache?.defaultOpenIn === 'tab' && urlParams.get('full') !== '1') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?full=1') });
    window.close();
    return;
  }

  // Update open-in segmented control UI
  const openIn = settingsCache?.defaultOpenIn || 'popup';
  $$('#open-in-segmented .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.openin === openIn));

  await refreshLLMHint();
  await refreshResumeCard();
  await refreshUserBadge();
  await updateTeamBellBadge();
  await ensureTeamSyncLoop();
  await syncTeamState({ force: true }).catch(() => {});
  await maybeToastUnreadPokes();
  await refreshRightPanel();
  const current = await Storage.getCurrentTask();
  const startView = urlParams.get('view');
  if (current && current.currentIndex < current.steps.length && (urlParams.get('full') === '1' || urlParams.get('pwa') === '1') && !startView) {
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
