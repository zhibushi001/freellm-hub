-- Phase 5: 完整 freellmapi + newapi Provider 集合
-- 38 个免费 / 自建 + 7 个收费
-- 表结构
ALTER TABLE providers ADD is_free INTEGER NOT NULL DEFAULT 0;
ALTER TABLE providers ADD category TEXT;
ALTER TABLE providers ADD docs_url TEXT;

-- 已存在的 providers 表 (001_init.sql) 不需要重复 CREATE

-- 17 收费 Provider (Phase 1 base)
INSERT OR IGNORE INTO providers (name, display_name, base_url, protocol, api_path, models_path, category, is_free, docs_url, notes, created_at, updated_at) VALUES
  ('minimax',         'MiniMax (M3/A1)', 'https://api.minimax.chat/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://api.minimax.chat', '主要用 M3/A1', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('openai',          'OpenAI',         'https://api.openai.com/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://platform.openai.com', 'GPT-4o/o1/o3 等', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('anthropic',       'Anthropic',      'https://api.anthropic.com/v1', 'anthropic', '/messages', '/models', 'paid', 0, 'https://docs.anthropic.com', 'Claude 3.5/4 等', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('openrouter',      'OpenRouter',     'https://openrouter.ai/api/v1', 'openai', '/chat/completions', '/models', 'aggregator', 0, 'https://openrouter.ai', '选模型路由, 收费', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('groq',            'Groq (paid)',    'https://api.groq.com/openai/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://console.groq.com', '按量付费 (开发层有免费额度)', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('together',        'Together AI',    'https://api.together.xyz/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://together.ai', '开源模型', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('fireworks',       'Fireworks AI',   'https://api.fireworks.ai/inference/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://fireworks.ai', '按量付费', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('deepseek',        'DeepSeek',       'https://api.deepseek.com/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://platform.deepseek.com', '国产, 便宜', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('moonshot',        'Moonshot (Kimi)','https://api.moonshot.cn/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://platform.moonshot.cn', 'Kimi, 实名', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('zhipu',           '智谱 GLM',      'https://open.bigmodel.cn/api/paas/v4', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://bigmodel.cn', 'GLM-4, 实名', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('dashscope',       '阿里 DashScope (通义)','https://dashscope.aliyuncs.com/compatible-mode/v1','openai','/chat/completions','/models','paid', 0, 'https://dashscope.aliyun.com', '通义千问, 实名', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('yi',              '零一万物 (Yi)', 'https://api.lingyiwanwu.com/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://platform.lingyiwanwu.com', 'Yi 大模型', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('mistral',         'Mistral',        'https://api.mistral.ai/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://console.mistral.ai', 'Mistral Large 等', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('cohere',          'Cohere',         'https://api.cohere.com/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://dashboard.cohere.com', 'Command R+', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('perplexity',      'Perplexity',     'https://api.perplexity.ai', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://docs.perplexity.ai', '搜索增强', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('google',          'Google AI Studio (Gemini 付费)','https://generativelanguage.googleapis.com/v1beta/openai','openai','/chat/completions','/models','paid', 0, 'https://ai.google.dev', 'Gemini Pro 等', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('xai',             'xAI (Grok)',     'https://api.x.ai/v1', 'openai', '/chat/completions', '/models', 'paid', 0, 'https://docs.x.ai', 'Grok-2 等', strftime('%s','now')*1000, strftime('%s','now')*1000);

-- 免费 / 自建 Provider (35+)
INSERT OR IGNORE INTO providers (name, display_name, base_url, protocol, api_path, models_path, category, is_free, docs_url, notes, created_at, updated_at) VALUES
  -- === 本地 / Self-hosted ===
  ('ollama',          'Ollama (本地)',  'http://127.0.0.1:11434/v1', 'openai', '/chat/completions', '/models', 'self-hosted', 1, 'https://ollama.com', '本地 Ollama, 默认端口 11434', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('ollama-cloud',    'Ollama Cloud',   'https://ollama.com/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://ollama.com', 'Ollama 官方云, 1 并发 / 5h session cap', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === Groq 免费层 (实时标注) ===
  ('groq-free',       'Groq 免费层',   'https://api.groq.com/openai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://console.groq.com', 'Groq 限速免费层', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('cerebras',        'Cerebras',       'https://api.cerebras.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://cloud.cerebras.ai', '免费层, 超快推理', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('groq-cloud',      'Groq Cloud (同 groq-free)','https://api.groq.com/openai/v1','openai','/chat/completions','/models','free', 1, 'https://console.groq.com', '别名', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === Google 免费 ===
  ('gemini-free',     'Gemini 免费层', 'https://generativelanguage.googleapis.com/v1beta/openai', 'openai', '/chat/completions', '/models', 'free', 1, 'https://aistudio.google.com', 'Gemini 1.5 Flash 免费层, 15 req/min', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === Cohere Trial ===
  ('cohere-trial',    'Cohere Trial',   'https://api.cohere.com/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://dashboard.cohere.com', 'Cohere 试用, 限速', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === OpenRouter 免费模型 (用 free 标签) ===
  ('openrouter-free', 'OpenRouter 免费模型','https://openrouter.ai/api/v1','openai','/chat/completions','/models','free', 1, 'https://openrouter.ai', '选 :free 模型即可免费', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === GitHub Models (注: 端点改 models.github.ai) ===
  ('github-models',   'GitHub Models',  'https://models.github.ai/inference', 'openai', '/chat/completions', '/models', 'free', 1, 'https://github.com/marketplace/models', 'GitHub Copilot 订阅用户', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === Hugging Face Router ===
  ('huggingface',     'Hugging Face Router','https://router.huggingface.co/v1','openai','/chat/completions','/models','free', 1, 'https://huggingface.co/docs/inference-providers', 'HF Token 即可, $0.10/月 router credit', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === Keyless / Aggregator ===
  ('kilo',            'Kilo Gateway (keyless)','https://api.kilo.ai/api/gateway/v1','openai','/chat/completions','/models','free', 1, 'https://kilo.ai', 'Keyless, :free 路由 200 req/hr/IP', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('pollinations',    'Pollinations',   'https://gen.pollinations.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://pollinations.ai', '需 publishable key (注册免费)', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('llm7',            'LLM7',           'https://api.llm7.io/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://llm7.io', '100 req/hr, 匿名可用基础模型', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('opencode-zen',    'OpenCode Zen',   'https://opencode.ai/zen/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://opencode.ai/zen', 'OpenCode 用户免费, 部分模型 promo', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('ovh-ai',          'OVH AI Endpoints (keyless)','https://oai.endpoints.kepler.ai.cloud.ovh.net/v1','openai','/chat/completions','/models','free', 1, 'https://endpoints.ai.cloud.ovh.net', 'Keyless 2 req/min/IP, 实名后 400 req/min', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('aihorde',         'AI Horde (keyless)','https://aihorde.net/api/v2','openai','/chat/completions','/models','free', 1, 'https://aihorde.net', '志愿者 GPU, 队列 60-120s, 匿名 key=0', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === 推理平台免费层 ===
  ('siliconflow',     'SiliconFlow',    'https://api.siliconflow.com/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://siliconflow.cn', '国产, 注册免费, FLUX/CosyVoice 也免费', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('nvidia-nim',      'NVIDIA NIM',     'https://integrate.api.nvidia.com/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://build.nvidia.com', 'NVIDIA 开发者免费, 推理 30-180s', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('amd-radeon',      'AMD Radeon Cloud','https://developer.amd.com.cn/radeon/api/v1','openai','/chat/completions','/models','free', 1, 'https://developer.amd.com', 'AMD 推理免费层, 长推理 600s', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('agnes-ai',        'Agnes AI',       'https://apihub.agnes-ai.com/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://platform.agnes-ai.com', '$0 promo, 推理 60s', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('reka',            'Reka',           'https://api.reka.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://platform.reka.ai', '月度 credit 发放, reka-flash/edge', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === 国产 / 国内实名 ===
  ('modelscope',      'ModelScope (魔搭)','https://api-inference.modelscope.cn/v1/chat/completions','openai','/chat/completions','/models','free', 1, 'https://modelscope.cn', '阿里魔搭, 需绑阿里云实名', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('baidu-qianfan',   '百度千帆',       'https://qianfan.baidubce.com/v2', 'openai', '/chat/completions', '/models', 'free', 1, 'https://cloud.baidu.com/product/qianfan', 'ERNIE-Speed/Lite 免费, 实名', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('volcengine-ark',  '火山方舟 (豆包)','https://ark.cn-beijing.volces.com/api/v3', 'openai', '/chat/completions', '/models', 'free', 1, 'https://www.volcengine.com/product/ark', '字节豆包, 实名, 2M tok/日/模型', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('iflytek-spark',   '讯飞星火',       'https://spark-api-open.xf-yun.com/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://xinghuo.xfyun.cn', '讯飞, 实名, Lite 免费', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('longcat',         '美团 LongCat',   'https://api.longcat.chat/openai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://longcat.chat', '美团, 日免费, 海外邮箱可注册', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('zhipu-free',      '智谱 GLM 免费层','https://open.bigmodel.cn/api/paas/v4','openai','/chat/completions','/models','free', 1, 'https://bigmodel.cn', 'GLM-4-Flash 免费, 实名, glm-4.7-flash 推理 60s', strftime('%s','now')*1000, strftime('%s','now')*1000),

  -- === 月度 credit / 一次性 / Promotional ===
  ('sail',            'Sail Research',  'https://api.sail.com/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://sail.com', '$5 free credits/月 (需绑卡)', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('electronhub',     'ElectronHub',    'https://api.electronhub.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://electronhub.ai', '共享钱包, 免费 credit', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('experiential',    'Experiential',   'https://api.experiential.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://experiential.ai', '共享钱包', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('router9',         'Router9',        'https://api.router9.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://router9.ai', '月 shared credit', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('septor',          'Septor',         'https://api.septor.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://septor.ai', '零价格模型共享日 quota', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('bai',             'B.AI',           'https://api.b.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://b.ai', '0-credit promo, 部分模型', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('anyapi',          'AnyAPI',         'https://api.anyapi.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://anyapi.ai', '$0, 100K tok/日, 无需卡', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('routeway',        'Routeway',       'https://api.routeway.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://routeway.ai', ':free 路由 5-20 rpm, 需浏览器 UA', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('bazaarlink',      'BazaarLink',     'https://bazaarlink.ai/api/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://bazaarlink.ai', 'auto:free 路由, 0 成本', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('ainative',        'AINative Studio','https://api.ainative.studio/api/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://ainative.studio', '~10M tok/月免费', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('aion-labs',       'Aion Labs',      'https://api.aionlabs.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://aionlabs.ai', '月 shared credit', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('navyai',          'NavyAI',         'https://api.navy/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://navy.ai', '150K tok/日, 20 rpm, 需 User-Agent', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('nara-router',     'NaraRouter',     'https://router.bynara.id/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://bynara.id', 'Telegram 验证, 0 余额可用部分模型', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('sea-lion',        'SEA-LION',       'https://api.sea-lion.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://sea-lion.ai', 'AI Singapore, 10 rpm, 谷歌登录', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('orca-router',     'OrcaRouter',     'https://api.orcarouter.ai/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://orcarouter.ai', '*-free 别名 $0, 限速', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('uno-router',      'UnoRouter',      'https://api.unorouter.com/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://unorouter.com', ':free 后缀 1 req/min/账号', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('xkiro',           'xKiro',          'https://api.xkiro.com/v1', 'openai', '/chat/completions', '/models', 'free', 1, 'https://xkiro.com', '5M tok/日, 多数免费', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('requesty-free',   'Requesty 免费路由','https://router.requesty.ai/v1','openai','/chat/completions','/models','aggregator', 0, 'https://requesty.ai', '聚合, 部分模型 free', strftime('%s','now')*1000, strftime('%s','now')*1000),
  ('cloudflare-ai',   'Cloudflare Workers AI','https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1','openai','/chat/completions','/models','free', 1, 'https://developers.cloudflare.com/workers-ai', 'key 格式 "account_id:token", 实名', strftime('%s','now')*1000, strftime('%s','now')*1000);
