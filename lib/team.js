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

// ---------------------------------------------------------------------------
// v0.8.2 · 组队真云端接线
//   - deriveMemberId：从设备种子（deviceId || uuid）稳定派生 memberId，
//     保证同一设备重进队伍不会重复注册。
//   - resolveTeamBackend：Worker 可用 → 'cloud'，否则回退 'local' 本地 mock。
//   - LocalTeamMock：与 sync_client 语义对齐的本地兜底实现（离线可用，单机可见）。
//   - makeTeamFacade：统一门面，按 mode 分发到 sync_client 或本地 mock。
//   - parseJoinCode：解析 URL query 中的 ?join=XXX 队伍码。
// ---------------------------------------------------------------------------

/** 从任意种子稳定派生 6+ 位 memberId（FNV-1a 32bit，无依赖、纯函数）。 */
export function deriveMemberId(seed) {
  const s = String(seed || '') || `${Date.now()}_${Math.random()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return `m_${hex}`;
}

/** Worker 健康时走云端，否则回退本地 mock。 */
export function resolveTeamBackend({ backendUrl, healthy } = {}) {
  const url = String(backendUrl || '').trim();
  return url && healthy ? 'cloud' : 'local';
}

/** 解析 URL（或 query 字符串）里的 ?join=XXX，返回规范化 6 位队伍码或 ''。 */
export function parseJoinCode(input) {
  let search = String(input || '');
  const qIdx = search.indexOf('?');
  if (qIdx >= 0) search = search.slice(qIdx + 1);
  let raw = '';
  try {
    raw = new URLSearchParams(search).get('join') || '';
  } catch {
    const m = /(?:^|&)join=([^&]*)/.exec(search);
    raw = m ? decodeURIComponent(m[1]) : '';
  }
  const code = raw.trim().toUpperCase();
  return /^[0-9A-Z]{6}$/.test(code) ? code : '';
}

export function normalizeTeamIdentity(identity = {}, profile = {}) {
  const nickname = String(identity?.nickname || profile?.displayName || '懒羊羊伙伴').trim() || '懒羊羊伙伴';
  return {
    nickname,
    avatarUrl: identity?.avatarUrl ? String(identity.avatarUrl) : '',
    avatarSeed: identity?.avatarSeed ? String(identity.avatarSeed) : '',
    avatarKind: identity?.avatarKind ? String(identity.avatarKind) : '',
  };
}

export function buildTeamCreatePayload({ identity, profile, memberId, pubKey } = {}) {
  const local = normalizeTeamIdentity(identity, profile);
  return {
    founder: {
      memberId: String(memberId || ''),
      nickname: local.nickname,
      avatarUrl: local.avatarUrl,
      avatarSeed: local.avatarSeed,
      avatarKind: local.avatarKind,
      ...(pubKey ? { pubKey } : {}),
    },
  };
}

export function buildTeamJoinPayload({ identity, profile, memberId, pubKey } = {}) {
  const local = normalizeTeamIdentity(identity, profile);
  return {
    member: {
      memberId: String(memberId || ''),
      nickname: local.nickname,
      avatarUrl: local.avatarUrl,
      avatarSeed: local.avatarSeed,
      avatarKind: local.avatarKind,
      ...(pubKey ? { pubKey } : {}),
    },
  };
}

export function isSelfTeamMember(member, { selfId, persistedMemberId } = {}) {
  const id = String(member?.memberId || '');
  return !!id && (id === String(selfId || '') || id === String(persistedMemberId || ''));
}

export function buildTeamMemberCardVM(member, { selfId, persistedMemberId, localIdentity } = {}) {
  const snap = member?.snapshot || {};
  const percent = Math.max(0, Math.min(100, Number(snap.progress || 0)));
  const title = snap.activeTaskTitle ? String(snap.activeTaskTitle) : '';
  let label = '空闲中';
  if (title) label = `${title} · ${percent}%`;
  else if (percent > 0) label = `进度 ${percent}%`;
  const self = isSelfTeamMember(member, { selfId, persistedMemberId });
  const local = self ? normalizeTeamIdentity(localIdentity) : null;
  return {
    memberId: String(member?.memberId || ''),
    name: self ? local.nickname : String(member?.nickname || '懒羊羊伙伴'),
    avatarUrl: self ? local.avatarUrl : String(member?.avatarUrl || ''),
    avatarSeed: self ? local.avatarSeed : String(member?.avatarSeed || ''),
    avatarKind: self ? local.avatarKind : String(member?.avatarKind || ''),
    isSelf: self,
    label,
    mood: snap.mood ? String(snap.mood) : '',
    lastSeenAt: Number(member?.lastSeenAt || member?.joinedAt || 0),
  };
}

function mockMember({ memberId, nickname, avatarSeed, avatarUrl, avatarKind }) {
  const ts = Date.now();
  return {
    memberId: String(memberId),
    nickname: String(nickname || '懒羊羊伙伴'),
    avatarSeed: avatarSeed ? String(avatarSeed) : '',
    avatarUrl: avatarUrl ? String(avatarUrl) : '',
    avatarKind: avatarKind ? String(avatarKind) : '',
    joinedAt: ts,
    lastSeenAt: ts,
    snapshot: null,
  };
}

/**
 * 本地兜底队伍实现，返回结构与 Worker(sync_client) 对齐：
 *   createTeam → { ok, code, token, memberId }
 *   joinTeam   → { ok, code, token, teamSnapshot }
 *   getTeam    → { ok, team }
 *   heartbeat  → { ok, team }
 *   poke       → { ok, poke, team }
 *   leaveTeam  → { ok, team }
 * store 为 Map-like（get/set/delete），默认使用内存 Map（仅本机、单会话可见）。
 */
export class LocalTeamMock {
  constructor(store = new Map()) {
    this.store = store;
  }

  _get(code) {
    return this.store.get(String(code || '').toUpperCase()) || null;
  }

  _save(team) {
    this.store.set(String(team.code).toUpperCase(), team);
    return team;
  }

  async createTeam({ founder } = {}) {
    const f = founder || {};
    const code = newTeamCode();
    const memberId = String(f.memberId || deriveMemberId());
    const team = {
      code,
      createdAt: Date.now(),
      founderMemberId: memberId,
      members: [mockMember({ memberId, nickname: f.nickname, avatarSeed: f.avatarSeed, avatarUrl: f.avatarUrl, avatarKind: f.avatarKind })],
      recentPokes: [],
      version: 1,
      local: true,
    };
    this._save(team);
    return { ok: true, code, token: `local_${code}_${memberId}`, memberId };
  }

  async joinTeam({ code, member } = {}) {
    const c = String(code || '').trim().toUpperCase();
    const m = member || {};
    const memberId = String(m.memberId || deriveMemberId());
    let team = this._get(c);
    if (!team) {
      // 本地兜底：加入不存在的队伍时直接建一支本机队伍，保证离线也能用。
      team = { code: c, createdAt: Date.now(), founderMemberId: memberId, members: [], recentPokes: [], version: 1, local: true };
    }
    const idx = team.members.findIndex((x) => x.memberId === memberId);
    if (idx >= 0) {
      team.members[idx] = {
        ...team.members[idx],
        nickname: String(m.nickname || team.members[idx].nickname),
        avatarSeed: m.avatarSeed ? String(m.avatarSeed) : team.members[idx].avatarSeed,
        avatarUrl: m.avatarUrl ? String(m.avatarUrl) : team.members[idx].avatarUrl,
        avatarKind: m.avatarKind ? String(m.avatarKind) : team.members[idx].avatarKind,
        lastSeenAt: Date.now(),
      };
    } else {
      team.members.push(mockMember({ memberId, nickname: m.nickname, avatarSeed: m.avatarSeed, avatarUrl: m.avatarUrl, avatarKind: m.avatarKind }));
    }
    team.version = Number(team.version || 1) + 1;
    this._save(team);
    return { ok: true, code: c, token: `local_${c}_${memberId}`, teamSnapshot: team };
  }

  async getTeam({ code } = {}) {
    const team = this._get(code);
    if (!team) return { ok: false, error: 'not_found', team: null };
    return { ok: true, team };
  }

  async heartbeat({ code, memberId, snapshot, nickname, avatarSeed, avatarUrl, avatarKind } = {}) {
    const team = this._get(code);
    if (!team) return { ok: false, error: 'not_found', team: null };
    const idx = team.members.findIndex((x) => x.memberId === String(memberId));
    if (idx >= 0) {
      team.members[idx].snapshot = snapshot || null;
      if (nickname) team.members[idx].nickname = String(nickname);
      if (avatarSeed) team.members[idx].avatarSeed = String(avatarSeed);
      if (avatarUrl) team.members[idx].avatarUrl = String(avatarUrl);
      if (avatarKind) team.members[idx].avatarKind = String(avatarKind);
      team.members[idx].lastSeenAt = Date.now();
      team.version = Number(team.version || 1) + 1;
      this._save(team);
    }
    return { ok: true, team };
  }

  async poke({ code, from, to, emoji } = {}) {
    const team = this._get(code);
    if (!team) return { ok: false, error: 'not_found', team: null };
    const poke = {
      pokeId: `poke_${Date.now().toString(36)}_${randomHex(4)}`,
      fromMemberId: String(from || ''),
      toMemberId: String(to || ''),
      emoji: String(emoji || '👊'),
      ts: Date.now(),
    };
    team.recentPokes = [poke, ...(Array.isArray(team.recentPokes) ? team.recentPokes : [])].slice(0, 20);
    team.version = Number(team.version || 1) + 1;
    this._save(team);
    return { ok: true, poke, team };
  }

  async leaveTeam({ code, memberId } = {}) {
    const team = this._get(code);
    if (!team) return { ok: false, error: 'not_found', team: null };
    team.members = team.members.filter((x) => x.memberId !== String(memberId));
    team.version = Number(team.version || 1) + 1;
    this._save(team);
    return { ok: true, team };
  }
}

/**
 * 统一门面：mode==='cloud' 时把调用透传给 syncClient（自动带 backendUrl），
 * 否则走 localMock。返回对象包含 `.mode`，方便 UI 决定徽标状态。
 */
export function makeTeamFacade({ mode, syncClient, backendUrl, localMock } = {}) {
  if (mode === 'cloud') {
    if (!syncClient) throw new Error('makeTeamFacade: cloud 模式缺少 syncClient');
    return {
      mode: 'cloud',
      createTeam: (opts = {}) => syncClient.createTeam({ backendUrl, ...opts }),
      joinTeam: (opts = {}) => syncClient.joinTeam({ backendUrl, ...opts }),
      getTeam: (opts = {}) => syncClient.getTeam({ backendUrl, ...opts }),
      heartbeat: (opts = {}) => syncClient.heartbeat({ backendUrl, ...opts }),
      poke: (opts = {}) => syncClient.poke({ backendUrl, ...opts }),
      leaveTeam: (opts = {}) => syncClient.leaveTeam({ backendUrl, ...opts }),
    };
  }
  const m = localMock || new LocalTeamMock();
  return {
    mode: 'local',
    createTeam: (opts = {}) => m.createTeam(opts),
    joinTeam: (opts = {}) => m.joinTeam(opts),
    getTeam: (opts = {}) => m.getTeam(opts),
    heartbeat: (opts = {}) => m.heartbeat(opts),
    poke: (opts = {}) => m.poke(opts),
    leaveTeam: (opts = {}) => m.leaveTeam(opts),
  };
}

export const _internal = {
  todayKey,
  computeStreak,
  completedSteps,
  taskPercent,
  buildActiveTaskView,
};
