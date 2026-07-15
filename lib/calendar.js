// lib/calendar.js — v0.3.2 · 完成日历打卡图（纯函数，可被 ES module 与 .mjs 测试直接导入）

// 本地日期 key：YYYY-MM-DD（使用本地时区，避免 UTC 偏差）
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// n 天前的日期 key（n=0 即今天）
export function daysAgoKey(n, base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() - n);
  return todayKey(d);
}

// 根据当天步数换算热力等级
function levelForSteps(steps) {
  if (!steps || steps <= 0) return 0;
  if (steps <= 2) return 1;
  if (steps <= 5) return 2;
  if (steps <= 9) return 3;
  return 4;
}

// 构建热力图数据：返回从 (days-1) 天前到今天、按日期升序排列的数组
// 每项：{ date, steps, tasks, food, level }
export function buildHeatmap(dailyLog = {}, days = 30, base = new Date()) {
  const cells = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = daysAgoKey(i, base);
    const entry = (dailyLog && dailyLog[date]) || {};
    const steps = entry.steps || 0;
    const tasks = entry.tasks || 0;
    const food = entry.food || 0;
    cells.push({ date, steps, tasks, food, level: levelForSteps(steps) });
  }
  return cells;
}

// 汇总窗口内统计：total* / activeDays / currentStreak / longestStreak
export function summarize(dailyLog = {}, days = 30, base = new Date()) {
  const cells = buildHeatmap(dailyLog, days, base);
  let totalSteps = 0, totalTasks = 0, totalFood = 0, activeDays = 0;
  let longestStreak = 0, run = 0;
  for (const c of cells) {
    totalSteps += c.steps;
    totalTasks += c.tasks;
    totalFood += c.food;
    if (c.steps > 0) {
      activeDays += 1;
      run += 1;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }
  // currentStreak：以今天结尾、连续 steps>0 的天数
  let currentStreak = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].steps > 0) currentStreak += 1;
    else break;
  }
  return { totalSteps, totalTasks, totalFood, activeDays, currentStreak, longestStreak };
}

export default { todayKey, daysAgoKey, buildHeatmap, summarize };
