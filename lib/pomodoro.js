// lib/pomodoro.js — v0.3.0 · 番茄钟状态机
// 纯前端计时，session 级：popup 关闭后自动清零（v0.4 再考虑持久化）
export const PHASES = {
  idle:  { name: 'idle',  label: '未开始', color: '#8c7455' },
  work:  { name: 'work',  label: '专注中', color: '#b0562c' },
  break: { name: 'break', label: '小憩中', color: '#6bb04f' },
  paused:{ name: 'paused',label: '已暂停', color: '#8c7455' },
};

// 纯函数：给定当前状态，返回下一状态
export function nextPhase(current) {
  if (current === 'work') return 'break';
  if (current === 'break') return 'work';
  return 'work';
}

// mm:ss 格式化
export function fmt(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 简单的番茄钟控制器工厂
export function createPomodoro({ workMinutes = 25, breakMinutes = 5, autoStartNext = true, soundOnEnd = true, onTick, onPhaseEnd } = {}) {
  const state = {
    phase: 'idle',        // idle/work/break/paused
    prevPhase: null,      // paused 之前的 phase，用于 resume
    endsAt: 0,
    remainingMs: 0,       // paused 时记录
    workMinutes, breakMinutes, autoStartNext, soundOnEnd,
    cycleCount: 0,        // 累计完成的 work 段
  };

  let timerId = null;

  function clearTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  function loop() {
    const now = Date.now();
    const leftMs = state.endsAt - now;
    if (leftMs <= 0) {
      const finishedPhase = state.phase;
      clearTimer();
      if (finishedPhase === 'work') state.cycleCount += 1;
      if (typeof onPhaseEnd === 'function') onPhaseEnd(finishedPhase, state);
      if (state.autoStartNext) {
        start(nextPhase(finishedPhase));
      } else {
        state.phase = 'idle';
        if (typeof onTick === 'function') onTick(0, state);
      }
      return;
    }
    if (typeof onTick === 'function') onTick(leftMs, state);
  }

  function start(phase = 'work') {
    clearTimer();
    state.phase = phase;
    state.prevPhase = null;
    const mins = phase === 'break' ? state.breakMinutes : state.workMinutes;
    state.endsAt = Date.now() + mins * 60_000;
    state.remainingMs = 0;
    if (typeof onTick === 'function') onTick(state.endsAt - Date.now(), state);
    timerId = setInterval(loop, 250);
  }

  function pause() {
    if (state.phase !== 'work' && state.phase !== 'break') return;
    clearTimer();
    state.remainingMs = Math.max(0, state.endsAt - Date.now());
    state.prevPhase = state.phase;
    state.phase = 'paused';
    if (typeof onTick === 'function') onTick(state.remainingMs, state);
  }

  function resume() {
    if (state.phase !== 'paused') return;
    state.phase = state.prevPhase || 'work';
    state.prevPhase = null;
    state.endsAt = Date.now() + state.remainingMs;
    state.remainingMs = 0;
    if (typeof onTick === 'function') onTick(state.endsAt - Date.now(), state);
    timerId = setInterval(loop, 250);
  }

  function stop() {
    clearTimer();
    state.phase = 'idle';
    state.prevPhase = null;
    state.endsAt = 0;
    state.remainingMs = 0;
    if (typeof onTick === 'function') onTick(0, state);
  }

  function updateConfig(cfg = {}) {
    if (typeof cfg.workMinutes === 'number' && cfg.workMinutes > 0) state.workMinutes = cfg.workMinutes;
    if (typeof cfg.breakMinutes === 'number' && cfg.breakMinutes > 0) state.breakMinutes = cfg.breakMinutes;
    if (typeof cfg.autoStartNext === 'boolean') state.autoStartNext = cfg.autoStartNext;
    if (typeof cfg.soundOnEnd === 'boolean') state.soundOnEnd = cfg.soundOnEnd;
  }

  function snapshot() { return { ...state }; }

  return { start, pause, resume, stop, updateConfig, snapshot };
}

export default { createPomodoro, PHASES, nextPhase, fmt };
