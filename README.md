# 懒羊羊大王 · 执行力浏览器插件 🐑👑

> **让懒虫也能一步一步搞定事情** —— 你输入一件想做的事，懒羊羊大王先用本地模板拆成“傻瓜到不能再傻瓜”的小步骤，再按可用性尝试用免费 AI 精修；完成过程中还能养宠物、看打卡日历、和队友互相拍一拍。

🚀 **[👉 在线试玩 v0.3.5](https://1e8add08b5ba.aime-app.bytedance.net)** —— 不用装扩展也能直接玩。

![banner](./icons/mascot.png)

## ✨ 特性

- **一键拆解**：把大任务拆成 4-8 步“最小可执行动作”，每步都尽量具体到能立刻开动。
- **🔐 认证账号系统（v0.3.5）**：访客 / 本地密码账号 / GitHub 登录三种模式，**全部免费**、优雅降级；匿名 userId 可平滑升级为真实账号，多设备找回进度。
- **🍃 AI 精修（免费方案）**：先本地拆解，再按可用性自动走 **Chrome 内置 Prompt API → 用户自配 API → 本地兜底**。
- **👥 组队模式（v0.3.4）**：创建 / 加入 6 位团队码，查看队友昵称、设备、今日步数、当前任务、连续打卡和最近活跃；GitHub 队友带 🐙 徽章。
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

## 🔐 认证与账号（v0.3.5）

v0.3.5 引入真正的“认证账号”，并坚持 **零付费依赖**：不引入任何收费服务、不内置任何共享 `client_id / secret`。三种模式互斥（当前只处于其中一种），可优雅降级。

### 三种模式与成本表（全部免费）

| 模式 | 说明 | 适用环境 | 成本 |
| --- | --- | --- | --- |
| 👤 **访客 Guest** | 沿用旧版本地匿名 `userId = usr_xxxxxx`，可编辑昵称 | 任意环境 | ¥0 · 0 依赖 |
| 🔐 **本地密码账号 Passphrase** | 昵称 + 密码，Web Crypto 在本机派生密钥；可区分同一浏览器的多个人、加密备份 | 任意环境（含 Web 试玩） | ¥0 · 纯本机、0 后端 |
| 🐙 **GitHub 登录** | OAuth Device Flow，真实验证身份，令牌加密存于本机，供后续 Gist 同步 | 扩展环境优先（Web 试玩遇 CORS 会优雅报错） | ¥0 · 你自建免费 OAuth App |
| 🟢 **Google 登录** | 骨架，**未启用**，按钮 disabled | 待发布至 Chrome Web Store | —（待发布） |

> 匿名 userId 可 **平滑升级**：创建本地密码账号 / GitHub 登录时，会把当前访客命名空间下的任务 / 历史 / 统计 / 宠物数据自动带入新账号，不丢进度。

### 本地密码模式的安全模型

- 派生：`PBKDF2(passphrase, salt=随机 16 字节, iterations=100000, SHA-256) → 32 字节密钥`。
- 存储：只保存 `{salt, verifierHash = SHA-256(key), createdAt}`，**从不存明文密码或原始密钥**。
- 登录：输入密码 → 重新派生 → 比对 `verifierHash`；成功后派生密钥 **仅存内存**（当前 popup 会话）。
- 会话自动锁定：15 分钟无操作后，内存密钥被清除，`Auth.getSession()` 返回 `null`，敏感操作需重新解锁。
- 敏感操作加锁：`生成新用户 ID`、`导入备份`、`切换账号` 在锁定态都会要求先解锁验证。
- 加密备份：本地密码账号解锁时，`导出备份` 使用 **AES-GCM + 派生密钥**，文件含 `enc: true` 标记；导入加密备份会提示输入密码。

### GitHub 登录：请自建一个免费 OAuth App（三步）

为保持“完全免费 + 完全归你所有”，我们 **不内置共享 client_id**，请你自己创建（免费）：

1. 打开 GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**；
2. 勾选 **Enable Device Flow**，Homepage / Callback URL 随意填（例如 `https://github.com`）；
3. 复制生成的 **Client ID**，粘贴到 popup「我的 → 🐙 GitHub」输入框，点“开始 GitHub 登录”，按提示到 `github.com/login/device` 输入设备码授权即可。

授权后会拉取 `https://api.github.com/user` 作为资料，令牌用设备本地随机密钥 AES-GCM 加密后存 `chrome.storage.local`（best-effort，非真正 KMS）。退出账户时会尽力调用 `DELETE /applications/{client_id}/token` 撤销，失败则仅本地删除。

### Google 登录（待发布后启用）

按钮当前为 **disabled**，tooltip 说明：Google Sign-in 需要扩展先发布到 Chrome Web Store 并配置稳定的 OAuth2 client_id。代码保留 `signInGoogle()` 桩（返回 `{ok:false, code:'NOT_ENABLED'}`），后续不回归。

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

点 popup 顶栏 **👤** 可打开“我的”视图（v0.3.5 重构为账号卡片 + 认证入口）：

- 顶部账号卡片：头像（自定义宠物 / GitHub 头像 / 昵称首字母）、内联编辑昵称、模式徽章（👤 访客 / 🔐 本地账号 / 🐙 GitHub）、GitHub 验证徽章、🔒 锁定按钮。
- 上下文相关操作：访客可 `创建本地密码账号 / 用 GitHub 登录 / 用 Google 登录（未启用）`；本地账号锁定态显示解锁输入框，解锁态显示 `修改密码 / 锁定 / 退出账户`；GitHub 显示 `打开 GitHub 主页 / 退出账户`。
- 登录弹窗 `#sign-in-modal`：本地密码 / GitHub 双 Tab；密码 Tab 带实时强度条；GitHub Tab 有 client_id 输入、复制设备码、验证链接与轮询倒计时。
- **导出备份**：本地密码账号解锁时自动 AES-GCM 加密（文件带 `enc:true`）；否则明文 JSON。
- **导入备份**：自动识别加密备份并提示输入密码；非访客锁定态会要求先解锁。
- **生成新用户 ID**：锁定态受保护，需先解锁。
- 启用 / 关闭 **免费 AI 精修**、**跨设备同步基础**（`chrome.storage.sync` 可用时）。

> 多账号数据隔离：`lib/storage.js` 以 `lsk:${accountKey}:${键}` 命名空间存储，`accountKey` 为 `guest:${userId}` / `p:${userId}` / `gh:${providerId}`；v0.3.5 首次启动会把旧版未加前缀的键平滑迁移到访客命名空间（`_migrated_035` 标记，不丢数据）。

> Web 试玩环境没有 `chrome.*`，会自动优雅降级为 `localStorage`。访客与本地密码账号在试玩环境完全可用；GitHub 登录遇 CORS 时会提示“网页试玩环境无法完成 GitHub 登录，请在安装扩展后使用”。

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

### 🔐 v0.3.5 · 认证账号系统（✅ 当前版本）
- [x] 访客 / 本地密码账号 / GitHub 登录三种免费模式，优雅降级
- [x] 本地密码：PBKDF2(10万次)+AES-GCM，密钥仅存内存、15 分钟自动锁定
- [x] 加密备份导出 / 导入；敏感操作（生成新 ID / 导入 / 切换账号）加锁
- [x] GitHub OAuth Device Flow（不内置 client_id）；令牌加密存于本机
- [x] Google 登录骨架（disabled，待发布至商店）
- [x] 多账号数据命名空间 + 旧数据平滑迁移（`_migrated_035`）
- [x] 新增 `tests/auth.test.mjs` 与 `tests/storage_ns.test.mjs`

### ⏳ 后续
- [ ] v0.4 · 宠物商店 / 换装 / 好友互动
- [ ] v0.5 · Todoist / Notion / 飞书任务导入
- [ ] 更完整的跨设备同步 / 云端协作（GitHub Gist 同步）

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
│   ├── auth.js           # 认证账号：passphrase(PBKDF2/AES-GCM) / GitHub device flow / Google 桩
│   ├── user.js           # 向后兼容 facade，委托到 auth.js + storage.js
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
