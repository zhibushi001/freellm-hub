import { useState, useEffect, useRef } from 'react';
import { Send, Trash2, Plus, MessageSquare, X, Loader2, ChevronDown, RefreshCw } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
}

interface Conversation {
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

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newModel, setNewModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
    loadModels();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentConversation?.messages]);

  const loadConversations = async () => {
    try {
      const res = await fetch('/api/admin/chat/conversations');
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setConversations(data.conversations);
        }
      }
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  };

  const loadModels = async () => {
    try {
      const res = await fetch('/api/admin/chat/models');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.data) {
          setModels(data.data.map((m: any) => m.id));
          if (data.data.length > 0) {
            setNewModel(data.data[0].id);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load models:', e);
    }
  };

  const createConversation = async () => {
    if (!newModel.trim()) return;
    try {
      const res = await fetch('/api/admin/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setCurrentConversation(data.conversation);
          loadConversations();
          setShowNewConv(false);
        }
      }
    } catch (e) {
      console.error('Failed to create conversation:', e);
    }
  };

  const selectConversation = async (conv: Conversation) => {
    try {
      const res = await fetch(`/api/admin/chat/conversations/${conv.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setCurrentConversation(data.conversation);
        }
      }
    } catch (e) {
      console.error('Failed to load conversation:', e);
    }
  };

  const deleteConversation = async (id: number) => {
    if (!confirm('确定删除这个对话吗？')) return;
    try {
      const res = await fetch(`/api/admin/chat/conversations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadConversations();
        if (currentConversation?.id === id) {
          setCurrentConversation(null);
        }
      }
    } catch (e) {
      console.error('Failed to delete conversation:', e);
    }
  };

  const updateConversationModel = async (model: string) => {
    if (!currentConversation) return;
    try {
      const res = await fetch(`/api/admin/chat/conversations/${currentConversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setCurrentConversation(data.conversation);
        }
      }
    } catch (e) {
      console.error('Failed to update conversation model:', e);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    if (!currentConversation) {
      alert('请先创建或选择一个对话');
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: input.trim(), created_at: Date.now() };
    const newMessages = [...currentConversation.messages, userMessage];
    
    // Update UI immediately
    setCurrentConversation({
      ...currentConversation,
      messages: newMessages,
      messageCount: newMessages.length,
    });
    setInput('');
    setLoading(true);

    try {
      // Save user message to backend
      await fetch(`/api/admin/chat/conversations/${currentConversation.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: userMessage.content }),
      });

      // Send to chat API with streaming
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: currentConversation.model,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          stream: true,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error?.message || `HTTP ${response.status}`);
      }

      // Read streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取流式响应');
      }

      const decoder = new TextDecoder();
      let assistantContent = '';
      let buffer = '';
      
      // Create placeholder for assistant message
      const assistantMessage: ChatMessage = { role: 'assistant', content: '', created_at: Date.now() };
      const updatedMessages = [...newMessages, assistantMessage];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine.startsWith(':')) continue;
          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6);
            if (dataStr === '[DONE]') continue;
            
            try {
              const data = JSON.parse(dataStr);
              const contentDelta = data.choices?.[0]?.delta?.content;
              if (contentDelta) {
                assistantContent += contentDelta;
                // Update the last message in the UI
                setCurrentConversation((prev) => {
                  if (!prev) return prev;
                  const msgs = [...prev.messages];
                  msgs[msgs.length - 1] = { ...assistantMessage, content: assistantContent };
                  return { ...prev, messages: msgs };
                });
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      // Save assistant message to backend
      if (assistantContent) {
        await fetch(`/api/admin/chat/conversations/${currentConversation.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: assistantContent }),
        });
        
        // Update UI with final content
        const finalMessages = [...newMessages, { ...assistantMessage, content: assistantContent }];
        setCurrentConversation({
          ...currentConversation,
          messages: finalMessages,
          messageCount: finalMessages.length,
        });
      }

      // Refresh conversation list (title might have changed)
      loadConversations();
    } catch (error: any) {
      const errorMsg: ChatMessage = { 
        role: 'assistant', 
        content: `错误: ${error.message}`, 
        created_at: Date.now() 
      };
      setCurrentConversation({
        ...currentConversation,
        messages: [...newMessages, errorMsg],
        messageCount: newMessages.length + 1,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden p-4 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">
            {currentConversation?.title || '选择对话'}
          </h2>
          <p className="text-sm text-gray-500">
            {currentConversation?.model || '请选择对话开始聊天'}
          </p>
        </div>
        <button
          onClick={() => setShowNewConv(true)}
          className="flex items-center gap-1 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg"
        >
          <Plus size={16} />
          新建
        </button>
      </div>

      {/* Sidebar - Conversation List (Desktop) */}
      <div className="hidden md:flex w-64 bg-gray-100 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setShowNewConv(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            <Plus size={16} />
            新建对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">暂无对话</div>
          ) : (
            <div className="p-2 space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                    currentConversation?.id === conv.id
                      ? 'bg-primary-100 dark:bg-primary-900/30'
                      : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => selectConversation(conv)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{conv.title || '新对话'}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {conv.model} · {conv.messageCount} 条消息
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {!currentConversation ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
              <p>选择一个对话或创建新对话开始聊天</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-lg truncate">{currentConversation.title || '新对话'}</h2>
                    <p className="text-sm text-gray-500">
                      <select
                        value={currentConversation.model}
                        onChange={(e) => updateConversationModel(e.target.value)}
                        className="text-sm text-gray-500 bg-transparent border-none cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5"
                      >
                        {models.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadModels()}
                    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                    title="刷新模型列表"
                  >
                    <RefreshCw size={18} />
                  </button>
                  <button
                    onClick={() => deleteConversation(currentConversation.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {currentConversation.messages.length === 0 ? (
                <div className="text-center text-gray-400 mt-8">
                  <MessageSquare size={32} className="mx-auto mb-2 opacity-50" />
                  <p>开始新的对话</p>
                </div>
              ) : (
                currentConversation.messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] p-3 rounded-lg ${
                        msg.role === 'user'
                          ? 'bg-primary-600 text-white'
                          : msg.role === 'assistant'
                          ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words min-w-0">{msg.content}</div>
                      <div className="text-xs mt-1 opacity-60">
                        {new Date(msg.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg">
                    <Loader2 size={20} className="animate-spin text-gray-400" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                  className="flex-1 min-w-0 p-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                  rows={2}
                  disabled={loading}
                />
                <button
                  onClick={sendMessage}
                  disabled={loading || !input.trim()}
                  className="p-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* New Conversation Modal */}
      {showNewConv && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 w-full max-w-md shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">新建对话</h3>
              <button
                onClick={() => setShowNewConv(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                选择模型
              </label>
              <select
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              >
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={createConversation}
                disabled={!newModel.trim()}
                className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                创建
              </button>
              <button
                onClick={() => setShowNewConv(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
