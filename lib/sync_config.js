// lib/sync_config.js — v0.8.0 云同步后端配置
// 用户执行 `wrangler deploy` 后，把返回的 workers.dev URL 填到 DEFAULT_BACKEND_URL，
// 再 push 到仓库即可让所有用户「可选」启用云同步。
// 若为空，前端自动 fallback 到本地存储 / 本地 mock（当前行为完全不变）。
export const DEFAULT_BACKEND_URL = '';  // 例如 'https://lsk-sync.xiakaiwen.workers.dev'
export const API_VERSION_PATH = '/v1';

export default { DEFAULT_BACKEND_URL, API_VERSION_PATH };
