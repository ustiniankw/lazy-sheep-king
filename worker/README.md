# lsk-sync · 懒羊羊大王云同步后端（Cloudflare Workers）

一个**免费 tier 即可运行**的 Cloudflare Workers 后端，仅用 KV，负责：

1. **队伍状态**：队伍码、成员快照（进度 / 心情 / 当前任务标题）、拍一拍
2. **E2E 加密用户 blob（vault）**：服务端只存密文，**永远不解密**

> ⚠️ 云同步在前端是**默认关闭**的可选功能。不接入时，App 100% 走本地存储，行为与之前完全一致。

---

## 🚀 5 步部署（约 5 分钟）

```bash
# 1. 安装 wrangler（Cloudflare 官方 CLI）
npm i -g wrangler

# 2. 登录 Cloudflare（会打开浏览器授权）
wrangler login

# 3. 创建 KV 命名空间，绑定名叫 LSK_KV
cd worker
wrangler kv namespace create LSK_KV
#    → 命令会输出类似： id = "abcd1234..."，复制这个 id

# 4. 把上一步的 id 填进 wrangler.toml 的 [[kv_namespaces]].id
#    （替换 REPLACE_WITH_YOUR_KV_ID）

# 5. 部署
wrangler deploy
#    → 部署成功后会打印你的 workers.dev URL，例如：
#      https://lsk-sync.<你的用户名>.workers.dev
```

拿到 URL 后，回到仓库根目录，把它填到 `lib/sync_config.js` 的 `DEFAULT_BACKEND_URL`，再 push 一次即可让所有用户可选启用云同步：

```js
// lib/sync_config.js
export const DEFAULT_BACKEND_URL = 'https://lsk-sync.<你的用户名>.workers.dev';
```

---

## ⚙️ 配置说明

`wrangler.toml`：

- `name = "lsk-sync"`
- `main = "src/index.js"`
- `compatibility_date = "2025-06-01"`
- `[[kv_namespaces]]` binding = `KV`（创建命令用的名字是 `LSK_KV`）
- `[vars] CORS_ORIGINS`：CORS 白名单，逗号分隔。默认 `https://ustiniankw.github.io,http://localhost:8787`。
  - 需要允许 Aime 预览域名时，把预览域名追加进来即可（也可用 `wrangler deploy --var CORS_ORIGINS:...` 临时覆盖）。

本地开发：

```bash
cp .dev.vars.example .dev.vars   # 可选
wrangler dev                     # 本地 http://localhost:8787
```

---

## 📡 API 一览（均在 `/v1` 前缀下）

响应统一 JSON，带 CORS 头。错误码：`400` 校验失败 / `401` token 无效 / `404` 不存在 / `409` 队伍码冲突 / `429` 速率限制 / `500` 兜底。

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/v1/health` | `{ ok: true, version: '0.8.0' }` |
| POST | `/v1/team/create` | 创建队伍，返回 `{ code, token, memberId }` |
| POST | `/v1/team/:code/join` | 加入队伍，返回 `{ code, token, teamSnapshot }` |
| GET | `/v1/team/:code` | 需 `Authorization: Bearer <token>`，返回整队快照 |
| POST | `/v1/team/:code/heartbeat` | 上报 `{ memberId, snapshot }` |
| POST | `/v1/team/:code/poke` | `{ fromMemberId, toMemberId, emoji }` |
| POST | `/v1/team/:code/leave` | `{ memberId }` 退出队伍 |
| DELETE | `/v1/team/:code` | 仅队长 token 可解散 |
| PUT | `/v1/vault/:vaultId` | 上传密文；首次带 `newVaultToken` 建立所有权 |
| GET | `/v1/vault/:vaultId` | 需 `Authorization: Bearer <vaultToken>`，返回密文 |
| DELETE | `/v1/vault/:vaultId` | 需 token，删除 vault |

**速率限制**：每 IP 每分钟 60 次，超出返回 `429`。

---

## 🧪 curl 冒烟测试

部署后（或 `wrangler dev` 时）把 `BASE` 换成你的 URL：

```bash
BASE="https://lsk-sync.<你的用户名>.workers.dev"

# 健康检查
curl -s "$BASE/v1/health"
# → {"ok":true,"version":"0.8.0"}

# 创建队伍
curl -s -X POST "$BASE/v1/team/create" \
  -H 'Content-Type: application/json' \
  -d '{"founderMemberId":"m1","founderNickname":"队长"}'
# → {"ok":true,"code":"XKCD42","token":"...","memberId":"m1"}

# 用上一步的 code + token 拉队伍
CODE="XKCD42"; TOKEN="<上一步返回的 token>"
curl -s "$BASE/v1/team/$CODE" -H "Authorization: Bearer $TOKEN"

# 心跳上报
curl -s -X POST "$BASE/v1/team/$CODE/heartbeat" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"memberId":"m1","snapshot":{"progress":42,"mood":"😀","activeTaskTitle":"写周报"}}'

# vault 首次上传（建立所有权）
curl -s -X PUT "$BASE/v1/vault/myvault123" \
  -H 'Content-Type: application/json' \
  -d '{"ciphertext":"BASE64_OPAQUE_BLOB","newVaultToken":"my-derived-token"}'

# vault 读取
curl -s "$BASE/v1/vault/myvault123" -H "Authorization: Bearer my-derived-token"
```

---

## 🔐 关于 E2E vault

- `vaultId` 由前端从备份短语稳定派生：`SHA-256(mnemonic + 'vault-v1').slice(0,32)`
- `vaultToken` 同样派生但用不同盐：`SHA-256(mnemonic + 'auth-v1').slice(0,32)`
- 服务端**只看到 hash 后的 token 与不可读密文**，永远接触不到短语或明文。
- 用户在新设备只需输入 14 词短语即可重算出 vaultId/vaultToken，从而"找到"并解密自己的 blob。

---

## 💰 成本

Cloudflare Workers 免费 tier：每天 10 万次请求 + KV 免费额度，个人 / 小团队使用完全够用，$0。
