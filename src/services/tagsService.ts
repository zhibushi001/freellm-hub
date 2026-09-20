/**
 * 渠道标签服务
 */
import { getDb } from '../db/connection.js';

export interface ChannelTag {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  channelCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 获取所有标签
 */
export function listTags(): ChannelTag[] {
  const rows = getDb()
    .prepare("SELECT * FROM channel_tags ORDER BY created_at DESC")
    .all() as any[];
  
  return rows.map((row) => ({
    id: row.id as number,
    name: row.name as string,
    description: row.description as string | null,
    color: row.color as string | null,
    channelCount: (row.channel_count as number) || 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}

/**
 * 获取单个标签
 */
export function getTag(id: number): ChannelTag | null {
  const row = getDb()
    .prepare("SELECT * FROM channel_tags WHERE id = ?")
    .get(id) as any;
  
  if (!row) return null;
  
  return {
    id: row.id as number,
    name: row.name as string,
    description: row.description as string | null,
    color: row.color as string | null,
    channelCount: (row.channel_count as number) || 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * 获取标签名（用于显示）
 */
export function getTagByName(name: string): ChannelTag | null {
  const row = getDb()
    .prepare("SELECT * FROM channel_tags WHERE name = ?")
    .get(name) as any;
  
  if (!row) return null;
  
  return {
    id: row.id as number,
    name: row.name as string,
    description: row.description as string | null,
    color: row.color as string | null,
    channelCount: (row.channel_count as number) || 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * 创建标签
 */
export function createTag(tag: { name: string; description?: string; color?: string }): ChannelTag {
  const now = Date.now();
  const name = tag.name.trim();
  const description = tag.description?.trim() || null;
  const color = tag.color?.trim() || null;
  
  const result = getDb()
    .prepare(
      "INSERT INTO channel_tags (name, description, color, channel_count, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)"
    )
    .run(name, description, color, now, now);
  
  return {
    id: result.lastInsertRowid as number,
    name,
    description,
    color,
    channelCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 更新标签
 */
export function updateTag(id: number, updates: { name?: string; description?: string; color?: string }): ChannelTag | null {
  const existing = getTag(id);
  if (!existing) return null;
  
  const now = Date.now();
  const name = updates.name !== undefined ? updates.name.trim() : existing.name;
  const description = updates.description !== undefined ? updates.description.trim() || null : existing.description;
  const color = updates.color !== undefined ? updates.color.trim() || null : existing.color;
  
  getDb()
    .prepare("UPDATE channel_tags SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?")
    .run(name, description, color, now, id);
  
  return getTag(id);
}

/**
 * 删除标签
 */
export function deleteTag(id: number): boolean {
  const result = getDb()
    .prepare("DELETE FROM channel_tags WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

/**
 * 给渠道添加标签
 */
export function addTagToChannel(channelId: number, tagId: number): boolean {
  const result = getDb()
    .prepare("INSERT OR IGNORE INTO channel_tag_links (channel_id, tag_id, created_at) VALUES (?, ?, ?)")
    .run(channelId, tagId, Date.now());
  
  if (result.changes > 0) {
    // 更新标签的 channel_count
    getDb()
      .prepare("UPDATE channel_tags SET channel_count = channel_count + 1 WHERE id = ?")
      .run(tagId);
    return true;
  }
  return false;
}

/**
 * 从渠道移除标签
 */
export function removeTagFromChannel(channelId: number, tagId: number): boolean {
  const result = getDb()
    .prepare("DELETE FROM channel_tag_links WHERE channel_id = ? AND tag_id = ?")
    .run(channelId, tagId);
  
  if (result.changes > 0) {
    // 更新标签的 channel_count
    getDb()
      .prepare("UPDATE channel_tags SET channel_count = MAX(0, channel_count - 1) WHERE id = ?")
      .run(tagId);
    return true;
  }
  return false;
}

/**
 * 设置渠道的标签（替换所有标签）
 */
export function setChannelTags(channelId: number, tagIds: number[]): void {
  // 删除旧的关联
  getDb()
    .prepare("DELETE FROM channel_tag_links WHERE channel_id = ?")
    .run(channelId);
  
  // 添加新的关联
  for (const tagId of tagIds) {
    getDb()
      .prepare("INSERT OR IGNORE INTO channel_tag_links (channel_id, tag_id, created_at) VALUES (?, ?, ?)")
      .run(channelId, tagId, Date.now());
    
    getDb()
      .prepare("UPDATE channel_tags SET channel_count = channel_count + 1 WHERE id = ?")
      .run(tagId);
  }
}

/**
 * 获取渠道的所有标签
 */
export function getChannelTags(channelId: number): ChannelTag[] {
  const rows = getDb()
    .prepare(
      `SELECT t.* FROM channel_tags t
       INNER JOIN channel_tag_links l ON t.id = l.tag_id
       WHERE l.channel_id = ?
       ORDER BY t.name`
    )
    .all(channelId) as any[];
  
  return rows.map((row) => ({
    id: row.id as number,
    name: row.name as string,
    description: row.description as string | null,
    color: row.color as string | null,
    channelCount: (row.channel_count as number) || 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}

/**
 * 获取标签关联的渠道 ID 列表
 */
export function getChannelsByTag(tagId: number): number[] {
  const rows = getDb()
    .prepare("SELECT channel_id FROM channel_tag_links WHERE tag_id = ?")
    .all(tagId) as any[];
  return rows.map((r) => r.channel_id);
}

/**
 * 批量设置渠道标签
 */
export function batchSetChannelTags(channelIds: number[], tagIds: number[]): void {
  for (const channelId of channelIds) {
    setChannelTags(channelId, tagIds);
  }
}
