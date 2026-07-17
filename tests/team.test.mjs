// tests/team.test.mjs — v0.3.4 组队模式 / 隐私模式 / 存储迁移
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.chrome = undefined;

const { Storage } = await import('../lib/storage.js');
const { PRIVACY, newTeamCode, buildMyMemberSnapshot, mergeTeamState, makePoke, deriveMemberId, resolveTeamBackend, parseJoinCode, LocalTeamMock, makeTeamFacade } = await import('../lib/team.js');

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  ✓', name);
    pass += 1;
  } catch (error) {
    console.error('  ✗', name, '\n    ', error.message);
    fail += 1;
  }
}
function eq(actual, expected, message = '') {
  if (actual !== expected) throw new Error(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function task(goal = '写周报', total = 5, done = 2) {
  return {
    id: 'task_demo',
    goal,
    currentIndex: done,
    steps: Array.from({ length: total }, (_, index) => ({ title: `step ${index}`, done: index < done, skipped: false })),
  };
}

console.log('team.js · code / snapshot / merge');

await t('newTeamCode 长度为 6', async () => {
  eq(newTeamCode().length, 6);
});

await t('newTeamCode 为大写十六进制', async () => {
  ok(/^[0-9A-F]{6}$/.test(newTeamCode()), '格式应为 6 位大写十六进制');
});

await t('连续生成多个 team code 基本不重复', async () => {
  const set = new Set(Array.from({ length: 20 }, () => newTeamCode()));
  eq(set.size, 20);
});

await t('public 隐私会显示真实标题', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: { '2099-01-01': { steps: 3 } } },
    dailyLog: {},
    activeTask: task('准备评审会', 5, 2),
    privacy: PRIVACY.PUBLIC,
  });
  eq(snapshot.activeTaskView.title, '准备评审会');
});

await t('public 隐私保留进度文本', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 2),
    privacy: PRIVACY.PUBLIC,
  });
  eq(snapshot.activeTaskView.progressText, '2/5');
});

await t('title-hidden 会隐藏真实标题', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.TITLE_HIDDEN,
  });
  eq(snapshot.activeTaskView.title, '🔒 私密任务');
});

await t('title-hidden 仍保留步数进度', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.TITLE_HIDDEN,
  });
  eq(snapshot.activeTaskView.label, '🔒 私密任务 · 3/5');
});

await t('full-private 会完全隐藏标题', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.FULL_PRIVATE,
  });
  eq(snapshot.activeTaskView.title, '🔒 完全私密');
});

await t('full-private 只暴露百分比', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.FULL_PRIVATE,
  });
  eq(snapshot.activeTaskView.progressText, '60%');
});

await t('full-private label 不泄漏原标题', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.FULL_PRIVATE,
  });
  ok(!snapshot.activeTaskView.label.includes('准备评审会'), '不应泄漏原标题');
});

await t('mergeTeamState 成员按 updatedAt 取新', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: { u1: { userId: 'u1', name: '旧', updatedAt: 10 } }, pokes: [], updatedAt: 10 },
    { code: 'ABC123', members: { u1: { userId: 'u1', name: '新', updatedAt: 20 } }, pokes: [], updatedAt: 20 },
  );
  eq(merged.members.u1.name, '新');
});

await t('mergeTeamState 较旧成员不会覆盖较新成员', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: { u1: { userId: 'u1', name: '新', updatedAt: 30 } }, pokes: [], updatedAt: 30 },
    { code: 'ABC123', members: { u1: { userId: 'u1', name: '旧', updatedAt: 20 } }, pokes: [], updatedAt: 20 },
  );
  eq(merged.members.u1.name, '新');
});

await t('mergeTeamState 会把不同成员都保留下来', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: { u1: { userId: 'u1', name: 'A', updatedAt: 10 } }, pokes: [], updatedAt: 10 },
    { code: 'ABC123', members: { u2: { userId: 'u2', name: 'B', updatedAt: 20 } }, pokes: [], updatedAt: 20 },
  );
  eq(Object.keys(merged.members).length, 2);
});

await t('mergeTeamState 会按 pokeId 去重', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: {}, pokes: [{ pokeId: 'p1', from: 'a', to: 'b', ts: 1, read: false }], updatedAt: 1 },
    { code: 'ABC123', members: {}, pokes: [{ pokeId: 'p1', from: 'a', to: 'b', ts: 2, read: false }], updatedAt: 2 },
  );
  eq(merged.pokes.length, 1);
});

await t('mergeTeamState 去重时会保留已读状态', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: {}, pokes: [{ pokeId: 'p1', from: 'a', to: 'b', ts: 1, read: true }], updatedAt: 1 },
    { code: 'ABC123', members: {}, pokes: [{ pokeId: 'p1', from: 'a', to: 'b', ts: 2, read: false }], updatedAt: 2 },
  );
  eq(merged.pokes[0].read, true);
});

await t('makePoke 会生成唯一 id', async () => {
  const a = makePoke({ from: 'u1', to: 'u2', message: '冲呀' });
  const b = makePoke({ from: 'u1', to: 'u2', message: '冲呀' });
  ok(a.pokeId !== b.pokeId, 'pokeId 应唯一');
});

await t('makePoke 默认 read=false', async () => {
  eq(makePoke({ from: 'u1', to: 'u2', message: '冲呀' }).read, false);
});

console.log('Storage · team keys / privacy migration');

await t('旧任务缺失 privacy 时会按 settings.team.defaultPrivacy 自动补齐', async () => {
  await Storage.resetAllLocalData();
  await Storage.setSettings({ team: { defaultPrivacy: PRIVACY.TITLE_HIDDEN } });
  mem.set(Storage.KEYS.TASKS, JSON.stringify([{ id: 'legacy', goal: '旧任务', currentIndex: 0, steps: [{ title: 'a', done: false, skipped: false }] }]));
  const tasks = await Storage.getTasks();
  eq(tasks[0].privacy, PRIVACY.TITLE_HIDDEN);
});

await t('setTasks 会保留显式设置的 privacy', async () => {
  await Storage.setTasks([{ id: 't1', goal: '任务', privacy: PRIVACY.FULL_PRIVATE, currentIndex: 0, steps: [{ title: 'a', done: false, skipped: false }] }]);
  const tasks = await Storage.getTasks();
  eq(tasks[0].privacy, PRIVACY.FULL_PRIVATE);
});

await t('teamSelf / teamState helper 可读写', async () => {
  await Storage.setTeamSelf({ teamCode: 'A1B2C3', joinedAt: 123, syncUrl: 'https://example.com/team.json' });
  await Storage.setTeamState({ code: 'A1B2C3', members: { u1: { userId: 'u1', name: '小羊', updatedAt: 1 } }, pokes: [], updatedAt: 1 });
  const teamSelf = await Storage.getTeamSelf();
  const teamState = await Storage.getTeamState();
  eq(teamSelf.teamCode, 'A1B2C3');
  eq(teamState.code, 'A1B2C3');
});

await t('pushPokes 会把新 poke 合并进 teamState', async () => {
  await Storage.setTeamState({ code: 'A1B2C3', members: {}, pokes: [], updatedAt: 1 });
  await Storage.pushPokes({ pokeId: 'px', from: 'u1', to: 'u2', ts: 1, read: false });
  const teamState = await Storage.getTeamState();
  eq(teamState.pokes.length, 1);
});

console.log('team.js · v0.8.2 云端接线');

await t('deriveMemberId 对同一 seed 稳定', async () => {
  eq(deriveMemberId('device-abc'), deriveMemberId('device-abc'));
});

await t('deriveMemberId 对不同 seed 不同', async () => {
  ok(deriveMemberId('device-abc') !== deriveMemberId('device-xyz'), '不同种子应产生不同 id');
});

await t('deriveMemberId 带 m_ 前缀', async () => {
  ok(/^m_[0-9a-f]{8}$/.test(deriveMemberId('seed')), '格式应为 m_ + 8位十六进制');
});

await t('resolveTeamBackend: 有 URL 且健康 → cloud', async () => {
  eq(resolveTeamBackend({ backendUrl: 'https://x.workers.dev', healthy: true }), 'cloud');
});

await t('resolveTeamBackend: 有 URL 但不健康 → local', async () => {
  eq(resolveTeamBackend({ backendUrl: 'https://x.workers.dev', healthy: false }), 'local');
});

await t('resolveTeamBackend: 无 URL → local', async () => {
  eq(resolveTeamBackend({ backendUrl: '', healthy: true }), 'local');
});

await t('parseJoinCode 解析 ?join=XXXXXX', async () => {
  eq(parseJoinCode('?join=E36500'), 'E36500');
});

await t('parseJoinCode 解析完整 URL', async () => {
  eq(parseJoinCode('https://x.github.io/lazy-sheep-king/?join=abc123&foo=1'), 'ABC123');
});

await t('parseJoinCode 非法码返回空串', async () => {
  eq(parseJoinCode('?join=zz'), '');
  eq(parseJoinCode('?other=1'), '');
  eq(parseJoinCode(''), '');
});

await t('LocalTeamMock create + get + join 全流程', async () => {
  const mock = new LocalTeamMock();
  const created = await mock.createTeam({ founder: { memberId: 'm_a', nickname: '队长' } });
  ok(created.ok && created.code && created.token, 'create 返回 code/token');
  const joined = await mock.joinTeam({ code: created.code, member: { memberId: 'm_b', nickname: '队友' } });
  ok(joined.ok, 'join 成功');
  const got = await mock.getTeam({ code: created.code });
  eq(got.team.members.length, 2);
});

await t('LocalTeamMock 同一 memberId 重复 join 不重复注册', async () => {
  const mock = new LocalTeamMock();
  const created = await mock.createTeam({ founder: { memberId: 'm_a', nickname: '队长' } });
  await mock.joinTeam({ code: created.code, member: { memberId: 'm_a', nickname: '队长2' } });
  const got = await mock.getTeam({ code: created.code });
  eq(got.team.members.length, 1);
});

await t('LocalTeamMock heartbeat 更新 snapshot', async () => {
  const mock = new LocalTeamMock();
  const created = await mock.createTeam({ founder: { memberId: 'm_a', nickname: '队长' } });
  await mock.heartbeat({ code: created.code, memberId: 'm_a', snapshot: { progress: 50 } });
  const got = await mock.getTeam({ code: created.code });
  eq(got.team.members[0].snapshot.progress, 50);
});

await t('LocalTeamMock poke 写入 recentPokes（toMemberId）', async () => {
  const mock = new LocalTeamMock();
  const created = await mock.createTeam({ founder: { memberId: 'm_a', nickname: '队长' } });
  await mock.poke({ code: created.code, from: 'm_a', to: 'm_b', emoji: '👊' });
  const got = await mock.getTeam({ code: created.code });
  eq(got.team.recentPokes.length, 1);
  eq(got.team.recentPokes[0].toMemberId, 'm_b');
});

await t('LocalTeamMock leaveTeam 移除成员', async () => {
  const mock = new LocalTeamMock();
  const created = await mock.createTeam({ founder: { memberId: 'm_a', nickname: '队长' } });
  await mock.joinTeam({ code: created.code, member: { memberId: 'm_b', nickname: '队友' } });
  await mock.leaveTeam({ code: created.code, memberId: 'm_b' });
  const got = await mock.getTeam({ code: created.code });
  eq(got.team.members.length, 1);
});

await t('makeTeamFacade local 模式委派给 localMock', async () => {
  const mock = new LocalTeamMock();
  const facade = makeTeamFacade({ mode: 'local', localMock: mock });
  eq(facade.mode, 'local');
  const created = await facade.createTeam({ founder: { memberId: 'm_a', nickname: 'x' } });
  ok(created.ok, 'facade.createTeam 走本地 mock');
});

await t('makeTeamFacade cloud 模式透传 backendUrl 给 syncClient', async () => {
  let captured = null;
  const fakeSync = { createTeam: (opts) => { captured = opts; return { ok: true }; } };
  const facade = makeTeamFacade({ mode: 'cloud', syncClient: fakeSync, backendUrl: 'https://x.workers.dev' });
  eq(facade.mode, 'cloud');
  await facade.createTeam({ founder: { memberId: 'm_a' } });
  eq(captured.backendUrl, 'https://x.workers.dev');
  eq(captured.founder.memberId, 'm_a');
});

console.log('Storage · v0.8.2 team session');

await t('getTeamSession / setTeamSession / clearTeamSession', async () => {
  await Storage.resetAllLocalData();
  await Storage.setTeamSession({ teamCode: 'e36500', teamToken: 'tok', teamMemberId: 'm_a', teamPokeSeenTs: 99 });
  let s = await Storage.getTeamSession();
  eq(s.teamCode, 'E36500');
  eq(s.teamToken, 'tok');
  eq(s.teamMemberId, 'm_a');
  eq(s.teamPokeSeenTs, 99);
  await Storage.clearTeamSession();
  s = await Storage.getTeamSession();
  eq(s.teamCode, '');
  eq(s.teamToken, '');
  eq(s.teamMemberId, '');
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
