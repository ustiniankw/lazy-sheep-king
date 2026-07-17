// lib/user.js — v0.6.0 · 向后兼容 facade
// v0.6.0 起简化：只委托 storage + 匿名 profile + identity 昵称/头像。
import { Storage } from './storage.js';
import { createUserId, detectDeviceLabel, defaultDisplayName, safeUUID } from './user_id.js';
import { getAuthState, getSession, MODE } from './auth.js';
import { ensureIdentity, updateIdentity, rerollNickname, rerollAvatar, setUploadedAvatar } from './identity.js';

export { createUserId, safeUUID };

const identityStorageAdapter = {
  getGlobal: (k) => Storage.getGlobal(k),
  setGlobal: (k, v) => Storage.setGlobal(k, v),
};

export async function getIdentity() {
  return ensureIdentity(identityStorageAdapter);
}

export async function saveNickname(nickname) {
  return updateIdentity(identityStorageAdapter, { nickname: String(nickname || '').trim() || undefined });
}

export async function rollNewNickname() {
  return rerollNickname(identityStorageAdapter);
}

export async function rollNewAvatar(styleOverride) {
  return rerollAvatar(identityStorageAdapter, styleOverride);
}

export async function useUploadedAvatar(dataUrl) {
  return setUploadedAvatar(identityStorageAdapter, dataUrl);
}

export async function pickAvatarStyle(style) {
  return updateIdentity(identityStorageAdapter, { avatarKind: 'dicebear', avatarStyle: style });
}

export async function getProfile() {
  const profile = await Storage.getProfile();
  const identity = await getIdentity();
  return {
    ...profile,
    displayName: profile?.displayName || identity.nickname || '',
    nickname: identity.nickname,
    avatarUrl: identity.avatarUrl,
    avatarKind: identity.avatarKind,
    avatarStyle: identity.avatarStyle,
  };
}

export async function ensureProfile() {
  const current = await Storage.getProfile();
  const identity = await getIdentity();
  if (current.userId) {
    if (!current.displayName && identity.nickname) {
      const updated = { ...current, displayName: identity.nickname };
      await Storage.setProfile(updated);
      return { ...updated, nickname: identity.nickname, avatarUrl: identity.avatarUrl };
    }
    return { ...current, nickname: identity.nickname, avatarUrl: identity.avatarUrl };
  }
  const created = {
    userId: createUserId(),
    displayName: current.displayName || identity.nickname || defaultDisplayName(),
    createdAt: Date.now(),
    deviceLabel: current.deviceLabel || detectDeviceLabel(),
  };
  await Storage.setProfile(created);
  return { ...created, nickname: identity.nickname, avatarUrl: identity.avatarUrl };
}

export async function setDisplayName(name) {
  const profile = await ensureProfile();
  const displayName = String(name || '').trim() || profile.nickname || defaultDisplayName();
  // 同步昵称 & profile.displayName
  await updateIdentity(identityStorageAdapter, { nickname: displayName });
  return Storage.setProfile({ ...profile, displayName });
}

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
  getIdentity,
  saveNickname,
  rollNewNickname,
  rollNewAvatar,
  useUploadedAvatar,
  pickAvatarStyle,
};

export default User;
