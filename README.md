# 懒羊羊大王 · 执行力浏览器插件 🐑👑

> **让懒虫也能一步一步搞定事情** —— 你输入一件想做的事，懒羊羊大王把它拆成"傻瓜到不能再傻瓜"的小步骤，每完成一步都有彩带、鼓励和小音效，让你不知不觉把大事儿做完。

🚀 **[👉 在线试玩 v0.3.2](https://539f2546774b.aime-app.bytedance.net)** —— 不用装扩展也能直接玩。

![banner](./icons/mascot.png)

## ✨ 特性

- **一键拆解**：把大任务拆成 5-10 步"最小可执行动作"，每步只要 1-5 分钟。
- **超傻瓜启动**：前 1-2 步一定是"几乎零门槛"的启动动作（比如"深呼吸 3 次"），用来破除拖延症。
- **一步只做一件事**：全屏只显示当前一步，避免大纲焦虑。
- **鼓励反馈**：每完成一步，撒彩带 🎉 + 懒羊羊萌语 + Web Audio 生成的小叮咚音效；全部完成时更有大彩蛋。
- **多 LLM Provider**（v1）：OpenAI / DeepSeek / Moonshot / 智谱 GLM / Ollama / Custom，一键切换。
- **Plan 二次编辑 & 一键再拆一层**（v1）：拆解结果可以增删改重排，某一步不会做点一下让 AI 再拆一层。
- **宠物之家 & 心情系统**（v2 / v2.1）：养懒羊羊 / 猫 / 狗 / 自定义形象；完成一步积攒养料喂宠物；4 种心情动画自动切换；上传图自动卡通化。
- **🕐 按步骤倒计时**（v0.3.1）：每一步用自己的 `estMinutes` 独立倒计时，可暂停 / +1 分钟 / 时间到提示音；养料按 estMinutes 发放，准时完成 +50% 奖励。
- **📅 完成日历打卡图**（v0.3.2）：顶栏 📅 入口，30 / 90 天完成热力图 + 连续打卡 streak + 每日养料统计；`stats.dailyLog` 每日累计 steps / tasks / food。
- **🖼 自定义形象上传优化**（v0.3.2）：移除不可靠的长按，改为显式「上传/更换形象」「卡通化」按钮，Web 预览下也能一键上传。
- **🗂 多任务并存**（v0.3.0）：可以同时挂 N 个任务，随时切换继续，每个任务独立进度。
- **本地存储**：所有数据都保存在 `chrome.storage.local`，不上传任何服务器。
- **快捷键**：`Alt + L` 一键唤起。
- **大屏模式**：点击 ⛶ 图标在新标签页打开，用大屏专注干活。

## 🧭 使用流程

1. 装好插件后，点击浏览器右上角的懒羊羊图标（或按 `Alt + L`）。
2. 在输入框写下"今天想搞定什么事？"，例如「把这周的周报写完」。
3. 点击"拆成傻瓜步骤，开干！"。
4. 屏幕上只会显示**下一步要做的一件小事**——照做，然后点 ✅ 完成。
5. 撒彩带、放叮咚音效、来点小鼓励，然后自动跳到下一步。
6. 全部完成后进入 🎉 完成页，可以看到累计步数、累计任务数，以及 **v2 宠物预告**。

## 📸 界面预览

|                    输入任务                    |              一步一步做              |              完成庆祝              |
| :--------------------------------------------: | :----------------------------------: | :--------------------------------: |
| 输入你想干的事 → 一键拆解 | 全屏只显示当前一小步 + 懒羊羊萌语 | 彩带 + 累计统计 + 宠物预告 |

## 🚀 安装（开发者模式加载）

> 目前处于早期版本，还未发布到 Chrome Web Store。请通过"开发者模式"加载本仓库：

1. `git clone https://github.com/<你的用户名>/lazy-sheep-king.git`
2. 打开 `chrome://extensions/`
3. 右上角开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本仓库根目录 `lazy-sheep-king/`
5. 完成！工具栏就会出现一只戴皇冠的懒羊羊 🐑👑

**兼容性**：Chrome 88+ / Edge / Arc 等基于 Chromium 的浏览器（Manifest V3）。

## ⚙️ LLM 配置（可选，但强烈推荐）

点击工具栏图标 → ⚙ 图标 → 打开设置页，填入：

| 字段 | 例子 |
| --- | --- |
| Base URL | `https://api.openai.com/v1`（或 DeepSeek/Moonshot 等 OpenAI 兼容端点） |
| API Key | `sk-...` |
| Model | `gpt-4o-mini` / `deepseek-chat` / `moonshot-v1-8k` … |

保存后可以点「测试连接」验证。所有 Key 都只保存在你自己的浏览器 `storage.local` 中。

## 🗺️ Roadmap

分三期迭代，先跑通体验，再上智能，再上宠物养成：

### 🌱 v0.1 · 页面 + 兜底逻辑（当前 · ✅ 已完成）
> 目标：**不依赖任何外部服务**，把"输入任务 → 傻瓜级步骤 → 一步一步跟着做 → 撒彩带鼓励"这条主链路先跑通。

- [x] 完整的插件页面（输入页 / 分步页 / 完成页 + 设置页）
- [x] **本地兜底拆解**：内置周报 / 学习 / 运动 / 打扫等场景模板 + 通用启发式兜底
- [x] 分步执行 UI（全屏只显示当前一步，避免焦虑）
- [x] 完成反馈：彩带 🎉 + Web Audio 合成音效 + 懒羊羊萌语
- [x] 完成页统计（累计任务数 / 累计步数）+ 断点续做
- [x] 快捷键 `Alt + L` + 大屏模式
- [x] 本地设置页 & 数据管理（chrome.storage.local）
- [x] `stats.foodStock / petLevel / petExp` 字段已经在跑（为 v2 铺路）

> ℹ️ **关于 LLM**：v0.1 里也提前埋了一个「实验性」的 LLM 通道（OpenAI 兼容协议），默认不启用；正式的 API 能力会在 v1 里全面打磨。

### 🤖 v1 · 加入 API 功能（✅ 已完成，v0.2.0）
> 目标：把"聪明大脑"接上，让拆解真正因人而异。

- [x] **LLM 拆解正式化**：Provider 一键切换（OpenAI / DeepSeek / Moonshot / 智谱 GLM / Ollama / Custom）
- [x] **模型选择器**：datalist 智能补全 + 展示每次拆解的 model / token / 耗时
- [x] **拆解结果二次编辑**：Plan 视图支持手动增 / 删 / 改 / 上下移动 / 全部重拆
- [x] **对话式细化**：某一步不会做？点「🍃 太难？再拆一层」让懒羊羊自动把这一步再拆
- [x] **response_format 自动降级**：LLM 不支持 JSON mode 时自动重试
- [ ] 任务导入 / 导出 API（Todoist / Notion / 飞书任务）—— 延后
- [ ] 可选云同步、多任务并存、番茄钟、Firefox / i18n —— 延后

### 🐣 v2 · 多种可饲养宠物（懒羊羊养成计划）

#### Option 1 · 宠物之家骨架（✅ 已完成，v0.2.1）
- [x] **宠物之家页面**：popup 顶部 🏠 入口，完成页也可跳转
- [x] **多物种可选**：🐑 懒羊羊 / 🐈 橘猫 / 🐕 柴柴 / 🖼️ 自定义
- [x] **自定义形象上传**：本地读文件转 Data URL，绑定专属宠物
- [x] **养料 & 喂养**：完成一步 +2 养料，喂养 1 次消耗 5 养料
- [x] **宠物等级 / 经验 / 累计喂养次数**（stats 字段已跑）

#### v2.1 · 心情 & 卡通化 & 动画（✅ 本次新增，v0.2.2）
- [x] **心情系统**：基于「距离上次喂养」+「最近活跃时间」自动计算 happy / normal / sleepy / sad，宠物会说不同的话
- [x] **心情动画**：happy 会弹跳，sleepy 会左右摇晃打瞌睡，sad 会小幅颤抖，normal 呼吸式起伏
- [x] **自定义形象自动卡通化**：上传图会通过 CSS filter（contrast + saturate + brightness）自动做轻量卡通化滤镜
- [x] **喂饱短时 buff**：喂养后进入 happy 状态并持续 2 小时以上

#### 后续（未完成）
- [ ] **宠物商店**：皮肤、装饰、家具、季节主题（换养料购买）
- [ ] **等级/经验解锁**：不同物种不同成长曲线 & 换装
- [ ] **本地卡通化增强**：上传时用 canvas 做 posterize / 边缘描边，而不仅是 CSS filter
- [ ] **好友宠物互动**（互相串门 / 送礼 / PK）
- [ ] **宠物专属房间**：落到独立标签页，做成小型放置类游戏
- [ ] AI 生图版卡通化（走 v1 的 API 通道）

### 🍅 v0.3.0 → 🕐 v0.3.1 · 多任务 & 按步倒计时（✅ 本轮迭代）
> v0.3.0 引入了番茄钟，但用户反馈"固定 25 min 和步骤 estMinutes 不匹配"。v0.3.1 把它重构成**每步独立倒计时**。

**v0.3.0 完成项（保留）**
- [x] **多任务并存**：Storage 层新增 `getTasks / saveTask / deleteTask / setActiveTaskId`；旧 `currentTask` 自动迁移
- [x] **任务列表 UI**：首页在 ≥ 2 个未完成任务时会显示卡片列表
- [x] **分步页切换**：分步页右下角新增「🗂 切到其他任务」

**v0.3.1 修正 & 新增**
- [x] **按步骤倒计时**：进入某一步 → 点 🕐 → 直接按 `estMinutes` 倒计时（1min 就是 1min，5min 就是 5min）
- [x] **暂停 / 继续 / +1 分钟 / 停止**
- [x] **时间到提示音 + toast**，可选"自动 +1 分钟继续"
- [x] **动态养料公式**：`food = estMinutes`；准时完成 +50%；跳过 0；未计时 → 保底 base
- [x] **任务完成额外奖励**：`sum(estMinutes) × 20%` 养料 + × 60% 经验
- [x] 移除 v0.3.0 固定 25/5 番茄钟 UI 与设置
- [x] `tests/step_timer.test.mjs`：15/15 ✅ （fmt / countdown / calcStepReward / calcTaskCompletionBonus）

### 📅 v0.3.2 · 完成日历打卡图 + 自定义上传优化（✅ 当前版本）
> 目标：把每天的完成情况沉淀成可视化打卡图，并修好 Web 预览下自定义形象上传的体验。

- [x] **完成日历打卡图**：30 / 90 天完成热力图（7 行 weekday × N 列周）+ tooltip
- [x] **打卡统计**：完成任务 / 完成步骤 / 连续打卡 streak / 总养料（近 30 天）
- [x] **`stats.dailyLog` 字段**：每日累计 `{ steps, tasks, food }`；`lib/calendar.js` 纯函数（`todayKey / daysAgoKey / buildHeatmap / summarize`）
- [x] **自定义形象上传优化**：移除长按，改为显式「🖼 上传/更换形象」「✨ 卡通化」按钮
- [x] `tests/calendar.test.mjs`：10/10 ✅；`tests/tasks.test.mjs` 新增 dailyLog 断言 → 累计 **54 全部通过**

## 🧩 目录结构

```
lazy-sheep-king/
├── manifest.json           # MV3 清单
├── icons/                  # 16/32/48/128/256 图标 + 大 mascot
├── background/
│   └── background.js       # Service Worker：欢迎通知
├── popup/
│   ├── popup.html          # 主 UI（也是大屏模式）
│   ├── popup.css           # 懒羊羊主题（奶黄+淡紫+圆润）
│   └── popup.js            # 输入 → 拆解 → 分步 → 完成
├── options/
│   ├── options.html        # 设置页
│   ├── options.css
│   └── options.js
├── lib/
│   ├── storage.js          # chrome.storage.local 数据层（v0.3.0: 多任务 + 番茄钟设置）
│   ├── breakdown.js        # 任务拆解：LLM + 本地兜底模板
│   ├── providers.js        # v1: Provider 预设（OpenAI / DeepSeek / Moonshot / 智谱 / Ollama / Custom）
│   ├── pets.js             # v2: 宠物状态 & 心情系统 & 喂养逻辑
│   ├── step_timer.js       # v0.3.1: 通用倒计时 + 动态养料公式（替代 v0.3.0 pomodoro.js）
│   ├── calendar.js         # v0.3.2: 完成日历打卡图纯函数（heatmap / streak / summarize）
│   └── celebrate.js        # 彩带 / 音效 / 萌语
├── docs/
│   └── preview.html        # 不用装扩展也能在浏览器里预览效果
└── README.md
```

## 🔧 本地开发

不装扩展也可以在普通浏览器里预览 UI：

```bash
# 直接把 docs/preview.html 拖到浏览器里打开
# 该页面会把 popup UI 嵌进来，用 localStorage 模拟 chrome.storage
```

单元测试（可选，Node 18+）：

```bash
node tests/breakdown.test.mjs
```

## 📄 License

MIT © 2025 [ustiniankw](https://github.com/ustiniankw) (xiakaiwen)
