/**
 * 多媒体生成服务 - 统一入口
 * 
 * 支持: 图片生成、图生图、图片编辑、文生视频、图生视频
 * 
 * 预配置了大量主流大模型的生成能力
 */

import { listKeys, getDecryptedApiKey } from '../db/repos/keys.js';
import { logger } from '../util/logger.js';

// ============================================
// 标准接口定义
// ============================================

export interface MediaGenerateRequest {
  model: string;
  prompt?: string;
  n?: number;
  size?: string;
  response_format?: string;
  style?: string;
  image?: string;
  mask?: string;
  duration?: number;
  resolution?: string;
  aspect_ratio?: string;
  seed?: number;
  video?: string;
}

export interface MediaGenerateResponse {
  id: string;
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  output?: {
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
    duration?: number;
  };
  error?: {
    message: string;
    code?: string;
  };
  // 内部字段: 实际路由到的 provider 与上游 Key，供异步任务持久化使用
  _provider?: string;
  _channel_key_id?: number;
}

// ============================================
// Provider 接口
// ============================================

export interface MediaProvider {
  name: string;
  supportsModel(model: string): boolean;
  supportsType: ('image' | 'image_edit' | 'video' | 'video_edit')[];
  generate(options: {
    apiKey: string;
    baseUrl: string;
    request: MediaGenerateRequest;
    type: 'image' | 'image_edit' | 'video' | 'video_edit';
  }): Promise<MediaGenerateResponse>;
}

// ============================================
// Provider: OpenAI (DALL-E, Sora)
// ============================================

const openaiProvider: MediaProvider = {
  name: 'openai',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('dall-e') || m.includes('dalle') || 
           m.includes('sora') || m.startsWith('gpt-image') ||
           m.includes('chatgpt-image');
  },
  
  supportsType: ['image', 'image_edit', 'video'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    let url: string;
    
    if (type === 'video') {
      url = `${baseUrl.replace(/\/$/, '')}/videos/generations`;
    } else if (type === 'image_edit') {
      url = `${baseUrl.replace(/\/$/, '')}/images/edits`;
    } else {
      url = `${baseUrl.replace(/\/$/, '')}/images/generations`;
    }
    
    const body: Record<string, any> = {
      model: request.model,
      ...(request.prompt && { prompt: request.prompt }),
      ...(request.n && { n: request.n }),
      ...(request.size && { size: request.size }),
      ...(request.response_format && { response_format: request.response_format }),
      ...(request.style && { style: request.style }),
      ...(request.image && { image: request.image }),
      ...(request.mask && { mask: request.mask }),
      ...(request.duration && { duration: request.duration }),
    };
    
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(type === 'video' ? 300000 : 120000),
      });
      
      const data = await res.json() as any;
      
      if (!res.ok) {
        return { id: `openai_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      }
      
      return {
        id: data.id || `openai_${Date.now()}`,
        model: request.model,
        status: type === 'video' ? mapStatus(data.status) : 'completed',
        output: { url: data.data?.[0]?.url || data.output?.url, b64_json: data.data?.[0]?.b64_json, revised_prompt: data.data?.[0]?.revised_prompt, duration: data.output?.duration },
      };
    } catch (e: any) {
      return { id: `openai_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: Stability AI (Stable Diffusion)
// ============================================

const stabilityProvider: MediaProvider = {
  name: 'stability',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('stable-diffusion') || m.includes('sd-') || 
           m.includes('stability') || m.includes('sdxl') ||
           m.includes('stable-cascade') || m.includes('stable-video');
  },
  
  supportsType: ['image', 'image_edit', 'video'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    const body: Record<string, any> = {
      model: request.model,
      ...(request.prompt && { prompt: request.prompt }),
      ...(request.n && { n: request.n }),
      ...(request.size && { size: request.size }),
      ...(request.image && { image: request.image }),
      ...(request.mask && { mask: request.mask }),
    };
    
    try {
      let url = `${baseUrl.replace(/\/$/, '')}/v1/generation/${request.model}/text-to-image`;
      if (type === 'image_edit') {
        url = `${baseUrl.replace(/\/$/, '')}/v1/generation/${request.model}/image-to-image`;
      } else if (type === 'video') {
        url = `${baseUrl.replace(/\/$/, '')}/v1/generation/${request.model}/text-to-video`;
      }
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `stability_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: `stability_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.artifacts?.[0]?.base64 ? `data:image/png;base64,${data.artifacts?.[0]?.base64}` : undefined } };
    } catch (e: any) {
      return { id: `stability_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: Midjourney
// ============================================

const midjourneyProvider: MediaProvider = {
  name: 'midjourney',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('midjourney') || m.includes('mj-') || m.includes('midj');
  },
  
  supportsType: ['image', 'image_edit'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      const action = type === 'image_edit' ? 'img2img' : 'text2img';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt, ...(request.image && { image: request.image }) }),
        signal: AbortSignal.timeout(180000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `midjourney_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `midjourney_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.image_url || data.data?.[0]?.url } };
    } catch (e: any) {
      return { id: `midjourney_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: Adobe Firefly
// ============================================

const adobeProvider: MediaProvider = {
  name: 'adobe',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('firefly') || m.includes('adobe') || m.includes('ps-fwk');
  },
  
  supportsType: ['image', 'image_edit'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          numImages: request.n || 1,
          size: request.size || '1024x1024',
          ...(request.style && { style: request.style }),
        }),
        signal: AbortSignal.timeout(120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `adobe_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `adobe_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.outputs?.[0]?.image?.url } };
    } catch (e: any) {
      return { id: `adobe_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: Runway
// ============================================

const runwayProvider: MediaProvider = {
  name: 'runway',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('runway') || m.includes('gen-3') || m.includes('pika') ||
           m.includes('gen2') || m.includes('gen3');
  },
  
  supportsType: ['video', 'video_edit'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      const body: Record<string, any> = {
        model: request.model,
        ...(request.prompt && { prompt: request.prompt }),
        ...(request.duration && { duration: request.duration }),
        ...(request.aspect_ratio && { aspect_ratio: request.aspect_ratio }),
        ...(request.seed !== undefined && { seed: request.seed }),
        ...(request.video && { video: request.video }),
      };
      
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/gen/${type === 'video_edit' ? 'video' : 'text-to-video'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `runway_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `runway_${Date.now()}`, model: request.model, status: mapStatus(data.status), output: { url: data.video_url || data.output } };
    } catch (e: any) {
      return { id: `runway_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: 智谱 GLM / Cogview
// ============================================

const zhipuProvider: MediaProvider = {
  name: 'zhipu',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('glm') || m.includes('cogview') || m.includes('zhipu') ||
           m.includes('cogvideo') || m.includes('chatglm');
  },
  
  supportsType: ['image', 'video'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      let url = `${baseUrl.replace(/\/$/, '')}/images/generations`;
      if (type === 'video' || request.model.toLowerCase().includes('cogvideo')) {
        url = `${baseUrl.replace(/\/$/, '')}/videos/generations`;
      }
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          ...(request.n && { n: request.n }),
          ...(request.size && { size: request.size }),
        }),
        signal: AbortSignal.timeout(120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `zhipu_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `zhipu_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.url || data.output?.video_url, duration: data.output?.duration } };
    } catch (e: any) {
      return { id: `zhipu_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: 快手 Kling (可灵)
// ============================================

const klingProvider: MediaProvider = {
  name: 'kling',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('kling') || m.includes('klingai') || m.includes('keling') ||
           m.includes('快手') || m.includes('kwai');
  },
  
  supportsType: ['video', 'video_edit'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/videos/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          ...(request.duration && { duration: request.duration }),
          ...(request.aspect_ratio && { aspect_ratio: request.aspect_ratio }),
          ...(request.resolution && { resolution: request.resolution }),
          ...(request.video && { video_url: request.video }),
        }),
        signal: AbortSignal.timeout(300000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `kling_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `kling_${Date.now()}`, model: request.model, status: mapStatus(data.status), output: { url: data.video_url || data.output?.url, duration: data.duration } };
    } catch (e: any) {
      return { id: `kling_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: Luma Dream Machine
// ============================================

const lumaProvider: MediaProvider = {
  name: 'luma',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('luma') || m.includes('dream-machine') || m.includes('photon');
  },
  
  supportsType: ['video'],
  
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/generate/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(300000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `luma_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `luma_${Date.now()}`, model: request.model, status: mapStatus(data.status), output: { url: data.video_url || data.output } };
    } catch (e: any) {
      return { id: `luma_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: ByteDance (字节豆包/即梦)
// ============================================

const bytedanceProvider: MediaProvider = {
  name: 'bytedance',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('doubao') || m.includes('bytedance') || m.includes('jimeng') ||
           m.includes('ji-meng') || m.includes('字节');
  },
  
  supportsType: ['image', 'video'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      const endpoint = type === 'video' ? 'video' : 'image';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/${endpoint}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(type === 'video' ? 300000 : 120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `bytedance_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `bytedance_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.url || data.video_url } };
    } catch (e: any) {
      return { id: `bytedance_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: 腾讯混元
// ============================================

const tencentProvider: MediaProvider = {
  name: 'tencent',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('hunyuan') || m.includes('tencent') || m.includes('腾讯');
  },
  
  supportsType: ['image', 'video'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      const endpoint = type === 'video' ? 'text-to-video' : 'text-to-image';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(type === 'video' ? 300000 : 120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `tencent_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `tencent_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.image_url || data.video_url } };
    } catch (e: any) {
      return { id: `tencent_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: 百度文心
// ============================================

const baiduProvider: MediaProvider = {
  name: 'baidu',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('wenxin') || m.includes('ernie') || m.includes('baidu') ||
           m.includes('文心') || m.includes('yiyan');
  },
  
  supportsType: ['image', 'video'],
  
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      const endpoint = type === 'video' ? 'text2video' : 'text2image';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(type === 'video' ? 300000 : 120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `baidu_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `baidu_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.url || data.video_url } };
    } catch (e: any) {
      return { id: `baidu_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: 通义万相 (阿里云)
// ============================================

const alibabaProvider: MediaProvider = {
  name: 'alibaba',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('wanxiang') || m.includes('tongyi') || m.includes('aliyun') ||
           m.includes('alibaba') || m.includes('通义');
  },
  
  supportsType: ['image'],
  
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `alibaba_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `alibaba_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.url } };
    } catch (e: any) {
      return { id: `alibaba_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: Pollinations AI (开源图片生成)
// ============================================

const pollinationsProvider: MediaProvider = {
  name: 'pollinations',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('pollinations') || m.includes('flux') || m.includes('pollinations-ai');
  },
  
  supportsType: ['image'],
  
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      // Pollinations uses a different API style
      const prompt = encodeURIComponent(request.prompt || '');
      const model = request.model.replace('pollinations-', '').replace('flux-', '');
      const url = `https://image.pollinations.ai/prompt/${prompt}?model=${model}&width=1024&height=1024&n=${request.n || 1}`;
      
      return { id: `pollinations_${Date.now()}`, model: request.model, status: 'completed', output: { url } };
    } catch (e: any) {
      return { id: `pollinations_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: Ideogram
// ============================================

const ideogramProvider: MediaProvider = {
  name: 'ideogram',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('ideogram');
  },
  
  supportsType: ['image'],
  
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `ideogram_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `ideogram_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.image_url } };
    } catch (e: any) {
      return { id: `ideogram_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: Leonardo AI
// ============================================

const leonardoProvider: MediaProvider = {
  name: 'leonardo',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('leonardo') || m.includes('photon') || m.includes('pixel');
  },
  
  supportsType: ['image'],
  
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `leonardo_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `leonardo_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.url || data.generations?.[0]?.image_url } };
    } catch (e: any) {
      return { id: `leonardo_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: 01 AI (零一)
// ============================================

const o1Provider: MediaProvider = {
  name: '01ai',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    return m.includes('yi-') || m.includes('01ai') || m.includes('zero-one');
  },
  
  supportsType: ['image'],
  
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(120000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `01ai_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `01ai_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.url } };
    } catch (e: any) {
      return { id: `01ai_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: 海螺AI (Hailuo AI)
// ============================================

const hailoProvider: MediaProvider = {
  name: 'hailuo',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    // 不匹配包含 minimax 的模型 (如 MiniMax-Hailuo-2.3 属于 minimax)
    return !m.includes('minimax') && (m.includes('hailuo') || m.includes('海螺'));
  },
  
  supportsType: ['video'],
  
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/videos/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(300000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `hailuo_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `hailuo_${Date.now()}`, model: request.model, status: mapStatus(data.status), output: { url: data.video_url || data.output } };
    } catch (e: any) {
      return { id: `hailuo_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// Provider: Meta AI (Video generation)
// ============================================

const metaProvider: MediaProvider = {
  name: 'meta',
  
  supportsModel(model: string): boolean {
    const m = model.toLowerCase();
    // 更精确的匹配，避免误匹配 agnes-video-*
    return (m.startsWith('meta-') || m.startsWith('llama-')) && 
           (m.includes('video') || m.includes('make'));
  },
  
  supportsType: ['video'],
  
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/video/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(300000),
      });
      
      const data = await res.json() as any;
      if (!res.ok) return { id: `meta_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      
      return { id: data.id || `meta_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.video_url || data.output } };
    } catch (e: any) {
      return { id: `meta_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// 原有 Provider 保留 (Agnes, MiniMax, DeepSeek, Moonshot, SenseNova)
// ============================================

/**
 * Agnes 视频重试: 首次用 'ti2vid'，若上游判定 invalid mode 则换 't2v' 再试一次。
 * 不同视频版本 (v2.0 / 2.x) 的合法 mode 集合不同，无法预知，只能自适应。
 */
async function retryAgnesVideo(
  url: string,
  apiKey: string,
  originalBody: any,
  request: MediaGenerateRequest,
  firstError: string,
): Promise<MediaGenerateResponse | null> {
  const altMode = originalBody.mode === 'ti2vid' ? 't2v' : 'ti2vid';
  const body = { ...originalBody, mode: altMode };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    });
    const data = await res.json() as any;
    if (res.ok) {
      const outUrl = data?.output?.url || data?.data?.[0]?.url || data?.video_url;
      return {
        id: data?.task_id || data?.id || `agnes_${Date.now()}`,
        model: request.model,
        status: outUrl ? 'completed' : 'pending',
        output: {
          url: outUrl,
          b64_json: data?.data?.[0]?.b64_json,
          duration: data?.output?.duration,
        },
      };
    }
    // 备选模式也被判为 invalid mode → 返回第一个错误，避免误导
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    if (typeof msg === 'string' && /invalid mode/i.test(msg)) {
      return {
        id: data?.task_id || `agnes_${Date.now()}`,
        model: request.model,
        status: 'failed',
        error: { message: firstError, code: data?.error?.code || data?.code },
      };
    }
    return null;
  } catch {
    return null;
  }
}

const agnesProvider: MediaProvider = {
  name: 'agnes',
  supportsModel(model: string): boolean { return model.startsWith('agnes-'); },
  supportsType: ['image', 'image_edit', 'video', 'video_edit'],
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    // Agnes 端点 (经实测确认):
    //   文生图 -> POST /v1/images/generations
    //   文生视频 -> POST /v1/videos  (必须带 mode:"t2v"，不支持 duration/resolution)
    //   图生视频 -> POST /v1/videos  (mode:"i2v")
    const base = baseUrl.replace(/\/$/, '');
    const isVideo = type === 'video' || type === 'video_edit';
    const url = isVideo
      ? `${base}/videos`
      : type === 'image_edit'
        ? `${base}/images/edits`
        : `${base}/images/generations`;

    try {
      let body: any;
      if (isVideo) {
        // 视频: mode 必填，实测合法值为 'ti2vid' | 'keyframes' | 'multi_reference'
        // 注意: 不传 duration/resolution，否则 Agnes 返回 "not an allowed request field"
        body = {
          model: request.model,
          prompt: request.prompt,
          mode: 'ti2vid',
        };
        if (type === 'video_edit' && request.image) body.image = request.image;
        if (request.seed !== undefined) body.seed = request.seed;
      } else {
        body = {
          model: request.model,
          prompt: request.prompt,
          ...(request.n !== undefined && { n: request.n }),
          ...(request.size && { size: request.size }),
          ...(request.response_format && { response_format: request.response_format }),
          ...(request.image && { image: request.image }),
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      });
      const data = await res.json() as any;
      if (!res.ok) {
        // Agnes 有时把上游错误包成 JSON 字符串放在 message 里 (fail_to_fetch_task)
        let msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
        if (typeof msg === 'string' && msg.startsWith('{')) {
          try {
            const inner = JSON.parse(msg);
            msg = inner?.error?.message || inner?.message || msg;
          } catch { /* 保留原文 */ }
        }
        // 不同视频模型的合法 mode 集合不同 (v2.0 要 ti2vid, 2.x 系列要 t2v)
        // 被上游明确判为 invalid mode 时自动换另一个模式重试
        if (isVideo && typeof msg === 'string' && /invalid mode/i.test(msg)) {
          const retry = await retryAgnesVideo(url, apiKey, body, request, msg);
          if (retry) return retry;
        }
        return {
          id: data?.task_id || `agnes_${Date.now()}`,
          model: request.model,
          status: 'failed',
          error: {
            message: msg,
            code: data?.error?.code || data?.code,
          },
        };
      }
      // 图片: { data: [{url, b64_json}] }  视频: { task_id, ... } 或 { output: {url} }
      const outUrl = data?.output?.url || data?.data?.[0]?.url || data?.video_url;
      return {
        id: data?.task_id || data?.id || `agnes_${Date.now()}`,
        model: request.model,
        // 有 URL 才算完成；否则视为异步排队中
        status: outUrl ? 'completed' : 'pending',
        output: {
          url: outUrl,
          b64_json: data?.data?.[0]?.b64_json,
          duration: data?.output?.duration,
        },
      };
    } catch (e: any) {
      return { id: `agnes_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

const minimaxProvider: MediaProvider = {
  name: 'minimax',
  supportsModel(model: string): boolean { 
    const m = model.toLowerCase();
    return m.includes('minimax') || m.includes('h3') || m.includes('hailuo') ||
           m === 'video-01' || m === 'image-01'; 
  },
  supportsType: ['image', 'video', 'video_edit'],
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      // 统一剥离 baseUrl 末尾的 /v1，避免二次拼接出 /v1/v1/...
      const base = baseUrl.replace(/\/$/, '').replace(/\/v1$/, '');

      let endpoint: string;
      let apiBody: Record<string, any>;

      if (type === 'video' || type === 'video_edit') {
        // 视频生成: Hailuo 2.3 -> /v1/video_generation
        // 注意: api.minimax.chat 只走语言模型，视频/图片必须走 api.minimax.cn
        let host = base.replace(/\/$/, '');
        if (host.includes('api.minimax.chat')) host = 'https://api.minimax.cn';
        endpoint = `${host.replace(/\/$/, '')}/v1/video_generation`;

        apiBody = {
          model: 'MiniMax-Hailuo-2.3',
          prompt: request.prompt,
          duration: request.duration || 6,
          resolution: request.resolution || '1080P',
        };
        if (type === 'video_edit' && request.image) {
          apiBody.content = [
            { type: 'text', text: request.prompt },
            { type: 'image_url', image_url: { url: request.image } },
          ];
        }
      } else {
        // 图片生成: /v1/image_generation
        endpoint = `${base.replace(/\/$/, '')}/v1/image_generation`;

        apiBody = {
          model: 'image-01',
          prompt: request.prompt,
          ...(request.n && { n: request.n }),
          ...(request.size && { size: request.size }),
          ...(request.response_format && { response_format: request.response_format }),
          ...(request.aspect_ratio && { aspect_ratio: request.aspect_ratio }),
        };
      }
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(apiBody),
        signal: AbortSignal.timeout(300000),
      });
      
      const data = await res.json() as any;
      
      if (!res.ok || data.base_resp?.status_code !== 0) {
        return { 
          id: `minimax_${Date.now()}`, 
          model: request.model, 
          status: 'failed', 
          error: { 
            message: data?.base_resp?.status_msg || data?.base_error?.message || data?.error?.message || data?.message || `HTTP ${res.status}` 
          } 
        };
      }
      
      if (type === 'video' || type === 'video_edit') {
        // MiniMax 视频创建接口只表示"任务已受理"，base_resp.status_code:0 ≠ 视频完成。
        // 真实状态在 data.status (queued/generating/finished)，video_url 仅在 finished 后出现。
        // 因此创建阶段一律按 data.status 判定，无 status 则视为 pending (需轮询)。
        const outUrl = data.video_url || data.output?.video_url;
        const videoStatus = outUrl
          ? 'completed'
          : mapStatus(data.status || (data.base_resp?.status_code === 0 ? 'pending' : 'failed'));
        return { 
          id: data.task_id || `minimax_${Date.now()}`, 
          model: request.model, 
          status: videoStatus,
          output: { 
            url: outUrl,
            duration: data.output?.duration || request.duration,
          },
        };
      } else {
        // 图片返回格式: { data: { image_urls: ["..."] } } 或 { data: { image_url: "..." } }
        const imageUrls = data.data?.image_urls || data.data?.image_base64 || [];
        const firstUrl = Array.isArray(imageUrls) ? imageUrls[0] : imageUrls;
        return { 
          id: data.id || `minimax_${Date.now()}`, 
          model: request.model, 
          status: 'completed',
          output: { 
            url: firstUrl?.url || firstUrl,
            b64_json: Array.isArray(data.data?.image_base64) ? data.data.image_base64[0] : data.data?.image_base64,
          },
        };
      }
    } catch (e: any) {
      return { 
        id: `minimax_${Date.now()}`, 
        model: request.model, 
        status: 'failed', 
        error: { message: e.message } 
      };
    }
  },
};

const deepseekProvider: MediaProvider = {
  name: 'deepseek',
  supportsModel(model: string): boolean { const m = model.toLowerCase(); return m.includes('deepseek'); },
  supportsType: ['image'],
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json() as any;
      if (!res.ok) return { id: `deepseek_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      return { id: data.id || `deepseek_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.url } };
    } catch (e: any) {
      return { id: `deepseek_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

const moonshotProvider: MediaProvider = {
  name: 'moonshot',
  supportsModel(model: string): boolean { const m = model.toLowerCase(); return m.includes('kimi') || m.includes('moonshot'); },
  supportsType: ['image'],
  async generate({ apiKey, baseUrl, request }): Promise<MediaGenerateResponse> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json() as any;
      if (!res.ok) return { id: `moonshot_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      return { id: data.id || `moonshot_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.url } };
    } catch (e: any) {
      return { id: `moonshot_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

const sensenovaProvider: MediaProvider = {
  name: 'sensenova',
  supportsModel(model: string): boolean { const m = model.toLowerCase(); return m.includes('sensenova') || m.includes('sense'); },
  supportsType: ['image', 'video'],
  async generate({ apiKey, baseUrl, request, type }): Promise<MediaGenerateResponse> {
    try {
      const url = type === 'video' ? `${baseUrl.replace(/\/$/, '')}/videos/generations` : `${baseUrl.replace(/\/$/, '')}/images/generations`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json() as any;
      if (!res.ok) return { id: `sensenova_${Date.now()}`, model: request.model, status: 'failed', error: { message: data?.error?.message || `HTTP ${res.status}` } };
      return { id: data.id || `sensenova_${Date.now()}`, model: request.model, status: 'completed', output: { url: data.data?.[0]?.url || data.output?.url } };
    } catch (e: any) {
      return { id: `sensenova_${Date.now()}`, model: request.model, status: 'failed', error: { message: e.message } };
    }
  },
};

// ============================================
// 注册所有 Provider
// ============================================

const providers: MediaProvider[] = [
  // OpenAI
  openaiProvider,
  // 主流图片/视频平台
  stabilityProvider,
  midjourneyProvider,
  adobeProvider,
  runwayProvider,
  // 国内大厂
  zhipuProvider,
  klingProvider,
  bytedanceProvider,
  tencentProvider,
  baiduProvider,
  alibabaProvider,
  // 其他
  lumaProvider,
  pollinationsProvider,
  ideogramProvider,
  leonardoProvider,
  o1Provider,
  hailoProvider,
  metaProvider,
  // 已有渠道
  agnesProvider,
  minimaxProvider,
  deepseekProvider,
  moonshotProvider,
  sensenovaProvider,
];

// ============================================
// 工具函数
// ============================================

function mapStatus(status: string): 'pending' | 'processing' | 'completed' | 'failed' {
  switch (status?.toLowerCase()) {
    case 'pending': case 'queued': return 'pending';
    case 'processing': case 'generating': case 'in_progress': return 'processing';
    case 'completed': case 'success': case 'succeeded': return 'completed';
    default: return 'failed';
  }
}

// ============================================
// 主入口函数
// ============================================

export async function generateMedia(
  request: MediaGenerateRequest,
  type: 'image' | 'image_edit' | 'video' | 'video_edit',
): Promise<MediaGenerateResponse> {
  const provider = providers.find(p => p.supportsModel(request.model) && p.supportsType.includes(type));
  
  if (!provider) {
    return {
      id: `error_${Date.now()}`,
      model: request.model,
      status: 'failed',
      error: { message: `模型 ${request.model} 不支持 ${type} 类型`, code: 'MODEL_NOT_SUPPORTED' },
    };
  }
  
  const allKeys = listKeys().filter(k => k.enabled === 1);
  
  // Provider URL 映射
  const providerUrls: Record<string, string[]> = {
    openai: ['api.openai.com', 'openai.com'],
    stability: ['api.stability.ai', 'stability.ai'],
    midjourney: ['api.midjourney.com', 'midjourney.com'],
    adobe: ['api.adobe.io', 'adobe.com'],
    runway: ['api.runwayml.com', 'runwayml.com', 'runway.pics'],
    zhipu: ['open.bigmodel.cn', 'zhipuai.cn', 'zhipuai.com'],
    kling: ['klingai.com', 'kling.kuaishou.com'],
    luma: ['api.lumalabs.ai', 'lumalabs.ai'],
    bytedance: ['ark.cn-beijing.volces.com', ' volcengine'],
    tencent: ['hunyuan.tencentcloudapi.com'],
    baidu: ['aip.baidubce.com', 'wenxin.baidu.com'],
    alibaba: ['dashscope.aliyuncs.com', 'api.tongyi.com'],
    pollinations: ['image.pollinations.ai'],
    ideogram: ['api.ideogram.ai', 'ideogram.com'],
    leonardo: ['api.leonardo.ai', 'leonardo.ai'],
    o1ai: ['api.01.ai', '01.ai'],
    hailuo: ['api.hailuoai.com', 'hailuoai.com'],
    meta: ['api.meta.ai', 'meta.ai'],
    agnes: ['apihub.agnes-ai.com'],
    minimax: ['api.minimax.chat', 'api.minimax.io', 'api.minimax.cn'],
    deepseek: ['api.deepseek.com', 'api.deepseek.ai'],
    moonshot: ['api.moonshot.cn', 'moonshot.cn'],
    sensenova: ['token.sensenova.ai', 'token.sensenova.cn'],
  };
  
  const suitableKeys = allKeys.filter(k => {
    if (!k.base_url) return false;
    const url = k.base_url.toLowerCase();
    const urls = providerUrls[provider.name] || [];
    return urls.some(pu => url.includes(pu));
  });
  
  if (suitableKeys.length === 0) {
    return {
      id: `error_${Date.now()}`,
      model: request.model,
      status: 'failed',
      error: { message: `没有可用的 Key 支持 ${provider.name} 提供商`, code: 'NO_AVAILABLE_KEY' },
    };
  }
  
  const key = suitableKeys[0];
  const resp = await provider.generate({ apiKey: getDecryptedApiKey(key.id), baseUrl: key.base_url, request, type });
  resp._provider = provider.name;
  resp._channel_key_id = key.id;
  return resp;
}

// ============================================
// 获取支持的模型列表 (全面覆盖)
// ============================================

export function listSupportedMediaModels(): {
  images: Array<{ model: string; provider: string; description: string }>;
  videos: Array<{ model: string; provider: string; description: string }>;
} {
  return {
    images: [
      // OpenAI
      { model: 'dall-e-3', provider: 'openai', description: 'OpenAI DALL-E 3 (高清图片)' },
      { model: 'dall-e-2', provider: 'openai', description: 'OpenAI DALL-E 2' },
      // Stability AI
      { model: 'stable-diffusion-xl-1024-v1-0', provider: 'stability', description: 'SDXL 1.0' },
      { model: 'stable-diffusion-3-medium', provider: 'stability', description: 'Stable Diffusion 3' },
      { model: 'stable-cascade', provider: 'stability', description: 'Stable Cascade' },
      // Midjourney
      { model: 'midjourney', provider: 'midjourney', description: 'Midjourney (默认)' },
      { model: 'midjourney-v6', provider: 'midjourney', description: 'Midjourney V6' },
      { model: 'midjourney-v5', provider: 'midjourney', description: 'Midjourney V5' },
      // Adobe
      { model: 'firefly-3', provider: 'adobe', description: 'Adobe Firefly 3' },
      { model: 'firefly-2', provider: 'adobe', description: 'Adobe Firefly 2' },
      // Ideogram
      { model: 'ideogram-2', provider: 'ideogram', description: 'Ideogram 2.0' },
      { model: 'ideogram-1', provider: 'ideogram', description: 'Ideogram 1.0' },
      // Leonardo
      { model: 'photon-1', provider: 'leonardo', description: 'Leonardo Photon' },
      { model: 'pixel', provider: 'leonardo', description: 'Leonardo Pixel' },
      // Pollinations
      { model: 'flux', provider: 'pollinations', description: 'Flux (开源高质量)' },
      { model: 'flux-schnell', provider: 'pollinations', description: 'Flux Schnell (快速)' },
      // 01 AI
      { model: 'yi-supernova', provider: '01ai', description: '01 AI Supernova' },
      // 国内大厂
      { model: 'glm-4', provider: 'zhipu', description: '智谱 GLM-4 (Cogview)' },
      { model: 'glm-5', provider: 'zhipu', description: '智谱 GLM-5 (Cogview)' },
      { model: 'cogview-3', provider: 'zhipu', description: 'Cogview-3' },
      { model: 'ernie-4', provider: 'baidu', description: '百度文心一言4 (图像)' },
      { model: 'wanxiang', provider: 'alibaba', description: '阿里通义万相' },
      { model: 'hunyuan', provider: 'tencent', description: '腾讯混元' },
      { model: 'doubao', provider: 'bytedance', description: '字节豆包' },
      { model: 'jimeng', provider: 'bytedance', description: '即梦AI' },
      // 已有渠道
      { model: 'agnes-image-2.5-flash', provider: 'agnes', description: 'Agnes AI 图片 (快速)' },
      { model: 'agnes-image-2.1-flash', provider: 'agnes', description: 'Agnes AI 图片 2.1' },
      { model: 'deepseek-v4-flash', provider: 'deepseek', description: 'DeepSeek V4 (Cogview)' },
      { model: 'kimi-k3', provider: 'moonshot', description: 'Kimi K3 (多模态)' },
      { model: 'sensenova-image', provider: 'sensenova', description: 'SenseNova 图片' },
    ],
    videos: [
      // OpenAI
      { model: 'sora-1', provider: 'openai', description: 'OpenAI Sora 1.0' },
      // Runway
      { model: 'gen-3-alpha', provider: 'runway', description: 'Runway Gen-3 Alpha' },
      { model: 'gen-2', provider: 'runway', description: 'Runway Gen-2' },
      // Pika
      { model: 'pika-1', provider: 'runway', description: 'Pika 1.0' },
      { model: 'pika-2', provider: 'runway', description: 'Pika 2.0' },
      // 快手 Kling
      { model: 'kling-1.0', provider: 'kling', description: '快手可灵 1.0' },
      { model: 'kling-1.5', provider: 'kling', description: '快手可灵 1.5' },
      // Luma
      { model: 'dream-machine', provider: 'luma', description: 'Luma Dream Machine' },
      { model: 'photon', provider: 'luma', description: 'Luma Photon' },
      // 智谱
      { model: 'cogvideo', provider: 'zhipu', description: '智谱 CogVideo' },
      { model: 'cogvideo-5b', provider: 'zhipu', description: 'CogVideo-5B' },
      // 海螺AI
      { model: 'hailuo', provider: 'hailuo', description: '海螺AI视频生成' },
      { model: 'MiniMax-Hailuo-2.3', provider: 'minimax', description: 'MiniMax Hailuo 2.3' },
      // Meta
      { model: 'meta-video', provider: 'meta', description: 'Meta Video Generation' },
      // 字节豆包
      { model: 'doubao-video', provider: 'bytedance', description: '豆包视频生成' },
      // 混元
      { model: 'hunyuan-video', provider: 'tencent', description: '腾讯混元视频' },
      // 文心
      { model: 'wenxin-video', provider: 'baidu', description: '文心视频生成' },
      // 已有渠道
      { model: 'agnes-video-2.5', provider: 'agnes', description: 'Agnes AI 视频 2.5' },
      { model: 'agnes-video-2.5-flash', provider: 'agnes', description: 'Agnes AI 视频 (快速)' },
      { model: 'agnes-video-v2.0', provider: 'agnes', description: 'Agnes AI 视频 V2.0' },
      { model: 'image-01', provider: 'minimax', description: 'MiniMax 图片生成 01' },
      { model: 'MiniMax-H3', provider: 'minimax', description: 'MiniMax H3 视频生成' },
      { model: 'MiniMax-H3-Max', provider: 'minimax', description: 'MiniMax H3 Max (高速)' },
    ],
  };
}

// ============================================
// 异步任务查询 (视频生成轮询)
// ============================================
// MiniMax: GET /v1/videos/:task_id  (实测确认)
//          -> { id, object, model, status, created_at, prompt, base_resp, ... }
//          完成时 base_resp.status_code:0 且 status:"finished"，视频地址在 file_info.video.video_url
// Agnes:   GET /v1/videos/:task_id  (或 /videos/:task_id)
//          -> { task_id, status, output: { url, duration } }
//
// 查询失败 (网络错误 / 404 / key 无查询权限 / 上游未提供) 时返回 null，
// 调用方保持本地原状态，不回归。

export interface MediaTaskQueryResult {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: { url?: string; duration?: number };
  error?: { message: string; code?: string };
}

export async function queryMediaTask(opts: {
  provider: string;
  taskId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<MediaTaskQueryResult | null> {
  const base = opts.baseUrl.replace(/\/$/, '');

  if (opts.provider === 'minimax') {
    let host = base.replace(/\/v1$/, '');
    if (host.includes('api.minimax.chat')) host = 'https://api.minimax.cn';
    const endpoint = `${host.replace(/\/$/, '')}/v1/videos/${opts.taskId}`;
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${opts.apiKey}` },
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json() as any;
      // base_resp.status_code !== 0 表示 key 无查询权限或参数错误，保持原状态
      if (!res.ok || data.base_resp?.status_code !== 0) {
        return null;
      }
      const out = data.file_info?.video || {};
      const url = out.video_url || data.video_url;
      const status: MediaTaskQueryResult['status'] = url
        ? 'completed'
        : data.status === 'failed' || data.status === 'error'
          ? 'failed'
          : mapStatus(data.status || 'pending');
      return {
        status,
        result: { url, duration: out.duration ?? data.duration },
      };
    } catch {
      return null;
    }
  }

  if (opts.provider === 'agnes') {
    // 依次尝试两个候选路径，任一成功即返回
    const candidates = [`${base}/v1/videos/${opts.taskId}`, `${base}/videos/${opts.taskId}`];
    for (const endpoint of candidates) {
      try {
        const res = await fetch(endpoint, {
          method: 'GET',
          headers: { Authorization: `Bearer ${opts.apiKey}` },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) continue;
        const data = await res.json() as any;
        const out = data.output || {};
        const url = out.url || data.video_url || data.url;
        const status: MediaTaskQueryResult['status'] = url
          ? 'completed'
          : data.status === 'failed' || data.status === 'error'
            ? 'failed'
            : mapStatus(data.status || 'pending');
        return {
          status,
          result: { url, duration: out.duration ?? data.duration },
        };
      } catch {
        continue;
      }
    }
    return null;
  }

  return null;
}
