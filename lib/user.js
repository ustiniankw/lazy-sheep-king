// lib/user.js — v0.3.5: 向后兼容 facade，委托到 lib/auth.js + lib/storage.js
// 保留旧 API（getProfile / setDisplayName / regenerateUserId），
// 其中 regenerateUserId 受会话解锁保护（本地密码 / GitHub 账号需先解锁）。
import { Storage } from './storage.js';
import { createUserId, detectDeviceLabel, defaultDisplayName, safeUUID } from './user_id.js';
import { getAuthState, getSession, MODE } from './auth.js';

export { createUserId, safeUUID };

export async function getProfile() {
  return Storage.getProfile();
}

export async function ensureProfile() {
  const current = await Storage.getProfile();
  if (current.userId) return current;
  const created = {
    userId: createUserId(),
    displayName: current.displayName || defaultDisplayName(),
    createdAt: Date.now(),
    deviceLabel: current.deviceLabel || detectDeviceLabel(),
  };
  await Storage.setProfile(created);
  return created;
}

export async function setDisplayName(name) {
  const profile = await ensureProfile();
  const displayName = String(name || '').trim() || defaultDisplayName();
  return Storage.setProfile({ ...profile, displayName });
}

// 生成新 userId：若处于非访客模式且会话被锁定，则拒绝（需先解锁验证）。
export async function regenerateUserId() {
  const state = await getAuthState();
  if (state.mode && state.mode !== MODE.GUEST && getSession() === null) {
    return { ok: false, code: 'LOCKED', message: '请先解锁账户再生成新用户 ID' };
  }
  const profile = await ensureProfile();
  return Storage.setProfile({ ...profile, userId: createUserId() });
}

export const User = {
  createUserId,
  getProfile,
  ensureProfile,
  setDisplayName,
  regenerateUserId,
  getAuthState,
};

export default User;
