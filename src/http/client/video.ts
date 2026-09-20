/**
 * 多媒体生成 API 路由
 * 
 * POST /v1/images/generations  - 文生图
 * POST /v1/images/edits        - 图生图/图片编辑
 * POST /v1/videos/generations  - 文生视频 (异步，返回 task_id)
 * POST /v1/videos/edits        - 图生视频 (异步，返回 task_id)
 * GET  /v1/videos/tasks/:taskId - 轮询视频任务状态 / 取回结果
 * GET  /v1/images/models       - 获取支持的图片模型
 * GET  /v1/videos/models       - 获取支持的视频模型
 * 
 * 统一入口，路由到对应 Provider
 */
import type { FastifyInstance } from 'fastify';
import { authenticateHubKey } from '../../auth/hubKeyAuth.js';
import { generateMedia, listSupportedMediaModels, queryMediaTask, type MediaGenerateResponse } from '../../services/mediaService.js';
import { createMediaTask, getMediaTask, updateMediaTask } from '../../db/repos/mediaTasks.js';
import { getKey, getDecryptedApiKey } from '../../db/repos/keys.js';
import { logger } from '../../util/logger.js';

export async function registerVideoRoutes(app: FastifyInstance): Promise<void> {

  // 持久化异步任务 (视频生成/编辑)。失败不影响主流程。
  const persistTask = (result: MediaGenerateResponse, hubKeyId: number | null) => {
    try {
      createMediaTask({
        id: result.id,
        provider: result._provider || 'unknown',
        model: result.model,
        type: 'video',
        hub_key_id: hubKeyId,
        channel_key_id: result._channel_key_id ?? null,
        status: result.status,
        result: result.output ?? null,
        error: result.error ?? null,
      });
    } catch (e) {
      logger.warn({ err: e }, 'Failed to persist media task');
    }
  };

  // 统一的任务响应格式
  const serializeTask = (task: NonNullable<ReturnType<typeof getMediaTask>>) => ({
    id: task.id,
    model: task.model,
    status: task.status,
    output: task.result ?? null,
    error: task.error ?? null,
    created_at: new Date(task.created_at).toISOString(),
    updated_at: new Date(task.updated_at).toISOString(),
  });

  // POST /v1/images/generations - 文生图
  app.post('/v1/images/generations', async (req, reply) => {
    const auth = authenticateHubKey(req);
    if (!auth.ok) {
      return reply.code(401).send({
        error: {
          message: auth.error.message,
          code: auth.error.code,
          type: 'authentication_error',
        },
      });
    }
    
    const body = req.body as any;
    
    if (!body?.model) {
      return reply.code(400).send({
        error: { message: 'model 字段必填', type: 'invalid_request_error' },
      });
    }
    
    if (!body?.prompt) {
      return reply.code(400).send({
        error: { message: 'prompt 字段必填', type: 'invalid_request_error' },
      });
    }
    
    try {
      const result = await generateMedia({
        model: body.model,
        prompt: body.prompt,
        n: body.n,
        size: body.size,
        response_format: body.response_format,
        style: body.style,
      }, 'image');
      
      if (result.status === 'failed') {
        return reply.code(400).send({
          error: {
            message: result.error?.message || '图片生成失败',
            code: result.error?.code || 'GENERATION_FAILED',
          },
        });
      }
      
      return reply.send({
        id: result.id,
        model: result.model,
        status: result.status,
        output: result.output,
      });
    } catch (e: any) {
      logger.error({ err: e }, 'Image generation error');
      return reply.code(500).send({
        error: { message: e.message || '内部错误', type: 'server_error' },
      });
    }
  });

  // POST /v1/images/edits - 图生图/图片编辑
  app.post('/v1/images/edits', async (req, reply) => {
    const auth = authenticateHubKey(req);
    if (!auth.ok) {
      return reply.code(401).send({
        error: {
          message: auth.error.message,
          code: auth.error.code,
          type: 'authentication_error',
        },
      });
    }
    
    const body = req.body as any;
    
    if (!body?.model) {
      return reply.code(400).send({
        error: { message: 'model 字段必填', type: 'invalid_request_error' },
      });
    }
    
    if (!body?.image) {
      return reply.code(400).send({
        error: { message: 'image 字段必填', type: 'invalid_request_error' },
      });
    }
    
    try {
      const result = await generateMedia({
        model: body.model,
        prompt: body.prompt,
        image: body.image,
        mask: body.mask,
        n: body.n,
        size: body.size,
        response_format: body.response_format,
        style: body.style,
      }, 'image_edit');
      
      if (result.status === 'failed') {
        return reply.code(400).send({
          error: {
            message: result.error?.message || '图片编辑失败',
            code: result.error?.code || 'GENERATION_FAILED',
          },
        });
      }
      
      return reply.send({
        id: result.id,
        model: result.model,
        status: result.status,
        output: result.output,
      });
    } catch (e: any) {
      logger.error({ err: e }, 'Image edit error');
      return reply.code(500).send({
        error: { message: e.message || '内部错误', type: 'server_error' },
      });
    }
  });

  // POST /v1/videos/generations - 文生视频
  app.post('/v1/videos/generations', async (req, reply) => {
    const auth = authenticateHubKey(req);
    if (!auth.ok) {
      return reply.code(401).send({
        error: {
          message: auth.error.message,
          code: auth.error.code,
          type: 'authentication_error',
        },
      });
    }
    
    const body = req.body as any;
    
    if (!body?.model) {
      return reply.code(400).send({
        error: { message: 'model 字段必填', type: 'invalid_request_error' },
      });
    }
    
    if (!body?.prompt) {
      return reply.code(400).send({
        error: { message: 'prompt 字段必填', type: 'invalid_request_error' },
      });
    }
    
    try {
      const result = await generateMedia({
        model: body.model,
        prompt: body.prompt,
        duration: body.duration,
        resolution: body.resolution,
        aspect_ratio: body.aspect_ratio,
        seed: body.seed,
      }, 'video');
      
      if (result.status === 'failed') {
        return reply.code(400).send({
          error: {
            message: result.error?.message || '视频生成失败',
            code: result.error?.code || 'GENERATION_FAILED',
          },
        });
      }
      
      persistTask(result, req.hubKey?.id ?? null);
      
      return reply.send({
        id: result.id,
        model: result.model,
        status: result.status,
        output: result.output,
      });
    } catch (e: any) {
      logger.error({ err: e }, 'Video generation error');
      return reply.code(500).send({
        error: { message: e.message || '内部错误', type: 'server_error' },
      });
    }
  });

  // POST /v1/videos/edits - 图生视频
  app.post('/v1/videos/edits', async (req, reply) => {
    const auth = authenticateHubKey(req);
    if (!auth.ok) {
      return reply.code(401).send({
        error: {
          message: auth.error.message,
          code: auth.error.code,
          type: 'authentication_error',
        },
      });
    }
    
    const body = req.body as any;
    
    if (!body?.model) {
      return reply.code(400).send({
        error: { message: 'model 字段必填', type: 'invalid_request_error' },
      });
    }
    
    if (!body?.prompt && !body?.video) {
      return reply.code(400).send({
        error: { message: 'prompt 或 video 字段必填', type: 'invalid_request_error' },
      });
    }
    
    try {
      const result = await generateMedia({
        model: body.model,
        prompt: body.prompt,
        video: body.video,
        duration: body.duration,
        resolution: body.resolution,
        aspect_ratio: body.aspect_ratio,
        seed: body.seed,
      }, 'video_edit');
      
      if (result.status === 'failed') {
        return reply.code(400).send({
          error: {
            message: result.error?.message || '视频生成失败',
            code: result.error?.code || 'GENERATION_FAILED',
          },
        });
      }
      
      persistTask(result, req.hubKey?.id ?? null);
      
      return reply.send({
        id: result.id,
        model: result.model,
        status: result.status,
        output: result.output,
      });
    } catch (e: any) {
      logger.error({ err: e }, 'Video edit error');
      return reply.code(500).send({
        error: { message: e.message || '内部错误', type: 'server_error' },
      });
    }
  });

  // GET /v1/videos/tasks/:taskId - 轮询视频任务状态 / 取回结果
  // 先读本地记录，若非终态则尝试向上游刷新 (查询失败保持原状态)
  app.get('/v1/videos/tasks/:taskId', async (req, reply) => {
    const auth = authenticateHubKey(req);
    if (!auth.ok) {
      return reply.code(401).send({
        error: {
          message: auth.error.message,
          code: auth.error.code,
          type: 'authentication_error',
        },
      });
    }

    const taskId = (req.params as { taskId: string }).taskId;
    const task = getMediaTask(taskId);

    if (!task) {
      return reply.code(404).send({
        error: { message: '任务不存在', code: 'TASK_NOT_FOUND', type: 'invalid_request_error' },
      });
    }

    // 终态直接返回
    if (task.status === 'completed' || task.status === 'failed') {
      return reply.send(serializeTask(task));
    }

    // 非终态: 尝试向上游刷新
    const upstreamKey = task.channel_key_id ? getKey(task.channel_key_id) : null;
    let refreshed = task;
    if (upstreamKey && upstreamKey.enabled === 1) {
      const qr = await queryMediaTask({
        provider: task.provider,
        taskId: task.id,
        apiKey: getDecryptedApiKey(upstreamKey.id),
        baseUrl: upstreamKey.base_url,
      });
      if (qr) {
        refreshed = updateMediaTask(task.id, {
          status: qr.status,
          result: qr.result ?? task.result,
          error: qr.error ?? (qr.status === 'failed' ? { message: '视频生成失败' } : null),
        }) ?? task;
      }
    }

    return reply.send(serializeTask(refreshed));
  });

  // GET /v1/images/models - 获取支持的图片生成模型
  app.get('/v1/images/models', async (_req, _reply) => {
    const supported = listSupportedMediaModels();
    return {
      object: 'list',
      data: supported.images.map(m => ({
        id: m.model,
        object: 'model',
        provider: m.provider,
        description: m.description,
      })),
    };
  });

  // GET /v1/videos/models - 获取支持的视频生成模型
  app.get('/v1/videos/models', async (_req, _reply) => {
    const supported = listSupportedMediaModels();
    return {
      object: 'list',
      data: supported.videos.map(m => ({
        id: m.model,
        object: 'model',
        provider: m.provider,
        description: m.description,
      })),
    };
  });
}
