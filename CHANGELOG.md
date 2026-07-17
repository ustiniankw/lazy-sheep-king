# CHANGELOG

## v0.8.5 — 兼容 KV / LSK_KV 双 binding 名（2026-07-17）

### 🐛 修复 · 创建队伍报错 `500 kv_unbound`

> **根因**：Worker 代码只读取 `env.KV`，但用户在 Cloudflare Dashboard 上的 KV binding 变量名是 `LSK_KV`，导致 `resolveKv` 前的 `env.KV` 恒为 undefined，创建队伍时返回 `500 {"error":"kv_unbound"}`。

- **Worker 现在同时接受 KV / LSK_KV 两种 binding 名，修复 kv_unbound 报错。** 新增 `resolveKv(env)` 助手（`env.KV || env.LSK_KV || null`），全文所有 KV 读写改为经由该助手解析出的 `kv` 实例，行为保持不变。
- **错误提示优化**：`kv_unbound` 的用户可见提示由「请在 wrangler.toml 配置 [[kv_namespaces]]」改为「请在 Cloudflare Dashboard 绑定 KV Namespace（变量名 KV 或 LSK_KV）」，更贴合手动部署场景。
- **wrangler.toml**：主 binding 名改为 `LSK_KV`（对齐用户账号现状），并注明 Worker 亦兼容 `KV`。
- Worker 通过 Cloudflare Dashboard 手动粘贴部署，需重贴的文件为 `worker/src/index.js`。

### 🔧 版本

- `manifest.json` → `0.8.5`；`popup/popup.js` `APP_VERSION` → `0.8.5`；`service-worker.js` CACHE_NAME → `lsk-cache-v0.8.5`；`index.html` 页脚 → `v0.8.5`；Worker `VERSION` → `0.8.5`。

## v0.8.4 — 两个用户实测 Bug 修复（2026-07-17）

### 🐛 Bug A（关键）· 创建队伍失败："网络不好，请重试"

> **根因**：组队页显示 🟢 云端已连接（`/v1/health` 是 GET、且不依赖 KV，所以能通），但点【创建队伍】时 `POST /v1/team/create` 需要 KV。线上 Worker（`lsk-sync.xiakaiwen12.workers.dev`）**未绑定 KV namespace**，返回 `HTTP 500 {"error":"kv_unbound"}`；前端 `friendlyTeamError` 把所有非枚举状态（含 500）都归成"网络不好，请重试"，掩盖了真实原因。curl 冒烟已确认：OPTIONS preflight / CORS 头完全正常（`Access-Control-Allow-Headers: Content-Type,Authorization`、`Allow-Methods` 含 POST），**并非 CORS 问题**。

- **前端错误映射修复**（`popup/popup.js` `friendlyTeamError`）：透传后端真实 `message`——4xx 显示"参数错误：xxx"，5xx 显示"服务器错误（500）：xxx"，不再一律"网络不好"。
- **⚠️ 需要用户操作（Worker 侧配置）**：Worker **代码无需重贴**（CORS 已正确）。但必须在 **Cloudflare Dashboard → 你的 Worker → Settings → Bindings → KV Namespace Bindings** 新增一个绑定：变量名 **`KV`**，选择（或先创建）一个 KV namespace，保存后 **Deploy**。绑定完成后创建队伍即可真正调通。

### 🐛 Bug B · 导航栏选中态错位

> **根因**：`VIEW_META.team.tab = 'my'`，而 `showView()` 用底部 tabbar 的 `tab` 值去更新侧边栏/图标栏高亮（`updateSidebarActive(tab || name)`）。侧边栏有独立的 `data-nav="team"` 项，于是进入组队页时高亮被错误地停在「我的」。

- **修复**：`VIEW_META` 每个视图新增独立 `nav` 字段（team → `team`），`showView()` 改用 `nav` 更新侧边栏/图标栏高亮；底部 tabbar 仍复用 `tab`（tabbar 无 team 项，映射到 my 符合预期）。现点【队友】→ 侧栏高亮「队友」。

### ✅ 测试

- `tests/sync_client.test.mjs` 新增「错误分类」用例，覆盖 400 / 401 / 429 / 500(kv_unbound) / CORS(TypeError) 各分支，验证 `SyncHttpError` 携带 `status` + `body.message`、网络错误重试后抛出。

### 🔧 版本

- `manifest.json` → `0.8.4`；`popup/popup.js` `APP_VERSION` → `0.8.4`；`service-worker.js` CACHE_NAME → `lsk-cache-v0.8.4`；`index.html` 页脚 → `v0.8.4`。

## v0.8.3 — 修复「队友」tab 点不动 / 空白（2026-07-17）

> **根因**：v0.8.2 组队页重写后，`renderTeam()` / `enterTeamView()` 在把任何 UI 画进 `#team-root` 之前，`await probeTeamHealth()` 先做了一次到 Cloudflare Worker 的健康探测（`/v1/health`，6s 超时 + 1 次重试 ≈ 最长 12s）。在预览 / 无 CORS 白名单 / Worker 不可达场景下，这段网络等待会阻塞首屏渲染，导致点开「队友」后长时间空白，用户体验上就是「点不动」。

### 🐛 修复

- **首屏立即渲染**：新增 `paintTeamRoot()`，进入组队页时先用已知会话同步画出落地页 / 队伍码卡片，**完全不依赖网络**。
- **健康探测后台化**：`refreshTeamInBackground()` 把 `probeTeamHealth` + 队友拉取全部移到后台，完成后再更新徽标 / 成员，绝不阻塞点击。
- **极端兜底**：即使渲染函数抛异常，也会兜底展示「组队暂时不可用 + 手动重试」，绝不空白 / 崩溃。
- **离线可用**：Worker 不可用 / CORS 未白名单时，落地页照常展示（⚪️ 离线模式），可创建本地队伍。

### 🔧 版本

- `manifest.json` → `0.8.3`；`popup/popup.js` `APP_VERSION` → `0.8.3`；`service-worker.js` CACHE_NAME → `lsk-cache-v0.8.3`；`index.html` 页脚 → `v0.8.3`。

## v0.8.2 — 组队真正连到 Worker · 拉齐真云端（2026-07-17）

> **根因**：组队页 UI 一直停留在 v0.7 之前的「本地 mock / 手动快照 / JSONBin URL 同步」形态，队伍码由本地随机生成、成员数永远是 1，从未接上 v0.8 的 Cloudflare Worker（`DEFAULT_BACKEND_URL` 已生产可用）。本次把组队页 UI 层彻底接到 Worker。

### ✨ 组队页重写为 Worker 版（`popup/`）

- **默认走云端**：只要 `DEFAULT_BACKEND_URL` 非空且 `/v1/health` 通过，组队自动走 Worker，**无需在「我的」页手动开云同步**；Worker 不可用时静默回退本地 mock。
- **动态状态徽标**：`🟢 云端已连接` / `🟡 连接中…` / `⚪️ 离线模式（本地）`（60s 健康探测缓存）。
- **落地页**：无队伍时展示【创建队伍】大按钮 + 队伍码输入框加入。
  - 创建 → `POST /v1/team/create`，展示 6 位队伍码（大字号 + 复制 + 分享链接 `https://ustiniankw.github.io/lazy-sheep-king/?join=<code>`）。
  - 加入 → `POST /v1/team/:code/join`。
- **队伍看板**：队伍码卡 + 复制/分享；队友列表 `GET /v1/team/:code` **每 15s 自动刷新**、**页面 focus 立即刷新**；**每 30s heartbeat** 上报 active task 标题 / 进度 % / 心情；`👊 拍一拍` → `/poke`；`🚪 退出队伍` → `/leave`。虚拟头像（首字母 + 稳定配色）。
- **URL 自动加入**：`?join=E36500` 自动填入并弹「是否加入队伍 E36500?」；`index.html` 落地页也会把 `?join=` 转发进 App。
- **成员 ID 稳定**：每设备一个 `memberId = hash(deviceId||uuid)`（FNV-1a），同设备重进不重复注册。
- **token 持久化**：create/join 返回的 token 存 settings（`teamCode`/`teamToken`/`teamMemberId`/`teamPokeSeenTs`），刷新不需重新 create/join；退出时清空。
- **友好错误**：400/401/403/404/429 → 「队伍码错误」「队伍已满」「太频繁了，稍等一下」「网络不好，请重试」等中文 toast。
- **删除旧 UI**：移除 JSONBin.io / npoint.io URL 同步控件、手动快照导出/导入 DOM。
- **「我的」页**：云同步开关默认「自动」（有 Worker URL 即 ON），文案改为「云端组队（连接到官方服务器）」。

### 🧱 库层

- **`lib/team.js`**：新增 `deriveMemberId()` / `resolveTeamBackend()` / `parseJoinCode()` / `LocalTeamMock`（与 sync_client 语义对齐的本地兜底）/ `makeTeamFacade()`（cloud→sync_client、local→本地 mock 统一门面）。
- **`lib/storage.js`**：settings 新增 `teamCode`/`teamToken`/`teamMemberId`/`teamPokeSeenTs`，`cloudSyncEnabled`/`backendUrl` 默认随 `DEFAULT_BACKEND_URL`；新增 `getTeamSession`/`setTeamSession`/`clearTeamSession`。

### ✅ 测试

- `tests/team.test.mjs`：新增覆盖 `deriveMemberId` / `resolveTeamBackend` / `parseJoinCode` / `LocalTeamMock` 全流程 / `makeTeamFacade` cloud vs local 路由 / team session helper。
- 全量 `node --test tests/*.mjs`：**110 passed / 0 failed**。

### 🔧 版本

- `manifest.json` → `0.8.2`；`service-worker.js` CACHE_NAME → `lsk-cache-v0.8.2`；`index.html` 页脚 → `v0.8.2`。

## v0.8.0 — Cloudflare Workers 后端 + 可选云同步（2026-07-17）


> 主功能：**一个可部署的 Cloudflare Workers 后端（免费 tier · KV-only）** + **前端可选云同步**（默认关闭，关闭时 100% 走本地存储，行为完全不变）。测试全绿。

### ✨ 新增 · Cloudflare Workers 后端（`worker/`）

- **`worker/src/index.js`（新增）** — 单文件 Worker，原生 `fetch` handler + 手写路由，**零外部依赖**。统一 JSON 响应 + CORS 头 + 轻量速率限制（每 IP 每分钟 60 次，KV 计数 `rl:<ip>:<minute>` TTL 90s，超出返回 429）。
  - **队伍**：`POST /v1/team/create`（生成 6 位队伍码，避开易混淆字符 `0/O/1/I/L`）、`POST /v1/team/:code/join`、`GET /v1/team/:code`（Bearer token 校验）、`POST /v1/team/:code/heartbeat`、`POST /v1/team/:code/poke`（保留最近 20 条）、`POST /v1/team/:code/leave`、`DELETE /v1/team/:code`（仅队长 token）。
  - **E2E 加密 vault**：`PUT /v1/vault/:vaultId`（首次带 `newVaultToken` 建立所有权，之后校验 token）、`GET /v1/vault/:vaultId`、`DELETE /v1/vault/:vaultId`。服务端**只存密文、永不解密**。
  - **健康**：`GET /v1/health` → `{ ok: true, version: '0.8.0' }`。
  - **错误码**：400 校验失败 / 401 token 无效 / 404 不存在 / 409 队伍码冲突（重试生成）/ 429 速率限制 / 500 兜底。
- **`worker/wrangler.toml`** — `name = lsk-sync`、`main = src/index.js`、`compatibility_date = 2025-06-01`、`[[kv_namespaces]]` binding `KV`（创建命令用 `LSK_KV`，`id` 留 placeholder）、`[vars] CORS_ORIGINS`。
- **`worker/package.json`** — 仅 `wrangler` devDependency（用户可选装）。
- **`worker/README.md`** — 5 步部署指南 + curl 冒烟测试 + API 一览。
- **`worker/.dev.vars.example`** — 本地 dev 变量样例。

### ✨ 新增 · 前端可选云同步

- **`lib/sync_config.js`（新增）** — `DEFAULT_BACKEND_URL`（用户 deploy 后填入 workers.dev URL，为空则 fallback 本地）、`API_VERSION_PATH`。
- **`lib/sync_client.js`（新增，纯函数）** — 导出 `createTeam / joinTeam / getTeam / heartbeat / poke / leaveTeam / putVault / getVault / deleteVault / pingHealth`；每个函数拿到空 `backendUrl` 立即抛 `SyncDisabledError`；网络错误自动重试 1 次；每次请求 6s 超时；HTTP 错误抛 `SyncHttpError`（不重试）。
- **`lib/crypto_backup.js`** 新增 `deriveVaultId(mnemonic)` = `SHA-256(mnemonic + 'vault-v1').slice(0,32)`、`deriveVaultToken(mnemonic)` = `SHA-256(mnemonic + 'auth-v1').slice(0,32)`。用户只凭 14 词短语即可在新设备稳定重算 vaultId/vaultToken，从而「找到」并解密云端 blob，无需扫码。
- **「我的」页新增「☁️ 云同步」卡片**：开关（默认关）、自建服务器地址（只读展示 / 可覆盖默认）、「🔌 测试连接」（调 `/v1/health`）、状态灯（🟢 已连 / 🟡 检查中 / 🔴 未启用/失败）、小字「开启后队伍进度会经 Cloudflare Workers 中转；单机使用无需开启」。
- **「🔐 备份与恢复」卡片**：云同步 ON + 已有短语时，暴露「☁️ 上传到云端」「☁️ 从云端恢复」。**用户只需 14 词短语 + 云同步开启，即可跨设备恢复全部数据。**
- **Team 页改造**：`settings.cloudSyncEnabled && backendUrl 已配置` 时创建/加入/拍一拍走 Worker，30s 心跳上报 snapshot（进度 / 心情 / 当前任务标题）+ 30s 拉队伍状态；否则完全走**现有本地 mock**（向后兼容）。云端队伍快照 ↔ 本地 `teamState` 结构做转换以复用既有 UI。

### 🔧 存储 & 设置

- `lib/storage.js` settings 新增 `cloudSyncEnabled: false`、`backendUrl: DEFAULT_BACKEND_URL || null`；`teamSelf` 新增 `cloudToken` / `cloudMemberId`。用户可在设置里覆盖 `backendUrl`（空则用默认）。

### 🔧 版本 & 缓存

- `manifest.json` → `0.8.0`；`popup/popup.js` `APP_VERSION` → `0.8.0`。
- `service-worker.js` `CACHE_NAME` → `lsk-cache-v0.8.0`；`APP_SHELL` 新增 `./lib/sync_client.js` + `./lib/sync_config.js`。
- `index.html` 页脚版本号 → `v0.8.0`（**落地页保持极简，未加任何 v0.8 亮点区块 / 新功能红点**）。
- `options/options.html` 版本文案 → `0.8.0`。
- `tests/pwa.test.mjs` 断言从 `lsk-cache-v0.7.0` 更新到 `lsk-cache-v0.8.0`。

### 🧪 测试

- **`tests/sync_client.test.mjs`（新增）** — mock `globalThis.fetch`，覆盖 createTeam/joinTeam/getTeam/heartbeat/poke/leaveTeam、vault put+get+delete、health、HTTP 错误不重试、网络错误重试、超时（AbortError）模拟、`SyncDisabledError`。
- **`tests/worker.test.mjs`（新增）** — 内存版 KV mock 直接驱动 Worker `fetch` handler（无需 miniflare）：队伍全流程 create→join→get→heartbeat→poke→leave→delete、vault 全流程、CORS 白名单、队伍码字符集、速率限制 429、未知路由 404、KV 未绑定兜底。
- **`tests/crypto_backup.test.mjs`** 补充 vault 派生测例。
- 现有测试全绿。

### 🚀 部署说明

我们**不执行** `wrangler deploy`（无 Cloudflare 凭据）——仅交付完整代码 + 部署指南。用户 5 分钟自助部署：
`cd worker` → `npm i -g wrangler` → `wrangler login` → `wrangler kv namespace create LSK_KV` → 把 id 填进 `wrangler.toml` → `wrangler deploy` → 拿到 workers.dev URL → 填到 `lib/sync_config.js` 的 `DEFAULT_BACKEND_URL` → 再 push 一次。详见 `worker/README.md`。

## v0.7.0 — 端到端加密备份 + 手机端修复（2026-07-17）

> 主功能：**备份短语（助记词）+ 端到端加密备份**，全程离线、零后端。同时修复两个手机端体验 Bug。**测试全绿（75 subtest）。**

### ✨ 新增 · 端到端加密备份

- **`lib/wordlist.js`（新增）** — 自建 512 词英文词表（512 = 2^9，`uint32 % 512` 无模偏差）。14 词 ≈ 126 bit 熵。
- **`lib/crypto_backup.js`（新增，纯函数、可测）**：
  - `generateMnemonic(wordCount = 14)` — 用 WebCrypto `getRandomValues` 从词表生成备份短语。
  - `mnemonicToKey(mnemonic, salt)` — PBKDF2-SHA256 · 100k rounds → 32 byte AES-GCM `CryptoKey`。
  - `encryptBlob(data, key)` / `decryptBlob(blob, key)` — AES-GCM，随机 12-byte IV，输出 base64（`{v, alg, iv, ct}`）。
  - `validateMnemonic(mnemonic)` — 校验词数 + 单词全部在词表内（大小写/空格归一化）。
  - `mnemonicHash(mnemonic)` — SHA-256 hex，用于校验用户后续输入是否为同一短语。
  - `encryptWithMnemonic / decryptWithMnemonic` 便捷组合。
  - 兼容浏览器（`globalThis.crypto`）与 Node（Node<20 用 `import { webcrypto } from 'node:crypto'` 兜底）。
- **「我的」页新增「🔐 备份与恢复（端到端加密）」卡片**：
  - **生成备份短语** → 弹出 modal 显示 14 词，配「📋 一键复制」「⬇ 下载 txt」，**必须勾选「我已保存好」才能关闭**。
  - **导出加密备份** → 输入短语（校验 hash 匹配）→ 用短语加密全部本地数据（tasks / pets / stats / dailyLog / feedLog / team / settings / identity）→ 下载 `.lsk-backup` 文件。
  - **导入加密备份** → 上传文件 + 输入 14 词 → 解密恢复（并入既有合并策略）。
  - **无短语时隐藏「导出」按钮**，提示「请先生成备份短语」。
- **短语明文永不落磁盘**：只在 modal 显示一次；用户勾选「已保存」后清除内存；storage 只存 `mnemonicHash`（SHA-256，全局键 `lsk_backup_mnemonic_hash_v1`）。
- **加密数据仅本地下载**（v0.8 再接 Cloudflare 云同步，本版本纯离线）。
- **`tests/crypto_backup.test.mjs`（新增）** — 16 个测例：encrypt/decrypt roundtrip、wrong key fails、篡改检测、mnemonic 校验、hash 稳定性、随机 IV、词表规模等。

### 🐛 修复 · 手机端

- **底部导航栏遮挡按钮**：手机模式（`<640px`）下主内容 `padding-bottom = calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 16px)`；底部悬浮 CTA / toast 加入 `env(safe-area-inset-bottom)`；tab bar 自身补 `env(safe-area-inset-bottom)` 对齐 iOS home indicator。桌面 & 平板不动。
  - `lib/layout.js` 新增可测纯函数 `contentBottomPadding(breakpoint)` / `floatingCtaBottom(breakpoint)`，`tests/layout.test.mjs` 补 4 个测例。
- **深色模式按钮对比度不足**：步骤页「🍃 太难？再拆一层」(`.chip-btn`) 原本用恒亮的 `--ios-gray6` 底 + 白字不可读；「⏹ 停止」(`.ios-btn-destructive`) 透明底红字对比不够。深色模式下改为：次级/chip 按钮 `rgba(255,255,255,0.08)` 底 + `rgba(255,255,255,0.15)` 边框 + 亮色文字；危险按钮 `rgba(255,80,80,0.15)` 底 + `#ff8a8a` 文字，满足 ≥ 4.5:1 对比度。

### 🔧 版本 & 缓存

- `manifest.json` → `0.7.0`；`popup/popup.js` `APP_VERSION` → `0.7.0`。
- `service-worker.js` `CACHE_NAME` → `lsk-cache-v0.7.0`；`APP_SHELL` 新增 `./lib/crypto_backup.js` + `./lib/wordlist.js`。
- `index.html` 页脚版本号 → `v0.7.0`（落地页 UI 保持极简，未加任何新版本亮点区块）。
- `options/options.html` 版本文案 → `0.7.0`。
- `tests/pwa.test.mjs` 断言从 `lsk-cache-v0.6.0` 更新到 `lsk-cache-v0.7.0`。

## v0.6.0 — 认证瘦身 + 2C 化落地页（2026-07-16）

> 产品化里程碑。把懒羊羊大王的定位从"技术工程 demo"彻底转为**面向普通用户（2C）**的执行力小工具：GitHub Pages 落地页大改为纯 2C 入口 + 卸掉 GitHub / Google OAuth 相关一切 + 自动分配可爱昵称和免费头像。**测试全绿（55 subtest / 273+ 断言），零功能回退。**

### ✨ 新增

- **`lib/identity.js`（新增）** — v0.6.0 认证瘦身的核心：
  - `generateNickname()` 从 32 个可爱中文形容词 + 34 个名词（水果 / 动物 / 食物 / 自然）+ 3 位随机数字生成昵称，示例 `"会飞的橘子237"` / `"打盹的柚子42"` / `"干饭的南瓜101"`。
  - `defaultAvatarUrl(seed | {seed, style})` 返回 `https://api.dicebear.com/9.x/<style>/svg?seed=<...>` 的 DiceBear 免费头像 URL，不需要任何 API key、不上传用户数据。
  - 4 种风格：`thumbs` / `bottts` / `avataaars` / `lorelei`；`nextAvatarStyle` 用于循环切换。
  - `ensureIdentity(storage)` 幂等：storage 里已有 `nickname / avatarUrl` 就返回；否则生成并写入 `lsk_identity_v1` 全局键。
  - `updateIdentity / rerollNickname / rerollAvatar / setUploadedAvatar` 覆盖所有编辑动作，`setUploadedAvatar` 支持 dataURL 上传本地图片。
- **`popup` 头像编辑器** — 「我的」页新增一整块头像编辑区：
  - 点头像随机换一个 seed；4 个风格按钮（🎨 拇指 / 🤖 机器人 / 🧑 小人 / 👧 手绘）一键切换；🎲 换头像 / 📤 上传本地图片（≤ 512KB）。
  - 昵称输入右侧新增 🎲「随机再来一个」按钮，一键换新昵称。
- **`options` 设置页新增身份编辑区** — 独立卡片，含头像 96px 预览、昵称输入 + 保存 / 随机、头像风格切换、上传本地图片。
- **`index.html` 完全重写为 2C 落地页** — 纯发布会风：
  - 品牌头 `🐑 懒羊羊大王` + 一句 tagline "把大任务拆成小步骤，一点点搞定"。
  - 一个巨大的 **「立即开始」** 主 CTA，直接跳 `popup/popup.html?full=1&pwa=1`。
  - PWA `beforeinstallprompt` 监听 → 显示 「📲 添加到主屏」次要 CTA；`appinstalled` 后自动隐藏 + toast 反馈；iOS 兜底提示。
  - 4 张核心功能卡：`✨ AI 拆解` / `🐾 养宠物` / `🎯 组队打卡` / `📅 日历追踪`；下方"三步开始"简介卡。
  - 极简 footer：版本号小字 + GitHub 仓库 + 意见反馈（GitHub Issues）。
  - 页面首屏彻底删除：`在线试玩` / `preview` / `demo` / `v0.x.x 亮点` / `roadmap` / `design tokens` / `tests passing / MV3 / PWA / Manifest V3` 等技术 jargon。

### 🗑 移除 / 下线

- **卸掉 GitHub Device Flow / Google Sign-in UI 与代码路径**
  - `popup/popup.html`：`sign-in-modal` 里的 `🐙 GitHub` Tab、`gh-client-id / gh-flow / gh-user-code / gh-qr / gh-verify-link / gh-status / gh-error / btn-gh-start / btn-gh-copy` 一整块 pane 全删；`account-verified` GitHub 已验证徽章删。
  - `popup/popup.js`：`startGitHubFlow` / `renderTextQR` / `ghAborted / ghCountdownTimer` 全部函数删；`renderAccountActions` 里 `用 GitHub 登录 / 用 Google 登录（disabled）` 按钮删；`renderAccountCard` 里 `MODE.GITHUB` 分支删；`buildMyMemberSnapshot({ provider: 'github' })` 改为空字符串；team 成员卡里的 🐙 GitHub 徽章删。
  - `options/options.html / options.js`：本轮之前就没有 GitHub / Google 按钮，仅更新版本号；新增身份编辑区。
- **manifest 权限瘦身**
  - `manifest.json`：删掉 `identity` permission；`host_permissions` 里 `https://github.com/*` / `https://api.github.com/*` 删掉，仅留 `https://api.dicebear.com/*` + 通用 `https://*/*` + `http://*/*`（供用户自配 AI provider）。
  - 结果：扩展安装时的权限申请列表比 v0.5.2 更短，用户心智负担降低。
- **`lib/auth.js` 主流程改为纯匿名 + 昵称/头像**
  - `MODE.GITHUB` / `MODE.GOOGLE` 常量保留作向后兼容；`beginGitHubDeviceFlow / pollGitHubDeviceFlow / signInGoogle` 三个函数一律返回 `{ ok: false, code: 'NOT_ENABLED', message: 'v0.6.0 起已下线 GitHub / Google 登录' }` 或抛 `NOT_ENABLED`，`getGitHubToken` 恒定返回 `null`。旧代码引用不崩，但主流程再不走 OAuth。
  - `getAuthState()` 现在始终附带 `nickname / avatarUrl / avatarKind / avatarStyle / avatarSeed / displayName`，UI 端不再区分「访客有没有头像」。
- **`lib/user.js` 变成向后兼容 facade**
  - 委托给 `auth.js + identity.js + storage.js`；新增 `getIdentity / saveNickname / rollNewNickname / rollNewAvatar / useUploadedAvatar / pickAvatarStyle` 6 个便捷方法；`setDisplayName` 会同步 profile displayName + identity nickname。

### 🔧 版本

- `manifest.json` → `0.6.0`
- `service-worker.js` `CACHE_NAME` → `lsk-cache-v0.6.0`（APP_SHELL 新增 `./lib/identity.js`）
- `popup/popup.js` `APP_VERSION` → `0.6.0`
- `options/options.html` / footer → `0.6.0`
- `index.html` footer 版本号 → `v0.6.0`
- `tests/pwa.test.mjs` 断言从 `lsk-cache-v0.5.2` 更新到 `lsk-cache-v0.6.0`

### 🧪 测试

- **新增 `tests/identity.test.mjs`（17 assertions）**：形容词 / 名词库 ≥30、`generateNickname` 三位数字后缀、`defaultAvatarUrl` v9.x URL 格式、DiceBear URL 识别、`nextAvatarStyle` 循环、`ensureIdentity` 幂等（同一 storage 反复调用返回同一 identity）、`rerollNickname / rerollAvatar` 会改变结果、`setUploadedAvatar` 把 `avatarKind` 切成 `upload`、`updateIdentity` 部分补丁行为、旧数据（只带 nickname 无 avatar 字段）补齐兼容。
- **`tests/auth.test.mjs` 更新**（18 assertions）：新增匿名主流程覆盖（`getAuthState` 自动带 nickname + dicebear 头像、`isSignedIn` 纯匿名返回 false）；保留原有 setup / verify / change passphrase、PBKDF2 派生、加密备份 roundtrip、signOut 回到 guest；新增 `beginGitHubDeviceFlow / getGitHubToken / signInGoogle` 均返回 `NOT_ENABLED` 的下线断言。
- `node --test tests/*.mjs`：**55 subtest / 273+ 断言全绿**，无功能回退。

### 📝 说明

- Web 版落地页 (`https://ustiniankw.github.io/lazy-sheep-king`) 更新后，用户会直接看到新的 2C 入口；PWA 用户会通过顶部横幅（v0.5.2 起）拿到新版本。
- 「本地密码账号」被重新定位为「备份加密可选项」，UI 文案改为「挂一个本地密码」 / 「清除本地密码」，不再表述为"账号"。
- `usr_xxx` 匿名 userId、任务 / 宠物 / 日历 / 组队数据一律**保留**，v0.6.0 属于**向后兼容升级**。
- `manifest.webmanifest`（PWA manifest）本身没有 `version` 字段，无需改动；`start_url` 仍指向 `./popup/popup.html?full=1&pwa=1`。

---

## v0.5.2 — GitHub Pages 自动部署 + Release-on-tag + PWA 新版本发现横幅（2026-07-16）

> 发布工程小版本。让 Web 版有一条对外的**稳定长期 URL**（`https://ustiniankw.github.io/lazy-sheep-king`），并给「装成 Chrome 扩展」提供一键 zip 产物，方便非技术用户使用。**测试全绿，零功能回退。**

### ✨ 新增

- **Added GitHub Pages auto-deploy workflow** — `.github/workflows/deploy-pages.yml`：`push → main` 触发，`actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`，无构建步骤（纯静态），`permissions: pages:write / id-token:write` + `concurrency: pages` 都配好。仓库 owner 只需在 Settings → Pages 里 **Enable Pages（Source: GitHub Actions）** 一次即可。
- **Added Release-on-tag workflow that builds installable Chrome extension zip** — `.github/workflows/release.yml`：推 `v*` tag 触发，从仓库 root 挑出 Chrome unpacked 扩展需要的最小集合（`manifest.json`、`popup/`、`options/`、`lib/`、`icons/`、`manifest.webmanifest`、`service-worker.js`、`background/`、`LICENSE`、`README.md`），打包成 `lazy-sheep-king-<version>.zip`，用 `softprops/action-gh-release@v2` 作为 Release asset 上传。**Excludes**：`.git` / `.github/` / `tests/` / `ui-samples/` / `layout-samples/` / `preview_site/` / `lsk-preview/` / `docs/*.md` / `*.test.mjs` / 旧的 `lazy-sheep-king.zip`。
- **New README quick-start (Web / Zip 扩展 / 源码)** — README 顶部新增三大安装方式段：**A · PWA**（写死 `https://ustiniankw.github.io/lazy-sheep-king`，即便 Pages 还没启用也没关系）/ **B · Chrome 扩展 zip 三步**（配 emoji 傻瓜级指南 + Release latest 链接）/ **C · 从源码 build**（`git clone` + unpacked，附 CWS 上架计划说明）。
- **PWA 新版本发现横幅** — `lib/pwa_update.js`（新）：监听 `serviceWorker.registration.updatefound` + `installing.statechange === 'installed'`（controller 已存在）以及 `serviceWorker.controllerchange`，触发 iOS 原生风顶部 top banner 「🔄 发现新版本 · 点这里刷新」，点击 / 键盘 Enter 都会 `location.reload()`。只在 web / PWA 环境启用，扩展 popup 内 skip。CSS 采用蓝色药丸 + top slide-down + `prefers-reduced-motion` 兜底。

### 🔧 版本

- `manifest.json` → `0.5.2`
- `service-worker.js` `CACHE_NAME` → `lsk-cache-v0.5.2`（同时把 `lib/pwa_update.js` 加入 APP_SHELL）
- `popup/popup.js` `APP_VERSION` → `0.5.2`
- `index.html` version badge / title → `0.5.2`
- `tests/pwa.test.mjs` 已跟随更新，仍绿

### 🧪 测试

- 新增 `tests/pwa_update.test.mjs`（12+ assertions）：`isExtensionPopup` / `hasWaitingUpdate` 状态矩阵、`createUpdateBanner` 幂等 + 点击回调、`installSWUpdateWatcher` 在扩展 popup 上下文 no-op、`updatefound → installed` 触发 banner。
- 全量 `node --test tests/*.mjs`：仍全绿，无回退。

### 📝 说明

- README 明确提醒仓库 owner 需要一次性开 Pages。
- Release 工作流是 tag-triggered，`main` 上直接 push 不会误打包；用户手动 `git tag v0.5.2 && git push --tags` 即可测试 release.yml。

---

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

