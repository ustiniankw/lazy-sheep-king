// lib/team.js — v0.3.4: 组队模式 / 隐私模式 / 拍一拍
export const PRIVACY = {
  PUBLIC: 'public',
  TITLE_HIDDEN: 'title-hidden',
  FULL_PRIVATE: 'full-private',
};

const PRIVACY_ORDER = [PRIVACY.PUBLIC, PRIVACY.TITLE_HIDDEN, PRIVACY.FULL_PRIVATE];

function randomHex(bytes = 3) {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    return Array.from(cryptoApi.getRandomValues(new Uint8Array(bytes)))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }
  let output = '';
  for (let index = 0; index < bytes; index += 1) {
    output += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return output;
}

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computeStreak(dailyLog = {}, now = new Date()) {
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (true) {
    const key = todayKey(cursor);
    if ((dailyLog?.[key]?.steps || 0) <= 0) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function completedSteps(task) {
  if (!task || !Array.isArray(task.steps)) return 0;
  const counted = task.steps.filter((item) => item?.done || item?.skipped).length;
  return Math.max(counted, Number(task.currentIndex || 0));
}

function taskPercent(task) {
  const total = Math.max(1, task?.steps?.length || 0);
  return Math.round((completedSteps(task) / total) * 100);
}

export function normalizePrivacy(value, fallback = PRIVACY.PUBLIC) {
  return PRIVACY_ORDER.includes(value) ? value : fallback;
}

export function cyclePrivacy(value) {
  const current = normalizePrivacy(value, PRIVACY.PUBLIC);
  const index = PRIVACY_ORDER.indexOf(current);
  return PRIVACY_ORDER[(index + 1) % PRIVACY_ORDER.length];
}

export function newTeamCode() {
  return randomHex(3).toUpperCase();
}

export function buildActiveTaskView(activeTask, privacy = PRIVACY.PUBLIC) {
  if (!activeTask || !Array.isArray(activeTask.steps) || activeTask.steps.length === 0) {
    return {
      privacy: normalizePrivacy(privacy),
      title: '空闲中',
      progressText: '0/0',
      percent: 0,
      label: '空闲中',
      totalSteps: 0,
      doneSteps: 0,
    };
  }

  const resolvedPrivacy = normalizePrivacy(privacy);
  const totalSteps = activeTask.steps.length;
  const doneSteps = completedSteps(activeTask);
  const progressText = `${doneSteps}/${totalSteps}`;
  const percent = taskPercent(activeTask);

  if (resolvedPrivacy === PRIVACY.TITLE_HIDDEN) {
    return {
      privacy: resolvedPrivacy,
      title: '🔒 私密任务',
      progressText,
      percent,
      label: `🔒 私密任务 · ${progressText}`,
      totalSteps,
      doneSteps,
    };
  }

  if (resolvedPrivacy === PRIVACY.FULL_PRIVATE) {
    return {
      privacy: resolvedPrivacy,
      title: '🔒 完全私密',
      progressText: `${percent}%`,
      percent,
      label: `进度 ${percent}%`,
      totalSteps,
      doneSteps,
    };
  }

  return {
    privacy: resolvedPrivacy,
    title: String(activeTask.goal || activeTask.title || '当前任务').trim() || '当前任务',
    progressText,
    percent,
    label: `${String(activeTask.goal || activeTask.title || '当前任务').trim() || '当前任务'} · ${progressText}`,
    totalSteps,
    doneSteps,
  };
}

export function buildMyMemberSnapshot({ profile, stats, tasks, dailyLog, activeTask, privacy, provider }) {
  const log = dailyLog || stats?.dailyLog || {};
  const currentTask = activeTask || (Array.isArray(tasks) ? tasks.find((task) => (task?.currentIndex || 0) < (task?.steps?.length || 0)) : null) || null;
  const fallbackName = '懒羊羊伙伴';
  return {
    userId: String(profile?.userId || '').trim(),
    name: String(profile?.displayName || fallbackName).trim() || fallbackName,
    device: String(profile?.deviceLabel || 'Web').trim() || 'Web',
    provider: provider === 'github' ? 'github' : '',
    updatedAt: Date.now(),
    lastActiveAt: Number(stats?.lastActiveAt || Date.now()),
    todaySteps: Number(log?.[todayKey()]?.steps || 0),
    streak: computeStreak(log),
    activeTaskView: buildActiveTaskView(currentTask, privacy),
  };
}

function normalizeMember(member) {
  if (!member?.userId) return null;
  const activeTaskView = member.activeTaskView || buildActiveTaskView(null, PRIVACY.PUBLIC);
  return {
    userId: String(member.userId),
    name: String(member.name || '懒羊羊伙伴'),
    device: String(member.device || 'Web'),
    provider: member.provider === 'github' ? 'github' : '',
    updatedAt: Number(member.updatedAt || 0),
    lastActiveAt: Number(member.lastActiveAt || member.updatedAt || 0),
    todaySteps: Number(member.todaySteps || 0),
    streak: Number(member.streak || 0),
    activeTaskView: {
      privacy: normalizePrivacy(activeTaskView.privacy, PRIVACY.PUBLIC),
      title: String(activeTaskView.title || '空闲中'),
      progressText: String(activeTaskView.progressText || '0/0'),
      percent: Number(activeTaskView.percent || 0),
      label: String(activeTaskView.label || activeTaskView.title || '空闲中'),
      totalSteps: Number(activeTaskView.totalSteps || 0),
      doneSteps: Number(activeTaskView.doneSteps || 0),
    },
  };
}

function normalizePoke(poke) {
  if (!poke?.pokeId) return null;
  return {
    pokeId: String(poke.pokeId),
    from: String(poke.from || ''),
    to: String(poke.to || ''),
    message: String(poke.message || '继续冲呀！'),
    ts: Number(poke.ts || Date.now()),
    read: poke.read === true,
  };
}

export function mergeTeamState(local, incoming) {
  const base = {
    code: String(local?.code || incoming?.code || '').trim().toUpperCase(),
    members: {},
    pokes: [],
    updatedAt: Math.max(Number(local?.updatedAt || 0), Number(incoming?.updatedAt || 0)),
  };

  const memberIds = new Set([
    ...Object.keys(local?.members || {}),
    ...Object.keys(incoming?.members || {}),
  ]);

  memberIds.forEach((userId) => {
    const left = normalizeMember(local?.members?.[userId]);
    const right = normalizeMember(incoming?.members?.[userId]);
    if (!left && !right) return;
    if (!left) {
      base.members[userId] = right;
      return;
    }
    if (!right) {
      base.members[userId] = left;
      return;
    }
    base.members[userId] = Number(right.updatedAt || 0) >= Number(left.updatedAt || 0) ? right : left;
  });

  const pokeMap = new Map();
  [...(local?.pokes || []), ...(incoming?.pokes || [])].forEach((item) => {
    const poke = normalizePoke(item);
    if (!poke) return;
    const prev = pokeMap.get(poke.pokeId);
    if (!prev) {
      pokeMap.set(poke.pokeId, poke);
      return;
    }
    pokeMap.set(poke.pokeId, {
      ...prev,
      ...poke,
      read: prev.read || poke.read,
      ts: Math.max(Number(prev.ts || 0), Number(poke.ts || 0)),
    });
  });
  base.pokes = Array.from(pokeMap.values()).sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));

  return base;
}

export function makePoke({ from, to, message }) {
  return {
    pokeId: `poke_${Date.now().toString(36)}_${randomHex(4)}`,
    from: String(from || ''),
    to: String(to || ''),
    message: String(message || '继续冲呀！'),
    ts: Date.now(),
    read: false,
  };
}

export const _internal = {
  todayKey,
  computeStreak,
  completedSteps,
  taskPercent,
  buildActiveTaskView,
};
