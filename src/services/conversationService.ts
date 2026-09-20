/**
 * 聊天对话服务
 */
import { getDb } from '../db/connection.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
}

export interface ChatConversation {
  id: number;
  title: string;
  model: string;
  channelId: number | null;
  messages: ChatMessage[];
  messageCount: number;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * 获取所有对话列表（不含完整消息）
 */
export function listConversations(limit = 50, offset = 0): Omit<ChatConversation, 'messages'>[] {
  const rows = getDb()
    .prepare("SELECT * FROM chat_conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as any[];
  
  return rows.map((row) => ({
    id: row.id as number,
    title: row.title as string,
    model: row.model as string,
    channelId: (row.channel_id as number | null) || null,
    messageCount: (row.message_count as number) || 0,
    totalTokens: (row.total_tokens as number) || 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}

/**
 * 获取单个对话（含完整消息）
 */
export function getConversation(id: number): ChatConversation | null {
  const row = getDb()
    .prepare("SELECT * FROM chat_conversations WHERE id = ?")
    .get(id) as any;
  
  if (!row) return null;
  
  let messages: ChatMessage[] = [];
  try {
    messages = JSON.parse(row.messages as string);
  } catch {
    messages = [];
  }
  
  return {
    id: row.id as number,
    title: row.title as string,
    model: row.model as string,
    channelId: (row.channel_id as number | null) || null,
    messages,
    messageCount: (row.message_count as number) || 0,
    totalTokens: (row.total_tokens as number) || 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * 创建新对话
 */
export function createConversation(params: {
  title?: string;
  model: string;
  channelId?: number;
}): ChatConversation {
  const now = Date.now();
  const title = params.title?.trim() || '新对话';
  const model = params.model;
  const channelId = params.channelId ?? null;
  const messages: ChatMessage[] = [];
  
  const result = getDb()
    .prepare(
      "INSERT INTO chat_conversations (title, model, channel_id, messages, message_count, total_tokens, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)"
    )
    .run(title, model, channelId, JSON.stringify(messages), now, now);
  
  return {
    id: result.lastInsertRowid as number,
    title,
    model,
    channelId,
    messages,
    messageCount: 0,
    totalTokens: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 添加消息到对话
 */
export function addMessage(conversationId: number, message: Omit<ChatMessage, 'created_at'>, tokens?: number): ChatConversation | null {
  const conv = getConversation(conversationId);
  if (!conv) return null;
  
  const now = Date.now();
  const newMessage: ChatMessage = {
    ...message,
    created_at: now,
  };
  
  const updatedMessages = [...conv.messages, newMessage];
  const newMessageCount = updatedMessages.length;
  const newTotalTokens = conv.totalTokens + (tokens || 0);
  
  getDb()
    .prepare("UPDATE chat_conversations SET messages = ?, message_count = ?, total_tokens = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(updatedMessages), newMessageCount, newTotalTokens, now, conversationId);
  
  // 自动更新标题（第一条用户消息）
  if (newMessageCount === 1 && message.role === 'user') {
    const title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
    getDb()
      .prepare("UPDATE chat_conversations SET title = ? WHERE id = ?")
      .run(title, conversationId);
  }
  
  return getConversation(conversationId);
}

/**
 * 更新对话标题
 */
export function updateConversationTitle(conversationId: number, title: string): ChatConversation | null {
  const now = Date.now();
  getDb()
    .prepare("UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ?")
    .run(title.trim(), now, conversationId);
  return getConversation(conversationId);
}

/**
 * 更新对话模型
 */
export function updateConversationModel(conversationId: number, model: string): ChatConversation | null {
  const now = Date.now();
  getDb()
    .prepare("UPDATE chat_conversations SET model = ?, updated_at = ? WHERE id = ?")
    .run(model.trim(), now, conversationId);
  return getConversation(conversationId);
}

/**
 * 删除对话
 */
export function deleteConversation(conversationId: number): boolean {
  const result = getDb()
    .prepare("DELETE FROM chat_conversations WHERE id = ?")
    .run(conversationId);
  return result.changes > 0;
}

/**
 * 清空对话消息
 */
export function clearConversationMessages(conversationId: number): ChatConversation | null {
  const now = Date.now();
  getDb()
    .prepare("UPDATE chat_conversations SET messages = ?, message_count = 0, total_tokens = 0, updated_at = ? WHERE id = ?")
    .run(JSON.stringify([]), now, conversationId);
  return getConversation(conversationId);
}

/**
 * 获取对话统计
 */
export function getConversationStats(): { total: number; today: number; week: number } {
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  
  const total = getDb()
    .prepare("SELECT COUNT(*) as count FROM chat_conversations")
    .get() as any;
  
  const today = getDb()
    .prepare("SELECT COUNT(*) as count FROM chat_conversations WHERE created_at >= ?")
    .get(todayStart) as any;
  
  const week = getDb()
    .prepare("SELECT COUNT(*) as count FROM chat_conversations WHERE created_at >= ?")
    .get(weekAgo) as any;
  
  return {
    total: (total.count as number) || 0,
    today: (today.count as number) || 0,
    week: (week.count as number) || 0,
  };
}
