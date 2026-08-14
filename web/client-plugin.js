/**
 * dsh-plugin-cockpit — DSH 界面内嵌视图（Client 插件源码）
 *
 * 在 DSH Web GUI 的会话视图环中新增「工作台」tab：iframe 嵌入插件服务
 * （默认 http://127.0.0.1:7799），切换由 shell 原生管理。
 *
 * ── 接入方式（本机已实测通过）──
 * 在 DSH 会话中使用 cordis 动态插件工具（cordis_define / cordis_run）加载本文件：
 *   code.client 填本文件内容，pluginId 用任意 3-6 位前缀，激活后会话标题栏
 *   （chat 旁）出现「工作台」tab。
 *
 * 注：正式随包分发（exports["./client"] + dsh.client 声明的 __ModuleLoader__
 * bundle）需 DSH 构建链生成，属后续迭代；本文件为当前可用的源码形态。
 */
return {
  apply(ctx) {
    const WORKBENCH_URL = 'http://127.0.0.1:7799/'
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const disposeStyles = styles.insert(`
      .cockpit-wb-view {
        display: block; width: 100%; height: 100%; border: 0; background: #fff;
      }
      .cockpit-wb-wrapper {
        width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column;
      }
      .cockpit-wb-toolbar {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 12px; flex: 0 0 auto;
        border-bottom: 1px solid rgba(128,128,128,.25);
        background: var(--background-color, #0f1115); color: #eee;
        font-size: 12px;
      }
      .cockpit-wb-toolbar a { color: #8ab4ff; text-decoration: none }
      .cockpit-wb-toolbar a:hover { text-decoration: underline }
    `)
    // 会话视图环新增「工作台」tab（切换由 shell 原生管理，保证可点）
    slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'workbench', order: 20, label: '工作台' },
      () => {
        return React.createElement(
          'div',
          { className: 'cockpit-wb-wrapper' },
          React.createElement(
            'div',
            { className: 'cockpit-wb-toolbar' },
            React.createElement('span', null, 'Personal Cockpit 工作台'),
            React.createElement(
              'a',
              { href: WORKBENCH_URL, target: '_blank', rel: 'noopener noreferrer' },
              '在新标签页打开',
            ),
          ),
          React.createElement('iframe', { className: 'cockpit-wb-view', src: WORKBENCH_URL, title: 'Personal Cockpit 工作台' }),
        )
      },
    ))
  },
}
