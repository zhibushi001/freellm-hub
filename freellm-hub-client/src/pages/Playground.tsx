import { useState, useEffect, useRef } from 'react';
import { Send, StopCircle, Trash2, Copy, Check, Loader2, Play } from 'lucide-react';
import { copyToClipboard as copyToClipboardUtil } from '../utils/copy';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function Playground() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const res = await fetch('/api/admin/chat/models');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.data) {
          const modelIds = data.data.map((m: any) => m.id as string);
          setModels(modelIds);
          if (modelIds.length > 0 && !selectedModel) {
            setSelectedModel(modelIds[0]);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load models:', e);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading || !selectedModel) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      // 使用 admin 代理端点调用 chat completions
      abortRef.current = new AbortController();
      const response = await fetch('/api/admin/chat/test-completion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: newMessages,
        }),
        signal: abortRef.current.signal,
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message || '请求失败');
      }
      
      const assistantContent = data.choices?.[0]?.message?.content || '(无内容)';
      setMessages([...newMessages, { role: 'assistant', content: assistantContent }]);
    } catch (error: any) {
      // 用户主动停止时不显示错误
      if (error?.name === 'AbortError') return;
      setMessages([...newMessages, { role: 'assistant', content: `错误: ${error.message}` }]);
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const clearChat = () => {
    setMessages([]);
  };

  const copyToClipboard = async (text: string) => {
    const success = await copyToClipboardUtil(text);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            <Play className="inline mr-2" />
            Playground
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex items-center"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              清空
            </button>
          </div>
        </div>
      </div>

      {/* 聊天区域 */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <p>开始测试你的 LLM API</p>
              <p className="text-sm mt-2">选择模型即可开始测试</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    msg.role === 'user'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm break-words min-w-0">{msg.content}</div>
                  {msg.role === 'assistant' && (
                    <button
                      onClick={() => copyToClipboard(msg.content)}
                      className="mt-2 text-xs text-gray-400 hover:text-gray-600 flex items-center"
                    >
                      {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                      复制
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="px-2 sm:px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 max-w-[110px] sm:max-w-xs shrink-0"
          >
            {models.length === 0 && <option value="">无可用模型</option>}
            {models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="输入消息..."
            disabled={loading || !selectedModel}
            className="flex-1 min-w-0 px-3 sm:px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
          />
          
          {loading ? (
            <button
              onClick={stopGeneration}
              className="px-3 sm:px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded flex items-center shrink-0"
            >
              <StopCircle className="w-4 h-4 mr-1" />
              停止
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim() || !selectedModel}
              className="px-3 sm:px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded flex items-center disabled:opacity-50 shrink-0"
            >
              <Send className="w-4 h-4 mr-1" />
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
