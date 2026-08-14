-- D7: 清理 V0.4 已删除的信息流（feed）残留表
-- 005_feed.sql 曾建 feed_sources / feed_items，但信息流功能在 V0.4 已移除，
-- 代码层零引用。此处安全删除，避免数据库残留孤儿表。
-- 使用 IF EXISTS 保证幂等：重复执行不会报错。

DROP TABLE IF EXISTS feed_items;
DROP TABLE IF EXISTS feed_sources;
