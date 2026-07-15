// lib/step_timer.js — v0.3.1
// 通用「一次性倒计时」：每一步都可以按自己的 estMinutes 独立启动
// 相比 v0.3.0 的固定 25 min 番茄钟，这个更贴合"步骤长短不一"的真实场景

export function fmt(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 创建一个可复用的倒计时控制器
 * @param {object} opts
 * @param {(leftMs:number, state:object) => void} opts.onTick 每 250ms 触发
 * @param {(state:object) => void} opts.onEnd 时间到时触发
 */
export function createCountdown({ onTick, onEnd } = {}) {
  const state = {
    phase: 'idle',        // idle | running | paused | ended
    startedAt: 0,         // 首次 start 的时间
    endsAt: 0,
    remainingMs: 0,       // 暂停时记录
    totalMs: 0,           // 累计设定过的总时长（+1min 后会增加）
    elapsedActiveMs: 0,   // 真正处于 running 的累计毫秒
    _resumedAt: 0,
  };
  let timerId = null;

  function clearT() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function loop() {
    const now = Date.now();
    const leftMs = state.endsAt - now;
    if (leftMs <= 0) {
      state.elapsedActiveMs += now - state._resumedAt;
      state._resumedAt = 0;
      clearT();
      state.phase = 'ended';
      if (typeof onTick === 'function') onTick(0, state);
      if (typeof onEnd === 'function') onEnd(state);
      return;
    }
    if (typeof onTick === 'function') onTick(leftMs, state);
  }

  function start(minutes) {
    clearT();
    const ms = Math.max(1_000, Math.round(minutes * 60_000));
    state.phase = 'running';
    state.startedAt = Date.now();
    state.endsAt = Date.now() + ms;
    state.totalMs = ms;
    state.elapsedActiveMs = 0;
    state._resumedAt = Date.now();
    if (typeof onTick === 'function') onTick(ms, state);
    timerId = setInterval(loop, 250);
  }

  function pause() {
    if (state.phase !== 'running') return;
    clearT();
    const now = Date.now();
    state.remainingMs = Math.max(0, state.endsAt - now);
    state.elapsedActiveMs += now - state._resumedAt;
    state._resumedAt = 0;
    state.phase = 'paused';
    if (typeof onTick === 'function') onTick(state.remainingMs, state);
  }

  function resume() {
    if (state.phase !== 'paused') return;
    state.endsAt = Date.now() + state.remainingMs;
    state.remainingMs = 0;
    state._resumedAt = Date.now();
    state.phase = 'running';
    if (typeof onTick === 'function') onTick(state.endsAt - Date.now(), state);
    timerId = setInterval(loop, 250);
  }

  function addMinutes(m) {
    const addMs = Math.max(0, m) * 60_000;
    state.totalMs += addMs;
    if (state.phase === 'running') {
      state.endsAt += addMs;
      if (typeof onTick === 'function') onTick(state.endsAt - Date.now(), state);
    } else if (state.phase === 'paused' || state.phase === 'ended') {
      state.remainingMs += addMs;
      // 从 ended 回到 paused 更符合"再给我一分钟"语义
      state.phase = 'paused';
      if (typeof onTick === 'function') onTick(state.remainingMs, state);
    }
  }

  function stop() {
    clearT();
    if (state.phase === 'running' && state._resumedAt) {
      state.elapsedActiveMs += Date.now() - state._resumedAt;
    }
    state._resumedAt = 0;
    state.phase = 'idle';
    state.endsAt = 0;
    state.remainingMs = 0;
    if (typeof onTick === 'function') onTick(0, state);
  }

  function snapshot() { return { ...state }; }

  return { start, pause, resume, stop, addMinutes, snapshot };
}

/**
 * 计算某个步骤完成时的养料 & 经验奖励
 *   base 养料 = estMinutes（1-5+ 分钟对应 1-5+ 养料）
 *   准时或提前完成 → +50% 奖励（"效率大王"）
 *   跳过 → base × 0（不给养料）
 *   没启动倒计时 → 就给 base（保底）
 * @param {object} opts
 * @param {number} opts.estMinutes 计划分钟数
 * @param {number} [opts.actualMs] 实际专注毫秒数（未启动倒计时时为 0）
 * @param {boolean} [opts.skipped]
 * @returns {{food:number, exp:number, tag:string}}
 */
export function calcStepReward({ estMinutes = 3, actualMs = 0, skipped = false } = {}) {
  const base = Math.max(1, Math.round(estMinutes));
  if (skipped) return { food: 0, exp: 0, tag: 'skip' };
  if (!actualMs || actualMs <= 0) return { food: base, exp: base * 3, tag: 'no-timer' };

  const realMin = actualMs / 60_000;
  if (realMin <= estMinutes * 1.05) {
    // 提前 / 准时（含 5% 容差）
    const bonus = Math.ceil(base * 0.5);
    return { food: base + bonus, exp: (base + bonus) * 3, tag: 'on-time' };
  }
  if (realMin > estMinutes * 2) {
    // 磨蹭：只给 base，但不惩罚
    return { food: base, exp: base * 3, tag: 'over-time' };
  }
  return { food: base, exp: base * 3, tag: 'normal' };
}

/**
 * 计算完成整个任务的额外奖励：sum(estMinutes) * 0.2
 */
export function calcTaskCompletionBonus(task) {
  const total = (task.steps || []).reduce((s, x) => s + Math.max(1, Math.round(x.estMinutes || 3)), 0);
  return { food: Math.ceil(total * 0.2), exp: Math.ceil(total * 0.6) };
}

export default { createCountdown, fmt, calcStepReward, calcTaskCompletionBonus };
