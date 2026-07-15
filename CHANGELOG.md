# CHANGELOG

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
