# 懒羊羊大王 · 执行力浏览器插件 🐑👑

> **让懒虫也能一步一步搞定事情** —— 你输入一件想做的事，懒羊羊大王先用本地模板拆成“傻瓜到不能再傻瓜”的小步骤，再按可用性尝试用免费 AI 精修；完成过程中还能养宠物、看打卡日历、和队友互相拍一拍。

🚀 **[👉 在线试玩 v0.3.4](https://5bd40465996c.aime-app.bytedance.net)** —— 不用装扩展也能直接玩。

![banner](./icons/mascot.png)

## ✨ 特性

- **一键拆解**：把大任务拆成 4-8 步“最小可执行动作”，每步都尽量具体到能立刻开动。
- **🍃 AI 精修（免费方案）**：先本地拆解，再按可用性自动走 **Chrome 内置 Prompt API → 用户自配 API → 本地兜底**。
- **👥 组队模式（v0.3.4）**：创建 / 加入 6 位团队码，查看队友昵称、设备、今日步数、当前任务、连续打卡和最近活跃。
- **🔒 隐私模式（v0.3.4）**：每个任务可切换 `公开 / 仅隐藏标题 / 完全隐私`；队伍面板还能设置默认隐私。
- **🫵 拍一拍（v0.3.4）**：给队友发一条鼓励 poke，对方下次打开就能看到红点与提醒。
- **📤 队伍快照交换（v0.3.4）**：默认零后端，直接导出 / 导入 team snapshot JSON 即可同步队伍状态与 poke。
- **🔗 可选免费 URL 同步（v0.3.4）**：用户可主动粘贴 JSONBin.io / npoint.io URL；有 URL 才会轮询并尝试同步，无 URL 完全不走网络。
- **🍃 本地兜底升级（v0.3.3）**：输入标准化 + 20+ 意图分类 + 模板库 + 相似任务 skeleton 复用，同一类任务不同说法也能稳定拆。
- **🗂 多任务并存**：可以同时挂多个任务，随时切换继续，每个任务独立进度。
- **一步只做一件事**：全屏只显示当前一步，避免大纲焦虑。
- **Plan 二次编辑 & 再拆一层**：拆解结果可手动增删改重排；某一步太难还可以再拆细。
- **🕐 按步骤倒计时**：每一步按自己的 `estMinutes` 独立倒计时，可暂停 / 继续 / +1 分钟。
- **❤️ 宠物喂养反馈**：累计喂养、今日喂养、连续喂养、亲密度条、喂养历史、投喂动画和勋章 toast。
- **👤 我的 & 备份**：匿名用户 ID、昵称、设备标签、导入 / 导出备份、跨设备同步基础（`chrome.storage.sync` 可用时启用）。
- **📅 完成日历打卡图**：30 / 90 天完成热力图 + 连续打卡 streak + 每日养料统计。
- **鼓励反馈**：每完成一步，撒彩带 🎉 + 懒羊羊萌语 + Web Audio 合成小音效。
- **快捷键**：`Alt + L` 一键唤起。
- **大屏模式**：点击 ⛶ 图标在新标签页打开，用更大的界面专注干活。

## 👥 组队与隐私（v0.3.4）

点 popup 顶栏 **👥** 可打开组队面板：

- **创建组队**：生成一个 6 位十六进制团队码，并自动复制到剪贴板。
- **加入组队**：输入队伍码后，本地先建立只有自己的 team state；随后可通过快照或 URL 同步把队友状态并进来。
- **成员卡片信息**：昵称、设备、今日已完成步数、当前任务、连续打卡天数、最近活跃时间。
- **拍一拍**：每个队友卡片都有 `🫵 拍一拍` 按钮；poke 会跟着快照 / URL 同步一起传播。
- **默认零成本同步**：
  - `📤 导出队伍快照`：下载 team snapshot JSON，发给队友即可。
  - `📥 导入队伍快照`：按 `userId / updatedAt / pokeId` 合并，不会粗暴覆盖本地。
- **可选免费 URL 同步**：
  - 用户自行粘贴 JSONBin.io / npoint.io URL 才会启用。
  - popup 打开期间按 60s 节流轮询并尝试 PUT。
  - 不配置 URL = 完全离线，不发任何请求。
- **隐私模式**：
  - `公开`：分享任务标题 + 进度，如 `写周报 · 2/5`
  - `仅隐藏标题`：分享 `🔒 私密任务 · 2/5`
  - `完全隐私`：只分享进度百分比，如 `进度 40%`
- **当前任务快速切换隐私**：步骤页右上角新增 `🔒/🙈/🫥` 小按钮，可循环切换当前任务隐私。

## 🍃 AI 精修（免费方案）

### 为什么不用 GPT 付费 API？

**因为 OpenAI 的 GPT API 需要付费，所以这次不采用项目方出钱的 GPT 路线。**

v0.3.4 改成 **完全免费** 的三档实现，按可用性自动降级：

1. **Tier 1（推荐）— Chrome 内置 Prompt API**
   - 目标接口：`LanguageModel` / `chrome.aiOriginTrial.languageModel`
   - 本地推理，不上传任务内容，不需要项目方买 API
   - 受 Chrome 版本（138+）、实验开关或 Origin Trial 影响
2. **Tier 2 — 用户自己配置的 API**
   - 复用设置页已有 provider 配置
   - 推荐使用：Ollama 本地 / DeepSeek 免费余额 / Gemini 免费 tier / Groq 免费 tier / 智谱 GLM Flash 免费 tier
   - Key 由用户自己申请并保存在本地浏览器，不经过项目方服务器
3. **Tier 3 — 本地兜底**
   - 如果以上都不可用，就直接保留本地拆解结果，不做 rerank

### 精修后会改什么？

- 标题更贴合具体任务主题
- `estMinutes` 更合理
- `tips` 更短、更鼓励
- 若 AI 返回 JSON 非法、步数过少或接口失败，会自动保留原始本地结果

> 说明：Chrome Prompt API 在真实 Chrome 扩展中可以接入对应接口，但在当前 Web 试玩页通常不可直接使用，因此试玩页会优雅降级到“用户 API / 本地兜底”。

## 🧭 使用流程

1. 点击浏览器右上角的懒羊羊图标（或按 `Alt + L`）。
2. 在输入框里写下“今天想搞定什么事？”，例如「把这周的周报写完」「准备明天评审会」「跑步 5km」。
3. 点“拆成傻瓜步骤，开干！”。
4. Plan 视图会展示本地拆解 + 免费 AI 精修后的结果，可继续微调。
5. 分步页只显示**当前这一步**——照做，然后点 ✅ 完成。
6. 想和朋友一起打卡时，点顶栏 **👥** 建队 / 入队，再导出快照或配置免费 URL 同步。
7. 点 🏠 进入宠物之家喂宠物；点 👤 进入“我的”查看用户 ID、备份和 AI 精修状态。

## 🚀 安装（开发者模式加载）

> 目前仍处于快速迭代阶段，尚未发布到 Chrome Web Store。请通过“开发者模式”加载本仓库：

1. `git clone https://github.com/ustiniankw/lazy-sheep-king.git`
2. 打开 `chrome://extensions/`
3. 右上角开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本仓库根目录 `lazy-sheep-king/`
5. 完成！工具栏就会出现一只戴皇冠的懒羊羊 🐑👑

**兼容性**：Chrome 88+ / Edge / Arc 等基于 Chromium 的浏览器（Manifest V3）。

## ⚙️ 设置说明

设置页现在分成两层：

- **AI 精修（免费）**：开关 + Chrome 内置 AI 可用性状态
- **用户 API（可选 Tier 2）**：仅在 Chrome Prompt API 不可用时作为免费 / 自带 Key 降级方案

点击工具栏图标 → ⚙ 图标 → 打开设置页，可填写：

| 字段 | 例子 |
| --- | --- |
| Provider | DeepSeek / 智谱 GLM / Ollama / Custom |
| Base URL | `https://api.deepseek.com/v1` |
| API Key | `sk-...` |
| Model | `deepseek-chat` / `glm-4-flash` / `llama3.1` |

保存后可以点“测试连接”验证。所有 Key 都只保存在你自己的浏览器 `storage.local` 中。

## 👤 用户体系、备份与 Web 降级

点 popup 顶栏 **👤** 可打开“我的”视图：

- 查看匿名用户资料：`userId / displayName / deviceLabel / createdAt`
- 点击底部迷你 userId badge 一键复制
- 启用 / 关闭 **免费 AI 精修**
- **启用跨设备同步基础**：当 `chrome.storage.sync` 可用且用户主动开启时，会同步 `profile / tasks / settings / 精简 stats`
- **导出备份**：下载完整 JSON（任务、历史、统计、宠物状态、队伍状态、设置、profile 等）
- **导入备份**：按合并策略恢复数据

> Web 试玩环境没有 `chrome.*`，会自动优雅降级为 `localStorage`。同理，Chrome Prompt API 在试玩页通常也不可直接使用，因此会展示为不可用并回退本地 / 用户 API。

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

### ✨ v0.3.3 · 删除修复 + 宠物反馈 + 用户体系 + 本地兜底升级（✅ 已完成）
- [x] 任务丢弃修复
- [x] 步骤页快捷丢弃
- [x] 宠物喂养反馈系统
- [x] 我的视图
- [x] 本地兜底质量升级

### 🚀 v0.3.4 · 组队模式 + 隐私模式 + 免费 AI 精修（✅ 当前版本）
- [x] 创建 / 加入队伍、团队码复制
- [x] 队伍快照导入 / 导出、poke 合并
- [x] 默认隐私 + 每任务隐私切换
- [x] 免费 URL 同步（可选、无 URL 不发请求）
- [x] 免费 AI 精修三档降级（Chrome AI → 用户 API → 本地兜底）
- [x] 新增 `tests/team.test.mjs` 与 `tests/ai_rerank.test.mjs`

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
│   ├── storage.js        # 多任务 / stats / team / settings / recentBreakdowns
│   ├── breakdown.js      # 本地拆解 + 免费 AI 精修接入
│   ├── ai_rerank.js      # Chrome AI / 用户 API / skip
│   ├── team.js           # team code / snapshot / poke / merge
│   ├── user.js
│   ├── pets.js
│   ├── step_timer.js
│   ├── calendar.js
│   ├── providers.js
│   └── celebrate.js
├── tests/
│   ├── ai_rerank.test.mjs
│   ├── team.test.mjs
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

- `tests/ai_rerank.test.mjs`：15/15 ✅
- `tests/team.test.mjs`：21/21 ✅
- `tests/breakdown.test.mjs`：15/15 ✅
- `tests/breakdown_local.test.mjs`：36/36 ✅
- `tests/calendar.test.mjs`：10/10 ✅
- `tests/pets.test.mjs`：13/13 ✅
- `tests/step_timer.test.mjs`：15/15 ✅
- `tests/tasks.test.mjs`：14/14 ✅
- 累计：**139/139 全部通过**

## 📄 License

MIT © 2025 [ustiniankw](https://github.com/ustiniankw) (xiakaiwen)
