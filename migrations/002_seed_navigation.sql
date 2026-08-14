INSERT OR IGNORE INTO navigation_items (
  id,
  name,
  url,
  description,
  category,
  accent,
  position,
  created_at,
  updated_at
) VALUES
  (
    'nav-jushuitan-erp',
    '聚水潭 ERP',
    'https://www.erp321.com/epaas',
    '进入聚水潭工作台',
    '工作系统',
    'blue',
    10,
    '2026-07-30T00:00:00.000Z',
    '2026-07-30T00:00:00.000Z'
  ),
  (
    'nav-qinsilk-production',
    '秦丝生产 ERP',
    'https://scm.qinsilk.com/scm-front/#/production/production-order',
    '直接进入生产订单',
    '工作系统',
    'amber',
    20,
    '2026-07-30T00:00:00.000Z',
    '2026-07-30T00:00:00.000Z'
  );
