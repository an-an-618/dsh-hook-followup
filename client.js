/**
 * Hook Follow-up — browser half of `@an-an-618/dsh-hook-followup`.
 *
 * Two seats, both fed by the metadata the Host persists on the `followup` tool
 * result:
 *
 *  - `tool.call.toolview` (keyed by the wire tool name) renders a one-line
 *    summary in the transcript;
 *  - `conversation.chat.turnTail` renders the hook sentence and the quick-reply
 *    chips at the end of the completed turn. Clicking a chip calls the
 *    session-scoped `conversation.send(text)`, so the picked reply arrives as
 *    one ordinary user message — no new RPC, no synthetic event type.
 *
 * The metadata is read from the Chat snapshot the same defensive way the
 * Intelligent UI card reads its program: the primary path is the location
 * index, and the public per-turn tool-call source is the fallback. Anything
 * unreadable renders nothing rather than a broken row.
 *
 * No dynamic code, no network, no DOM reads outside the React tree.
 */
window.__ModuleLoader__.load({
  id: '@an-an-618/dsh-hook-followup',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-hook-followup'

    /** Wire tool name shared with the Host half. */
    const TOOL_NAME = 'followup'

    /** Inline dictionaries; the Client never depends on a separate locale file. */
    const MESSAGES = {
      zh: {
        'followup.group': '快捷回复',
        'followup.summary': '已附加 {count} 条快捷回复',
        'followup.preparing': '正在准备快捷回复…',
        'followup.unavailable': '没有可用的快捷回复',
        'followup.sent': '已发送，正在开启下一轮…',
        'followup.failed': '发送失败：{message}',
        'followup.noChannel': '当前组合没有会话发送通道',
        'form.summary': '策略：{strategy} · 上限 {count} 条',
        'form.title': '追问策略与开关',
        'form.desc': '改完点保存，下一轮生效；离开页面会丢弃未保存的修改。',
        'form.enabled': '启用插件',
        'form.enabledHint': '关闭后不再向系统提示注入追问规则，followup 调用会被拒绝。',
        'form.strategy': '追问策略',
        'form.strategyHint': '决定省略条件的宽松程度。',
        'form.strategy.always': '应出尽出',
        'form.strategy.balanced': '平衡',
        'form.strategy.conservative': '克制',
        'form.refusal': '拒答时省略',
        'form.refusalHint': '本轮是拒绝回答时，是否整块省略。',
        'form.emotional': '情绪场景省略',
        'form.emotionalHint': '用户处于情绪危机、哀伤、自伤风险时，是否整块省略。',
        'form.maxReplies': '回复条数上限',
        'form.maxRepliesHint': '1–3 条；实际条数仍按路径数量自适应，不凑满。',
        'form.renderMode': '渲染模式',
        'form.renderModeHint': 'ui 渲染胶囊；markdown / tag 是纯提示词降级。',
        'form.renderMode.ui': 'ui（工具 + 胶囊）',
        'form.renderMode.markdown': 'markdown 降级',
        'form.renderMode.tag': 'tag 降级',
        'form.language': '语言',
        'form.languageHint': 'follow_user 跟随用户语言；zh / en 同时固定规则文本语言。',
        'form.language.follow_user': '跟随用户',
        'form.language.zh': '中文',
        'form.language.en': 'English',
        'form.save': '保存',
        'form.saving': '保存中…',
        'form.saved': '已保存',
        'form.failed': '保存失败，请重试',
        'form.unchanged': '没有改动',
        'form.reset': '恢复默认',
        'form.notWritable': '当前配置不可写。',
        'form.noForm': 'Host 还没有提供这个插件的配置表单；确认插件已启用并且 Config schema 已加载。',
        'form.loading': '正在读取配置…',
      },
      en: {
        'followup.group': 'Quick replies',
        'followup.summary': 'Attached {count} quick replies',
        'followup.preparing': 'Preparing quick replies…',
        'followup.unavailable': 'No quick replies available',
        'followup.sent': 'Sent. Starting the next turn…',
        'followup.failed': 'Could not send: {message}',
        'followup.noChannel': 'This composition has no conversation send channel',
        'form.summary': 'Strategy: {strategy} · up to {count} replies',
        'form.title': 'Follow-up policy',
        'form.desc': 'Save to apply from the next turn; leaving the page discards unsaved edits.',
        'form.enabled': 'Enable plugin',
        'form.enabledHint': 'When off, no follow-up rules are injected and followup calls are rejected.',
        'form.strategy': 'Follow-up strategy',
        'form.strategyHint': 'How aggressive the omission rules are.',
        'form.strategy.always': 'Always output',
        'form.strategy.balanced': 'Balanced',
        'form.strategy.conservative': 'Conservative',
        'form.refusal': 'Skip on refusal',
        'form.refusalHint': 'Skip the whole block when this turn is a refusal.',
        'form.emotional': 'Skip on emotional distress',
        'form.emotionalHint': 'Skip the whole block when the user is in crisis, grieving, or at risk.',
        'form.maxReplies': 'Reply cap',
        'form.maxRepliesHint': '1-3; the actual count still follows the number of real paths.',
        'form.renderMode': 'Render mode',
        'form.renderModeHint': 'ui renders chips; markdown / tag are prompt-only fallbacks.',
        'form.renderMode.ui': 'ui (tool + chips)',
        'form.renderMode.markdown': 'markdown fallback',
        'form.renderMode.tag': 'tag fallback',
        'form.language': 'Language',
        'form.languageHint': 'follow_user follows the user; zh / en also fix the rule language.',
        'form.language.follow_user': 'Follow user',
        'form.language.zh': 'Chinese',
        'form.language.en': 'English',
        'form.save': 'Save',
        'form.saving': 'Saving…',
        'form.saved': 'Saved',
        'form.failed': 'Save failed, try again',
        'form.unchanged': 'No changes',
        'form.reset': 'Reset to defaults',
        'form.notWritable': 'This configuration is not writable.',
        'form.noForm': 'The Host did not provide a configuration form yet; check that the plugin is enabled and its Config schema loaded.',
        'form.loading': 'Loading configuration…',
      },
    }

    /** Last-resort dictionary for a composition without the locale service. */
    const FALLBACK_MESSAGES = MESSAGES.zh

    /**
     * Theme-token-only styling. The `<style>` element lives inside the
     * component, so React removes it on unmount and nothing leaks globally.
     */
    const CSS = [
      '.dsh-hf-root{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;width:100%;max-width:748px;min-width:0;margin:4px 0 2px;font-family:var(--dsw-font-family,inherit);overflow-wrap:anywhere}',
      '.dsh-hf-hook{display:flex;align-items:flex-start;gap:6px;color:var(--dsw-alias-label-primary,#1b1f27);font-size:var(--dsw-font-xs-13-font-size,13px);line-height:var(--dsw-font-xs-13-line-height,20px);font-weight:500}',
      '.dsh-hf-mark{flex:none;color:var(--dsw-alias-state-business-primary,#4176e6);font-size:var(--dsw-font-xs-13-font-size,13px);line-height:var(--dsw-font-xs-13-line-height,20px);font-weight:600}',
      '.dsh-hf-hook-text{min-width:0;white-space:pre-wrap}',
      '.dsh-hf-replies{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}',
      '.dsh-hf-chip{appearance:none;box-sizing:border-box;max-width:100%;padding:7px 14px;border:0.5px solid var(--dsw-alias-border-l2,rgba(20,26,40,.1));border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f5f6f9);color:var(--dsw-alias-label-primary,#1b1f27);font:inherit;font-size:var(--dsw-font-xs-13-font-size,13px);line-height:var(--dsw-font-xs-13-line-height,20px);font-weight:500;text-align:left;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,transform .12s ease}',
      '.dsh-hf-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#eef1f6);border-color:var(--dsw-alias-border-l3,rgba(20,26,40,.16))}',
      '.dsh-hf-chip:active:not(:disabled){transform:translateY(0.5px)}',
      '.dsh-hf-chip:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}',
      '.dsh-hf-chip:disabled{cursor:default;opacity:.55}',
      '.dsh-hf-chip[data-sent]{border-color:var(--dsw-alias-border-l3,rgba(20,26,40,.16))}',
      '.dsh-hf-status{color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px)}',
      '.dsh-hf-error{color:var(--dsw-alias-state-error-primary,#c62828);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px)}',
      '.dsh-hf-summary{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;max-width:640px;min-width:0;padding:2px;color:var(--dsw-alias-label-tertiary,#8a93a3);font-family:var(--dsw-font-family,inherit);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px);overflow-wrap:anywhere}',
      '.dsh-hf-form{display:flex;flex-direction:column;gap:14px;box-sizing:border-box;width:100%;max-width:640px;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary,#1b1f27)}',
      '.dsh-hf-form-title{margin:0;font-size:14px;line-height:20px;font-weight:600}',
      '.dsh-hf-form-desc{margin:0;color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:12px;line-height:18px}',
      '.dsh-hf-field{display:flex;flex-direction:column;gap:6px;padding-bottom:12px;border-bottom:0.5px solid var(--dsw-alias-border-l2,rgba(20,26,40,.1))}',
      '.dsh-hf-field:last-of-type{border-bottom:0;padding-bottom:0}',
      '.dsh-hf-field-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}',
      '.dsh-hf-field-label{font-size:13px;line-height:20px;font-weight:500;min-width:0}',
      '.dsh-hf-field-hint{color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:12px;line-height:18px}',
      '.dsh-hf-check{width:18px;height:18px;margin:0;accent-color:var(--dsw-alias-state-business-primary,#4176e6);cursor:pointer}',
      '.dsh-hf-select,.dsh-hf-number{box-sizing:border-box;height:32px;border:0.5px solid var(--dsw-alias-border-l4,rgba(20,26,40,.16));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2,#f5f6f9);color:var(--dsw-alias-label-primary,#1b1f27);font:inherit;font-size:13px;line-height:20px;padding:0 10px}',
      '.dsh-hf-select{min-width:180px;max-width:100%}',
      '.dsh-hf-number{width:72px}',
      '.dsh-hf-select:focus-visible,.dsh-hf-number:focus-visible,.dsh-hf-check:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}',
      '.dsh-hf-form-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dsh-hf-save{appearance:none;border:0.5px solid transparent;border-radius:var(--dsw-radius-md,8px);height:32px;padding:0 14px;background:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-label-primary-inverted,#fff);font:inherit;font-size:13px;line-height:20px;font-weight:500;cursor:pointer}',
      '.dsh-hf-save:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 86%,#000)}',
      '.dsh-hf-save:disabled{opacity:.5;cursor:default}',
      '.dsh-hf-reset{appearance:none;border:0.5px solid var(--dsw-alias-border-l2,rgba(20,26,40,.1));border-radius:var(--dsw-radius-md,8px);height:32px;padding:0 14px;background:var(--dsw-alias-bg-layer-2,#f5f6f9);color:var(--dsw-alias-label-primary,#1b1f27);font:inherit;font-size:13px;line-height:20px;cursor:pointer}',
      '.dsh-hf-reset:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#eef1f6)}',
      '.dsh-hf-reset:disabled{opacity:.5;cursor:default}',
      '.dsh-hf-form-status{color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:12px;line-height:18px}',
      '.dsh-hf-form-status[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#c62828)}',
      '.dsh-hf-form-note{color:var(--dsw-alias-label-tertiary,#8a93a3);font-size:13px;line-height:20px}',
    ].join('\n')

    /* ------------------------------------------------------------------ *
     * Defensive readers
     * ------------------------------------------------------------------ */

    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /** Whether a persisted object is metadata this Client version renders. */
    function isFollowupMeta(meta) {
      return isRecord(meta)
        && meta.v === 1
        && meta.kind === 'followup'
        && typeof meta.hook === 'string'
        && Array.isArray(meta.replies)
        && meta.replies.length > 0
        && meta.replies.every((reply) => typeof reply === 'string' && reply.trim() !== '')
    }

    /** Normalize `turn` (number in 0.2.1-rc.2, Turn object in the contract). */
    function turnNumberOf(turn) {
      if (typeof turn === 'number' && Number.isFinite(turn)) return turn
      if (!isRecord(turn)) return undefined
      const inner = turn.turn
      if (typeof inner === 'number' && Number.isFinite(inner)) return inner
      if (isRecord(inner) && typeof inner.turn === 'number' && Number.isFinite(inner.turn)) return inner.turn
      return undefined
    }

    /** Whether this turn is still the latest one (unknown fixture -> enabled). */
    function isLatestTurn(snapshot, turn) {
      if (!isRecord(snapshot) || !Number.isFinite(turn)) return true
      try {
        const timeline = snapshot.timeline
        const order = isRecord(timeline) ? timeline.turnOrder : undefined
        if (!Array.isArray(order) || order.length === 0) return true
        return order[order.length - 1] === turn
      } catch (error) {
        return true
      }
    }

    /** The Host's metadata off one tool result root, restricted to `followup`. */
    function metaOfRoot(root) {
      if (!isRecord(root) || root.isError === true) return undefined
      const name = typeof root.name === 'string' ? root.name : ''
      if (name !== '' && name !== TOOL_NAME) return undefined
      return isFollowupMeta(root.meta) ? root.meta : undefined
    }

    function metaOfNode(node) {
      if (!isRecord(node) || node.kind !== 'tool-call' || !isRecord(node.data)) return undefined
      return metaOfRoot(node.data.root)
    }

    /**
     * Find this turn's follow-up metadata. Primary path: the Chat location
     * index; fallback: the public per-turn tool-call source. Both are read
     * defensively because both shapes belong to the Chat composition.
     */
    function findFollowup(snapshot, turn) {
      if (!isRecord(snapshot) || !Number.isFinite(turn)) return undefined
      try {
        const locations = snapshot.locations
        const nodes = snapshot.nodes
        if (isRecord(locations) && typeof locations.getTurn === 'function'
          && isRecord(nodes) && typeof nodes.get === 'function') {
          const keys = locations.getTurn(turn)
          if (Array.isArray(keys)) {
            for (let index = keys.length - 1; index >= 0; index--) {
              const meta = metaOfNode(nodes.get(keys[index]))
              if (meta !== undefined) return meta
            }
          }
        }
      } catch (error) {
        /* fall through to the public source */
      }
      try {
        const nodes = snapshot.nodes
        if (!isRecord(nodes) || typeof nodes.turnDataSource !== 'function') return undefined
        const source = nodes.turnDataSource(turn, 'tool-call')
        const calls = isRecord(source) && typeof source.getSnapshot === 'function' ? source.getSnapshot() : undefined
        if (!Array.isArray(calls)) return undefined
        for (let index = calls.length - 1; index >= 0; index--) {
          const call = calls[index]
          const meta = metaOfRoot(isRecord(call) ? call.root : undefined)
          if (meta !== undefined) return meta
        }
      } catch (error) {
        /* the fallback is optional */
      }
      return undefined
    }

    /* ------------------------------------------------------------------ *
     * Locale and submission channel
     * ------------------------------------------------------------------ */

    function translator(t) {
      return function translate(key, params) {
        let text
        if (typeof t === 'function') {
          try {
            text = t(key, params)
          } catch (error) {
            text = undefined
          }
        }
        if (typeof text !== 'string' || text === key) {
          text = FALLBACK_MESSAGES[key] !== undefined ? FALLBACK_MESSAGES[key] : key
        }
        if (isRecord(params)) {
          for (const name of Object.keys(params)) {
            text = text.split('{' + name + '}').join(String(params[name]))
          }
        }
        return text
      }
    }

    function errorMessage(reason) {
      if (reason === undefined || reason === null) return 'unknown error'
      if (typeof reason === 'string') return reason
      if (typeof reason.message === 'string' && reason.message !== '') return reason.message
      return String(reason)
    }

    /** Resolve the session-scoped conversation service used for one send. */
    function conversationOf(ctx, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('dsh-hook-followup: no session id in scope')
      }
      const sessions = ctx === undefined || ctx === null ? undefined : ctx.sessions
      const scoped = sessions !== undefined && sessions !== null && typeof sessions.scope === 'function'
        ? sessions.scope(sessionId)
        : undefined
      const conversation = scoped !== undefined && scoped !== null && typeof scoped.get === 'function'
        ? scoped.get('conversation')
        : undefined
      if (conversation === undefined || conversation === null || typeof conversation.send !== 'function') {
        throw new Error('dsh-hook-followup: conversation service unavailable in this composition')
      }
      return conversation
    }

    /** The `inject` factory handed to the turnTail registration. */
    function submitter(ctx) {
      return (sessionId) => ({
        submit: (text) => conversationOf(ctx, sessionId).send(text),
      })
    }

    function useAbsentChat(selector) {
      return React.useMemo(() => selector(undefined), [selector])
    }

    /* ------------------------------------------------------------------ *
     * Turn tail: hook sentence + clickable quick replies
     * ------------------------------------------------------------------ */

    function FollowupTail(props) {
      const { turn, submit, useChat, t } = props
      const useChatHook = typeof useChat === 'function' ? useChat : useAbsentChat
      const turnNumber = turnNumberOf(turn)
      const meta = useChatHook((snapshot) => findFollowup(snapshot, turnNumber))
      const latest = useChatHook((snapshot) => isLatestTurn(snapshot, turnNumber))
      const [sending, setSending] = React.useState(false)
      const [sent, setSent] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const tr = translator(t)
      if (!isFollowupMeta(meta)) return null
      const replies = meta.replies
      const disabled = sending === true || sent !== null || latest === false

      function choose(reply) {
        if (disabled) return
        if (typeof submit !== 'function') {
          setFailure(tr('followup.noChannel'))
          return
        }
        setSending(true)
        setFailure(null)
        Promise.resolve()
          .then(() => submit(reply))
          .then(() => {
            setSending(false)
            setSent(reply)
          })
          .catch((error) => {
            setSending(false)
            setFailure(errorMessage(error))
          })
      }

      return h('div', {
        className: 'dsh-hf-root',
        'data-hook-followup': '',
        role: 'group',
        'aria-label': tr('followup.group'),
      },
        h('style', { key: 'style' }, CSS),
        meta.hook === '' ? null : h('div', { className: 'dsh-hf-hook', key: 'hook' },
          h('span', { className: 'dsh-hf-mark', 'aria-hidden': 'true' }, '↳'),
          h('span', { className: 'dsh-hf-hook-text' }, meta.hook)),
        h('div', { className: 'dsh-hf-replies', key: 'replies' },
          replies.map((reply, index) => h('button', {
            key: 'reply-' + index,
            type: 'button',
            className: 'dsh-hf-chip',
            disabled,
            title: reply,
            'data-sent': sent === reply ? '' : undefined,
            onClick: () => choose(reply),
          }, reply))),
        sent === null ? null : h('div', { className: 'dsh-hf-status', key: 'status', role: 'status' }, tr('followup.sent')),
        failure === null ? null : h('div', { className: 'dsh-hf-error', key: 'error', role: 'alert' }, tr('followup.failed', { message: failure })))
    }

    /**
     * Keyed toolview body. The tool call only says the turn carried quick
     * replies; the clickable copy lives in the turn tail, and the tool row
     * renders no controls and holds no state.
     */
    function FollowupSummary(props) {
      const { block, t } = props
      const tr = translator(t)
      let text = tr('followup.unavailable')
      if (isRecord(block) && isFollowupMeta(block.meta)) {
        text = tr('followup.summary', { count: block.meta.replies.length })
      } else if (isRecord(block) && (block.phase === 'preparing' || block.phase === 'start')) {
        text = tr('followup.preparing')
      }
      return h('div', { className: 'dsh-hf-summary' }, h('style', null, CSS), text)
    }

    /* ------------------------------------------------------------------ *
     * Plugin settings page: plugins.row.config
     *
     * The plugin manager opens a row's page only when a `plugins.row.config`
     * entry names that row. The page host passes the live settings form as
     * { state, mutate }; state.value is the effective config, state.revision
     * the write fence. We edit a local draft and write only on save.
     * ------------------------------------------------------------------ */

    const CONFIG_FIELDS = ['enabled', 'strategy', 'max_replies', 'render_mode', 'language', 'skip_on_refusal', 'skip_on_emotional']
    const CONFIG_DEFAULTS = {
      enabled: true,
      strategy: 'always',
      max_replies: 3,
      render_mode: 'ui',
      language: 'follow_user',
      skip_on_refusal: true,
      skip_on_emotional: true,
    }

    /** Effective values of one settings form, defaults filled in. */
    function configValueOf(form) {
      const state = isRecord(form) ? form.state : undefined
      const value = isRecord(state) && isRecord(state.value) ? state.value : {}
      const merged = {}
      for (const field of CONFIG_FIELDS) {
        merged[field] = value[field] === undefined ? CONFIG_DEFAULTS[field] : value[field]
      }
      return merged
    }

    /** Field edits between a draft and the current effective values. */
    function configOps(draft, current) {
      const ops = []
      for (const field of CONFIG_FIELDS) {
        const next = isRecord(draft) ? draft[field] : undefined
        const previous = isRecord(current) ? current[field] : undefined
        if (next === previous) continue
        if (next === undefined) ops.push({ op: 'unset', path: [field] })
        else ops.push({ op: 'set', path: [field], value: next })
      }
      return ops
    }

    function RowConfigSummary(props) {
      const tr = translator(props.t)
      const value = configValueOf(props.form)
      return h('span', null, tr('form.summary', {
        strategy: tr('form.strategy.' + value.strategy),
        count: String(value.max_replies),
      }))
    }

    function RowConfigPage(props) {
      const { t, form } = props
      const tr = translator(t)
      const state = isRecord(form) ? form.state : undefined
      const ready = isRecord(state) && state.status === 'ready' && isRecord(state.value)
      const writable = ready && state.writable !== false
      const revision = ready ? state.revision : undefined
      const [draft, setDraft] = React.useState(() => configValueOf(form))
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const revisionRef = React.useRef(revision)
      React.useEffect(() => {
        if (!ready || revisionRef.current === revision) return
        revisionRef.current = revision
        setDraft(configValueOf(form))
        setStatus(null)
      }, [ready, revision, form])
      if (!ready) {
        const loading = isRecord(state) && (state.status === 'loading' || state.status === undefined)
        return h('div', { className: 'dsh-hf-form' },
          h('style', null, CSS),
          h('div', { className: 'dsh-hf-form-note' }, tr(loading ? 'form.loading' : 'form.noForm')))
      }
      const set = (field, value) => setDraft((previous) => {
        const next = {}
        for (const name of CONFIG_FIELDS) next[name] = previous[name]
        next[field] = value
        return next
      })
      const settle = (promise) => {
        setBusy(true)
        setStatus(null)
        Promise.resolve(promise)
          .then((ok) => {
            setBusy(false)
            setStatus(ok === false ? 'failed' : 'saved')
          })
          .catch(() => {
            setBusy(false)
            setStatus('failed')
          })
      }
      const save = () => {
        const ops = configOps(draft, configValueOf(form))
        if (ops.length === 0) {
          setStatus('unchanged')
          return
        }
        settle(form.mutate(ops, revision))
      }
      const reset = () => {
        const ops = CONFIG_FIELDS.map((field) => ({ op: 'unset', path: [field] }))
        settle(form.mutate(ops, revision))
      }
      const switchRow = (field, labelKey, hintKey) => h('div', { className: 'dsh-hf-field', key: field },
        h('div', { className: 'dsh-hf-field-head' },
          h('span', { className: 'dsh-hf-field-label' }, tr(labelKey)),
          h('input', {
            type: 'checkbox',
            className: 'dsh-hf-check',
            checked: draft[field] === true,
            disabled: !writable || busy,
            onChange: (event) => set(field, event.target.checked),
          })),
        h('div', { className: 'dsh-hf-field-hint' }, tr(hintKey)))
      const selectRow = (field, labelKey, hintKey, prefix, options) => h('div', { className: 'dsh-hf-field', key: field },
        h('div', { className: 'dsh-hf-field-head' },
          h('span', { className: 'dsh-hf-field-label' }, tr(labelKey)),
          h('select', {
            className: 'dsh-hf-select',
            value: String(draft[field]),
            disabled: !writable || busy,
            onChange: (event) => set(field, event.target.value),
          }, options.map((option) => h('option', { key: option, value: option }, tr('form.' + prefix + '.' + option))))),
        h('div', { className: 'dsh-hf-field-hint' }, tr(hintKey)))
      const numberRow = h('div', { className: 'dsh-hf-field', key: 'max_replies' },
        h('div', { className: 'dsh-hf-field-head' },
          h('span', { className: 'dsh-hf-field-label' }, tr('form.maxReplies')),
          h('input', {
            type: 'number',
            className: 'dsh-hf-number',
            min: 1,
            max: 3,
            step: 1,
            value: String(draft.max_replies),
            disabled: !writable || busy,
            onChange: (event) => {
              const parsed = Number(event.target.value)
              set('max_replies', Number.isFinite(parsed) ? Math.min(3, Math.max(1, Math.round(parsed))) : CONFIG_DEFAULTS.max_replies)
            },
          })),
        h('div', { className: 'dsh-hf-field-hint' }, tr('form.maxRepliesHint')))
      return h('section', { className: 'dsh-hf-form' },
        h('style', null, CSS),
        h('h3', { className: 'dsh-hf-form-title' }, tr('form.title')),
        h('p', { className: 'dsh-hf-form-desc' }, tr('form.desc')),
        switchRow('enabled', 'form.enabled', 'form.enabledHint'),
        selectRow('strategy', 'form.strategy', 'form.strategyHint', 'strategy', ['always', 'balanced', 'conservative']),
        switchRow('skip_on_refusal', 'form.refusal', 'form.refusalHint'),
        switchRow('skip_on_emotional', 'form.emotional', 'form.emotionalHint'),
        numberRow,
        selectRow('render_mode', 'form.renderMode', 'form.renderModeHint', 'renderMode', ['ui', 'markdown', 'tag']),
        selectRow('language', 'form.language', 'form.languageHint', 'language', ['follow_user', 'zh', 'en']),
        h('div', { className: 'dsh-hf-form-foot' },
          h('button', { type: 'button', className: 'dsh-hf-save', disabled: !writable || busy, onClick: save }, tr(busy ? 'form.saving' : 'form.save')),
          h('button', { type: 'button', className: 'dsh-hf-reset', disabled: !writable || busy, onClick: reset }, tr('form.reset')),
          status === null ? null : h('span', {
            className: 'dsh-hf-form-status',
            'data-tone': status === 'failed' ? 'error' : undefined,
            role: 'status',
          }, tr('form.' + status))),
        writable ? null : h('p', { className: 'dsh-hf-form-desc' }, tr('form.notWritable')))
    }

    function RowConfigView(props) {
      return props.view === 'summary' ? h(RowConfigSummary, props) : h(RowConfigPage, props)
    }

    /* ------------------------------------------------------------------ *
     * Plugin entry
     * ------------------------------------------------------------------ */

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: MESSAGES.zh, en: MESSAGES.en }), 'dsh-hook-followup: locale')
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: TOOL_NAME,
        locale: NS,
      }, FollowupSummary))
      // Optional surface: a composition without the standard transcript
      // declares no turnTail seat. The summary still reports the result, but
      // there is no clickable copy.
      try {
        const inject = submitter(ctx)
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'hook-followup',
          // Turn tail is the last seat. Intelligent UI cards use order 40,
          // and other answer content sits above that, so a high fixed order
          // keeps the Hook below every piece of answer content.
          order: 1000,
          locale: NS,
          inject,
        }, FollowupTail))
      } catch (error) {
        if (ctx.logger !== undefined && typeof ctx.logger.warn === 'function') {
          ctx.logger.warn('dsh-hook-followup: turnTail unavailable', error)
        }
      }
      // Plugin manager row page: without this registration the row gets no
      // configure control, so the switches would exist in Config but be
      // unreachable from the UI.
      try {
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: '@an-an-618/dsh-hook-followup#hook-followup',
          locale: NS,
        }, RowConfigView))
      } catch (error) {
        if (ctx.logger !== undefined && typeof ctx.logger.warn === 'function') {
          ctx.logger.warn('dsh-hook-followup: row config page unavailable', error)
        }
      }
    }

    return {
      inject: ['slots', 'sessions', 'locale'],
      apply,
      // Pure helpers and component entry points, exercised by test/client.test.mjs
      // in a DOM-free VM without mounting React.
      __test: {
        NS,
        TOOL_NAME,
        MESSAGES,
        CSS,
        isFollowupMeta,
        turnNumberOf,
        isLatestTurn,
        findFollowup,
        conversationOf,
        submitter,
        CONFIG_FIELDS,
        CONFIG_DEFAULTS,
        configValueOf,
        configOps,
        components: { FollowupTail, FollowupSummary, RowConfigView, RowConfigPage, RowConfigSummary },
      },
    }
  },
})
