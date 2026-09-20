-- Phase 6: 渠道能力标记 (vision / tools / image 等)
-- capabilities 为 JSON 对象: {"vision": true, "tools": true, "image": false}
ALTER TABLE channels ADD COLUMN capabilities TEXT;
