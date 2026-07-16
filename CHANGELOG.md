# CHANGELOG

## v0.5.1 — 永不卡住 + 免费 AI 一键接入（2026-07-16）

🚀 **在线试玩**：https://324d0dbb517c.aime-app.bytedance.net

> 本次为 bugfix + 体验版本，聚焦两个真实用户反馈：「免费 AI 用不了」「只有列出的几个任务能拆解，其他会卡住」。**278 个测试断言全部通过（37/37 test 文件绿）**，零功能回退。

### 🐛 修复

- **修复：低覆盖任务会卡住 → 现在永不卡住**。本地管线（normalize → classify → template → 通用兜底）保证 <100ms 内返回 **≥ 4 个有效步骤**，绝不 hang、绝不抛异常。AI rerank 加 **6s 硬超时（Promise.race）**，超时静默回退本地并记诊断日志；popup CTA「开始拆解」最长锁定 8s，超时展示本地结果 + toast「AI 精修超时，已使用本地拆解结果」。任何 AI JSON 解析错误 → 静默丢弃 AI 部分保留本地；整条管线 try/catch，异常时仍返回安全通用模板 + toast「拆解遇到异常，已使用通用模板 · 详情见诊断」。
- **修复：本地兜底 `default.generic` 对任意任务输出合理 5-6 步**。基于归一化 `subject` + 提取到的 hints（时间 / 数量 / 公里 / 页数 / deadline）动态生成「明确目标 → 拆第一小步 → 集中做 N 分钟 → 回顾进度 → 收尾整理」骨架；有 `minutes` hint 时替换第 3 步时长。

### ✨ 新增

- **新增 8-10 个意图 + 关键词库扩充 30-50%**：`life.finance.tax` / `life.parenting` / `life.gift` / `life.medical` / `life.legal` / `life.housing` / `life.relationship` / `life.hobby.instrument` / `life.hobby.craft` / `career.job_search.followup`，并为每个既有意图补充口语 / 英文混写 / 同义词。
- **通用模板池**：`default.generic` 从单一兜底升级为 deep-work / lightweight / creative / research / social 5 套骨架，用主语动词的廉价启发式挑「最贴合」的一套 —— 即使不匹配任何意图，也能给出最合适的通用拆法。
- **Google Gemini / Groq / DeepSeek 免费 tier 一键向导**：三步注册指引 + 预填 baseUrl / model + `保存并测试` 探针请求（发 `hello, respond with the word ready`），成功显示绿色 ✓、失败显示红色详细错误。「我的」和设置页均可用。
- **拆解诊断面板**（我的 → 折叠区）：显示 Chrome Prompt API 可用性、已配置 provider / model / base、最近 5 次拆解记录（ts / input / intent / source / latency / tier / ok / error），一键复制为 JSON 便于反馈；本地环形缓冲保留最近 20 次，**永不记录 key**。
- **AI rerank 6s 超时 + 骨架 loader**：等待时展示 3-4 行灰色 shimmer 骨架，不再「假死」。

### 🔧 说明

- **Chrome 内置 Prompt API 因浏览器兼容不稳定，降级为可选被动兜底**。检测顺序改为 **优先使用用户配置的 API**（若已配置 key），Chrome Prompt API 变为 Tier 2；UI 标签更新为 `Chrome AI（仅 138+ 且启用 flag，实验性）`。未配置任何 AI 时会给出「3 分钟接入免费 Gemini」的柔性引导。

---

## v0.5.0 — 多端形态：响应式 + PWA + Open-in-Tab（2026-07-16）

🚀 **在线试玩**：https://1e8add08b5ba.aime-app.bytedance.net

> 多平台里程碑：三个 breakpoint 响应式布局（phone / tablet / desktop），PWA 离线安装，Chrome 扩展 Open-in-Tab 大屏体验。**187 个测试全部通过，零功能回退**。

### 🖥 Feature A — 响应式布局 + 桌面模式切换

- 三个断点：phone `< 640px`（底部 Tab bar）/ tablet `640–1023px`（200px 侧栏 + 主内容）/ desktop `≥ 1024px`。
- Desktop 两种子模式（用户可选）：
  - **三栏**（默认）：220px 侧栏 + 主内容 + 300px 右面板（宠物卡 / 今日统计 / 14 天打卡条）。
  - **单列极简**：56px 图标栏（hover tooltip） + 主内容 `max-width: 720px` 居中。
- 新增 `<aside class="ios-sidebar">` / `<aside class="ios-right-panel">` / `<nav class="ios-icon-rail">`。
- CSS media query 驱动默认可见性；`body.desktop-mode-3pane` / `body.desktop-mode-centered` JS override。
- 设置 UI：「我的 → 桌面显示」分段控件 `三栏 / 单列极简`，写入 `settings.desktopMode`，即时生效。
- Tablet+ 隐藏 topbar 📅 / 👥 / 👤 快捷按钮（侧栏已覆盖）。
- `lib/layout.js`：导出 `computeBreakpoint(width)` 和 `layoutVisibility(breakpoint, mode)` 纯函数。
- `prefers-reduced-motion` 尊重：禁用 stagger 动画。

### 📱 Feature B — PWA（Progressive Web App）

- `manifest.webmanifest`：name / short_name / start_url / display:standalone / icons 128 + 256 + maskable。
- `service-worker.js`：缓存 app shell（stale-while-revalidate）；API 网络优先；跨域 pass-through；版本化 `lsk-cache-v0.5.0`。
- SW 注册仅在非 Chrome extension 上下文：`!('chrome' in window && chrome.runtime?.id)`。
- `popup/popup.html` + `index.html` 引用 manifest + `<meta name="theme-color">` + Apple PWA meta。
- **安装引导 UX**：
  - 监听 `beforeinstallprompt` → topbar 显示「📲 安装 App」chip。
  - iOS Safari 检测：首次访问弹出底部 sheet 引导添加到主屏幕（可 dismiss + localStorage 持久化）。
- **离线指示器**：`navigator.onLine === false` → 显示「⚡ 离线模式」chip。
- PWA 启动（`?pwa=1`）→ 自动 full-page 模式 + 隐藏 open-in-tab 按钮。

### ⤢ Feature C — Chrome Extension Open-in-Tab

- Topbar 新按钮 `#btn-open-tab`（⤢）：仅在扩展 popup 或非 full 模式下显示。
- 点击 → `chrome.tabs.create({ url: popup.html?full=1 })` + 关闭 popup。
- `?full=1` → `body.full-page` 类，适配桌面断点。
- 设置 `defaultOpenIn`（popup / tab），「我的 → 启动方式」分段控件。
- 若 `defaultOpenIn === 'tab'`，扩展 popup 打开时自动跳转到新标签页。

### 🧪 Tests

- `tests/layout.test.mjs`（新）：8 assertions（computeBreakpoint + layoutVisibility）。
- `tests/pwa.test.mjs`（新）：11 assertions（manifest 键校验 + SW 文件存在 + 缓存版本）。
- `tests/settings.test.mjs`（新）：6 assertions（desktopMode / defaultOpenIn 默认值 + 合并语义）。
- 原有 162 测试全部通过，总计 187 green / 0 red。

### 📦 Infra / Docs

- `manifest.json` → 0.5.0，新增 `"tabs"` 权限 + `web_accessible_resources`。
- `README.md`：新增「🌈 v0.5.0 · 多端形态」段 + 平台表格 + PWA 安装三步 + Desktop 模式说明。
- `index.html`：v0.5.0 标识 + PWA install hint + feature grid 更新。
- `CHANGELOG.md`：本条目。

---

## v0.4.0 — iOS 原生风 UI 重构（MAJOR UI overhaul，零功能回退）（2026-07-16）

🚀 **在线试玩**：https://c97743bfb5c2.aime-app.bytedance.net

> 一次纯 UI 层的大重构：从 v0.3.x 的"暖奶油"配色升级到 iOS 原生视觉语言，采用 Apple 系统色、SF Pro + PingFang SC 字重层级、圆角分组卡片、毛玻璃底部 Tab Bar、`cubic-bezier(0.4,0,0.2,1)` 300ms 动效。**完整保留 v0.3.5 全部功能与存储结构，163 个单元测试 100% 通过**。

### 🎨 设计语言 — 全部 tokens-driven（`popup/popup.css` 顶部 `:root`）

- **调色板**：Blue `#007AFF` · Green `#34C759` · Orange `#FF9500` · Red `#FF3B30` · Purple `#AF52DE` · Teal `#5AC8FA` · Gray 1-6 阶梯。
- **Surfaces**：`--surface-bg: #F2F2F7` · `--surface-card: #FFFFFF` · `--separator: rgba(60,60,67,0.08)`。
- **Radius**：card 14px / row 10px / button 12px / chip 100px。
- **Shadows**：card `0 1px 3px rgba(0,0,0,0.04)` · elev `0 8px 24px rgba(0,0,0,0.08)`。
- **Typography**：`-apple-system, 'SF Pro Text', 'PingFang SC', ...`；大标题 32px 700 letter-spacing -0.5px。
- **Motion**：`--ease-ios: cubic-bezier(0.4,0,0.2,1)`；视图切换 300ms；按下 `scale(0.97)` + `opacity 0.85`；stagger fadeIn 递增 0.06s。
- **深色模式**：`@media (prefers-color-scheme: dark)` 一处覆盖，全站自动跟随系统。

### 🧭 布局重构

- **`<header class="ios-topbar">`**：sticky + `backdrop-filter: saturate(180%) blur(20px)`；左侧 32×32 圆角 mascot 头像（`icons/icon-32.png`，可点击返回首页）；中间大标题动态切换；右侧 📅 / 👥 / 👤 / ⛶ / ⚙ 圆形快捷键（32×32）。
- **`<nav class="ios-tabbar">`**：底部 5-tab 毛玻璃导航 🏠 首页 / 📋 任务 / 🐑 宠物 / 📅 打卡 / 👤 我的；`position: sticky`，顶部 1px separator。
- **`<main class="ios-main">`**：每个视图使用 `data-view`；`.view` 使用 iOS push-in 动画（translateX 12→0 + fadeIn 320ms）。

### 🏠 全新 Home 视图（landing dashboard）

- 动态问候语（早/中/下午/晚上）+ 副标题根据"进行中任务数"变化。
- Hero 蓝渐变卡：今日完成步数大字 + 养料副标。
- 进行中任务卡片：目标 / 已完成/总步骤 / 当前步骤 / 进度条 + "继续这个任务 →" 主按钮，可一键跳到 steps view。
- 4 格快捷 tile：新任务 / 宠物之家 / 打卡记录 / 组队。
- "今日统计" 分组列表：完成步骤 · 获得养料 · 连续打卡 · 宠物等级（带 chevron 可跳）。

### 📋 各视图 iOS 化

- **任务输入**：`.chips-grid` 2×2 pastel tinted tile 快捷示例；带 inset shadow 的 pill 输入框；`.ios-btn-primary big block` 主 CTA。
- **拆解结果**：目标行 `.goal-line` + `.plan-meta` 药丸标签；`.plan-list > .plan-item` 卡片化可编辑；plan-actions & plan-cta 分两行。
- **专注一步**：`.step-card` 22px 700 大标题 + 圆蓝 tag + 详情；step-list 使用 iOS 待办清单圆圈（22px），当前项蓝色 halo `box-shadow: 0 0 0 3px rgba(0,122,255,0.12)`，完成态实心绿 + ✓ + 灰色删除线。stimer-card 支持 phase → 主色微渐变。
- **宠物之家**：hero 96×96 mascot `filter: drop-shadow`，`feed-pop` 动画重做为 iOS-y 弹性；`.pet-milestones` 4 枚 pill 状勋章，达标绿高亮；亲密度条渐变（tier: low/mid/high/max）。喂养历史 `<details>` 折叠。
- **打卡日历**：cal-stat 4 格圆角卡；30 / 90 天切换用 iOS segmented control (`.cal-range-switch`)；热力格 12×12 border-radius 3，颜色矩阵 `#EBEDF0 → #0E9F52`。
- **组队**：team-code 单色系 chip 可点复制；member card 分栏；隐私 chip 3 色（blue/purple/orange）；poke 卡带 amber 左边框条；同步 URL box + 立即同步。
- **我的**：48×48 圆头像 + verified 徽章 + mode-chip（`mode-guest` / `mode-passphrase` / `mode-github`）；grouped `.my-card` 分组；备份区 2×2 iOS action grid。
- **登录弹窗**：从底部 slide-up sheet，顶部 36×5 drag handle + 圆角 18px；`.modal-tabs` iOS segmented control；输入框 focus 蓝色 halo。

### 💫 动效系统

- 视图进入：`translateX(12px) → 0` + `opacity 0 → 1` 320ms ease-ios。
- 元素 stagger：`.fade-in.delay-1/2/3/4` 递增 0.06s。
- 按下反馈：全局 `.ios-btn:active { transform: scale(0.97); opacity: 0.85 }`。
- 步骤卡进入：`iosStepIn` 400ms translateX + 微 scale 0.98 → 1。
- Toast：从底部 tabbar 上方 24px 滑入，capsule shape、subtle shadow，2.4s 自动消失。

### 🛡 兼容 & 保留

- **APP_VERSION** `0.3.5 → 0.4.0`；`manifest.json version` `0.4.0`。
- 所有 popup.js 里的 DOM ID **保持原样**（`task-input` / `plan-list` / `steps-list` / `pet-avatar` / `cal-heatmap` / `team-root` / `account-card` / `sign-in-modal` 等）→ 保证 `lib/` 各模块 & 单元测试完全兼容。
- 保留全部 `.chip` / `.btn` / `.btn.primary` / `.btn.ghost` / `.tasks-item` / `.plan-item` 等旧 class 的兜底样式，避免 popup.js 里的动态注入 HTML 失去样式。
- **Icon 资产未替换**：topbar `../icons/icon-32.png`、pet hero `../icons/mascot.png`、done view `../icons/icon-256.png`、favicon 都指向已有懒羊羊 logo。
- 全局无 `emoji-only` 替换，SVG / img 优先。

### ✅ 测试

- `node --test tests/*.mjs`：**163 passed, 0 failed**（storage / breakdown / calendar / pets / step_timer / auth / team / ai_rerank / breakdown_local / tasks 全部通过）。
- `node --check popup/popup.js`：语法通过。
- `html_vision`：Home / Pet / Calendar / Team / My 五视图逐一 render 校验，mascot 加载 OK，tabbar 可见，无 console error。

### 📝 文件改动一览

- `popup/popup.css`：完全重写为 tokens-driven CSS（≈900 行）。
- `popup/popup.html`：`<header class="ios-topbar">` + `<main class="ios-main">` + `<nav class="ios-tabbar">` 三段式；新增 `view-home` 首页视图。
- `popup/popup.js`：新增 `VIEW_META` / `updateTopbarTitle` / `setActiveTab` / `renderHomeDashboard` / `showTaskInput`；tabbar routing；`showHome` 改为 landing dashboard；APP_VERSION 升到 0.4.0；wire pet mascot & milestones。
- `options/options.css`：iOS tokens 同步；`options/options.html` lead 文案与 footer 版本号更新到 v0.4.0。
- `index.html`：完全重写为 iOS 风演示页 + 设计规范 tokens 展示。
- `manifest.json`：version 0.4.0。
- `README.md`：新增 "🎨 v0.4.0 — iOS 原生风 UI 重构" 章节 + 折叠设计规范。
- `CHANGELOG.md`：本条。

---

## v0.3.5 — 认证账号系统（三种免费模式，零付费依赖）（2026-07-15）

🚀 **在线试玩**：https://1e8add08b5ba.aime-app.bytedance.net

> 从「本地匿名 userId」升级为真正的「认证账号」体系：新设备可登录同一账号、同一浏览器可区分多人、备份可加密。三种模式全部 **¥0 成本、无付费后端依赖**，且匿名用户可平滑升级为真实账号而不丢数据。

### 1. 新增 `lib/auth.js` — 统一认证层
- `MODE = { GUEST, PASSPHRASE, GITHUB, GOOGLE }`，当前模式互斥。
- 全异步、无同步 IO；所有函数在网页试玩环境可安全调用（无 `chrome.*` 硬依赖）；不可用时返回 `{ok:false, code, message}` 而非抛错。
- 导出 API：`getAuthState / isSignedIn / setupPassphrase / verifyPassphrase / changePassphrase / evaluatePassphrase / beginGitHubDeviceFlow / pollGitHubDeviceFlow / getGitHubToken / signInGoogle / signOut / getSession / lockSession / encryptBackup / decryptBackup`。

### 2. 三种账号模式
- **👤 访客（Guest）**：保留原有本地匿名 `usr_xxxxxx`，不想认证的用户零感知。
- **🔐 本地密码账号（Passphrase，全环境可用，含网页试玩）**：
  - 昵称 + 密码（≥6 位，屏蔽明显弱口令）。
  - Web Crypto `PBKDF2(passphrase, salt=random16B, iters=100000, SHA-256) → 32B key`。
  - 仅落盘 `{salt, verifierHash=SHA256(key), createdAt}`，**绝不存储密码或原始 key**。
  - 派生 key **只在内存**中保留供本次 popup 会话加解密。
  - 会话闲置 15 分钟自动锁定（`getSession()` 返回 null）。
  - 敏感操作加锁：`生成新用户ID` / `导入备份` / `切换账户` 需先验证解锁。
  - **加密备份**：解锁状态下 `导出备份` 使用 AES-GCM，输出带 `enc:true` 标记；导入时提示输入密码。
- **🐙 GitHub OAuth Device Flow（扩展环境优先，网页 CORS 受限时优雅禁用）**：
  - 用户自建 **免费公开 GitHub OAuth App** 并粘贴自己的 `client_id`（**不内置共享 client_id/secret，保持完全用户自持、零成本**）。
  - `POST /login/device/code` → `POST /login/oauth/access_token` 轮询 → `GET api.github.com/user`。
  - 弹窗显示 `user_code`、复制按钮、验证链接与倒计时轮询状态。
  - Token 以本地设备 key（AES-GCM）**加密落盘**（best-effort，非真正 KMS），供后续 Gist 同步。
  - 网页试玩若被 CORS 拦截，捕获并提示「网页试玩环境无法完成 GitHub 登录，请在安装扩展后使用」。
  - 退出时尽力 `DELETE /applications/{client_id}/token` 撤销，失败则仅本地删除。
- **🟢 Google（Chrome Identity API，骨架占位）**：按钮 disabled，`signInGoogle` 返回 `{ok:false, code:'NOT_ENABLED'}`，tooltip/文档说明需扩展上架 Chrome Web Store 并配置稳定 OAuth2 client_id 后启用。

### 3. 多账号数据命名空间（`lib/storage.js`）
- 物理键格式 `lsk:${accountKey}:${logicalKey}`，`accountKey` 为 `guest:${userId}` / `p:${userId}` / `gh:${providerId}`。
- v0.3.5 首次启动自动迁移：旧未命名空间键 → `lsk:guest:${legacyUserId}:...`，写入 `_migrated_035` 标记，不丢数据。
- 新增 `switchAccount / copyAccountData / getCurrentAccountKey / getGlobal/setGlobal/removeGlobal / ensureMigrated`；活跃账号键存于 `lsk_active_account_v1`。
- 读取未知键干净地返回默认值。

### 4. UI 重构「我的」视图 + 登录弹窗
- 顶部账号卡片：头像（自定义宠物图 / GitHub 头像 / 首字母生成）、内联改名、模式 chip（👤 访客 / 🔐 本地账号 / 🐙 GitHub / 🟢 Google 未启用）、GitHub 已验证徽章、🔒 锁定按钮。
- 上下文相关的账号操作区（访客创建/登录、本地账号解锁/改密/锁定/退出、GitHub 主页/退出）。
- 新增 `#sign-in-modal`：passphrase / GitHub 标签页，密码强度条，GitHub client_id 输入 + 复制代码 + 验证链接 + 轮询状态倒计时。
- 队友卡片：成员 `provider=github` 时显示 🐙 已验证徽章。

### 5. `lib/user.js` 兼容门面
- 保留为向后兼容 facade，委托 `lib/auth.js`（`getProfile→getAuthState`、`setDisplayName`、`regenerateUserId` 受会话解锁保护）。
- 新增 `lib/user_id.js` 抽出无依赖的 userId 工具（`safeUUID / createUserId / detectDeviceLabel / defaultDisplayName`）。

### 6. manifest / 权限
- 版本 `0.3.4 → 0.3.5`。
- 新增 `identity` 权限（Google 未启用时为 no-op）。
- 新增 `host_permissions`：`https://github.com/*`、`https://api.github.com/*`。

### 7. 测试
- 新增 `tests/auth.test.mjs`（17）：passphrase setup/verify（正/负）、PBKDF2 同盐同密一致/异盐不同、加密备份 roundtrip、锁定清会话、改密、GitHub device flow（mock fetch：pending×2 → access_token → user profile）、`beginGitHubDeviceFlow('')→MISSING_CLIENT_ID`、GitHub CORS 失败优雅降级、Google `NOT_ENABLED`、强度评估。
- 新增 `tests/storage_ns.test.mjs`（7）：旧数据迁移不丢失、`_migrated_035` 写入、账号键正确、命名空间隔离、未知账号返回默认、`copyAccountData` 升级保留数据。
- 全量：**163/163 通过**（原 139 + 新 24）。

## v0.3.4 — 组队模式 + 隐私模式 + 免费 AI 精修（2026-07-15）

🚀 **在线试玩**：https://5bd40465996c.aime-app.bytedance.net

### 1. 组队模式 + 隐私模式
- 新增 `lib/team.js`：
  - `newTeamCode()`：生成 6 位大写十六进制团队码
  - `buildMyMemberSnapshot(...)`：输出 `昵称 / 设备 / 今日步数 / 当前任务视图 / 连续打卡 / 最近活跃`
  - `mergeTeamState(...)`：按 `userId + updatedAt` 合并成员，按 `pokeId` 去重合并 poke
  - `makePoke(...)`：创建 `pokeId / from / to / message / ts / read`
- `lib/storage.js` 扩展 team 相关存储：
  - `team.self = { teamCode, joinedAt, syncUrl? }`
  - `team.state = { code, members, pokes, updatedAt }`
  - `settings.team = { defaultPrivacy, pokesSoundOn }`
  - 任务新增 `privacy` 字段；旧任务在加载时自动按 `settings.team.defaultPrivacy` 补齐
- popup 顶栏新增 **👥** 入口：
  - 创建 / 加入队伍
  - 显示成员卡片：昵称、设备、今日步数、当前任务、连续打卡、最近活跃
  - 每个队友支持 `🫵 拍一拍`
  - 队伍快照 `导出 / 导入`
  - 默认隐私设置 `公开 / 仅隐藏标题 / 完全隐私`
  - 步骤页新增 🔒 隐私切换按钮，支持单任务循环切换
- poke 收件箱：
  - 队伍页顶部新增未读 shelf
  - 顶栏 **👥** 按钮显示 bell badge 红点数量
  - 进入 popup / team 视图时可看到收到的拍一拍提醒

### 2. 零成本同步：默认快照，可选免费 URL
- **默认模式：手动快照交换**
  - 不依赖任何后端服务
  - team snapshot JSON 内同时包含成员快照与 poke 状态
- **可选模式：免费 URL 同步**
  - 用户主动粘贴 JSONBin.io / npoint.io URL 才启用
  - popup 打开期间按 60s 节流拉取并尝试 PUT
  - 无 URL 时完全不发网络请求
  - 网络失败只显示轻量“同步失败” pill，不打断主流程

### 3. 免费 AI 精修（不用项目方出钱买 GPT）
- **成本说明**：OpenAI 的 GPT API 需要付费，因此本版本不采用项目方出钱的 GPT 路线。
- 改为 **完全免费** 的三档实现，按可用性自动降级：
  1. **Tier 1（推荐）**：Chrome 内置 Prompt API（`LanguageModel` / `chrome.aiOriginTrial.languageModel`），本地推理，不上传数据
  2. **Tier 2**：用户自己在 v1 API 设置里配置的 provider（如 Ollama 本地 / DeepSeek / Gemini 免费 tier / Groq / 智谱 GLM Flash 等）
  3. **Tier 3**：全部不可用时保留 v0.3.3 本地兜底结果，不做 rerank
- 新增 `lib/ai_rerank.js`：
  - `detectAvailableTier()`
  - `rerankSteps({subject, steps, hints, intent}, options)`
- `lib/breakdown.js` 接入策略改为：
  - 先产出本地步骤
  - 若 `settings.aiRerankEnabled !== false`，再尝试免费 AI 精修
  - 精修只替换 `title / detail(tips) / estMinutes`
  - AI 返回 JSON 非法、步数不足、接口异常时自动保留原始步骤
- `options` 与 popup「我的」视图新增：
  - `启用 AI 精修（免费）` 开关
  - `Chrome 内置 AI：可用 / 不可用` 状态展示
  - 文案明确说明“本功能仅使用免费方案，不产生任何 API 费用”

### 4. 文档 / 主页 / 版本
- `manifest.json`：`0.3.3 → 0.3.4`
- `README.md`：新增「组队与隐私」「AI 精修（免费方案）」章节，并把 roadmap 标记到 v0.3.4
- `index.html`：主页试玩页新增两大特性文案与 roadmap 更新
- `options/options.html`：改为免费 AI 精修导向的配置说明

### 5. 测试
- `tests/ai_rerank.test.mjs`：15/15 ✅
- `tests/team.test.mjs`：21/21 ✅
- `tests/breakdown.test.mjs`：15/15 ✅
- `tests/breakdown_local.test.mjs`：36/36 ✅
- `tests/calendar.test.mjs`：10/10 ✅
- `tests/pets.test.mjs`：13/13 ✅
- `tests/step_timer.test.mjs`：15/15 ✅
- `tests/tasks.test.mjs`：14/14 ✅
- 累计：**139/139 全部通过**

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
