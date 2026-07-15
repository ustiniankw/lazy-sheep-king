// lib/providers.js — 内置 LLM Provider 预设
// 使用 OpenAI 兼容 ChatCompletion 协议，只要 provider 支持就能一键切换

export const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyHint: 'sk-...',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o3-mini'],
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keyHint: 'sk-...',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'moonshot',
    name: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    keyHint: 'sk-...',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keyHint: 'xxxx.xxxx',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    keyHint: '任意字符串（本地不校验）',
    defaultModel: 'llama3.1',
    models: ['llama3.1', 'qwen2.5', 'mistral', 'phi3'],
    docsUrl: 'https://ollama.com/library',
  },
  {
    id: 'custom',
    name: '自定义（其他 OpenAI 兼容）',
    baseUrl: '',
    keyHint: '',
    defaultModel: '',
    models: [],
    docsUrl: null,
  },
];

export function findProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[PROVIDERS.length - 1];
}
