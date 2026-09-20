-- 009: 给 hub_keys 加 plain_key 字段, 让用户能随时复制完整 key
-- 个人使用场景: 不再需要 "重生成才能看" 这种逆向操作
ALTER TABLE hub_keys ADD COLUMN plain_key TEXT;
