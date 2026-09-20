import React, { useState, useEffect } from 'react';
import { api, Channel, Key, Provider } from '../api';
import { copyToClipboard } from '../utils/copy';
import {
  Plus,
  Trash2,
  Play,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Copy,
  Eye,
  EyeOff,
  X,
  Search,
  Check,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ExternalLink,
  Zap,
  Eye as VisionEye,
  Pencil,
  Code,
  Image,
  Volume2,
  Mic,
} from 'lucide-react';

const PROTOCOLS = [
  { id: 'openai', name: 'OpenAI Compatible' },
  { id: 'anthropic', name: 'Anthropic Messages' },
  { id: 'gemini', name: 'Google Gemini' },
];

const PROVIDER_LOGOS: Record<string, string> = {
  openai: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/OpenAIIcon.svg',
  anthropic: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/AnthropicIcon.svg',
  google: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/GoogleIcon.svg',
  deepseek: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/DeepSeekIcon.svg',
  groq: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/GroqIcon.svg',
  minimax: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/MiniMaxIcon.svg',
  mistral: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/MistralIcon.svg',
  openrouter: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/OpenRouterIcon.svg',
  together: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/TogetherIcon.svg',
  fireworks: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/FireworksIcon.svg',
  moonshot: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/MoonshotIcon.svg',
  zhipu: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/ZhipuIcon.svg',
  yi: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/YiIcon.svg',
  dashscope: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/AlibabaIcon.svg',
  cohere: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/CohereIcon.svg',
  perplexity: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/PerplexityIcon.svg',
  xai: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/xFIIcon.svg',
  azure: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/MicrosoftAzureIcon.svg',
  aws: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/AmazonIcon.svg',
  volcengine: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/VolcengineIcon.svg',
  baidu: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/BaiduIcon.svg',
  xunfei: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/XunfeiIcon.svg',
  ollama: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/OllamaIcon.svg',
  huggingface: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/HuggingFaceIcon.svg',
  cerebras: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/CerebrasIcon.svg',
  siliconflow: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/SiliconFlowIcon.svg',
  cloudflare: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/CloudflareIcon.svg',
  nvidia: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/NvidiaIcon.svg',
  custom: 'https://cdn.jsdelivr.net/gh/lobehub/lobe-icons@main/packages/icons/logos/CustomIcon.svg',
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'from-green-500 to-green-600',
  anthropic: 'from-orange-500 to-orange-600',
  google: 'from-red-500 to-yellow-500',
  deepseek: 'from-cyan-500 to-cyan-600',
  groq: 'from-amber-500 to-yellow-500',
  minimax: 'from-purple-500 to-purple-600',
  custom: 'from-gray-500 to-gray-600',
};

function getProviderIcon(name: string): React.ReactNode {
  const logo = PROVIDER_LOGOS[name];
  if (logo) {
    return <img src={logo} alt={name} className="w-5 h-5 rounded" />;
  }
  return <span className="text-base">📡</span>;
}

function getProviderColor(name: string): string {
  return PROVIDER_COLORS[name] || 'from-gray-500 to-gray-600';
}

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedChannel, setExpandedChannel] = useState<number | null>(null);
  const [channelKeys, setChannelKeys] = useState<Record<number, Key[]>>({});
  const [testing, setTesting] = useState<number | null>(null);
  const [fetchingModels, setFetchingModels] = useState<number | null>(null);
  const [probing, setProbing] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [editForm, setEditForm] = useState({
    label: '',
    name: '',
    test_model: '',
    priority: 0,
    weight: 1,
    models: '',
    tag: '',
    support_vision: false,
    support_tools: false,
    support_image: false,
    support_video: false,
    support_tts: false,
    support_stt: false,
  });
  const [editingLoading, setEditingLoading] = useState(false);
  
  // 标签状态
  const [tags, setTags] = useState<any[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [selectedTagFilter, setSelectedTagFilter] = useState<number | null>(null);
  const [showTagManager, setShowTagManager] = useState(false);
  const [showChannelTags, setShowChannelTags] = useState<number | null>(null);
  
  // 批量操作状态
  const [selectedChannels, setSelectedChannels] = useState<Set<number>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchEditForm, setBatchEditForm] = useState({
    enabled: -1, // -1 = 不修改, 0 = 禁用, 1 = 启用
    priority: -1,
    weight: -1,
    tag: '',
  });
  
  // 测速弹窗状态
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [benchmarkChannel, setBenchmarkChannel] = useState<Channel | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<any | null>(null);
  const [benchmarkModel, setBenchmarkModel] = useState('');
  const [benchmarkSamples, setBenchmarkSamples] = useState(5);

  // 模型测试状态
  const [showModelTest, setShowModelTest] = useState(false);
  const [modelTestChannel, setModelTestChannel] = useState<Channel | null>(null);
  const [modelTestLoading, setModelTestLoading] = useState(false);
  const [modelTestResults, setModelTestResults] = useState<{
    results: Array<{
      key_id: number;
      key_label: string | null;
      upstream_id: string;
      ok: boolean;
      latency_ms: number;
      error?: string;
    }>;
    summary: { total: number; ok: number; error: number; untested: number };
  } | null>(null);

  useEffect(() => {
    loadChannels();
    api.getProviders().then(setProviders).catch(() => {});
    api.getTags().then(setTags).catch(() => {});
  }, []);

  const loadChannels = async () => {
    try {
      const data = await api.getChannels();
      setChannels(data);
    } catch (err) {
      console.error('Failed to load channels:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadKeys = async (channelId: number) => {
    try {
      const keys = await api.getChannelKeys(channelId);
      setChannelKeys((prev) => ({ ...prev, [channelId]: keys }));
    } catch (err) {
      console.error('Failed to load keys:', err);
    }
  };

  const handleExpand = async (channelId: number) => {
    if (expandedChannel === channelId) {
      setExpandedChannel(null);
    } else {
      setExpandedChannel(channelId);
      if (!channelKeys[channelId]) {
        await loadKeys(channelId);
      }
    }
  };

  const handleTest = async (id: number) => {
    setTesting(id);
    try {
      const result = await api.testChannel(id);
      if (result.ok) {
        alert(`测试成功! 延迟: ${result.latency}ms`);
      } else {
        alert(`测试失败: ${result.error}`);
      }
    } catch (err: any) {
      alert(`测试失败: ${err.message}`);
    } finally {
      setTesting(null);
    }
  };

  const handleSpeedTest = async (id: number) => {
    const channel = channels.find(c => c.id === id);
    if (!channel) return;
    
    setBenchmarkChannel(channel);
    setBenchmarkModel(channel.test_model || 'gpt-4o-mini');
    setBenchmarkResult(null);
    setShowBenchmark(true);
  };

  // 模型健康检查
  const handleModelTest = async (id: number) => {
    const channel = channels.find(c => c.id === id);
    if (!channel) return;
    
    setModelTestChannel(channel);
    setModelTestResults(null);
    setShowModelTest(true);
  };

  const runModelTest = async () => {
    if (!modelTestChannel) return;
    setModelTestLoading(true);
    setModelTestResults(null);
    
    try {
      const result = await api.testChannelModels(modelTestChannel.id);
      setModelTestResults(result);
    } catch (err: any) {
      alert(`模型测试失败: ${err.message}`);
    } finally {
      setModelTestLoading(false);
    }
  };

  const handleDeleteFailedModels = async () => {
    if (!modelTestChannel || !modelTestResults) return;
    const failedCount = modelTestResults.summary.error;
    if (failedCount === 0) {
      alert('没有失败的模型需要删除');
      return;
    }
    if (!confirm(`确定删除 ${failedCount} 个失败的模型？`)) return;
    
    try {
      const result = await api.deleteFailedModels(modelTestChannel.id);
      alert(`已删除 ${result.deleted_count} 个失败模型`);
      // 重新测试
      await runModelTest();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  const runBenchmark = async () => {
    if (!benchmarkChannel) return;
    setBenchmarkLoading(true);
    setBenchmarkResult(null);
    
    try {
      // 获取第一个 key 的 id 进行测速
      const keyResponse = await fetch(`/api/admin/channels/${benchmarkChannel.id}/keys`);
      if (keyResponse.ok) {
        const keyData = await keyResponse.json();
        if (keyData.ok && keyData.keys.length > 0) {
          const keyId = keyData.keys[0].id;
          const benchmarkResponse = await fetch(`/api/admin/benchmark/${keyId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: benchmarkModel,
              samples: benchmarkSamples,
            }),
          });
          if (benchmarkResponse.ok) {
            const result = await benchmarkResponse.json();
            setBenchmarkResult(result);
          }
        }
      }
    } catch (err: any) {
      setBenchmarkResult({ error: err.message });
    } finally {
      setBenchmarkLoading(false);
    }
  };

  const handleFetchModels = async (id: number) => {
    setFetchingModels(id);
    try {
      const result = await api.fetchModels(id);
      if (result.ok) {
        alert(`发现 ${result.models.length} 个模型:\n${result.models.slice(0, 10).join(', ')}${result.models.length > 10 ? '...' : ''}`);
      } else {
        alert('发现模型失败');
      }
    } catch (err: any) {
      alert(`发现模型失败: ${err.message}`);
    } finally {
      setFetchingModels(null);
    }
  };

  const handleProbe = async (id: number) => {
    setProbing(id);
    try {
      const result = await api.probeChannel(id);
      if (result.ok) {
        const parts = [];
        if (result.reasoning) parts.push('✅ Reasoning');
        if (result.tool_calls) parts.push('✅ Tool Calls');
        if (result.vision) parts.push('✅ Vision');
        const summary = parts.length > 0 ? parts.join(', ') : '❌ 未检测到能力';
        alert(`能力探测完成!\n${summary}\n延迟: ${result.latencyMs}ms`);
      } else {
        alert(`能力探测失败: ${result.error || '未知错误'}`);
      }
    } catch (err: any) {
      alert(`能力探测失败: ${err.message}`);
    } finally {
      setProbing(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个渠道吗？')) return;
    try {
      await api.deleteChannel(id);
      await loadChannels();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  const handleEdit = (id: number) => {
    const channel = channels.find(c => c.id === id);
    if (!channel) return;
    setEditingChannel(channel);
    // 解析渠道已有的 capabilities JSON
    let caps: any = {};
    try { caps = channel.capabilities ? JSON.parse(channel.capabilities) : {}; } catch {}
    setEditForm({
      label: channel.label || '',
      name: channel.name || '',
      test_model: channel.test_model || '',
      priority: channel.priority || 0,
      weight: channel.weight || 1,
      models: channel.models || '',
      tag: channel.tag || '',
      support_vision: !!caps.vision,
      support_tools: !!caps.tools,
      support_image: !!caps.image,
      support_video: !!caps.video,
      support_tts: !!caps.tts,
      support_stt: !!caps.stt,
    });
    setShowEditModal(true);
  };

  const handleEditSubmit = async () => {
    if (!editingChannel) return;
    setEditingLoading(true);
    try {
      // 构建 capabilities JSON
      const capabilities: any = {};
      if (editForm.support_vision) capabilities.vision = true;
      if (editForm.support_tools) capabilities.tools = true;
      if (editForm.support_image) capabilities.image = true;
      if (editForm.support_video) capabilities.video = true;
      if (editForm.support_tts) capabilities.tts = true;
      if (editForm.support_stt) capabilities.stt = true;
      const capabilitiesJson = Object.keys(capabilities).length > 0 ? JSON.stringify(capabilities) : '';

      await api.updateChannel(editingChannel.id, {
        label: editForm.label || undefined,
        test_model: editForm.test_model || undefined,
        priority: editForm.priority,
        weight: editForm.weight,
        models: editForm.models || undefined,
        tag: editForm.tag || undefined,
        capabilities: capabilitiesJson,
      });
      await loadChannels();
      setShowEditModal(false);
      alert('更新成功');
    } catch (err: any) {
      alert(`更新失败: ${err.message}`);
    } finally {
      setEditingLoading(false);
    }
  };

  const handleToggle = async (channel: Channel) => {
    try {
      const isCurrentlyEnabled = channel.enabled === 1 || (channel.enabled === undefined && channel.status === 1);
      const newStatus = isCurrentlyEnabled ? 0 : 1;
      await api.updateChannel(channel.id, { enabled: newStatus, status: newStatus });
      await loadChannels();
    } catch (err: any) {
      alert(`操作失败: ${err.message}`);
    }
  };

  // 批量操作处理函数
  const toggleSelectChannel = (id: number) => {
    setSelectedChannels(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedChannels.size === filteredChannels.length) {
      setSelectedChannels(new Set());
    } else {
      setSelectedChannels(new Set(filteredChannels.map(c => c.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedChannels.size === 0) return;
    if (!confirm(`确定要删除 ${selectedChannels.size} 个渠道吗？`)) return;
    setBatchLoading(true);
    try {
      const result = await api.batchDeleteChannels(Array.from(selectedChannels));
      alert(`已删除 ${result.deleted_count} 个渠道`);
      setSelectedChannels(new Set());
      await loadChannels();
    } catch (err: any) {
      alert(`批量删除失败: ${err.message}`);
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchTest = async () => {
    if (selectedChannels.size === 0) return;
    setBatchLoading(true);
    try {
      const result = await api.batchTestChannels(Array.from(selectedChannels));
      alert(`批量测试完成:\n成功: ${result.success_count}\n失败: ${result.failed_count}`);
      await loadChannels();
    } catch (err: any) {
      alert(`批量测试失败: ${err.message}`);
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchEnable = async (enabled: boolean) => {
    if (selectedChannels.size === 0) return;
    setBatchLoading(true);
    try {
      await api.batchStatusChannels(Array.from(selectedChannels), enabled);
      alert(`已${enabled ? '启用' : '禁用'} ${selectedChannels.size} 个渠道`);
      await loadChannels();
    } catch (err: any) {
      alert(`批量操作失败: ${err.message}`);
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchEdit = async () => {
    if (selectedChannels.size === 0) return;
    setBatchLoading(true);
    try {
      const updates: any = {};
      if (batchEditForm.enabled !== -1) updates.enabled = batchEditForm.enabled;
      if (batchEditForm.priority !== -1) updates.priority = batchEditForm.priority;
      if (batchEditForm.weight !== -1) updates.weight = batchEditForm.weight;
      if (batchEditForm.tag) updates.tag = batchEditForm.tag;
      
      const result = await api.batchEditChannels(Array.from(selectedChannels), updates);
      alert(`已更新 ${result.updated_count} 个渠道`);
      setShowBatchEdit(false);
      setBatchEditForm({ enabled: -1, priority: -1, weight: -1, tag: '' });
      await loadChannels();
    } catch (err: any) {
      alert(`批量编辑失败: ${err.message}`);
    } finally {
      setBatchLoading(false);
    }
  };

  const handleCopyChannel = async (id: number) => {
    try {
      const result = await api.copyChannel(id);
      if (result.ok) {
        alert('渠道已复制! 新渠道默认禁用，请手动添加 API Key');
        await loadChannels();
      } else {
        alert('复制失败');
      }
    } catch (err: any) {
      alert(`复制失败: ${err.message}`);
    }
  };

  const getProviderName = (channel: Channel) => {
    if (channel.provider_name) return channel.provider_name;
    const p = providers.find((p) => p.id === channel.provider_id);
    return p?.display_name || p?.name || '未知';
  };

  const filteredChannels = channels.filter((c) =>
    (c.name || c.label || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in overflow-x-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 md:gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">渠道管理</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 md:mt-2 text-sm md:text-base">管理 API 渠道和密钥配置</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary flex items-center justify-center gap-2"
        >
          <Plus size={18} />
          <span className="hidden sm:inline">添加渠道</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索渠道..."
            className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          {selectedTagFilter && (
            <button
              onClick={() => setSelectedTagFilter(null)}
              className="px-3 py-2.5 rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 text-sm font-medium flex items-center gap-2"
            >
              <span className="hidden sm:inline">标签:</span> {tags.find(t => t.id === selectedTagFilter)?.name || '未知'}
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => setShowTagManager(true)}
            className="px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-medium flex items-center gap-2"
          >
            <Check size={16} />
            <span className="hidden sm:inline">标签管理</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {/* 批量操作工具栏 */}
        {selectedChannels.size > 0 && (
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800/50">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-indigo-700 dark:text-indigo-300 shrink-0">
                <Check size={16} />
                <span>已选择 {selectedChannels.size} 个渠道</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={handleBatchTest}
                  disabled={batchLoading}
                  className="px-3 py-1.5 text-sm bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50"
                >
                  批量测试
                </button>
                <button
                  onClick={() => handleBatchEnable(true)}
                  disabled={batchLoading}
                  className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  批量启用
                </button>
                <button
                  onClick={() => handleBatchEnable(false)}
                  disabled={batchLoading}
                  className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  批量禁用
                </button>
                <button
                  onClick={() => setShowBatchEdit(true)}
                  disabled={batchLoading}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  批量编辑
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={batchLoading}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  批量删除
                </button>
                <button
                  onClick={() => setSelectedChannels(new Set())}
                  className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                >
                  取消
                </button>
            </div>
          </div>
        </div>
        )}
        
        {filteredChannels.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-4">
              <Wifi size={24} className="text-slate-400" />
            </div>
            <p className="text-slate-500 dark:text-slate-400">暂无渠道</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">点击"添加渠道"创建第一个</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {/* 全选行 */}
            <div className="p-3 bg-slate-50/50 dark:bg-slate-700/20 flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedChannels.size === filteredChannels.length && filteredChannels.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </label>
              <span className="text-sm text-slate-600 dark:text-slate-300">全选 ({filteredChannels.length} 个渠道)</span>
            </div>
            
            {filteredChannels.map((channel) => {
              const provider = providers.find((p) => p.id === channel.provider_id);
              const iconName = provider?.name || 'custom';
              const isEnabled = channel.enabled === 1 || (channel.enabled === undefined && channel.status === 1);
              const isSelected = selectedChannels.has(channel.id);

              return (
                <div key={channel.id} className={isSelected ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}>
                  <div className="p-3 md:p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <div className="flex items-center gap-2 md:gap-4">
                      {/* 选择框 */}
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectChannel(channel.id)}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </label>

                      <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden shrink-0">
                        {getProviderIcon(iconName)}
                      </div>

                      <button
                        onClick={() => handleToggle(channel)}
                        className={`p-2 rounded-xl transition-colors shrink-0 ${
                          isEnabled
                            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                            : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500'
                        }`}
                      >
                        {isEnabled ? <Wifi size={16} /> : <WifiOff size={16} />}
                      </button>

                      <button
                        onClick={() => handleExpand(channel.id)}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 shrink-0"
                      >
                        {expandedChannel === channel.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white truncate">{channel.name || channel.label || '未命名'}</span>
                          {channel.tag && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 shrink-0">
                              {channel.tag}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                          {getProviderName(channel)} · {channel.key_count || 0} 个 Key
                        </div>
                      </div>

                      {/* 移动端只显示关键按钮 */}
                      <div className="flex items-center gap-1 md:hidden shrink-0">
                        <button
                          onClick={() => handleTest(channel.id)}
                          disabled={testing === channel.id}
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 dark:hover:text-blue-400 disabled:opacity-50 transition-colors"
                          title="测试连接"
                        >
                          {testing === channel.id ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <Play size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => handleEdit(channel.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 dark:hover:text-blue-400 transition-colors"
                          title="编辑"
                        >
                          <Pencil size={16} />
                        </button>
                      </div>

                      {/* 桌面端显示所有按钮 */}
                      <div className="hidden md:flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleTest(channel.id)}
                          disabled={testing === channel.id}
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 dark:hover:text-blue-400 disabled:opacity-50 transition-colors"
                          title="测试连接"
                        >
                          {testing === channel.id ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <Play size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => handleSpeedTest(channel.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 dark:hover:text-amber-400 transition-colors"
                          title="测速 (3次)"
                        >
                          <Zap size={16} />
                        </button>
                        <button
                          onClick={() => handleFetchModels(channel.id)}
                          disabled={fetchingModels === channel.id}
                          className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400 disabled:opacity-50 transition-colors"
                          title="发现模型"
                        >
                          {fetchingModels === channel.id ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <Search size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => handleProbe(channel.id)}
                          disabled={probing === channel.id}
                          className="p-2 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-500/10 dark:hover:text-purple-400 disabled:opacity-50 transition-colors"
                          title="能力探测"
                        >
                          {probing === channel.id ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <Wifi size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => handleCopyChannel(channel.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-400 transition-colors"
                          title="复制渠道"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => handleEdit(channel.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 dark:hover:text-blue-400 transition-colors"
                          title="编辑"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(channel.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition-colors"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {expandedChannel === channel.id && (
                    <div className="px-3 md:px-4 pb-3 md:pb-4 bg-slate-50/50 dark:bg-slate-700/20">
                      <div className="p-3 md:p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 md:gap-3 mb-3">
                          <h4 className="font-semibold text-slate-900 dark:text-white">API Keys ({channelKeys[channel.id]?.length || 0})</h4>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => loadKeys(channel.id)}
                              className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                            >
                              <RefreshCw size={12} />
                              <span className="hidden sm:inline">刷新</span>
                            </button>
                            <AddKeyButton channelId={channel.id} onAdded={() => loadKeys(channel.id)} />
                          </div>
                        </div>
                        {channelKeys[channel.id]?.length === 0 ? (
                          <p className="text-sm text-slate-500 dark:text-slate-400">暂无 Keys</p>
                        ) : (
                          <div className="space-y-2">
                            {channelKeys[channel.id]?.map((key) => (
                              <KeyRow
                                key={key.id}
                                key_={key}
                                channelId={channel.id}
                                onEdit={async () => {
                                  try {
                                    await loadKeys(channel.id);
                                  } catch (err: any) {
                                    alert('刷新失败: ' + err.message);
                                  }
                                }}
                                onDelete={async () => {
                                  if (!confirm('确定删除这个 Key？')) return;
                                  try {
                                    await api.deleteKey(key.id);
                                    await loadKeys(channel.id);
                                  } catch (err: any) {
                                    alert('删除失败: ' + err.message);
                                  }
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 模型健康检查 */}
                      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
                          <h4 className="font-semibold text-slate-900 dark:text-white">已发现模型</h4>
                          <button
                            onClick={() => handleModelTest(channel.id)}
                            disabled={modelTestLoading && modelTestChannel?.id === channel.id}
                            className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            <Zap size={14} />
                            {modelTestLoading && modelTestChannel?.id === channel.id ? '测试中...' : '批量测速'}
                          </button>
                        </div>
                        {modelTestResults && modelTestChannel?.id === channel.id && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-4 text-sm mb-2">
                              <span className="text-emerald-600">✅ 正常: {modelTestResults.summary.ok}</span>
                              <span className="text-red-600">❌ 失败: {modelTestResults.summary.error}</span>
                              <span className="text-slate-400">未测试: {modelTestResults.summary.untested}</span>
                            </div>
                            {modelTestResults.results.length === 0 ? (
                              <p className="text-sm text-slate-500 dark:text-slate-400">暂无已发现的模型，请先进行能力探测</p>
                            ) : (
                              <div className="max-h-48 overflow-y-auto space-y-1">
                                {modelTestResults.results.map((r, i) => (
                                  <div key={i} className={`flex items-center justify-between p-2 rounded-lg text-sm ${
                                    r.ok ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-red-50 dark:bg-red-500/10'
                                  }`}>
                                    <div className="flex items-center gap-2 min-w-0">
                                      {r.ok ? (
                                        <Wifi size={14} className="text-emerald-600 shrink-0" />
                                      ) : (
                                        <WifiOff size={14} className="text-red-600 shrink-0" />
                                      )}
                                      <span className="text-slate-700 dark:text-slate-300 truncate">{r.upstream_id}</span>
                                      {r.key_label && (
                                        <span className="text-xs text-slate-400 shrink-0">({r.key_label})</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {r.ok ? (
                                        <span className="text-emerald-600">{r.latency_ms}ms</span>
                                      ) : (
                                        <span className="text-red-600 text-xs max-w-[150px] truncate" title={r.error}>
                                          {r.error}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {modelTestResults.summary.error > 0 && (
                              <button
                                onClick={handleDeleteFailedModels}
                                className="mt-2 px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 flex items-center gap-1"
                              >
                                <Trash2 size={14} />
                                清理 {modelTestResults.summary.error} 个失败模型
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateChannelModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await loadChannels();
          }}
        />
      )}

      {showEditModal && editingChannel && (
        <EditChannelModal
          channel={editingChannel}
          form={editForm}
          onFormChange={setEditForm}
          onSave={handleEditSubmit}
          onClose={() => setShowEditModal(false)}
          loading={editingLoading}
        />
      )}

      {showBatchEdit && (
        <BatchEditModal
          form={batchEditForm}
          onFormChange={setBatchEditForm}
          onSave={handleBatchEdit}
          onClose={() => setShowBatchEdit(false)}
          loading={batchLoading}
          count={selectedChannels.size}
        />
      )}

      {showTagManager && (
        <TagManagerModal
          tags={tags}
          channels={channels}
          onClose={() => setShowTagManager(false)}
          onTagsChanged={() => {
            api.getTags().then(setTags).catch(() => {});
          }}
        />
      )}

      {showBenchmark && benchmarkChannel && (
        <BenchmarkModal
          channel={benchmarkChannel}
          model={benchmarkModel}
          onModelChange={setBenchmarkModel}
          samples={benchmarkSamples}
          onSamplesChange={setBenchmarkSamples}
          loading={benchmarkLoading}
          result={benchmarkResult}
          onRun={runBenchmark}
          onClose={() => setShowBenchmark(false)}
        />
      )}

      {/* 模型批量测试弹窗 */}
      {showModelTest && modelTestChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden mx-4">
            <div className="p-4 md:p-6 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">模型批量测速</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {modelTestChannel.name || modelTestChannel.label || '未命名渠道'}
                  </p>
                </div>
                <button
                  onClick={() => setShowModelTest(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <div className="p-4 md:p-6 overflow-y-auto max-h-[60vh]">
              {!modelTestResults ? (
                <div className="text-center py-8">
                  <p className="text-slate-500 dark:text-slate-400 mb-4">
                    点击"开始测试"对所有已发现模型进行实际调用测试
                  </p>
                  <button
                    onClick={runModelTest}
                    disabled={modelTestLoading}
                    className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 mx-auto"
                  >
                    {modelTestLoading ? (
                      <>
                        <RefreshCw size={18} className="animate-spin" />
                        测试中，请稍候...
                      </>
                    ) : (
                      <>
                        <Zap size={18} />
                        开始测试
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-4 mb-4">
                    <span className="text-emerald-600 font-medium">✅ 正常: {modelTestResults.summary.ok}</span>
                    <span className="text-red-600 font-medium">❌ 失败: {modelTestResults.summary.error}</span>
                    <span className="text-slate-400">未测试: {modelTestResults.summary.untested}</span>
                  </div>
                  
                  {modelTestResults.results.length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400 text-center py-4">
                      暂无已发现的模型，请先进行能力探测获取模型列表
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {modelTestResults.results.map((r, i) => (
                        <div key={i} className={`flex items-center justify-between p-3 rounded-xl ${
                          r.ok ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-red-50 dark:bg-red-500/10'
                        }`}>
                          <div className="flex items-center gap-3 min-w-0">
                            {r.ok ? (
                              <Wifi size={18} className="text-emerald-600 shrink-0" />
                            ) : (
                              <WifiOff size={18} className="text-red-600 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 dark:text-white truncate">{r.upstream_id}</div>
                              {r.key_label && (
                                <div className="text-xs text-slate-500 dark:text-slate-400">{r.key_label}</div>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            {r.ok ? (
                              <div className="text-emerald-600 font-medium">{r.latency_ms}ms</div>
                            ) : (
                              <div className="text-red-600 text-sm max-w-[200px] truncate" title={r.error}>
                                {r.error}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="p-4 md:p-6 border-t border-slate-200 dark:border-slate-700 flex justify-between gap-3">
              <button
                onClick={runModelTest}
                disabled={modelTestLoading}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 flex items-center gap-2"
              >
                <RefreshCw size={16} className={modelTestLoading ? 'animate-spin' : ''} />
                重新测试
              </button>
              <div className="flex gap-2">
                {modelTestResults && modelTestResults.summary.error > 0 && (
                  <button
                    onClick={handleDeleteFailedModels}
                    className="px-4 py-2 bg-red-100 text-red-700 rounded-xl hover:bg-red-200 flex items-center gap-2"
                  >
                    <Trash2 size={16} />
                    清理失败模型
                  </button>
                )}
                <button
                  onClick={() => setShowModelTest(false)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddKeyButton({ channelId, onAdded }: { channelId: number; onAdded: () => void }) {
  const [show, setShow] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  // 模型限制: restrictModels=false 表示不限制 (allowed_models = null)
  const [restrictModels, setRestrictModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());

  const loadModels = () => {
    api.getChannelAvailableModels(channelId)
      .then(setAvailableModels)
      .catch(() => setAvailableModels([]));
  };

  const openDialog = () => {
    setKeyName('');
    setApiKey('');
    setSelectedModels(new Set());
    setRestrictModels(false);
    loadModels();
    setShow(true);
  };

  const toggleModel = (m: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setLoading(true);
    try {
      const models = restrictModels && selectedModels.size > 0
        ? Array.from(selectedModels)
        : null;
      await api.createKey(channelId, {
        api_key: apiKey.trim(),
        key_label: keyName.trim() || 'Key ' + Date.now(),
        models,
      });
      setKeyName('');
      setApiKey('');
      setShow(false);
      onAdded();
    } catch (err: any) {
      alert('添加失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!show) {
    return (
      <button
        onClick={openDialog}
        className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
      >
        <Plus size={12} />
        添加 Key
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-x-hidden">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] animate-scale-in border border-slate-200/50 dark:border-slate-700/50 overflow-hidden flex flex-col"
      >
        <div className="px-4 sm:px-5 pt-4 sm:pt-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
          <span className="text-base font-semibold text-slate-900 dark:text-white truncate">添加 API Key</span>
          <button type="button" onClick={() => setShow(false)} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Key 名称</label>
          <input
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
            placeholder="可选，默认自动生成"
          />
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none font-mono"
            placeholder="sk-..."
            required
            autoFocus
          />
        </div>

        <div className="pt-1">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">限制可用模型</span>
            <input
              type="checkbox"
              checked={restrictModels}
              onChange={(e) => setRestrictModels(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-600"
            />
          </label>
          <p className="text-xs text-slate-400 mt-1">
            {restrictModels
              ? '只允许调用勾选的模型，其他模型会返回「没有可用的 Key」'
              : '不勾选 = 该 Key 可服务此渠道的全部模型'}
          </p>

          {restrictModels && (
            <div className="mt-2 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 dark:bg-slate-700/40 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {availableModels.length === 0 ? '暂无可发现的模型' : `已选 ${selectedModels.size} / ${availableModels.length}`}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedModels(selectedModels.size === availableModels.length ? new Set() : new Set(availableModels))}
                  className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                >
                  {selectedModels.size === availableModels.length && availableModels.length > 0 ? '清空' : '全选'}
                </button>
              </div>
              {availableModels.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-400">
                  没有可用模型列表。可先「获取模型」探测，或添加 Key 后在服务端探测。
                </div>
              ) : (
                <div className="max-h-44 overflow-y-auto py-1">
                  {availableModels.map(m => (
                    <label key={m} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedModels.has(m)}
                        onChange={() => toggleModel(m)}
                        className="w-3.5 h-3.5 rounded accent-indigo-600"
                      />
                      <code className="text-xs text-slate-700 dark:text-slate-300 font-mono truncate">{m}</code>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => setShow(false)}
            className="flex-1 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading || !apiKey.trim() || (restrictModels && selectedModels.size === 0)}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
          >
            {loading ? '添加中...' : '确认添加'}
          </button>
        </div>
        </div>
      </form>
    </div>
  );
}

function KeyRow({ key_, channelId, onDelete, onEdit }: { key_: Key; channelId: number; onDelete?: () => void; onEdit?: () => void }) {
  const [showKey, setShowKey] = useState(false);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(key_.label || '');
  const [editEnabled, setEditEnabled] = useState(key_.enabled === 1);
  const [saving, setSaving] = useState(false);
  // 模型限制编辑
  const [restrictModels, setRestrictModels] = useState(() => {
    const cur = key_.allowed_models_parsed ?? key_.allowed_models;
    return Array.isArray(cur) && cur.length > 0;
  });
  const [editAllowedModels, setEditAllowedModels] = useState<Set<string>>(() => {
    const cur = key_.allowed_models_parsed ?? key_.allowed_models;
    return new Set(Array.isArray(cur) ? cur : []);
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const enterEdit = () => {
    setEditLabel(key_.label || '');
    setEditEnabled(key_.enabled === 1);
    const cur = key_.allowed_models_parsed ?? key_.allowed_models;
    setRestrictModels(Array.isArray(cur) && cur.length > 0);
    setEditAllowedModels(new Set(Array.isArray(cur) ? cur : []));
    api.getChannelAvailableModels(channelId)
      .then(setAvailableModels)
      .catch(() => setAvailableModels([]));
    setEditing(true);
  };

  const toggleEditModel = (m: string) => {
    setEditAllowedModels(prev => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };

  const handleToggleKey = async () => {
    if (!showKey && !plainKey) {
      // 首次点击，获取明文
      try {
        const res = await api.getKeyPlain(key_.id);
        setPlainKey(res.api_key);
      } catch (err: any) {
        alert('获取 Key 失败: ' + err.message);
        return;
      }
    }
    setShowKey(!showKey);
  };

  const handleCopy = async () => {
    // 如果还没有明文，先获取
    if (!plainKey) {
      try {
        const res = await api.getKeyPlain(key_.id);
        setPlainKey(res.api_key);
        await copyToClipboard(res.api_key);
      } catch (err: any) {
        alert('获取 Key 失败: ' + err.message);
      }
    } else {
      await copyToClipboard(plainKey);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const allowedModels = restrictModels && editAllowedModels.size > 0
        ? Array.from(editAllowedModels)
        : null;
      await api.updateKey(key_.id, {
        label: editLabel,
        enabled: editEnabled ? 1 : 0,
        allowed_models: allowedModels,
      });
      setEditing(false);
      onEdit?.();
    } catch (err: any) {
      alert('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const displayHint = key_.api_key_hint || key_.api_key?.slice(0, 12) || '••••••••';
  const displayName = key_.label || 'Unnamed';
  const currentAllowed = key_.allowed_models_parsed ?? key_.allowed_models;
  const allowedCount = Array.isArray(currentAllowed) && currentAllowed.length > 0 ? currentAllowed.length : 0;

  if (editing) {
    return (
      <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border-2 border-indigo-300 dark:border-indigo-600">
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Key 名称</label>
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-indigo-400"
              placeholder="输入名称"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">状态</label>
              <button
                onClick={() => setEditEnabled(!editEnabled)}
                className={`px-2 py-1 text-xs rounded-md font-medium ${
                  editEnabled
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                    : 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'
                }`}
              >
                {editEnabled ? '启用' : '禁用'}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || (restrictModels && editAllowedModels.size === 0)}
                className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-slate-200 dark:border-slate-700">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">限制可用模型</span>
            <input
              type="checkbox"
              checked={restrictModels}
              onChange={(e) => setRestrictModels(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-600"
            />
          </label>
          {restrictModels && (
            <div className="mt-2 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 dark:bg-slate-700/40 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {availableModels.length === 0
                    ? '暂无可发现的模型'
                    : `已选 ${editAllowedModels.size} / ${availableModels.length}`}
                </span>
                <button
                  type="button"
                  onClick={() => setEditAllowedModels(editAllowedModels.size === availableModels.length ? new Set() : new Set(availableModels))}
                  className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                >
                  {editAllowedModels.size === availableModels.length && availableModels.length > 0 ? '清空' : '全选'}
                </button>
              </div>
              {availableModels.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-400">
                  没有可发现的模型列表，可先「获取模型」探测。当前已选 {editAllowedModels.size} 个：
                  {editAllowedModels.size > 0 && <code className="ml-1">{Array.from(editAllowedModels).join(', ')}</code>}
                </div>
              ) : (
                <div className="max-h-40 overflow-y-auto py-1">
                  {availableModels.map(m => (
                    <label key={m} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editAllowedModels.has(m)}
                        onChange={() => toggleEditModel(m)}
                        className="w-3.5 h-3.5 rounded accent-indigo-600"
                      />
                      <code className="text-xs text-slate-700 dark:text-slate-300 font-mono truncate">{m}</code>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200/50 dark:border-slate-600/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-slate-900 dark:text-white text-sm truncate">{displayName}</span>
          <span
            className={`px-1.5 py-0.5 text-xs rounded-md font-medium shrink-0 ${
              key_.enabled === 1
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                : 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'
            }`}
          >
            {key_.enabled === 1 ? '启用' : '禁用'}
          </span>
          <span
            className={`px-1.5 py-0.5 text-xs rounded-md font-medium shrink-0 ${
              allowedCount > 0
                ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                : 'bg-slate-200 text-slate-500 dark:bg-slate-600/40 dark:text-slate-400'
            }`}
            title={allowedCount > 0 ? '只允许调用指定的模型' : '可调用此渠道全部模型'}
          >
            {allowedCount > 0 ? `限定 ${allowedCount} 个模型` : '全部模型'}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1.5 min-w-0">
          <code className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate" title={showKey ? (plainKey || '') : ''}>
            {showKey ? (plainKey || '获取中...') : displayHint + '••••••••'}
          </code>
          <button onClick={handleToggleKey} className="text-slate-400 hover:text-slate-600 shrink-0">
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button onClick={handleCopy} className="text-slate-400 hover:text-slate-600 shrink-0">
            <Copy size={12} />
          </button>
        </div>
        <div className="text-xs text-slate-400 mt-1.5">
          成功: {key_.success_count} | 失败: {key_.failure_count} | 延迟: {key_.avg_latency_ms?.toFixed(0) || 0}ms
          {allowedCount > 0 && (
            <span className="ml-1">
              | 仅: {currentAllowed!.slice(0, 3).join(', ')}{allowedCount > 3 ? '…' : ''}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={enterEdit}
        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
        title="编辑 Key"
      >
        <Pencil size={14} />
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          title="删除 Key"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function CreateChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerTab, setProviderTab] = useState<'paid' | 'free' | 'custom'>('paid');
  const [selectedDbProvider, setSelectedDbProvider] = useState<Provider | null>(null);
  const [form, setForm] = useState({
    name: '',
    protocol: 'openai',
    base_url: '',
    api_keys_batch: '',
    multi_key_mode: 'random',
    models: '',
    priority: 0,
    weight: 1,
    test_model: '',
    tag: '',
    support_vision: false,
    support_tools: false,
    support_image: false,
    support_video: false,
    support_tts: false,
    support_stt: false,
  });

  useEffect(() => {
    api.getProviders().then(setProviders).catch(console.error);
  }, []);

  const paidProviders = providers.filter(p => p.is_free === 0 && p.category !== null && p.name !== 'mock' && p.name !== 'test' && !p.name.includes('test'));
  const freeProviders = providers.filter(p => p.is_free === 1);

  const selectedProvider = selectedDbProvider;

  const handleSelectProvider = (provider: Provider) => {
    setSelectedDbProvider(provider);
    setForm({
      ...form,
      name: form.name || provider.display_name || provider.name,
      protocol: provider.protocol || 'openai',
      base_url: provider.base_url || form.base_url,
    });
    setStep(2);
  };

  const handleSelectCustom = () => {
    setSelectedDbProvider(null);
    setForm({
      ...form,
      name: form.name || '',
      protocol: 'openai',
      base_url: '',
    });
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // 构建 capabilities JSON
      const capabilities: any = {};
      if (form.support_vision) capabilities.vision = true;
      if (form.support_tools) capabilities.tools = true;
      if (form.support_image) capabilities.image = true;
      if (form.support_video) capabilities.video = true;
      if (form.support_tts) capabilities.tts = true;
      if (form.support_stt) capabilities.stt = true;
      const capabilitiesJson = Object.keys(capabilities).length > 0 ? JSON.stringify(capabilities) : '';

      await api.createChannel({
        name: form.name,
        provider_id: selectedDbProvider?.id || 0,
        protocol: form.protocol,
        base_url: form.base_url,
        api_keys_batch: form.api_keys_batch,
        multi_key_mode: form.multi_key_mode,
        models: form.models,
        priority: form.priority,
        weight: form.weight,
        test_model: form.test_model,
        tag: form.tag,
        capabilities: capabilitiesJson,
      });
      onCreated();
    } catch (err: any) {
      alert(`创建失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFetchModels = async () => {
    if (!form.base_url) {
      alert('请先填写 Base URL');
      return;
    }
    // 用第一个 key 测试
    const firstKey = form.api_keys_batch.split(/\r?\n/)[0]?.trim();
    if (!firstKey) {
      alert('请先填写 API Key');
      return;
    }
    setFetchingModels(true);
    try {
      const modelsPath = selectedDbProvider?.models_path || '/models';
      const res = await fetch('/api/admin/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          base_url: form.base_url,
          models_path: modelsPath,
          api_key: firstKey,
        }),
      });
      const data = await res.json();
      if (data.ok && data.models) {
        // 合并现有模型和新获取的模型
        const existingModels = form.models.split(',').map(m => m.trim()).filter(Boolean);
        const newModels = [...new Set([...existingModels, ...data.models])];
        const firstModel = newModels[0] || '';
        setForm({ ...form, models: newModels.join(','), test_model: form.test_model || firstModel });
        alert(`成功获取 ${data.models.length} 个模型`);
      } else {
        alert(`获取模型失败: ${data.error || '未知错误'}`);
      }
    } catch (err: any) {
      alert(`获取模型失败: ${err.message}`);
    } finally {
      setFetchingModels(false);
    }
  };

  // 模型标签操作
  const addModel = (modelInput: string) => {
    const model = modelInput.trim();
    if (!model) return;
    const models = form.models.split(',').map(m => m.trim()).filter(Boolean);
    if (!models.includes(model)) {
      models.push(model);
      setForm({ ...form, models: models.join(',') });
    }
  };

  const removeModel = (model: string) => {
    const models = form.models.split(',').map(m => m.trim()).filter(m => m && m !== model);
    setForm({ ...form, models: models.join(',') });
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-x-hidden">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl animate-scale-in border border-slate-200/50 dark:border-slate-700/50 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="min-w-0">
              <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white truncate">
                {step === 1 ? '选择提供商' : '配置连接'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                步骤 {step}/2
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-2 sm:py-3 border-b border-slate-200/50 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-700/30">
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-2 sm:gap-3">
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium ${
                  s <= step
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-600 text-slate-500'
                }`}>
                  {s < step ? <Check size={12} /> : s}
                </div>
                {s < 2 && <div className={`w-8 sm:w-16 h-0.5 ${s < step ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-600'}`} />}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6">
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">选择你要添加的 API 提供商来源</p>

              <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-700 rounded-xl">
                {[
                  { key: 'paid' as const, label: '收费提供商', icon: '💰', count: paidProviders.length },
                  { key: 'free' as const, label: '免费提供商', icon: '🎁', count: freeProviders.length },
                  { key: 'custom' as const, label: '自定义', icon: '⚙️', count: null },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setProviderTab(tab.key)}
                    className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                      providerTab === tab.key
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    <span className="mr-1">{tab.icon}</span>
                    {tab.label}
                    {tab.count !== null && (
                      <span className="ml-1.5 text-xs text-slate-400">({tab.count})</span>
                    )}
                  </button>
                ))}
              </div>

              {providerTab === 'paid' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                  {paidProviders.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProvider(p)}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all text-left"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {getProviderIcon(p.name)}
                        <div className="font-medium text-slate-900 dark:text-white text-sm truncate flex-1">{p.display_name || p.name}</div>
                      </div>
                      <div className="text-xs text-slate-400 truncate">{p.base_url}</div>
                      {p.signup_url ? (
                        <a
                          href={p.signup_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600"
                        >
                          <ExternalLink size={10} />
                          申请地址
                        </a>
                      ) : p.docs_url ? (
                        <a
                          href={p.docs_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600"
                        >
                          <ExternalLink size={10} />
                          申请地址
                        </a>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}

              {providerTab === 'free' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                  {freeProviders.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProvider(p)}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all text-left"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {getProviderIcon(p.name)}
                        <div className="font-medium text-slate-900 dark:text-white text-sm truncate flex-1">{p.display_name || p.name}</div>
                      </div>
                      <div className="text-xs text-slate-400 truncate">{p.base_url}</div>
                      {p.signup_url ? (
                        <a
                          href={p.signup_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-600"
                        >
                          <ExternalLink size={10} />
                          免费申请
                        </a>
                      ) : p.docs_url ? (
                        <a
                          href={p.docs_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-600"
                        >
                          <ExternalLink size={10} />
                          免费申请
                        </a>
                      ) : null}
                      {p.notes && (
                        <div className="text-xs text-slate-400 truncate mt-0.5" title={p.notes}>{p.notes}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {providerTab === 'custom' && (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl">⚙️</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 font-medium">自定义提供商</p>
                  <p className="text-sm text-slate-400 mt-1">手动配置 Base URL、协议等参数</p>
                  <button
                    type="button"
                    onClick={handleSelectCustom}
                    className="mt-4 btn-primary"
                  >
                    开始配置
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              {selectedProvider && (
                <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 flex items-center gap-3 min-w-0">
                  {getProviderIcon(selectedProvider.name)}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-indigo-700 dark:text-indigo-300 truncate">{selectedProvider.display_name || selectedProvider.name}</div>
                    <div className="text-xs text-indigo-500 dark:text-indigo-400 font-mono truncate" title={selectedProvider.base_url}>{selectedProvider.base_url}</div>
                    {selectedProvider.notes && (
                      <div className="text-xs text-indigo-400 dark:text-indigo-500 mt-0.5 truncate" title={selectedProvider.notes}>{selectedProvider.notes}</div>
                    )}
                  </div>
                  {selectedProvider.signup_url ? (
                    <a
                      href={selectedProvider.signup_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-white dark:bg-slate-700 text-indigo-600 hover:text-indigo-700"
                      title="打开申请地址"
                    >
                      <ExternalLink size={14} />
                    </a>
                  ) : selectedProvider.docs_url ? (
                    <a
                      href={selectedProvider.docs_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg bg-white dark:bg-slate-700 text-indigo-600 hover:text-indigo-700"
                      title="打开文档"
                    >
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">渠道名称</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
                  placeholder={selectedProvider?.display_name || selectedProvider?.name || '渠道名称'}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">协议类型</label>
                {selectedProvider ? (
                  <div className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-sm text-slate-600 dark:text-slate-300 font-medium">
                    {PROTOCOLS.find(p => p.id === form.protocol)?.name || form.protocol}
                    <span className="ml-2 text-xs text-slate-400">(已自动选择)</span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {PROTOCOLS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setForm({ ...form, protocol: p.id })}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                          form.protocol === p.id
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Base URL</label>
                <input
                  type="url"
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none font-mono text-sm"
                  placeholder="https://api.example.com/v1"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  API Key <span className="text-slate-400 font-normal">(每行一个，支持批量)</span>
                </label>
                <textarea
                  value={form.api_keys_batch}
                  onChange={(e) => setForm({ ...form, api_keys_batch: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none font-mono text-sm"
                  rows={3}
                  placeholder={"sk-key1\nsk-key2\nsk-key3"}
                />
                <p className="text-xs text-slate-400 mt-1">每个 Key 会创建一个独立渠道，便于分组管理</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">多 Key 模式</label>
                <select
                  value={form.multi_key_mode}
                  onChange={(e) => setForm({ ...form, multi_key_mode: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
                >
                  <option value="random">Random (随机选 Key)</option>
                  <option value="polling">Polling (轮询)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">模型列表</label>
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !form.base_url}
                    className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50"
                  >
                    {fetchingModels ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    自动获取
                  </button>
                </div>
                <textarea
                  value={form.models}
                  onChange={(e) => setForm({ ...form, models: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none font-mono text-sm"
                  rows={3}
                  placeholder="gpt-4o,gpt-4o-mini,gpt-3.5-turbo"
                />
                <p className="text-xs text-slate-400 mt-1">逗号分隔，留空表示支持所有模型</p>
                {form.models && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {form.models.split(',').map((m, i) => {
                      const model = m.trim();
                      if (!model) return null;
                      return (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-xs font-medium border border-indigo-100 dark:border-indigo-500/20"
                        >
                          {model}
                          <button
                            type="button"
                            onClick={() => removeModel(model)}
                            className="hover:text-red-500 dark:hover:text-red-400 ml-0.5"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      );
                    })}
                    <input
                      type="text"
                      placeholder="+ 添加模型"
                      className="inline-flex items-center px-2 py-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs focus:outline-none focus:border-indigo-400 w-32 bg-transparent text-slate-900 dark:text-white"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          e.preventDefault();
                          addModel(e.currentTarget.value);
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  测试模型 <span className="text-slate-400">(用于测速/探测)</span>
                </label>
                <select
                  value={form.test_model}
                  onChange={(e) => setForm({ ...form, test_model: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
                >
                  <option value="">请选择</option>
                  {form.models.split(',').map((m, i) => {
                    const model = m.trim();
                    if (!model) return null;
                    return <option key={i} value={model}>{model}</option>;
                  })}
                </select>
                <p className="text-xs text-slate-400 mt-1">留空则使用第一个模型</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">优先级</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">数字越小优先级越高</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">权重</label>
                  <input
                    type="number"
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: parseInt(e.target.value) || 1 })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">用于加权随机</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  标签 <span className="text-slate-400">(可选)</span>
                </label>
                <input
                  type="text"
                  value={form.tag}
                  onChange={(e) => setForm({ ...form, tag: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
                  placeholder="例如: 生产环境"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200/50 dark:border-slate-600/50">
                <div className="text-sm font-medium text-slate-900 dark:text-white col-span-2 mb-1">模型能力</div>
                
                <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.support_vision}
                    onChange={(e) => setForm({ ...form, support_vision: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <VisionEye size={14} className="text-indigo-500" />
                  <span className="text-sm">视觉理解</span>
                </label>

                <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.support_tools}
                    onChange={(e) => setForm({ ...form, support_tools: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <Code size={14} className="text-indigo-500" />
                  <span className="text-sm">工具调用</span>
                </label>

                <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.support_image}
                    onChange={(e) => setForm({ ...form, support_image: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <Image size={14} className="text-indigo-500" />
                  <span className="text-sm">图像生成</span>
                </label>

                <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.support_video}
                    onChange={(e) => setForm({ ...form, support_video: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <Code size={14} className="text-indigo-500" />
                  <span className="text-sm">视频生成</span>
                </label>

                <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.support_tts}
                    onChange={(e) => setForm({ ...form, support_tts: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <Volume2 size={14} className="text-indigo-500" />
                  <span className="text-sm">文本转语音</span>
                </label>

                <label className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.support_stt}
                    onChange={(e) => setForm({ ...form, support_stt: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <Mic size={14} className="text-indigo-500" />
                  <span className="text-sm">语音转文本</span>
                </label>
              </div>
            </div>
          )}
        </form>

        <div className="p-4 sm:p-6 border-t border-slate-200/50 dark:border-slate-700/50 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          {step === 2 && (
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={loading}
              className="btn-primary flex items-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check size={16} />
              )}
              {loading ? '创建中...' : '完成创建'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditChannelModal({ channel, form, onFormChange, onSave, onClose, loading }: {
  channel: Channel;
  form: any;
  onFormChange: (form: any) => void;
  onSave: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-x-hidden">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md animate-scale-in border border-slate-200/50 dark:border-slate-700/50 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50">
          <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">编辑渠道</h3>
        </div>
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">渠道名称</label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => onFormChange({ ...form, label: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              placeholder="例如: 商汤 SenseNova"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">测试模型</label>
            <select
              value={form.test_model}
              onChange={(e) => onFormChange({ ...form, test_model: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
            >
              <option value="">请选择</option>
              {form.models.split(',').map((m: string, i: number) => {
                const model = m.trim();
                if (!model) return null;
                return <option key={i} value={model}>{model}</option>;
              })}
            </select>
            <p className="text-xs text-slate-400 mt-1">用于测速和探测</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">优先级</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => onFormChange({ ...form, priority: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">权重</label>
              <input
                type="number"
                value={form.weight}
                onChange={(e) => onFormChange({ ...form, weight: parseInt(e.target.value) || 1 })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">标签</label>
            <input
              type="text"
              value={form.tag}
              onChange={(e) => onFormChange({ ...form, tag: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              placeholder="例如: 生产环境"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200/50 dark:border-slate-600/50">
            <div className="text-sm font-medium text-slate-900 dark:text-white col-span-2 mb-1">模型能力</div>

            {[
              { key: 'support_vision', icon: <VisionEye size={14} className="text-indigo-500" />, label: '视觉理解' },
              { key: 'support_tools', icon: <Code size={14} className="text-indigo-500" />, label: '工具调用' },
              { key: 'support_image', icon: <Image size={14} className="text-indigo-500" />, label: '图像生成' },
              { key: 'support_video', icon: <Volume2 size={14} className="text-indigo-500" />, label: '视频生成' },
              { key: 'support_tts', icon: <Volume2 size={14} className="text-indigo-500" />, label: '文本转语音' },
              { key: 'support_stt', icon: <Mic size={14} className="text-indigo-500" />, label: '语音转文本' },
            ].map(item => (
              <label key={item.key} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form[item.key]}
                  onChange={(e) => onFormChange({ ...form, [item.key]: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                {item.icon}
                <span className="text-sm">{item.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="p-4 sm:p-6 border-t border-slate-200/50 dark:border-slate-700/50 flex justify-end gap-2 sm:gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Check size={16} />
            )}
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BatchEditModal({ form, onFormChange, onSave, onClose, loading, count }: {
  form: { enabled: number; priority: number; weight: number; tag: string };
  onFormChange: (form: any) => void;
  onSave: () => void;
  onClose: () => void;
  loading: boolean;
  count: number;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md animate-scale-in border border-slate-200/50 dark:border-slate-700/50 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">批量编辑渠道</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">已选择 {count} 个渠道，留空的字段将保持不变</p>
        </div>
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">启用状态</label>
            <select
              value={form.enabled}
              onChange={(e) => onFormChange({ ...form, enabled: parseInt(e.target.value) })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
            >
              <option value={-1}>不修改</option>
              <option value={1}>启用</option>
              <option value={0}>禁用</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">优先级</label>
            <input
              type="number"
              value={form.priority === -1 ? '' : form.priority}
              onChange={(e) => onFormChange({ ...form, priority: e.target.value === '' ? -1 : parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              placeholder="不修改"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">权重</label>
            <input
              type="number"
              value={form.weight === -1 ? '' : form.weight}
              onChange={(e) => onFormChange({ ...form, weight: e.target.value === '' ? -1 : parseInt(e.target.value) || 1 })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              placeholder="不修改"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">标签</label>
            <input
              type="text"
              value={form.tag}
              onChange={(e) => onFormChange({ ...form, tag: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white input-focus outline-none"
              placeholder="不修改或清空标签"
            />
          </div>
        </div>
        <div className="p-4 sm:p-6 border-t border-slate-200/50 dark:border-slate-700/50 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Check size={16} />
            )}
            {loading ? '保存中...' : '批量保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TagManagerModal({ tags, channels, onClose, onTagsChanged }: {
  tags: any[];
  channels: Channel[];
  onClose: () => void;
  onTagsChanged: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '' });
  const [loading, setLoading] = useState(false);
  const [editingTag, setEditingTag] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', color: '' });

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setLoading(true);
    try {
      await api.createTag({ name: form.name.trim(), description: form.description, color: form.color });
      onTagsChanged();
      setForm({ name: '', description: '', color: '' });
      setShowCreate(false);
    } catch (err: any) {
      alert(`创建失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editingTag) return;
    setLoading(true);
    try {
      await api.updateTag(editingTag.id, {
        name: editForm.name.trim() || undefined,
        description: editForm.description || undefined,
        color: editForm.color || undefined,
      });
      onTagsChanged();
      setEditingTag(null);
      setEditForm({ name: '', description: '', color: '' });
    } catch (err: any) {
      alert(`更新失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (tagId: number) => {
    if (!confirm('确定要删除这个标签吗？')) return;
    try {
      await api.deleteTag(tagId);
      onTagsChanged();
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in border border-slate-200/50 dark:border-slate-700/50 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 sm:p-6 border-b border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">标签管理</h3>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {tags.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">暂无标签</p>
          ) : (
            <div className="space-y-2">
              {tags.map((tag) => (
                <div key={tag.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200/50 dark:border-slate-600/50">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {tag.color && (
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900 dark:text-white truncate" title={tag.name}>{tag.name}</div>
                      {tag.description && (
                        <div className="text-xs text-slate-400 break-words">{tag.description}</div>
                      )}
                    </div>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-300 shrink-0">
                      {tag.channel_count} 个渠道
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingTag(tag);
                        setEditForm({ name: tag.name, description: tag.description || '', color: tag.color || '' });
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(tag.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(showCreate || editingTag) ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200/50 dark:border-slate-600/50 space-y-3">
              <h4 className="font-medium text-slate-900 dark:text-white">{editingTag ? '编辑标签' : '创建标签'}</h4>
              <input
                type="text"
                value={editingTag ? editForm.name : form.name}
                onChange={(e) => editingTag ? setEditForm({ ...editForm, name: e.target.value }) : setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                placeholder="标签名称"
              />
              <input
                type="text"
                value={editingTag ? editForm.description : form.description}
                onChange={(e) => editingTag ? setEditForm({ ...editForm, description: e.target.value }) : setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                placeholder="描述（可选）"
              />
              <input
                type="color"
                value={editingTag ? editForm.color || '#6366f1' : form.color || '#6366f1'}
                onChange={(e) => editingTag ? setEditForm({ ...editForm, color: e.target.value }) : setForm({ ...form, color: e.target.value })}
                className="w-10 h-8 rounded-lg border border-slate-200 dark:border-slate-600 cursor-pointer"
                title="选择颜色"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => editingTag ? handleEdit() : handleCreate()}
                  disabled={loading}
                  className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  {loading ? '保存中...' : (editingTag ? '保存' : '创建')}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setEditingTag(null); }}
                  className="px-3 py-2 rounded-lg bg-slate-200 text-slate-700 text-sm hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCreate(true)}
              className="w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-sm font-medium"
            >
              + 创建标签
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BenchmarkModal({
  channel,
  model,
  onModelChange,
  samples,
  onSamplesChange,
  loading,
  result,
  onRun,
  onClose,
}: {
  channel: Channel;
  model: string;
  onModelChange: (model: string) => void;
  samples: number;
  onSamplesChange: (samples: number) => void;
  loading: boolean;
  result: any | null;
  onRun: () => void;
  onClose: () => void;
}) {
  const scoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 bg-green-100 dark:bg-green-900/30';
    if (score >= 60) return 'text-amber-600 bg-amber-100 dark:bg-amber-900/30';
    if (score >= 40) return 'text-orange-600 bg-orange-100 dark:bg-orange-900/30';
    return 'text-red-600 bg-red-100 dark:bg-red-900/30';
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <Zap size={20} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">测速测试</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{channel.label || channel.name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6 space-y-4">
          {/* Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                测试模型
              </label>
              <input
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="gpt-4o-mini"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                测试次数
              </label>
              <input
                type="number"
                value={samples}
                onChange={(e) => onSamplesChange(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                min="1"
                max="20"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          <button
            onClick={onRun}
            disabled={loading}
            className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                测试中...
              </>
            ) : (
              <>
                <Zap size={18} />
                开始测速
              </>
            )}
          </button>

          {/* Results */}
          {result && !loading && (
            <div className="space-y-4">
              {/* Score */}
              {result.score !== undefined && (
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50">
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">综合评分</div>
                    <div className={`text-3xl font-bold ${scoreColor(result.score).split(' ')[0]}`}>
                      {result.score}
                      <span className="text-lg text-slate-400">/100</span>
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-slate-500 dark:text-slate-400">成功率</div>
                    <div className="text-lg font-medium text-slate-900 dark:text-white">
                      {result.successRate ? (result.successRate * 100).toFixed(0) : 0}%
                    </div>
                  </div>
                </div>
              )}

              {/* Metrics */}
              {result.samples !== undefined && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                    <div className="text-xs text-slate-500 dark:text-slate-400">测试次数</div>
                    <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                      {result.samples}
                    </div>
                    <div className="text-xs text-slate-400">
                      成功 {result.successes} / 失败 {result.errors}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                    <div className="text-xs text-slate-500 dark:text-slate-400">平均延迟</div>
                    <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                      {result.avgLatencyMs}ms
                    </div>
                    <div className="text-xs text-slate-400">P50: {result.p50LatencyMs}ms</div>
                  </div>
                  <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                    <div className="text-xs text-slate-500 dark:text-slate-400">P95 延迟</div>
                    <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                      {result.p95LatencyMs}ms
                    </div>
                    <div className="text-xs text-slate-400">
                      {result.avgTokensPerRequest} tokens/次
                    </div>
                  </div>
                </div>
              )}

              {/* Per Sample Details */}
              {result.perSample && result.perSample.length > 0 && (
                <div>
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    每次测试详情
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {result.perSample.map((sample: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 w-8">#{idx + 1}</span>
                          {sample.ok ? (
                            <span className="text-green-600 dark:text-green-400">✓ 成功</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">✗ 失败</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                          <span>{sample.latencyMs}ms</span>
                          {sample.errorMessage && (
                            <span className="text-red-500 text-xs truncate max-w-[200px]">
                              {sample.errorMessage}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error */}
              {result.error && (
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {result.error}
                  </div>
                </div>
              )}
            </div>
          )}

          {!result && !loading && (
            <div className="text-center py-8 text-slate-400">
              <Zap size={48} className="mx-auto mb-4 opacity-30" />
              <p>配置测试参数后点击"开始测速"</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
