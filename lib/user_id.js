// lib/user_id.js — 匿名 userId / 设备标签 / 默认昵称（无依赖，供 auth.js 与 user.js 复用）

export function safeUUID() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${rand()}-${rand().slice(0, 4)}-${rand().slice(0, 4)}-${rand().slice(0, 4)}-${rand()}${rand().slice(0, 4)}`;
}

export function createUserId() {
  return `usr_${safeUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function detectDeviceLabel() {
  const ua = globalThis.navigator?.userAgent || '';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Win';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Web';
}

export function defaultDisplayName() {
  return '懒羊羊伙伴';
}
