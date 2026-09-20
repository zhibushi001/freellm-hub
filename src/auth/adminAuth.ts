/**
 * 管理员账号管理
 * 管理员账号存在 settings.admin_users (JSON 数组)
 */
import { z } from 'zod';
import { getSetting, setSetting } from '../db/repos/settings.js';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from '../crypto/password.js';

const AdminUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(3).max(32),
  password_hash: z.string(),
  created_at: z.number().int(),
});
const AdminUsersSchema = z.array(AdminUserSchema);

export type AdminUser = z.infer<typeof AdminUserSchema>;

function loadAll(): AdminUser[] {
  const raw = getSetting('admin_users');
  if (!raw) return [];
  const parsed = AdminUsersSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error('[admin] admin_users JSON 损坏, 视为空');
    return [];
  }
  return parsed.data;
}

function saveAll(users: AdminUser[]): void {
  setSetting('admin_users', JSON.stringify(users));
}

export function hasAnyAdmin(): boolean {
  return loadAll().length > 0;
}

export function listAdmins(): AdminUser[] {
  return loadAll();
}

export interface CreateAdminInput {
  username: string;
  password: string;
}

export async function createFirstAdmin(input: CreateAdminInput): Promise<AdminUser> {
  if (loadAll().length > 0) {
    throw new Error('已经存在管理员账号, 请使用登录或重置流程');
  }
  const username = input.username.trim();
  if (username.length < 3 || username.length > 32) {
    throw new Error('用户名长度 3-32 字符');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    throw new Error('用户名只能包含字母、数字、下划线、横线');
  }
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok) {
    throw new Error(strength.reason);
  }
  const password_hash = await hashPassword(input.password);
  const user: AdminUser = {
    id: 1,
    username,
    password_hash,
    created_at: Date.now(),
  };
  saveAll([user]);
  setSetting('setup_completed', '1');
  return user;
}

export async function authenticate(username: string, password: string): Promise<AdminUser | null> {
  const users = loadAll();
  const user = users.find((u) => u.username === username);
  if (!user) return null;
  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) return null;
  return user;
}

export interface ChangePasswordInput {
  userId: number;
  oldPassword: string;
  newPassword: string;
}

/**
 * 改密码: 必须提供旧密码验证身份
 */
export async function changePassword(input: ChangePasswordInput): Promise<AdminUser> {
  const users = loadAll();
  const idx = users.findIndex((u) => u.id === input.userId);
  if (idx < 0) throw new Error('用户不存在');
  const user = users[idx];
  const ok = await verifyPassword(user.password_hash, input.oldPassword);
  if (!ok) throw new Error('旧密码错误');
  const strength = validatePasswordStrength(input.newPassword);
  if (!strength.ok) throw new Error(strength.reason);
  const updated: AdminUser = {
    ...user,
    password_hash: await hashPassword(input.newPassword),
  };
  users[idx] = updated;
  saveAll(users);
  return updated;
}

export interface UpdateUsernameInput {
  userId: number;
  newUsername: string;
}

export function updateUsername(input: UpdateUsernameInput): AdminUser {
  const users = loadAll();
  const idx = users.findIndex((u) => u.id === input.userId);
  if (idx < 0) throw new Error('用户不存在');
  const newName = input.newUsername.trim();
  if (newName.length < 3 || newName.length > 32) {
    throw new Error('用户名长度 3-32 字符');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
    throw new Error('用户名只能包含字母、数字、下划线、横线');
  }
  if (users.some((u, i) => i !== idx && u.username === newName)) {
    throw new Error('用户名已被占用');
  }
  const updated: AdminUser = { ...users[idx], username: newName };
  users[idx] = updated;
  saveAll(users);
  return updated;
}
