// lib/providers.js — 内置 LLM Provider 预设
// 使用 OpenAI 兼容 ChatCompletion 协议，只要 provider 支持就能一键切换

export const PROVIDERS = [
  {
    id: 'gemini',
    name: 'Google Gemini（免费 tier）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyHint: 'AIza...',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    docsUrl: 'https://aistudio.google.com/apikey',
    free: true,
    freeNote: '免费额度约 1500 请求/天，无需绑卡',
    authHeader: 'Bearer',
    wizardSteps: [
      '打开 aistudio.google.com/apikey（可能需科学上网）用 Google 账号登录',
      '点击「Create API key」，选择或新建一个项目',
      '复制以 AIza 开头的 key，粘贴到下面输入框',
    ],
  },
  {
    id: 'groq',
    name: 'Groq（免费 tier）',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyHint: 'gsk_...',
    defaultModel: 'llama-3.1-70b-versatile',
    models: ['llama-3.1-70b-versatile', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    docsUrl: 'https://console.groq.com/keys',
    free: true,
    freeNote: '免费额度约 30 请求/分钟，llama-3.1 70B 超快',
    authHeader: 'Bearer',
    wizardSteps: [
      '打开 console.groq.com/keys 用邮箱 / GitHub 登录',
      '点击「Create API Key」并命名',
      '复制以 gsk_ 开头的 key，粘贴到下面输入框',
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek（注册送额度）',
    baseUrl: 'https://api.deepseek.com/v1',
    keyHint: 'sk-...',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    docsUrl: 'https://platform.deepseek.com',
    free: true,
    freeNote: '新用户注册即送免费额度，中文效果好',
    authHeader: 'Bearer',
    wizardSteps: [
      '打开 platform.deepseek.com 注册并登录',
      '进入 API keys 页面，点击「创建 API key」',
      '复制以 sk- 开头的 key，粘贴到下面输入框',
    ],
  },
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

// FIX 4（v0.5.1）：一键接入免费 AI 向导使用的免费 provider 列表（Gemini / Groq / DeepSeek）。
export const FREE_WIZARD_PROVIDER_IDS = ['gemini', 'groq', 'deepseek'];

export function getWizardProviders() {
  return FREE_WIZARD_PROVIDER_IDS.map((id) => findProvider(id)).filter((p) => p && p.id === p.id && p.free);
}
