# 懒羊羊大王 · 执行力浏览器插件 🐑👑

> **让懒虫也能一步一步搞定事情** —— 你输入一件想做的事，懒羊羊大王把它拆成“傻瓜到不能再傻瓜”的小步骤，每完成一步都有鼓励、养料和宠物反馈，让拖延症也能慢慢动起来。

🚀 **[👉 在线试玩 v0.3.3](https://e5abdadc4674.aime-app.bytedance.net)** —— 不用装扩展也能直接玩。

![banner](./icons/mascot.png)

## ✨ 特性

- **一键拆解**：把大任务拆成 4-8 步“最小可执行动作”，每步都尽量具体到能立刻开动。
- **本地 + LLM 双模**：配置 API 时走更聪明的 LLM 拆解；没配 API 也有本地兜底，不会“哑火”。
- **🍃 本地兜底升级（v0.3.3）**：输入标准化 + 20+ 意图分类 + 模板库 + 相似任务 skeleton 复用，同一类任务不同说法也能稳定拆。
- **🗑 任务丢弃修复（v0.3.3）**：多任务列表改为事件委托；丢弃按钮使用“再点一次确认”轻量交互，避免 Chrome popup 里 `confirm` 失灵导致删不掉。
- **🗂 多任务并存**：可以同时挂多个任务，随时切换继续，每个任务独立进度。
- **一步只做一件事**：全屏只显示当前一步，避免大纲焦虑。
- **Plan 二次编辑 & 再拆一层**：拆解结果可手动增删改重排；某一步太难还可以再拆细。
- **🕐 按步骤倒计时**：每一步按自己的 `estMinutes` 独立倒计时，可暂停 / 继续 / +1 分钟。
- **❤️ 宠物喂养反馈（v0.3.3）**：新增累计喂养、今日喂养、连续喂养天数、亲密度条、喂养历史、投喂动画和勋章 toast。
- **🏠 宠物之家**：支持 🐑 懒羊羊 / 🐈 橘猫 / 🐕 柴柴 / 🖼️ 自定义宠物，自定义形象可切换卡通化。
- **👤 我的 & 备份（v0.3.3）**：匿名用户 ID、昵称、设备标签、导入 / 导出备份、跨设备同步基础（`chrome.storage.sync` 可用时启用）。
- **📅 完成日历打卡图**：30 / 90 天完成热力图 + 连续打卡 streak + 每日养料统计。
- **鼓励反馈**：每完成一步，撒彩带 🎉 + 懒羊羊萌语 + Web Audio 合成小音效。
- **快捷键**：`Alt + L` 一键唤起。
- **大屏模式**：点击 ⛶ 图标在新标签页打开，用更大的界面专注干活。

## 🧭 使用流程

1. 点击浏览器右上角的懒羊羊图标（或按 `Alt + L`）。
2. 在输入框里写下“今天想搞定什么事？”，例如「把这周的周报写完」「准备明天评审会」「跑步 5km」。
3. 点“拆成傻瓜步骤，开干！”。
4. 先在 Plan 视图看一眼步骤，也可以微调后再开始。
5. 分步页只显示**当前这一步**——照做，然后点 ✅ 完成。
6. 完成后会拿到养料、经验和鼓励；想休息时还能切去做别的任务。
7. 点 🏠 进入宠物之家喂宠物；点 👤 进入“我的”查看用户 ID、备份和同步开关。

## 🚀 安装（开发者模式加载）

> 目前仍处于快速迭代阶段，尚未发布到 Chrome Web Store。请通过“开发者模式”加载本仓库：

1. `git clone https://github.com/ustiniankw/lazy-sheep-king.git`
2. 打开 `chrome://extensions/`
3. 右上角开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本仓库根目录 `lazy-sheep-king/`
5. 完成！工具栏就会出现一只戴皇冠的懒羊羊 🐑👑

**兼容性**：Chrome 88+ / Edge / Arc 等基于 Chromium 的浏览器（Manifest V3）。

## ⚙️ LLM 配置（可选，但推荐）

点击工具栏图标 → ⚙ 图标 → 打开设置页，填入：

| 字段 | 例子 |
| --- | --- |
| Base URL | `https://api.openai.com/v1`（或 DeepSeek / Moonshot 等 OpenAI 兼容端点） |
| API Key | `sk-...` |
| Model | `gpt-4o-mini` / `deepseek-chat` / `moonshot-v1-8k` … |

保存后可以点“测试连接”验证。所有 Key 都只保存在你自己的浏览器 `storage.local` 中。

## 👤 用户体系 & 备份（v0.3.3）

点 popup 顶栏 **👤** 可打开“我的”视图：

- 查看匿名用户资料：`userId / displayName / deviceLabel / createdAt`
- 点击底部迷你 userId badge 一键复制
- **启用跨设备同步基础**：当 `chrome.storage.sync` 可用且用户主动开启时，会同步 `profile / tasks / settings / 精简 stats`
- **导出备份**：下载完整 JSON（任务、历史、统计、宠物状态、feedLog、dailyLog、设置、profile 等）
- **导入备份**：按合并策略恢复数据
  - tasks / history：按 id / 时间去重合并
  - stats：以较大值合并关键累计字段，`dailyLog` 按日期取最大值合并
  - settings：以导入备份为准
  - pets：以导入备份为准
  - profile：若备份 userId 与当前不一致，会提示并保留当前身份，仅合并数据

> Web 试玩环境没有 `chrome.*`，会自动优雅降级为 `localStorage`。

## 🗺️ Roadmap

### 🌱 v0.1 · 页面 + 兜底逻辑（✅ 已完成）

- [x] 完整插件页面（输入页 / 分步页 / 完成页 / 设置页）
- [x] 本地兜底拆解
- [x] 分步执行 UI（一次只做一步）
- [x] 完成反馈：彩带 + Web Audio 音效 + 萌语
- [x] 快捷键 `Alt + L` + 大屏模式

### 🤖 v0.2.0 · API 集成（✅ 已完成）

- [x] 多 Provider 一键切换（OpenAI / DeepSeek / Moonshot / 智谱 / Ollama / Custom）
- [x] Plan 视图二次编辑
- [x] “太难？再拆一层” refine 能力
- [x] 拆解耗时 / token / model 展示

### 🐣 v0.2.1 ~ v0.2.2 · 宠物之家基础（✅ 已完成）

- [x] 宠物之家页面
- [x] 懒羊羊 / 橘猫 / 柴柴 / 自定义宠物
- [x] 自定义图片上传 + 卡通化切换
- [x] 心情系统：happy / normal / sleepy / sad
- [x] CSS 动画：弹跳 / 呼吸 / 打瞌睡 / 抖动

### 🗂 v0.3.0 ~ v0.3.2 · 多任务 / 倒计时 / 日历（✅ 已完成）

- [x] 多任务并存 + 首页任务列表
- [x] 按步骤倒计时 + 动态养料奖励
- [x] 完成日历打卡图（30 / 90 天热力图）
- [x] 自定义形象上传交互优化

### ✨ v0.3.3 · 删除修复 + 宠物反馈 + 用户体系 + 本地兜底升级（✅ 当前版本）

- [x] **任务丢弃修复**：`#tasks-list` 事件委托、二次确认、当前任务丢弃后自动回首页
- [x] **步骤页快捷丢弃**：步骤头部新增 🗑 按钮
- [x] **宠物喂养反馈系统**：feedLog / totalFedByPet / totalFedAll / feedStreakDays / rich toast / 亲密度条 / 历史列表 / 勋章提示
- [x] **我的视图**：匿名用户 profile、昵称编辑、userId badge 复制、导出 / 导入备份、跨设备同步基础
- [x] **本地兜底质量升级**：标准化、意图分类、模板库、多意图合并、相似任务复用
- [x] `tests/breakdown_local.test.mjs` 新增；累计 **103/103** 全部通过

### ⏳ 后续

- [ ] v0.4 · 宠物商店 / 换装 / 好友互动
- [ ] v0.5 · Todoist / Notion / 飞书任务导入
- [ ] 更完整的跨设备同步 / 云端协作

## 🧩 目录结构

```text
lazy-sheep-king/
├── manifest.json
├── index.html
├── icons/
├── background/
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js
├── lib/
│   ├── storage.js        # 多任务 / stats / sync / profile / recentBreakdowns
│   ├── breakdown.js      # LLM + 本地兜底（标准化 / 分类 / 模板 / 复用）
│   ├── user.js           # 匿名用户 profile
│   ├── pets.js           # 宠物状态 / 喂养反馈 / feedLog / affinity
│   ├── step_timer.js
│   ├── calendar.js
│   ├── providers.js
│   └── celebrate.js
├── tests/
│   ├── breakdown.test.mjs
│   ├── breakdown_local.test.mjs
│   ├── calendar.test.mjs
│   ├── pets.test.mjs
│   ├── step_timer.test.mjs
│   └── tasks.test.mjs
└── README.md
```

## 🔧 本地开发

不装扩展也可以直接预览：

```bash
# 打开根目录 index.html
# 或直接打开 popup/popup.html?full=1
```

运行测试（Node 18+）：

```bash
node --test tests/*.mjs
```

## 🧪 测试现状

- `tests/breakdown.test.mjs`：15/15 ✅
- `tests/breakdown_local.test.mjs`：36/36 ✅
- `tests/calendar.test.mjs`：10/10 ✅
- `tests/pets.test.mjs`：13/13 ✅
- `tests/step_timer.test.mjs`：15/15 ✅
- `tests/tasks.test.mjs`：14/14 ✅
- 累计：**103/103 全部通过**

## 📄 License

MIT © 2025 [ustiniankw](https://github.com/ustiniankw) (xiakaiwen)
