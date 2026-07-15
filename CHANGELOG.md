# CHANGELOG

## v0.3.3 — 删除修复 + 宠物喂养反馈 + 用户体系基础 + 本地兜底升级（2026-07-15）

🚀 **在线试玩**：https://e5abdadc4674.aime-app.bytedance.net

### 1. 任务丢弃修复
- **修复“任务丢弃功能无法正常使用”**：
  - `#tasks-list` 改为事件委托，不再因 `innerHTML` 重渲染导致按钮监听丢失
  - 删除动作统一按 `data-task-id` 处理，兼容数字 / 字符串 id
  - popup 内移除易失效的 `window.confirm`，改成“再点一次确认丢弃”交互，3 秒自动回退，也会在点击其它区域时解除武装
- **当前任务删除收口**：删除当前 active task 时会清空 `activeTaskId`、停止步骤倒计时并回到首页
- **新增步骤页头部 🗑 按钮**：执行中也能快速丢弃当前任务
- **删除反馈 toast**：显示 `已丢弃任务 · N 步未完成`

### 2. 宠物喂养反馈系统
- `lib/pets.js` 扩展状态：`feedLog / totalFedByPet / totalFedAll / lastFedAt / feedStreakDays`
- `Pets.feed(count, petId)` 现在会：
  - 扣除养料、增加经验、处理升级
  - 记录最近 200 条喂养历史
  - 分宠物累计亲密度（`totalFedByPet`）
  - 统计总喂养量与连续喂养天数
  - 返回 rich summary：`delta / newLevel / leveledUp / totalForPet / totalAll / streak`
- 宠物之家 UI 新增：
  - 顶部统计条：累计喂养 / 今日喂养 / 连续喂养天数
  - 每只宠物独立的 ❤️ 亲密度与渐变进度条
  - 最近 10 条喂养历史折叠面板
  - rich toast、feed-pop 动画、heart particles、10/50/100/500 里程碑勋章提示
  - 若步骤倒计时提示音开启，则投喂时播放短 WebAudio jingle

### 3. 多用户区分 + 跨设备同步基础
- 新增 `lib/user.js`：匿名 profile（`userId / displayName / createdAt / deviceLabel`）
- `Storage` 新增：
  - `getSyncEnabled / setSyncEnabled`
  - sync 安全包装：仅在 `chrome.storage.sync` 可用且 payload < 90KB 时写入；Web 试玩环境自动降级本地模式
  - sync 范围限制为 `profile / tasks / settings / 精简 stats`，不会把 `history / feedLog / dailyLog` 推上 sync
- popup 顶栏新增 **👤 我的**：
  - 查看与编辑用户资料
  - 复制 userId badge
  - 启用 / 关闭跨设备同步基础
  - 导出 / 导入备份 JSON
  - 生成新用户 ID
- 备份导入策略：
  - tasks / history 按 id / 时间去重合并
  - stats 关键累计字段取较大值合并，`dailyLog` 按日期合并
  - settings 与 pets 以备份为准
  - userId 不一致时保留当前身份并提示

### 4. 本地兜底质量升级（最重要）
- `lib/breakdown.js` 重构本地 fallback：
  - `normalizeInput(raw)`：去口头前后缀、统一标点/大小写、提取 minutes / kilometers / pages / deadline hints
  - `classifyIntent(normalized, tokens)`：覆盖学习 / 写作 / 代码 / 会议 / 生活 / 求职 / 规划等 20+ 常见意图
  - 模板库：每类任务返回 4-8 步、含 `estMinutes` 的具体动作
  - 多意图合并：两个高置信意图会融合并去重
  - 相似任务复用：基于最近 successful breakdown skeleton 的 token-overlap 检索
  - 对外新增 `analyzeInput()` 与 `localBreakdown()`
- 新增 `tests/breakdown_local.test.mjs`：覆盖 25+ 分类输入、表达变体、步骤结构与 skeleton 复用

### 测试
- `tests/breakdown.test.mjs`：15/15 ✅
- `tests/breakdown_local.test.mjs`：36/36 ✅
- `tests/calendar.test.mjs`：10/10 ✅
- `tests/pets.test.mjs`：13/13 ✅
- `tests/step_timer.test.mjs`：15/15 ✅
- `tests/tasks.test.mjs`：14/14 ✅
- 累计：**103/103 全部通过**

### 其它
- `manifest.json`：0.3.2 → 0.3.3
- `index.html / README.md / options/options.html`：同步更新版本与功能说明

## v0.3.2 — 完成日历打卡图 + 自定义形象上传体验优化（2026-07-15）

🚀 **在线试玩**：https://539f2546774b.aime-app.bytedance.net

### 新增
- **📅 完成日历打卡图**：顶栏新增 📅 入口，独立视图展示近 30 / 90 天的完成热力图
  - 4 张统计卡：完成任务 / 完成步骤 / 连续打卡 / 总养料
  - 7 行（weekday）× N 列（周）的 CSS Grid 热力图，每格 hover 有 tooltip（日期 / 步数 / 任务 / 养料）
  - 5 档绿色图例（0 → 10+），30 天 / 90 天分段切换
  - 连续打卡（currentStreak）= 以今天结尾、连续 steps > 0 的天数；最长连续（longestStreak）= 窗口内最长连续
- **`lib/calendar.js`**：纯函数模块 `todayKey / daysAgoKey / buildHeatmap / summarize`，ES module 与 `.mjs` 测试均可导入
- **`stats.dailyLog` 字段**：`{ 'YYYY-MM-DD': { steps, tasks, food } }` 每日打卡日志
  - `Storage.todayKey()` / `Storage.bumpDaily(patch)` 帮助函数
  - `addStepCompleted` / `addTaskCompleted` 完成时自动累加当日 steps / tasks / food

### 修正
- **自定义形象上传体验优化**：Web 预览（iframe）下长按 > 500ms 触发上传不可靠
  - 移除自定义槽的 `mousedown / mouseup / mouseleave` 长按逻辑
  - 自定义槽：无图 → 点击直接打开文件选择器；有图 → 点击切为当前宠物
  - 新增 `🖼 上传/更换形象` 与 `✨ 卡通化` 两个显式按钮
  - 提示文案由"长按自定义可上传形象" → "自定义 · 点击上传或使用下方按钮更换形象"

### 测试
- `tests/calendar.test.mjs`：10/10 ✅（todayKey / daysAgoKey / buildHeatmap level 映射 / summarize streak & gap）
- `tests/tasks.test.mjs`：新增 dailyLog 打卡断言，11/11 ✅
- 累计单测：**54 全部通过**（calendar 10 / tasks 11 / step_timer 15 / breakdown 10 / pets 8）

### 其它
- `manifest.json`：0.3.1 → 0.3.2

## v0.3.1 — 按步骤倒计时 + 动态养料（2026-07-15）

🚀 **在线试玩**：https://e628d62014a7.aime-app.bytedance.net

### 背景
用户反馈：v0.3.0 引入了 25/5 固定番茄钟，但步骤 `estMinutes` 各不相同（1-5 分钟），"专注 25 分钟"根本对不上一个 1 分钟的小步。v0.3.1 把它重构成**每步独立倒计时**，并让养料随实际用时动态发放。

### 新增
- **🕐 按步骤倒计时**：分步页 🕐 按钮直接按当前步骤的 `estMinutes` 启动倒计时（1 → 5 分钟自适应）
- **暂停 / 继续 / +1 分钟 / 停止**
- **时间到提示音**（Web Audio 3 音铃声）+ toast，可选自动 +1 分钟继续
- **动态养料公式**（`lib/step_timer.js` → `calcStepReward / calcTaskCompletionBonus`）：
  - `base food = estMinutes`（1 min = 1 养料，5 min = 5 养料）
  - 未计时 → 保底 base（`no-timer`）
  - 实际用时 ≤ estMinutes × 1.05 → **+50% 效率奖励**（`on-time`）
  - 实际用时 ∈ (1x, 2x] → base 无奖励（`normal`）
  - 实际用时 > 2x → base 无奖励（`over-time`）
  - 跳过 → 0（`skip`）
- **任务完成额外奖励**：`sum(estMinutes) × 20%` 养料 + × 60% 经验，在 done 页显示
- **step 记录 actualMs**：每个 step 完成时保存实际专注毫秒，方便后续 v0.4 做统计

### 改造
- 删除 `lib/pomodoro.js` + `tests/pomodoro.test.mjs`
- 新建 `lib/step_timer.js` + `tests/step_timer.test.mjs`（15/15 ✅）
- `Storage.addStepCompleted` / `addTaskCompleted` 支持显式 `{food, exp}` 入参
- `settings.stepTimer`：`autoStart / endSound / autoAddOnEnd`（旧 `settings.pomodoro` 保留兼容字段但不再使用）
- `popup.html / .js / .css`：`.pomo-*` → `.stimer-*`，phase running 红 / paused 灰 / ended 绿
- `options`：番茄钟设置整段替换为步骤倒计时设置
- `manifest.json`：0.3.0 → 0.3.1

### 测试
- 46 → **48 全部通过**（step_timer 15 / tasks 10 / breakdown 15 / pets 8）

## v0.3.0 — 多任务并存 & 番茄钟（2026-07-15）

🚀 **在线试玩**：https://e628d62014a7.aime-app.bytedance.net

### 新增
- **🗂 多任务并存**
  - `Storage.getTasks / saveTask / deleteTask / setActiveTaskId / getActiveTaskId`
  - 数据自动从 v0.2 的 `lsk_current_task_v1` 迁移到 `lsk_tasks_v1 + lsk_active_task_id_v1`
  - 首页在 ≥ 2 个未完成任务时会显示卡片列表（目标 / 进度条 / 创建时间 / 继续 / 丢弃）
  - 分步页右下角新增「🗂 切到其他任务」按钮
- **🍅 番茄钟（v0.3.0 全新模块 `lib/pomodoro.js`）**
  - 4 phase 状态机：`idle / work / break / paused`
  - `work → break → work` 自动循环
  - 可暂停 / 继续 / 结束，累计 🍅 数
  - 结束提示音：Web Audio 合成，work 结束 3 音铃声，break 结束 2 音短促
  - 分步页专注红色 / 小憩绿色 / 暂停灰色主题切换
  - 设置页新增：专注时长（1-120 min）/ 小憩时长（1-60 min）/ 自动进入下一段 / 结束提示音
- **🌐 在线试玩页**：仓库根新增 `index.html`，左侧文档 / 右侧 iframe 直接嵌入 popup

### 改造
- `lib/storage.js`：settings 深合并 `pomodoro`；`getCurrentTask / setCurrentTask / clearCurrentTask` 兼容旧 API 但实际操作多任务表
- `popup/popup.html`：新增 `#tasks-card / #pomo-card / #btn-back-tasks`
- `popup/popup.js`：`refreshResumeCard` 支持多任务视图；新增 pomodoro widget 绑定
- `popup/popup.css`：新增 tasks list & pomodoro widget 样式（含 phase 主题色）
- `options/options.html / options.js / options.css`：新增番茄钟配置区块
- `manifest.json`：0.2.2 → 0.3.0

### 新增测试
- `tests/pomodoro.test.mjs`：13/13 ✅ （nextPhase / fmt / start / pause / resume / stop / updateConfig）
- `tests/tasks.test.mjs`：10/10 ✅ （多任务 CRUD + active 切换 + settings 深合并）
- 累计单测：46 全部通过

## v0.2.2 — v2.1 心情 & 卡通化 & 动画（2026-07-15）

### 新增
- **宠物心情系统**：根据「距离上次喂养」+「最近活跃时间」实时计算 4 种心情
  - `happy` 😊：6h 内被喂过 / 刚被喂饱 → 弹跳动画 + "被你喂饱啦"
  - `normal` 🙂：24h 内喂过 或 近期有任务活跃 → 呼吸式起伏动画
  - `sleepy` 😴：24-72h 未喂 → 左右摇晃打瞌睡，滤镜微暗
  - `sad` 🥺：>72h 未喂 → 小幅颤抖 + 求投喂台词
- **心情动画**：CSS keyframes 实现 `mood-bounce/idle/sleepy/shake`，无需 JS 定时器
- **喂饱短时 buff**：喂养后 2 小时内锁定 happy，跨会话保持
- **自定义形象自动卡通化**：上传图通过 `contrast(1.15) saturate(1.35) brightness(1.02)` CSS filter 做轻量卡通化，可通过 `state.cartoonize` 关闭

### 改造
- `lib/pets.js`：新增 `computeMood(state, stats)` 和 `MOOD_META`；`feed()` 会写入 `lastFedAt` 和 `moodOverride`
- `popup/popup.js`：avatar 现在会带上 `mood-*` class 用于动画，心情文案自动更新
- `popup/popup.css`：新增 mood keyframes 与 pet-mood 徽章样式
- `manifest.json`：0.2.1 → 0.2.2
- `README.md`：Roadmap 中 v1 / v2 Option 1 / v2.1 三段勾选状态全部同步

## v0.2.1 — v2 Option 1 · 宠物骨架 + 新图标（2026-07-15）
- 使用用户提供的懒羊羊图片重新生成 16/32/48/128/256 全套图标 + mascot
- 整体配色切换到「暖奶油 + 棕色系」（`#fff5d6 / #b0562c / #5c3a1e`）
- 新增 `lib/pets.js`：多物种（🐑/🐈/🐕/🖼️）状态管理、`foodStock` 消耗喂养、自定义图片上传
- popup 顶部新增 🏠 宠物之家入口，完成页也可跳转
- 宠物之家页面：avatar / 心情 / 等级 / 养料 / 累计喂养次数 / picker / 上传

## v0.2.0 — v1 API 集成（2026-07-15）

### ✨ Highlights
- 🧠 **Provider 一键切换**：内置 OpenAI / DeepSeek / Moonshot / 智谱 GLM / Ollama / 自定义 6 种预设，点一下就自动填 baseUrl + 推荐模型 + 官方 Key 申请入口。
- 📝 **拆解结果二次编辑**：LLM 拆完不立刻开动，先进入「Plan 视图」——可以增、删、改、上下移，微调后再点开始。
- 🍃 **对话式细化**：分步页每个当前步骤右上角新增「太难？再拆一层」按钮，一键让 LLM 把这一步替换成 3-5 个更小的子步骤，兜底也支持。
- ⏱️ **拆解耗时 & token 用量**：Plan 视图顶部展示 `model / elapsedMs / prompt+completion tokens`，选做「便宜大模型 vs 高级大模型」时更有数（设置里可关）。
- 🔧 Model 输入框改成 `<datalist>`，切换 provider 时自动补全该家常见模型列表。
- 🧪 单测扩容到 15 项，全部通过。

### 🧱 底层改造
- 新增 `lib/providers.js` 统一管理 provider 预设。
- `lib/breakdown.js`：
  - 提取公共 `chatComplete(...)`，返回 `{ content, usage, model, elapsedMs }`。
  - 新增 `refineStep(goal, step, siblings, settings)` 对话式细化 API。
  - 对不识别 `response_format: json_object` 的 provider 做自动降级重试。
- `lib/storage.js` 深合并 `llm` 子对象，避免升级时丢字段。

### 🖼️ UI
- 新增 view：`plan`，介于 input 和 steps 之间。
- 分步卡片右上角新增 `chip-btn` 样式的操作入口。
- 设置页 Provider 网格 + Model datalist + Show usage 开关。

### 🛠 破坏性变更
无。老数据全部兼容（storage 有默认值填充）。

---

## v0.1.0 — 首个版本（2026-07-15）

- 输入任务 → 本地兜底拆解 → 分步执行（撒彩带 + Web Audio 音效）→ 完成页统计
- 快捷键 `Alt + L`、大屏模式、设置页数据管理
- 实验性 LLM 通道（v1 正式化）
