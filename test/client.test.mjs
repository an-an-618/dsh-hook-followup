/**
 * Client-half tests for @an-an-618/dsh-hook-followup.
 *
 * Zero dependencies and no DOM: client.js is loaded into a Node vm whose only
 * global is a fake window.__ModuleLoader__, require('react') returns a minimal
 * React stand-in, and the slot/session context is a small recorder. The
 * component is rendered by a ~40-line hook runtime, so we can exercise the
 * chips, the click path into conversation.send, and the disabled states without
 * mounting React.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const CLIENT_SOURCE = readFileSync(CLIENT_PATH, 'utf8')

/* ------------------------------------------------------------------ *
 * Loader and minimal React
 * ------------------------------------------------------------------ */

function createFakeReact() {
  return {
    createElement(type, props, ...children) {
      const merged = props === null || props === undefined ? {} : Object.assign({}, props)
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
  }
}

/** Cursor-based hook runtime: state cells survive rerenders, cursor resets. */
function createHookRuntime(React) {
  let cells = []
  let cursor = 0
  React.useState = (initial) => {
    const index = cursor
    cursor += 1
    if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial
    const setter = (next) => {
      cells[index] = typeof next === 'function' ? next(cells[index]) : next
    }
    return [cells[index], setter]
  }
  React.useMemo = (factory) => {
    cursor += 1
    return factory()
  }
  React.useRef = (initial) => ({ current: initial })
  React.useEffect = () => {}
  return {
    reset() {
      cells = []
      cursor = 0
    },
    render(component, props) {
      cursor = 0
      return component(props)
    },
  }
}

function loadClient() {
  let definition
  const window = {
    __ModuleLoader__: {
      load(candidate) {
        definition = candidate
      },
    },
  }
  const context = vm.createContext({ window, console, Promise, Object, Array, String, Number, Error })
  new vm.Script(CLIENT_SOURCE, { filename: CLIENT_PATH }).runInContext(context)
  assert.ok(definition, 'client.js must call window.__ModuleLoader__.load')
  const React = createFakeReact()
  const module = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require(' + JSON.stringify(name) + ')')
  })
  return { definition, module, React }
}

/* ------------------------------------------------------------------ *
 * Tree helpers
 * ------------------------------------------------------------------ */

function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  if (node.props !== undefined) walk(node.props.children, visit)
}

function findAll(tree, predicate) {
  const found = []
  walk(tree, (node) => {
    if (predicate(node)) found.push(node)
  })
  return found
}

function textContent(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (typeof node === 'object' && node.props !== undefined) return textContent(node.props.children)
  return ''
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const META = {
  v: 1,
  kind: 'followup',
  hook: '这三种里，你更想先试哪一种？',
  replies: [
    '先从走路开始',
    '在家练自重的话怎么安排？',
    '我体能很差，爬三楼就喘，这种情况先做什么比较稳',
  ],
}

function snapshotWith(meta, turnOrder) {
  const nodes = new Map()
  let keys = []
  if (meta !== undefined) {
    nodes.set('node-1', { kind: 'tool-call', data: { root: { name: 'followup', meta } } })
    keys = ['node-1']
  }
  return {
    nodes,
    locations: {
      getTurn(turn) {
        return turn === 1 ? keys : []
      },
    },
    timeline: { turnOrder: turnOrder === undefined ? [1] : turnOrder },
  }
}

function fakeCtx(options) {
  const settings = options === undefined ? {} : options
  const registrations = []
  const injections = []
  const localeRegistrations = []
  const warns = []
  const sent = []
  const ctx = {
    effect(callback) {
      callback()
      return () => {}
    },
    logger: {
      warn(...args) {
        warns.push(args)
      },
    },
    locale: {
      register(namespace, messages) {
        localeRegistrations.push({ namespace, messages })
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
    slots: {
      inject(name, callback) {
        injections.push(name)
        if (settings.failTurnTail === true && name === 'conversation.chat.turnTail') {
          throw new Error('slot unavailable: ' + name)
        }
        callback()
        return () => {}
      },
      register(definition, component) {
        registrations.push({ definition, component })
        return () => {}
      },
    },
    sessions: {
      scope(sessionId) {
        return {
          get(name) {
            return {
              send(text) {
                sent.push({ sessionId, name, text })
                return Promise.resolve({ ok: true })
              },
            }
          },
        }
      },
    },
  }
  return { ctx, registrations, injections, localeRegistrations, warns, sent }
}

const loaded = loadClient()
const definition = loaded.definition
const plugin = loaded.module
const helper = plugin.__test

/* ------------------------------------------------------------------ *
 * 1. Registration
 * ------------------------------------------------------------------ */

test('client module identity and injected services', () => {
  assert.equal(definition.id, '@an-an-618/dsh-hook-followup')
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'sessions', 'locale'])
})

test('apply registers the locale, the keyed toolview and the turn tail', () => {
  const world = fakeCtx()
  plugin.apply(world.ctx)
  assert.deepEqual(world.injections, ['tool.call.toolview', 'conversation.chat.turnTail', 'plugins.row.config'])
  assert.equal(world.localeRegistrations.length, 1)
  assert.equal(world.localeRegistrations[0].namespace, 'dsh-hook-followup')
  assert.ok(world.localeRegistrations[0].messages.zh['followup.group'])
  assert.ok(world.localeRegistrations[0].messages.en['followup.group'])

  const toolview = world.registrations[0]
  assert.equal(toolview.definition.name, 'tool.call.toolview')
  assert.equal(toolview.definition.key, 'followup')
  assert.equal(toolview.definition.locale, 'dsh-hook-followup')

  const tail = world.registrations[1]
  assert.equal(tail.definition.name, 'conversation.chat.turnTail')
  assert.equal(tail.definition.id, 'hook-followup')
  assert.equal(tail.definition.order, 30)
  assert.equal(typeof tail.definition.inject, 'function')

  const rowConfig = world.registrations[2]
  assert.equal(rowConfig.definition.name, 'plugins.row.config')
  assert.equal(rowConfig.definition.key, '@an-an-618/dsh-hook-followup#hook-followup')
  assert.equal(rowConfig.definition.locale, 'dsh-hook-followup')
  assert.equal(typeof rowConfig.component, 'function')
  const channel = tail.definition.inject('session-1')
  assert.equal(typeof channel.submit, 'function')
  return Promise.resolve(channel.submit('先从走路开始')).then(() => {
    assert.deepEqual(world.sent, [{ sessionId: 'session-1', name: 'conversation', text: '先从走路开始' }])
  })
})

test('apply survives a composition without the turnTail seat', () => {
  const world = fakeCtx({ failTurnTail: true })
  assert.doesNotThrow(() => plugin.apply(world.ctx))
  assert.equal(world.registrations.length, 2)
  assert.equal(world.warns.length, 1)
})

/* ------------------------------------------------------------------ *
 * 2. Snapshot readers
 * ------------------------------------------------------------------ */

test('findFollowup reads the location index and ignores other turns', () => {
  const snapshot = snapshotWith(META)
  assert.deepEqual(JSON.parse(JSON.stringify(helper.findFollowup(snapshot, 1))), META)
  assert.equal(helper.findFollowup(snapshot, 2), undefined)
  assert.equal(helper.findFollowup(undefined, 1), undefined)
  assert.equal(helper.findFollowup(snapshot, undefined), undefined)
})

test('findFollowup rejects a different tool, a different kind and an error result', () => {
  const cases = [
    { name: 'other_tool', meta: META },
    { name: 'followup', meta: { v: 1, kind: 'other', hook: '', replies: ['a'] } },
    { name: 'followup', meta: { v: 2, kind: 'followup', hook: '', replies: ['a'] } },
    { name: 'followup', meta: { v: 1, kind: 'followup', hook: '', replies: [] } },
  ]
  for (const root of cases) {
    const snapshot = {
      nodes: new Map([['node-1', { kind: 'tool-call', data: { root } }]]),
      locations: { getTurn: () => ['node-1'] },
      timeline: { turnOrder: [1] },
    }
    assert.equal(helper.findFollowup(snapshot, 1), undefined)
  }
  const errored = {
    nodes: new Map([['node-1', { kind: 'tool-call', data: { root: { name: 'followup', isError: true, meta: META } } }]]),
    locations: { getTurn: () => ['node-1'] },
    timeline: { turnOrder: [1] },
  }
  assert.equal(helper.findFollowup(errored, 1), undefined)
})

test('findFollowup falls back to the public per-turn tool-call source', () => {
  const snapshot = {
    nodes: {
      turnDataSource(turn, kind) {
        if (turn !== 1 || kind !== 'tool-call') return undefined
        return { getSnapshot: () => [{ root: { name: 'followup', meta: META } }] }
      },
    },
    timeline: { turnOrder: [1] },
  }
  assert.deepEqual(JSON.parse(JSON.stringify(helper.findFollowup(snapshot, 1))), META)
})

test('turnNumberOf and isLatestTurn normalize the turn prop', () => {
  assert.equal(helper.turnNumberOf(3), 3)
  assert.equal(helper.turnNumberOf({ turn: 4 }), 4)
  assert.equal(helper.turnNumberOf({ turn: { turn: 5 } }), 5)
  assert.equal(helper.turnNumberOf('3'), undefined)
  assert.equal(helper.turnNumberOf(undefined), undefined)
  assert.equal(helper.isLatestTurn(snapshotWith(META, [1]), 1), true)
  assert.equal(helper.isLatestTurn(snapshotWith(META, [1, 2]), 1), false)
  assert.equal(helper.isLatestTurn(snapshotWith(META, [1, 2]), 2), true)
  assert.equal(helper.isLatestTurn({}, 1), true)
})

/* ------------------------------------------------------------------ *
 * 3. Turn-tail component
 * ------------------------------------------------------------------ */

const runtime = createHookRuntime(loaded.React)

function renderTail(props) {
  return runtime.render(helper.components.FollowupTail, Object.assign({
    turn: 1,
    useChat: (selector) => selector(snapshotWith(META)),
    t: (key) => key,
  }, props))
}

test('chips stack vertically and look like a neutral secondary button', () => {
  assert.ok(helper.CSS.includes('.dsh-hf-replies{display:flex;flex-direction:column;align-items:flex-start'))
  assert.ok(helper.CSS.includes('background:var(--dsw-alias-bg-layer-2'))
  assert.ok(helper.CSS.includes('color:var(--dsw-alias-label-primary'))
  assert.ok(helper.CSS.includes('.dsh-hf-chip{appearance:none;box-sizing:border-box;max-width:100%;padding:7px 14px;border:0.5px solid var(--dsw-alias-border-l2'))
})

test('turn tail renders the hook and one chip per quick reply', () => {
  runtime.reset()
  const tree = renderTail({ submit: () => Promise.resolve() })
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.length, 3)
  assert.deepEqual(buttons.map((button) => textContent(button)), META.replies)
  assert.ok(textContent(tree).includes(META.hook))
  assert.ok(textContent(tree).includes('↳'))
  assert.equal(buttons[0].props.type, 'button')
})

test('clicking a chip sends exactly that sentence and locks the row', async () => {
  runtime.reset()
  const sent = []
  const props = {
    submit: (text) => {
      sent.push(text)
      return Promise.resolve()
    },
  }
  const tree = renderTail(props)
  const first = findAll(tree, (node) => node.type === 'button')[0]
  assert.equal(first.props.onClick(), undefined)
  await tick()
  assert.deepEqual(sent, [META.replies[0]])

  const next = renderTail(props)
  const buttons = findAll(next, (node) => node.type === 'button')
  assert.equal(buttons.every((button) => button.props.disabled === true), true)
  assert.ok(textContent(next).includes('已发送'))
})

test('older turns and missing metadata render conservatively', () => {
  runtime.reset()
  const oldSnapshot = snapshotWith(META, [1, 2])
  const tree = runtime.render(helper.components.FollowupTail, {
    turn: 1,
    useChat: (selector) => selector(oldSnapshot),
    submit: () => {
      throw new Error('must not send')
    },
    t: (key) => key,
  })
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.every((button) => button.props.disabled === true), true)

  const empty = runtime.render(helper.components.FollowupTail, {
    turn: 1,
    useChat: (selector) => selector(snapshotWith(undefined)),
    submit: () => Promise.resolve(),
    t: (key) => key,
  })
  assert.equal(empty, null)
})

test('a failed send surfaces the error and unlocks the row', async () => {
  runtime.reset()
  const tree = renderTail({
    submit: () => Promise.reject(new Error('boom')),
  })
  findAll(tree, (node) => node.type === 'button')[0].props.onClick()
  await tick()
  const next = renderTail({
    submit: () => Promise.reject(new Error('boom')),
  })
  assert.ok(textContent(next).includes('boom'))
  const buttons = findAll(next, (node) => node.type === 'button')
  assert.equal(buttons.every((button) => button.props.disabled === false), true)
})

test('a missing hook renders chips only', () => {
  runtime.reset()
  const meta = { v: 1, kind: 'followup', hook: '', replies: ['甲', '乙'] }
  const tree = runtime.render(helper.components.FollowupTail, {
    turn: 1,
    useChat: (selector) => selector(snapshotWith(meta)),
    submit: () => Promise.resolve(),
    t: (key) => key,
  })
  assert.equal(textContent(tree).includes('↳'), false)
  assert.equal(findAll(tree, (node) => node.type === 'button').length, 2)
})

/* ------------------------------------------------------------------ *
 * 4. Tool-row summary
 * ------------------------------------------------------------------ */

test('tool-row summary reports the count, then degrades per phase', () => {
  const summary = helper.components.FollowupSummary
  const ready = summary({ block: { kind: 'tool-result', meta: META }, t: (key) => key })
  assert.ok(textContent(ready).includes('已附加 3 条快捷回复'))
  const preparing = summary({ block: { phase: 'preparing', name: 'followup' }, t: (key) => key })
  assert.ok(textContent(preparing).includes('正在准备快捷回复…'))
  const failed = summary({ block: { kind: 'tool-result', isError: true }, t: (key) => key })
  assert.ok(textContent(failed).includes('没有可用的快捷回复'))
})

/* ------------------------------------------------------------------ *
 * 5. Plugin settings page
 * ------------------------------------------------------------------ */

test('configValueOf fills defaults and configOps reports real edits only', () => {
  const read = { enabled: false, max_replies: 2 }
  const value = helper.configValueOf({ state: { value: read } })
  assert.deepEqual(JSON.parse(JSON.stringify(value)), {
    enabled: false,
    strategy: 'always',
    max_replies: 2,
    render_mode: 'ui',
    language: 'follow_user',
    skip_on_refusal: true,
    skip_on_emotional: true,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(helper.configOps({ ...value, strategy: 'balanced' }, value))), [
    { op: 'set', path: ['strategy'], value: 'balanced' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(helper.configOps({ ...value, skip_on_emotional: undefined }, value))), [
    { op: 'unset', path: ['skip_on_emotional'] },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(helper.configOps(value, value))), [])
})

test('the row config page edits a draft, saves only on click and resets defaults', async () => {
  const calls = []
  const form = {
    state: {
      status: 'ready',
      writable: true,
      revision: 7,
      value: { enabled: true, strategy: 'always', max_replies: 3, render_mode: 'ui', language: 'follow_user', skip_on_refusal: true, skip_on_emotional: true },
    },
    mutate(ops, revision) {
      calls.push({ ops, revision })
      return Promise.resolve(true)
    },
  }
  const runtime = createHookRuntime(loaded.React)
  runtime.reset()
  const render = () => runtime.render(helper.components.RowConfigPage, { form, t: (key) => key })
  let tree = render()
  const select = findAll(tree, (node) => node.type === 'select')[0]
  assert.equal(select.props.value, 'always')
  select.props.onChange({ target: { value: 'balanced' } })
  tree = render()
  const save = findAll(tree, (node) => node.type === 'button')[0]
  save.props.onClick()
  await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { ops: [{ op: 'set', path: ['strategy'], value: 'balanced' }], revision: 7 })
  runtime.reset()
  tree = runtime.render(helper.components.RowConfigPage, { form, t: (key) => key })
  const reset = findAll(tree, (node) => node.type === 'button')[1]
  reset.props.onClick()
  await tick()
  assert.equal(calls[1].ops.length, 7)
  assert.equal(calls[1].ops.every((op) => op.op === 'unset'), true)
})

test('the row config page reports a missing form instead of crashing', () => {
  const runtime = createHookRuntime(loaded.React)
  runtime.reset()
  const tree = runtime.render(helper.components.RowConfigPage, { form: undefined, t: (key) => key })
  assert.ok(textContent(tree).includes('还没有提供'))
})

/* ------------------------------------------------------------------ *
 * 5. Submission channel
 * ------------------------------------------------------------------ */

test('conversationOf resolves the session-scoped conversation service', async () => {
  const world = fakeCtx()
  const conversation = helper.conversationOf(world.ctx, 'session-9')
  await conversation.send('hi')
  assert.deepEqual(world.sent, [{ sessionId: 'session-9', name: 'conversation', text: 'hi' }])
  assert.throws(() => helper.conversationOf(world.ctx, ''), /no session id/)
  assert.throws(() => helper.conversationOf(undefined, 'session-9'), /unavailable/)
})
