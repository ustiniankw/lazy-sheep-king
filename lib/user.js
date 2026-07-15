// lib/user.js — v0.3.3: 匿名用户资料与设备标签
import { Storage } from './storage.js';

function safeUUID() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${rand()}-${rand().slice(0, 4)}-${rand().slice(0, 4)}-${rand().slice(0, 4)}-${rand()}${rand().slice(0, 4)}`;
}

function detectDeviceLabel() {
  const ua = globalThis.navigator?.userAgent || '';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Win';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Web';
}

function defaultDisplayName() {
  return '懒羊羊伙伴';
}

export function createUserId() {
  return `usr_${safeUUID().replace(/-/g, '').slice(0, 12)}`;
}

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

export async function regenerateUserId() {
  const profile = await ensureProfile();
  return Storage.setProfile({ ...profile, userId: createUserId() });
}

export const User = {
  createUserId,
  getProfile,
  ensureProfile,
  setDisplayName,
  regenerateUserId,
};

export default User;
