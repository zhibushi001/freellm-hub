import { useState, useEffect } from 'react';
import { Send, Download, Image, Mic, Volume2, Loader2, FileAudio, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface ModelInfo {
  id: string;
  capabilities: any;
}

/** 文件转 base64 (不含 data: 前缀) */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 去掉 "data:audio/wav;base64," 前缀
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function API() {
  const [activeTab, setActiveTab] = useState<'image' | 'video' | 'audio' | 'chat'>('chat');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Image generation state
  const [imgModel, setImgModel] = useState('');
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgSize, setImgSize] = useState('1024x1024');
  const [imgN, setImgN] = useState(1);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgResult, setImgResult] = useState<{ url?: string; b64_json?: string }[] | null>(null);

  // Audio state
  const [ttsModel, setTtsModel] = useState('');
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [ttsInput, setTtsInput] = useState('');
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsAudio, setTtsAudio] = useState<string | null>(null);
  
  const [sttModel, setSttModel] = useState('');
  const [sttLoading, setSttLoading] = useState(false);
  const [sttResult, setSttResult] = useState<string | null>(null);
  const [sttFile, setSttFile] = useState<File | null>(null);

  // Video generation state
  const [videoModel, setVideoModel] = useState('');
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoDuration, setVideoDuration] = useState(6);
  const [videoResolution, setVideoResolution] = useState('768P');
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoResult, setVideoResult] = useState<any | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const res = await fetch('/api/admin/chat/models');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.data) {
          const modelInfos: ModelInfo[] = data.data.map((m: any) => ({
            id: m.id,
            capabilities: m.capabilities || {},
          }));
          setModels(modelInfos);
          
          // 根据 capabilities 筛选模型
          const imageModels = modelInfos.filter(m => m.capabilities.image);
          const videoModels = modelInfos.filter(m => m.capabilities.video);
          const ttsModels = modelInfos.filter(m => m.capabilities.tts);
          const sttModels = modelInfos.filter(m => m.capabilities.stt);

          if (imageModels.length > 0) {
            setImgModel(imageModels[0].id);
            setActiveTab('image');
          } else if (videoModels.length > 0) {
            setVideoModel(videoModels[0].id);
            setActiveTab('video');
          } else if (ttsModels.length > 0 || sttModels.length > 0) {
            setTtsModel(ttsModels[0]?.id || '');
            setSttModel(sttModels[0]?.id || '');
            setActiveTab('audio');
          } else {
            setActiveTab('chat');
            setSelectedModel(modelInfos[0]?.id || '');
          }
        }
      }
    } catch (e) {
      console.error('Failed to load models:', e);
    }
  };

  const testChat = async () => {
    if (!selectedModel || chatLoading) return;
    setChatLoading(true);
    
    try {
      const res = await fetch('/api/admin/chat/test-completion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: 'user', content: '你好，请简单介绍一下你自己' }],
        }),
      });
      
      const data = await res.json();
      if (data.error) {
        setChatMessages([{ role: 'assistant', content: `错误: ${data.error.message}` }]);
      } else {
        setChatMessages([{ 
          role: 'assistant', 
          content: data.choices?.[0]?.message?.content || '(无内容)' 
        }]);
      }
    } catch (e: any) {
      setChatMessages([{ role: 'assistant', content: `错误: ${e.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const generateImage = async () => {
    if (!imgPrompt.trim() || !imgModel) return;
    setImgLoading(true);
    setImgResult(null);
    
    try {
      const res = await fetch('/api/admin/api/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: imgModel,
          prompt: imgPrompt,
          size: imgSize,
          n: imgN,
        }),
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      
      const data = await res.json();
      // mediaService 返回 { output: { url } }, OpenAI 兼容格式返回 { data: [...] }
      setImgResult(data.data || (data.output ? [data.output] : []));
    } catch (error: any) {
      alert(`生成失败: ${error.message}`);
    } finally {
      setImgLoading(false);
    }
  };

  const generateVideo = async () => {
    if (!videoPrompt.trim() || !videoModel) return;
    setVideoLoading(true);
    setVideoResult(null);
    setVideoError(null);

    try {
      const res = await fetch('/api/admin/api/videos/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: videoModel,
          prompt: videoPrompt,
          duration: videoDuration,
          resolution: videoResolution,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }

      setVideoResult(data);
    } catch (error: any) {
      setVideoError(error.message);
    } finally {
      setVideoLoading(false);
    }
  };

  const generateSpeech = async () => {
    if (!ttsInput.trim() || !ttsModel) return;
    setTtsLoading(true);
    setTtsAudio(null);
    
    try {
      const res = await fetch('/api/admin/api/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ttsModel,
          input: ttsInput,
          voice: ttsVoice,
        }),
      });
      
      if (!res.ok) {
        const err = await res.text().catch(() => null);
        throw new Error(err || `HTTP ${res.status}`);
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setTtsAudio(url);
    } catch (error: any) {
      alert(`生成失败: ${error.message}`);
    } finally {
      setTtsLoading(false);
    }
  };

  const transcribeAudio = async () => {
    if (!sttFile || !sttModel) return;
    setSttLoading(true);
    setSttResult(null);
    
    try {
      // 后端期望 JSON: {model, file: <base64>}
      const fileBase64 = await fileToBase64(sttFile);

      const res = await fetch('/api/admin/api/audio/transcriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: sttModel,
          file: fileBase64,
        }),
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      
      const data = await res.json();
      setSttResult(data.text || '');
    } catch (error: any) {
      alert(`转写失败: ${error.message}`);
    } finally {
      setSttLoading(false);
    }
  };

  const imgModels = models.filter(m => m.capabilities.image).map(m => m.id);
  const videoModels = models.filter(m => m.capabilities.video).map(m => m.id);
  const ttsModels = models.filter(m => m.capabilities.tts).map(m => m.id);
  const sttModels = models.filter(m => m.capabilities.stt).map(m => m.id);
  const chatModels = models.filter(m => !m.capabilities.image && !m.capabilities.video && !m.capabilities.tts && !m.capabilities.stt).map(m => m.id);

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">API 测试</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">测试 Chat、图像生成和音频 API</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
        <button
          onClick={() => setActiveTab('chat')}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'chat'
              ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-transparent text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Send size={16} />
          Chat 测试
        </button>
        <button
          onClick={() => setActiveTab('image')}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'image'
              ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-transparent text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Image size={16} />
          图像生成
        </button>
        <button
          onClick={() => setActiveTab('video')}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'video'
              ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-transparent text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Volume2 size={16} />
          视频生成
        </button>
        <button
          onClick={() => setActiveTab('audio')}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'audio'
              ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-transparent text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Mic size={16} />
          音频 API
        </button>
      </div>

      {/* Chat Test Tab */}
      {activeTab === 'chat' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">Chat Completion 测试</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">模型</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                {chatModels.length === 0 && <option value="">暂无可用模型</option>}
                {chatModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">测试提示词</label>
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl text-sm text-slate-600 dark:text-slate-300">
                你好，请简单介绍一下你自己
              </div>
            </div>

            <button
              onClick={testChat}
              disabled={chatLoading || !selectedModel}
              className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              {chatLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              测试
            </button>

            {chatMessages.length > 0 && (
              <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={16} className="text-green-600" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">测试结果</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">{chatMessages[0].content}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image Generation Tab */}
      {activeTab === 'image' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">生成参数</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">模型</label>
                <select
                  value={imgModel}
                  onChange={(e) => setImgModel(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {imgModels.length === 0 && <option value="">暂无图像模型</option>}
                  {imgModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">提示词</label>
                <textarea
                  value={imgPrompt}
                  onChange={(e) => setImgPrompt(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-none h-32"
                  placeholder="描述你想生成的图像..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">尺寸</label>
                  <select
                    value={imgSize}
                    onChange={(e) => setImgSize(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="256x256">256x256</option>
                    <option value="512x512">512x512</option>
                    <option value="1024x1024">1024x1024</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">数量</label>
                  <select
                    value={imgN}
                    onChange={(e) => setImgN(parseInt(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                </div>
              </div>

              <button
                onClick={generateImage}
                disabled={imgLoading || !imgPrompt.trim() || !imgModel}
                className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                {imgLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                {imgLoading ? '生成中...' : '生成图像'}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5">生成结果</h3>
            
            {imgLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 size={32} className="animate-spin text-indigo-500" />
              </div>
            ) : imgResult && imgResult.length > 0 ? (
              <div className="space-y-4">
                {imgResult.map((img, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.url}
                      alt={`Generated image ${idx + 1}`}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700"
                    />
                    <button
                      onClick={() => window.open(img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.url, '_blank')}
                      className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Download size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-slate-400">
                <div className="text-center">
                  <Image size={48} className="mx-auto mb-2 opacity-50" />
                  <p>生成的图像将显示在这里</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Video Tab */}
      {activeTab === 'video' && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5 flex items-center gap-2">
            <Volume2 size={20} className="text-indigo-500" />
            文生视频
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">模型</label>
                <select
                  value={videoModel}
                  onChange={(e) => setVideoModel(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {videoModels.length === 0 && <option value="">暂无视频模型（请在渠道能力中勾选「视频生成」）</option>}
                  {videoModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">提示词</label>
                <textarea
                  value={videoPrompt}
                  onChange={(e) => setVideoPrompt(e.target.value)}
                  rows={5}
                  placeholder="描述你想生成的视频内容，例如：一只猫在草地上奔跑"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">时长 (秒)</label>
                  <select
                    value={videoDuration}
                    onChange={(e) => setVideoDuration(Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value={4}>4 秒</option>
                    <option value={6}>6 秒</option>
                    <option value={10}>10 秒</option>
                    <option value={15}>15 秒</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">分辨率</label>
                  <select
                    value={videoResolution}
                    onChange={(e) => setVideoResolution(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="768P">768P</option>
                    <option value="1080P">1080P</option>
                    <option value="576P">576P</option>
                  </select>
                </div>
              </div>

              <button
                onClick={generateVideo}
                disabled={videoLoading || !videoModel || !videoPrompt.trim()}
                className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                {videoLoading ? <Loader2 size={18} className="animate-spin" /> : <Volume2 size={18} />}
                生成视频
              </button>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
              {videoError ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <AlertCircle size={40} className="text-red-400 mb-3" />
                  <p className="text-sm text-red-600 dark:text-red-400 max-w-xs break-all">{videoError}</p>
                </div>
              ) : videoResult ? (
                <div className="space-y-3">
                  {videoResult.output?.url ? (
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">生成结果</p>
                      <video
                        src={videoResult.output.url}
                        controls
                        className="w-full rounded-lg bg-black"
                      />
                    </div>
                  ) : (
                    <div className="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/30 rounded-lg p-3">
                      <p className="text-sm text-indigo-700 dark:text-indigo-300">
                        已提交任务（异步生成中）
                      </p>
                    </div>
                  )}
                  <div className="bg-white dark:bg-slate-800 rounded-lg p-3 font-mono text-xs text-slate-600 dark:text-slate-300 overflow-x-auto">
                    <div className="flex justify-between gap-3">
                      <span>任务 ID: {videoResult.id}</span>
                      <span>状态: {videoResult.status}</span>
                    </div>
                    {videoResult.output?.duration && (
                      <div className="mt-1">时长: {videoResult.output.duration} 秒</div>
                    )}
                    {videoResult.model && <div className="mt-1">模型: {videoResult.model}</div>}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <div className="text-center">
                    <Volume2 size={48} className="mx-auto mb-2 opacity-50" />
                    <p>生成的视频将显示在这里</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Audio Tab */}
      {activeTab === 'audio' && (
        <div className="space-y-4 md:space-y-6">
          {/* TTS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5 flex items-center gap-2">
                <Volume2 size={20} className="text-indigo-500" />
                文本转语音 (TTS)
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">模型</label>
                  <select
                    value={ttsModel}
                    onChange={(e) => setTtsModel(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">选择模型...</option>
                    {ttsModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">音色</label>
                  <select
                    value={ttsVoice}
                    onChange={(e) => setTtsVoice(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="alloy">Alloy</option>
                    <option value="echo">Echo</option>
                    <option value="fable">Fable</option>
                    <option value="onyx">Onyx</option>
                    <option value="nova">Nova</option>
                    <option value="shimmer">Shimmer</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">文本</label>
                  <textarea
                    value={ttsInput}
                    onChange={(e) => setTtsInput(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-none h-24"
                    placeholder="输入要转换为语音的文本..."
                  />
                </div>

                <button
                  onClick={generateSpeech}
                  disabled={ttsLoading || !ttsInput.trim() || !ttsModel}
                  className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {ttsLoading ? <Loader2 size={18} className="animate-spin" /> : <Volume2 size={18} />}
                  {ttsLoading ? '生成中...' : '生成语音'}
                </button>

                {ttsAudio && (
                  <div className="pt-4">
                    <audio controls src={ttsAudio} className="w-full" />
                  </div>
                )}
              </div>
            </div>

            {/* STT */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4 sm:mb-5 flex items-center gap-2">
                <FileAudio size={20} className="text-indigo-500" />
                语音转文本 (STT)
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">模型</label>
                  <select
                    value={sttModel}
                    onChange={(e) => setSttModel(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">选择模型...</option>
                    {sttModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">音频文件</label>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setSttFile(e.target.files?.[0] || null)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  {sttFile && (
                    <p className="text-sm text-slate-500 mt-1">已选择: {sttFile.name}</p>
                  )}
                </div>

                <button
                  onClick={transcribeAudio}
                  disabled={sttLoading || !sttFile || !sttModel}
                  className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {sttLoading ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
                  {sttLoading ? '转写中...' : '转写语音'}
                </button>

                {sttResult && (
                  <div className="pt-4">
                    <div className="p-4 bg-slate-50 dark:bg-slate-700/30 rounded-xl">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">转写结果:</p>
                      <p className="text-slate-900 dark:text-white">{sttResult}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
