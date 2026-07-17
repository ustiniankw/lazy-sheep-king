# 懒羊羊大王 · 执行力浏览器插件 🐑👑

> **让懒虫也能一步一步搞定事情** —— 你输入一件想做的事，懒羊羊大王先用本地模板拆成"傻瓜到不能再傻瓜"的小步骤，再按可用性尝试用免费 AI 精修；完成过程中还能养宠物、看打卡日历、和队友互相拍一拍。

> 🔐 **v0.7.0 起支持端到端加密备份**：用一句 14 词备份短语（PBKDF2-SHA256 · 100k rounds → AES-GCM）把全部本地数据加密导出为 `.lsk-backup` 文件，全程离线、零后端；短语明文永不落盘，只在本机存 SHA-256 校验值。

🚀 **[👉 立即使用（Web 版）](https://ustiniankw.github.io/lazy-sheep-king)** —— 一个链接直接进入，装到主屏就是 App。

![banner](./icons/mascot.png)

---

## 🌐 使用方式 A · 打开网页立即用（PWA · 推荐）

**稳定 URL：** [`https://ustiniankw.github.io/lazy-sheep-king`](https://ustiniankw.github.io/lazy-sheep-king)

> Web 版从 v0.6.0 起就是纯 2C 落地页：一个「立即开始」按钮直接进入 App，一个「添加到主屏」按钮把它装成 PWA。安装完就跟原生 App 一样，离线也能用。

- **📱 手机 Safari / Chrome**：打开链接 → 点底部「分享」按钮 ⎙ → 选「添加到主屏幕」
- **💻 PC Chrome / Edge**：打开链接 → 地址栏右侧的 ⤓ 安装图标 → 「安装」
- **🔄 更新方式：下次打开自动拿到最新版**（Service Worker + 顶部横幅「🔄 发现新版本 · 点这里刷新」，v0.5.2 起）

## 🧩 使用方式 B · 装成 Chrome 扩展（自己打包）

**三步安装** — 傻瓜级：

1. 📥 到 [**Release 页**](https://github.com/ustiniankw/lazy-sheep-king/releases/latest) 下载最新的 `lazy-sheep-king-vX.Y.Z.zip`
2. 📂 解压到本地任意目录（例如 `~/Downloads/lazy-sheep-king/`）
3. 🧩 打开 `chrome://extensions` → 右上角开启「**开发者模式**」→ 点「**加载已解压的扩展程序**」→ 选中刚解压的目录

**备注**：
- ⌨️ `Alt + L` 一键呼出 popup
- 📌 建议在扩展工具栏点右键把懒羊羊图标 pin 出来
- 🔄 **更新方式：**Release 页有新版本时，重新下载解压、在 `chrome://extensions` 点扩展卡上的 🔄「重新加载」即可

## 🛠 使用方式 C · 从源码自己 build（给动手能力强的）

```bash
git clone https://github.com/ustiniankw/lazy-sheep-king.git
```

然后直接把整个目录作为 unpacked 扩展加载即可（步骤同上）。仓库根本身就是可用的扩展目录，不需要任何构建步骤。

> **未来 Chrome Web Store 上架计划**：等一个稳定 milestone 后会打包发布到 CWS，届时会同时更新到「Web 版 + CWS 一键安装」两条链路。目前依然保持零付费依赖、纯前端。

---

## 🪶 v0.6.0 · 认证瘦身 + 2C 化落地页

本次是产品化里程碑，让懒羊羊大王的定位彻底面向普通用户（2C）：

- **落地页大改**：`index.html` 从"技术介绍页"变成纯 2C 入口 —— 品牌头 + 一个巨大的「立即开始」CTA + 4 张核心功能卡片 + PWA「添加到主屏」提示。零 jargon、零版本亮点堆叠。
- **认证瘦身**：GitHub / Google OAuth 相关 UI + 代码路径全部下线，扩展权限也一并瘦身（去掉 `identity` permission 和 `https://github.com/*` host permission）。
- **自动昵称 + DiceBear 头像**：首次进来就已经自动分配了一个可爱的中文昵称（"会飞的橘子237"），头像走 DiceBear 免费方案。可以在「我的」/「设置」页随时换风格、点头像换 seed，也支持上传本地图片。
- **匿名依旧一切照旧**：现有 `usr_xxx` 匿名身份、任务/宠物/日历/组队数据全部保留，用户旧数据完全不丢。
- **本地密码变可选**：本地密码不再是"账号系统"，只作为可选的**备份加密**能力保留（不解锁也能用 App）。

---

## 🛟 v0.5.1 · 永不卡住 + 免费 AI 一键接入

本次是 bugfix + 体验版本，直击两个真实用户反馈：

- **「免费 AI 用不了」** → Chrome 内置 Prompt API 因浏览器版本 / flag / Origin Trial 对多数用户不可用，已**降级为可选被动兜底**；改为主推 **Gemini / Groq / DeepSeek 免费 tier 一键向导**，三步拿 key、一键测试即用。
- **「只有列出的几个任务能拆解，其他会卡住」** → 现在**任意任务都能拆**：本地管线 <100ms 内保证 ≥4 步、绝不 hang；AI 精修 6s 硬超时兜底；CTA 最长 8s 锁定后必回本地结果。

### ✅「永不卡住」保证

| 环节 | 兜底策略 |
|------|----------|
| 本地管线（normalize → classify → template → generic） | 始终 <100ms 返回 **≥ 4 个有效步骤**，never hang / never throw |
| AI rerank | **6s 硬超时（`Promise.race`）** → 超时静默回退本地，记诊断日志（debug tier），绝不阻塞 CTA |
| Popup CTA「开始拆解」 | 按钮最长锁定 **8s**；无响应 → 展示本地结果 + toast「AI 精修超时，已使用本地拆解结果」 |
| AI JSON 解析错误 | 静默丢弃 AI 部分，保留本地结果 |
| 管线未知异常 | 整条 try/catch，仍返回**安全通用模板** + toast「拆解遇到异常，已使用通用模板 · 详情见诊断」 |
| 等待观感 | 展示 3-4 行灰色 shimmer **骨架 loader**，不再「假死」 |

新增 8-10 个生活场景意图（报税 / 育儿 / 送礼 / 就医 / 法律行政 / 房产 / 人际 / 学乐器 / 手工 / 求职跟进），并把既有意图关键词库扩充 30-50%（口语 + 英文混写 + 同义词）；`default.generic` 升级为 deep-work / lightweight / creative / research / social 5 套通用骨架池。

---

## 🌈 v0.5.0 · 多端形态

v0.5.0 是多平台里程碑 — **响应式布局 + PWA 安装 + Open-in-Tab**，让懒羊羊在手机、平板、桌面浏览器都能完美运行。

| 平台 | 形态 | 说明 |
|------|------|------|
| 📱 Phone | 底部 Tab Bar | Chrome 扩展弹窗 / 手机浏览器 / PWA 主屏幕 |
| 📋 Tablet (640-1023px) | 左侧边栏 + 主内容 | iPad / 小屏笔记本 |
| 🖥 Desktop ≥ 1024px · 三栏 | 侧栏 + 主内容 + 右面板 | 默认桌面模式，右面板含宠物/统计/打卡 |
| 🖥 Desktop · 单列极简 | 56px 图标栏 + 居中主内容 720px | 可在「我的 → 桌面显示」切换 |

### 📲 PWA 安装指南

**iOS Safari**
1. 打开试玩链接 → 点击底部「分享」按钮 ⎙
2. 选择「添加到主屏幕」
3. 确认名称，点「添加」

**Android Chrome**
1. 打开试玩链接 → 点击右上三点菜单
2. 选择「安装应用」或「添加到主屏幕」
3. 确认安装

**Mac / Windows Chrome**
1. 打开试玩链接 → 地址栏右侧出现 ⊕ 安装图标
2. 点击 → 确认「安装」
3. 应用出现在启动台 / 开始菜单

### 🖥 Desktop 模式切换

进入「我的」页面 → 找到「桌面显示」卡片 → 选择「三栏」或「单列极简」，立即生效，下次打开也会记住。

<details>
<summary>🎨 设计规范（Design Tokens）</summary>

全部 tokens 位于 `popup/popup.css` 顶部 `:root`，options 与 index 共享：

**调色板**
- Blue `#007AFF` · Green `#34C759` · Orange `#FF9500` · Red `#FF3B30` · Purple `#AF52DE` · Teal `#5AC8FA`
- Grays: `#8E8E93` / `#AEAEB2` / `#C7C7CC` / `#D1D1D6` / `#E5E5EA` / `#F2F2F7`

**Surfaces**
- Page bg: `--ios-gray6` · Card: `#FFFFFF` · Separator: `rgba(60,60,67,0.08)`

**Radius**
- Card 14px · Row 10px · Button 12px · Chip / pill 100px

**Shadows**
- Card `0 1px 3px rgba(0,0,0,0.04)` · Elevated `0 8px 24px rgba(0,0,0,0.08)`

**Typography**
- Stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif`
- 大标题 32px 700 letter-spacing -0.5px
- Row title 15px 500 · Row subtitle 12px

**Motion**
- Ease: `cubic-bezier(0.4, 0, 0.2, 1)` · 视图切换 300ms · 按下 100ms scale 0.97 + opacity 0.85
- 元素进入 stagger fadeIn（0.06 / 0.12 / 0.18 / 0.24s 递增延迟）

**Layout patterns**
- 分组卡片：`.ios-section > .ios-section-header + .ios-group > .ios-row × N`
- Row 内部 padding 13px 16px，`border-bottom: 1px solid var(--separator)`，`:last-child { border-bottom: none; }`
- 按钮：`.ios-btn-primary` / `.ios-btn-secondary` / `.ios-btn-ghost` / `.ios-btn-destructive`
- 状态芯片：`.ios-chip` 药丸 100px 圆角

</details>

## ✨ 特性

- **一键拆解**：把大任务拆成 4-8 步"最小可执行动作"，每步都尽量具体到能立刻开动。
- **👤 无门槛匿名 + 自动昵称/头像（v0.6.0）**：打开就能用，自动分配可爱中文昵称 + DiceBear 免费头像，可选挂本地密码给备份加密。
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
- **👤 我的 & 备份**：匿名用户 ID、昵称/头像、设备标签、导入 / 导出备份、跨设备同步基础（`chrome.storage.sync` 可用时启用）。
- **📅 完成日历打卡图**：30 / 90 天完成热力图 + 连续打卡 streak + 每日养料统计。
- **鼓励反馈**：每完成一步，撒彩带 🎉 + 懒羊羊萌语 + Web Audio 合成小音效。
- **快捷键**：`Alt + L` 一键唤起。
- **大屏模式**：点击 ⛶ 图标在新标签页打开，用更大的界面专注干活。

## 👤 身份与备份（v0.6.0 · 认证瘦身）

v0.6.0 把"账号系统"简化为「默认匿名 + 可选本地密码备份」两档，去掉了所有真实身份登录（GitHub / Google OAuth）。零后端、零 OAuth、零权限膨胀。

### 两种身份模式

| 模式 | 说明 | 何时用 |
| --- | --- | --- |
| 👤 **匿名（默认）** | 自动分配 `userId = usr_xxxxxx` + 可爱中文昵称（"会飞的橘子237"） + [DiceBear](https://www.dicebear.com/) 免费头像 | 打开就是；99% 的用户不需要再改 |
| 🔐 **本地密码（可选）** | 想让导出的备份文件自带 AES-GCM 加密时，可以再挂一个本地密码 | 备份到网盘、导出发给自己 |

- 匿名 `userId` 不会因为挂/清除本地密码而变化，所有任务 / 宠物 / 日历 / 组队数据一律保留。
- 想换昵称：点右上「保存」旁的 🎲 或直接改文字后保存。
- 想换头像：点头像本身随机换一个 seed，或从下方 4 种风格（拇指 / 机器人 / 小人 / 手绘）里挑一种，也可以上传本地图片。
- 头像走 DiceBear 免费公共 API，不需要任何 API key、不上传任何用户数据。

### 本地密码模式的安全模型（可选功能，不启用不影响使用）

- 派生：`PBKDF2(passphrase, salt=随机 16 字节, iterations=100000, SHA-256) → 32 字节密钥`。
- 存储：只保存 `{salt, verifierHash = SHA-256(key), createdAt}`，**从不存明文密码或原始密钥**。
- 解锁：输入密码 → 重新派生 → 比对 `verifierHash`；成功后派生密钥 **仅存内存**（当前 popup 会话）。
- 会话自动锁定：15 分钟无操作后，内存密钥被清除，敏感操作需重新解锁。
- 加密备份：解锁态下 `导出备份` 使用 **AES-GCM + 派生密钥**，文件含 `enc: true` 标记；导入加密备份会提示输入密码。

> **v0.6.0 起下线**：GitHub Device Flow、Google Sign-in placeholder 相关 UI + 权限。`lib/auth.js` 仍保留 `beginGitHubDeviceFlow / signInGoogle` 桩函数（返回 `{ok:false, code:'NOT_ENABLED'}`），旧代码引用不会崩，但主流程不再走 OAuth。

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

> **v0.5.1 起调整主推顺序**：Chrome 内置 Prompt API 对多数用户不可用，已降级为**可选被动兜底**；现在**优先使用你配置的免费 API**（若已填 key），推荐 Gemini / Groq / DeepSeek 免费 tier，并提供**一键接入向导**。

### ⚡ 免费 AI 三步接入（v0.5.1 主推）

打开「我的 → ⚡ 一键接入免费 AI」或设置页顶部同名面板，任选一家：

| Provider | 免费额度 | 拿 Key 地址 | 预填 baseUrl / model |
|----------|----------|-------------|----------------------|
| **Google Gemini** | ~1500 请求/天，无需绑卡 | https://aistudio.google.com/apikey | `https://generativelanguage.googleapis.com/v1beta/openai` · `gemini-2.0-flash` |
| **Groq** | ~30 请求/分钟，llama-3.1 70B 超快 | https://console.groq.com/keys | `https://api.groq.com/openai/v1` · `llama-3.1-70b-versatile` |
| **DeepSeek** | 新用户注册送额度，中文效果好 | https://platform.deepseek.com | `https://api.deepseek.com/v1` · `deepseek-chat` |

**三步**：① 按卡片指引到对应网站拿 key → ② 粘贴到「我拿到了 key，填在这里」输入框 → ③ 点「保存并测试」，会立刻发一个 `hello, respond with the word ready` 探针请求，成功显示绿色 ✓（含耗时），失败显示红色详细错误信息。

### 现有降级链（v0.5.1）

1. **Tier 1 — 用户配置的免费 API（推荐）**：Key 保存在本地浏览器，不经过项目方服务器。
2. **Tier 2 — Chrome 内置 Prompt API（实验性，被动兜底）**：`LanguageModel` / `chrome.aiOriginTrial.languageModel`，仅 Chrome 138+ 且启用 flag / Origin Trial 时可用，多数用户不可用。
3. **Tier 3 — 本地兜底**：以上都不可用时保留本地拆解结果，不做 rerank。

### 精修后会改什么？

- 标题更贴合具体任务主题
- `estMinutes` 更合理
- `tips` 更短、更鼓励
- 若 AI 返回 JSON 非法、步数过少或接口失败 / 超时（6s），会自动保留原始本地结果，绝不卡住

> 说明：Chrome Prompt API 在真实 Chrome 扩展中可以接入对应接口，但在当前 Web 试玩页通常不可直接使用；未配置任何 AI 时，「我的」会给出「3 分钟接入免费 Gemini」的柔性引导。遇到问题可在「我的 → 🔧 拆解诊断」复制诊断 JSON 反馈。

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

点 popup 顶栏 **👤** 可打开"我的"视图（v0.6.0 重构为「身份卡片 + 头像编辑器 + 备份区」）：

- 顶部账号卡片：DiceBear 头像 / 昵称输入 + 🎲 随机 + 保存、模式徽章（👤 匿名 / 🔐 本地密码）、🔒 锁定按钮（仅本地密码模式）。
- 头像编辑器：点头像随机换一个 seed；4 种 DiceBear 风格切换；支持上传本地图片（≤ 512KB）。
- 上下文相关操作：匿名可 `挂一个本地密码`；本地密码锁定态显示解锁输入框，解锁态显示 `修改密码 / 锁定 / 清除本地密码`。
- 登录弹窗 `#sign-in-modal`：v0.6.0 起只保留「本地密码」单 Tab，带实时强度条。
- **导出备份**：本地密码解锁时自动 AES-GCM 加密（文件带 `enc:true`）；否则明文 JSON。
- **导入备份**：自动识别加密备份并提示输入密码；本地密码锁定态会要求先解锁。
- **生成新用户 ID**：锁定态受保护，需先解锁。
- 启用 / 关闭 **免费 AI 精修**、**跨设备同步基础**（`chrome.storage.sync` 可用时）。

> 多账号数据隔离：`lib/storage.js` 以 `lsk:${accountKey}:${键}` 命名空间存储，`accountKey` 为 `guest:${userId}` / `p:${userId}`；v0.3.5 首次启动会把旧版未加前缀的键平滑迁移到访客命名空间（`_migrated_035` 标记，不丢数据）。身份信息（昵称 / 头像）在 `lsk_identity_v1` 全局键下，跨账号共享。

> Web 环境没有 `chrome.*` 时会自动优雅降级为 `localStorage`。匿名与本地密码在 PWA / 扩展 / Web 环境全部可用。

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

### 🚀 v0.3.4 · 组队模式 + 隐私模式 + 免费 AI 精修（✅ 已完成）
- [x] 创建 / 加入队伍、团队码复制
- [x] 队伍快照导入 / 导出、poke 合并
- [x] 默认隐私 + 每任务隐私切换
- [x] 免费 URL 同步（可选、无 URL 不发请求）
- [x] 免费 AI 精修三档降级（Chrome AI → 用户 API → 本地兜底）
- [x] 新增 `tests/team.test.mjs` 与 `tests/ai_rerank.test.mjs`

### 🔐 v0.3.5 · 认证账号系统（✅ 已完成，v0.6.0 已简化）
- [x] 访客 / 本地密码账号 / GitHub 登录三种免费模式，优雅降级
- [x] 本地密码：PBKDF2(10万次)+AES-GCM，密钥仅存内存、15 分钟自动锁定
- [x] 加密备份导出 / 导入；敏感操作（生成新 ID / 导入 / 切换账号）加锁
- [x] GitHub OAuth Device Flow（不内置 client_id）；令牌加密存于本机
- [x] Google 登录骨架（disabled，待发布至商店）
- [x] 多账号数据命名空间 + 旧数据平滑迁移（`_migrated_035`）
- [x] 新增 `tests/auth.test.mjs` 与 `tests/storage_ns.test.mjs`
- [x] **v0.6.0 起下线** GitHub / Google 登录路径与相关 UI/权限

### 🪶 v0.6.0 · 认证瘦身 + 2C 化落地页（✅ 当前版本）
- [x] `index.html` 重写为纯 2C 落地页：品牌头 + 立即开始 CTA + 4 张功能卡 + PWA 添加到主屏
- [x] 卸掉 GitHub / Google OAuth UI + 代码路径 + manifest 权限（`identity` permission、`github.com` host permission）
- [x] 新增 `lib/identity.js`：随机可爱中文昵称（"会飞的橘子237"）+ DiceBear 免费头像
- [x] 「我的」页 / 设置页新增头像编辑器：4 种风格切换、点头像换 seed、上传本地图片
- [x] `usr_xxx` 匿名身份 & 现有本机数据全部保留，本地密码变成"备份加密"可选项
- [x] 新增 `tests/identity.test.mjs`；旧 `tests/auth.test.mjs` 更新为覆盖新的匿名 + 昵称路径

### 🛟 v0.5.1 · 永不卡住 + 免费 AI 一键接入（✅ 当前版本 · Roadmap 兑现）
- [x] 「永不卡住」保证：本地管线 <100ms 返回 ≥4 步、never hang / never throw
- [x] AI rerank 6s 硬超时（`Promise.race`）→ 静默回退本地 + 诊断日志
- [x] Popup CTA 最长锁定 8s + 骨架 loader；超时 toast 本地结果
- [x] `default.generic` 通用模板池（deep-work / lightweight / creative / research / social）
- [x] 新增 8-10 个生活意图 + 既有意图关键词库扩充 30-50%
- [x] 免费 AI 一键向导：Gemini / Groq / DeepSeek 三步接入 + 探针测试
- [x] 拆解诊断面板（Chrome Prompt 可用性 / provider / 最近 5 次记录 / 复制 JSON）
- [x] Chrome 内置 Prompt API 降级为可选被动兜底，主推用户免费 API
- [x] 新增 `tests/breakdown_universal.test.mjs`、`tests/breakdown_never_stuck.test.mjs`、`tests/providers.test.mjs`；测试断言 187 → 278

### ⏳ 后续
- [ ] v0.7 · Todoist / Notion / 飞书任务导入
- [ ] v0.8 · 组队 6 位队伍码接 Cloudflare Workers KV
- [ ] 宠物商店 / 换装 / 好友互动
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
│   ├── storage.js        # 多任务 / stats / team / settings / 多账号命名空间
│   ├── auth.js           # v0.6.0 认证瘦身：guest + passphrase(PBKDF2/AES-GCM)；GitHub/Google 已下线为占位
│   ├── identity.js       # v0.6.0 新增：自动昵称 + DiceBear 头像
│   ├── user.js           # 向后兼容 facade，委托到 auth.js + identity.js + storage.js
│   ├── user_id.js        # 匿名 userId / 设备标签 / 默认昵称（无依赖）
│   ├── breakdown.js      # 本地拆解 + 免费 AI 精修接入
│   ├── ai_rerank.js      # Chrome AI / 用户 API / skip
│   ├── team.js           # team code / snapshot / poke / merge
│   ├── pets.js
│   ├── step_timer.js
│   ├── calendar.js
│   ├── providers.js
│   └── celebrate.js
├── tests/
│   ├── auth.test.mjs
│   ├── storage_ns.test.mjs
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

- `tests/auth.test.mjs`：17/17 ✅（passphrase setup/verify、PBKDF2 一致性、加密备份 roundtrip、GitHub device flow mock、Google 未启用）
- `tests/storage_ns.test.mjs`：7/7 ✅（旧数据迁移不丢失、多账号隔离、未知键返回默认、平滑升级）
- `tests/ai_rerank.test.mjs`：15/15 ✅
- `tests/team.test.mjs`：21/21 ✅
- `tests/breakdown.test.mjs`：15/15 ✅
- `tests/breakdown_local.test.mjs`：36/36 ✅
- `tests/calendar.test.mjs`：10/10 ✅
- `tests/pets.test.mjs`：13/13 ✅
- `tests/step_timer.test.mjs`：15/15 ✅
- `tests/tasks.test.mjs`：14/14 ✅
- 累计：**163/163 全部通过**（139 旧 + 24 新）

## 📄 License

MIT © 2025 [ustiniankw](https://github.com/ustiniankw) (xiakaiwen)
