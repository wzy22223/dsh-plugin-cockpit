/**
 * dsh-plugin-cockpit — DSH 界面内嵌视图（Client 插件源码）
 *
 * 在 DSH Web GUI 的会话视图环中新增「工作台」tab：
 * 工作台 iframe 全屏铺满会话区（CSS `:has()` 隐藏底部 composer 座，
 * 视图区 flex:1 自动撑满整列），右下角悬浮迷你聊天条（默认收起为状态圆钮，
 * 展开可发消息/看状态），切换由 shell 原生管理。
 *
 * ── 接入方式（本机已实测通过）──
 * 在 DSH 会话中使用 cordis 动态插件工具（cordis_define / cordis_run）加载本文件：
 *   code.client 填本文件内容，pluginId 用任意 3-6 位前缀，激活后会话标题栏
 *   （chat 旁）出现「工作台」tab。
 *
 * 实现要点：
 * - `conversation.view` 插槽（list，session 作用域）注册 id `workbench`；
 * - 全屏：`[data-conversation-scroll]:has(.wb-anchor) > [data-composer-seat]`
 *   display:none —— 与 DSH 自身 composer-overlay 的 :has() 模式一致；
 *   不要用 position:fixed 测量定位（DSH 布局含 transform/backdrop-filter，
 *   会改变 fixed 包含块，实测不可靠）；
 * - 发消息：会话标准 props 的 `inputActions.setDraft()/submit()`，
 *   草稿与 chat tab 输入框共享同一输入机；
 * - 状态：`useSession` 快照的 `running` / `pending`（待确认需去 chat tab）；
 *
 * 注：正式随包分发（exports["./client"] + dsh.client 声明的 __ModuleLoader__
 * bundle）需 DSH 构建链生成，属后续迭代；本文件为当前可用的源码形态。
 */
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    styles.insert(`
      /* 工作台视图激活时隐藏 DSH 底部聊天座，视图区自动撑满整列 */
      [data-conversation-scroll]:has(.wb-anchor) > [data-composer-seat] { display: none !important; }
      .wb-anchor { position: relative; flex: 1; min-height: 0; width: 100%; }
      .wb-full { position: absolute; inset: 0; display: flex; flex-direction: column; background: #fff; }
      .wb-frame { width: 100%; height: 100%; border: 0; flex: 1; min-height: 0; background: #fff; }
      .wb-minibar { position: absolute; right: 16px; bottom: 16px; z-index: 20; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
      .wb-card { width: 320px; max-width: calc(100vw - 40px); background: rgba(23,25,32,.94); backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,.14); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.38); color: #e8eaed; overflow: hidden; }
      .wb-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 8px 12px; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,.1); }
      .wb-status { display: flex; align-items: center; gap: 7px; min-width: 0; }
      .wb-status-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .wb-dot { width: 8px; height: 8px; border-radius: 50%; background: #7c8794; flex: 0 0 auto; }
      .wb-dot-running { background: #fbbf24; animation: wb-pulse 1.1s ease-in-out infinite; }
      .wb-dot-pending { background: #f87171; animation: wb-pulse 1.1s ease-in-out infinite; }
      @keyframes wb-pulse { 50% { opacity: .35; } }
      .wb-icon-btn { background: transparent; border: 0; color: #9aa3b2; cursor: pointer; padding: 3px 6px; border-radius: 6px; display: inline-flex; align-items: center; }
      .wb-icon-btn:hover { background: rgba(255,255,255,.08); color: #e8eaed; }
      .wb-body { display: flex; gap: 8px; padding: 10px 12px; align-items: flex-end; }
      .wb-input { flex: 1; resize: none; border: 1px solid rgba(255,255,255,.22); border-radius: 8px; background: rgba(255,255,255,.08); color: #fff; padding: 8px 10px; font-size: 13px; line-height: 1.45; min-height: 34px; max-height: 120px; outline: none; font-family: inherit; }
      .wb-input:focus { border-color: rgba(139,180,255,.65); }
      .wb-input::placeholder { color: #8b93a3; }
      .wb-send { width: 34px; height: 34px; border-radius: 8px; border: 0; background: #6d28d9; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
      .wb-send:hover { background: #5b21b6; }
      .wb-send:disabled { opacity: .4; cursor: default; }
      .wb-pill { width: 46px; height: 46px; border-radius: 50%; border: 0; background: #6d28d9; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px rgba(0,0,0,.35); position: relative; }
      .wb-pill:hover { background: #5b21b6; }
      .wb-pill-dot { position: absolute; top: -2px; right: -2px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #17191f; }
      .wb-pill-dot-running { background: #fbbf24; }
      .wb-pill-dot-pending { background: #f87171; }
    `)

    slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'workbench', order: 20, label: '工作台' },
      (props) => {
        const useInput = props.useInput
        const useSession = props.useSession
        const inputActions = props.inputActions
        const inputRef = React.useRef(null)
        const [open, setOpen] = React.useState(false)

        // 展开时聚焦输入框（默认收起，不打扰工作台浏览）
        React.useEffect(() => {
          if (open) {
            const el = inputRef.current
            if (el) el.focus()
          }
        }, [open])

        const draft = useInput ? useInput(s => s.draft) : ''
        const snap = useSession ? useSession(s => s) : null
        const running = !!(snap && snap.running)
        const pendingCount = snap && snap.pending ? snap.pending.length : 0
        const canSend = !!(draft && draft.trim())

        const send = () => {
          if (!canSend || !inputActions) return
          inputActions.submit()
        }

        const onKeyDown = (e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }

        const statusText = running
          ? '回复中…'
          : pendingCount > 0
            ? `待确认 ${pendingCount} 条 → 去 chat tab`
            : '空闲'
        const dotClass = running || pendingCount > 0 ? (pendingCount > 0 ? 'wb-dot-pending' : 'wb-dot-running') : ''

        const chatIcon = React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('path', { d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' }))
        const sendIcon = React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'currentColor' },
          React.createElement('path', { d: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z' }))
        const downIcon = React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('path', { d: 'M6 9l6 6 6-6' }))
        const extIcon = React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
          React.createElement('polyline', { points: '15 3 21 3 21 9' }),
          React.createElement('line', { x1: '10', y1: '14', x2: '21', y2: '3' }))

        const card = React.createElement('div', { className: 'wb-card' },
          React.createElement('div', { className: 'wb-card-head' },
            React.createElement('span', { className: 'wb-status' },
              React.createElement('span', { className: 'wb-dot ' + dotClass }),
              React.createElement('span', { className: 'wb-status-text' }, statusText)),
            React.createElement('span', { style: { display: 'flex', gap: 2 } },
              React.createElement('a', { className: 'wb-icon-btn', href: 'http://127.0.0.1:7799/', target: '_blank', rel: 'noopener noreferrer', title: '在新标签页打开' }, extIcon),
              React.createElement('button', { className: 'wb-icon-btn', title: '收起', onClick: () => setOpen(false) }, downIcon))),
          React.createElement('div', { className: 'wb-body' },
            React.createElement('textarea', {
              ref: inputRef,
              className: 'wb-input',
              rows: 1,
              placeholder: '给 agent 发消息…（Enter 发送）',
              value: draft,
              onChange: (e) => { if (inputActions) inputActions.setDraft(e.target.value) },
              onKeyDown,
            }),
            React.createElement('button', { className: 'wb-send', disabled: !canSend, title: '发送', onClick: send }, sendIcon)))

        const pill = React.createElement('button', { className: 'wb-pill', title: '打开迷你聊天', onClick: () => setOpen(true) },
          chatIcon,
          (running || pendingCount > 0) && React.createElement('span', { className: 'wb-pill-dot ' + (pendingCount > 0 ? 'wb-pill-dot-pending' : 'wb-pill-dot-running') }))

        return React.createElement('div', { ref: null, className: 'wb-anchor' },
          React.createElement('div', { className: 'wb-full' },
            React.createElement('iframe', { className: 'wb-frame', src: 'http://127.0.0.1:7799/', title: 'Personal Cockpit 工作台' }),
            React.createElement('div', { className: 'wb-minibar' }, open ? card : pill)))
      },
    ))
  },
}
