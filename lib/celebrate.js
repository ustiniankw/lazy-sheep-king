// lib/celebrate.js — 一步完成 / 全部完成 时的鼓励反馈
// - Web Audio API 合成"叮/胜利"音效，避免打包音频文件
// - 屏幕彩带 + 懒羊羊萌语弹幕
// - 全部完成时的大彩蛋

const CHEERS_STEP = [
  '完成一步！懒羊羊都要给你鼓掌了 👏',
  '欸嘿嘿，比懒羊羊起床还快～ 🐑',
  '一步接一步，你就是执行力大王！👑',
  '啊哈，又搞定一小步，反正也就一小步嘛～',
  '大王大王，你是懒羊羊国的大王！',
  '哇塞，你这么勤快，懒羊羊要认输了！',
  '进度条又肥了一圈～ 🎈',
  '厉害呀，这一步稳稳落地！',
  '滋——奖励一颗小星星 ⭐',
  '就是这样，别管完美，先动起来！',
];

const CHEERS_ALL = [
  '恭喜大王，任务圆满收官！🎉',
  '哇！懒羊羊都要跪下叫爸爸了！👑',
  '任务完成！记得给自己吃点好的～ 🍬',
  '这就是执行力大王的风范！',
  '一整个任务收工，超酷！',
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// -------- 音效 --------
let audioCtx = null;
function getCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {
      audioCtx = null;
    }
  }
  return audioCtx;
}

function beep({ freq = 880, duration = 0.18, type = 'sine', gain = 0.15, when = 0 } = {}) {
  const ctx = getCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export function playStepDoneSound() {
  // 两个上升的清脆叮咚
  beep({ freq: 784, duration: 0.16, type: 'triangle', when: 0 });
  beep({ freq: 1174, duration: 0.22, type: 'triangle', when: 0.12 });
}

export function playAllDoneSound() {
  // 简易胜利小号：C E G C
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => beep({ freq: f, duration: 0.22, type: 'square', gain: 0.12, when: i * 0.14 }));
  // 再加一个尾音
  beep({ freq: 1568, duration: 0.5, type: 'triangle', gain: 0.1, when: 0.14 * notes.length });
}

// -------- 视觉 --------
function ensureConfettiLayer() {
  let layer = document.getElementById('lsk-confetti-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'lsk-confetti-layer';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:99999;';
    document.body.appendChild(layer);
  }
  return layer;
}

function spawnConfetti(count = 40) {
  const layer = ensureConfettiLayer();
  const colors = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#c780fa'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    const size = 6 + Math.random() * 8;
    const left = Math.random() * 100;
    const rotate = Math.random() * 360;
    const duration = 1200 + Math.random() * 900;
    const delay = Math.random() * 200;
    p.style.cssText = `
      position:absolute;top:-20px;left:${left}%;width:${size}px;height:${size * 0.6}px;
      background:${colors[i % colors.length]};transform:rotate(${rotate}deg);
      border-radius:2px;opacity:0.95;
      animation: lsk-fall ${duration}ms ${delay}ms linear forwards;
    `;
    layer.appendChild(p);
    setTimeout(() => p.remove(), duration + delay + 100);
  }
}

function showToast(text, { big = false, duration = 1600 } = {}) {
  const t = document.createElement('div');
  t.className = 'lsk-toast' + (big ? ' lsk-toast-big' : '');
  t.textContent = text;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('lsk-toast-show'));
  setTimeout(() => {
    t.classList.remove('lsk-toast-show');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

export function celebrateStep({ sound = true } = {}) {
  spawnConfetti(28);
  showToast(pick(CHEERS_STEP));
  if (sound) playStepDoneSound();
}

export function celebrateAll({ sound = true } = {}) {
  spawnConfetti(120);
  showToast(pick(CHEERS_ALL), { big: true, duration: 2600 });
  if (sound) playAllDoneSound();
}

export const _cheers = { CHEERS_STEP, CHEERS_ALL };
