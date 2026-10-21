/**
 * Hook Follow-up — Host half.
 *
 * Registers one model-facing tool (`followup`) that carries the Hook question
 * and 1-3 quick replies. The compiled content is persisted through
 * `output.presentationMeta`, so the Client can render clickable chips from the
 * session log without parsing assistant Markdown and without inventing a new
 * event type.
 *
 * Ordering matters: the model calls this tool BEFORE writing the answer and
 * writes the answer after the tool result. A tool call placed after the answer
 * would put the answer in a tool-calling step, and the chat's Turn Process
 * folding classifies exactly those steps as process (`latestAnswer()` rejects a
 * final step that contains any tool-call block), hiding the answer behind a
 * collapsed "process" row.
 *
 * Strategy and skip switches live in `Config` and are `volatile()`: the plugin
 * settings form derives its fields from that schema, and the running plugin
 * reads the live values when it assembles the prompt section, so changing a
 * switch applies to the next turn without restarting the Host.
 *
 * `@deepseek-ai/schemastery` cannot be imported as a bare specifier from a
 * profile-linked package (Node resolves the workspace realpath), so the schema
 * library is resolved at runtime from the profile or the installed dsh; when no
 * copy is reachable the plugin simply has no `Config` and keeps its row defaults.
 *
 * No dynamic code and no I/O beyond locating that library.
 *
 * @module @an-an-618/dsh-hook-followup
 */

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { FollowupError, META_KIND, buildMeta, normalizeFollowup } from './lib/meta.js'
import {
  SECTION_NAME,
  SECTION_ORDER,
  buildPromptSection,
  buildReceipt,
  normalizeConfig,
  toolDescription,
} from './lib/prompt.js'

export const name = 'hook-followup'

/** Services required by the Host half (resolved by name, no package imports). */
export const inject = ['tools', 'systemPrompt']

/** Wire tool name; also the `tool.call.toolview` key the Client registers. */
export const TOOL_NAME = 'followup'

/** Metadata version understood by client.js. */
export { META_KIND }

/**
 * Resolve schemastery from the running installation. A linked package lives in
 * the workspace, so a bare import would resolve against the workspace and fail;
 * the installed dsh and the profile both ship the package.
 * @returns {Promise<object | undefined>} the `z` schema factory, or undefined.
 */
async function loadSchemastery() {
  const roots = []
  for (const arg of process.argv.slice(1)) {
    if (typeof arg !== 'string' || arg === '') continue
    if (arg.endsWith('/app.asar/dsh') || arg.includes('/.dsh/profiles/')) roots.push(arg)
  }
  if (typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR !== '') {
    roots.push(process.env.DSH_PROFILE_DIR)
  }
  const profilesDir = join(homedir(), '.dsh', 'profiles')
  if (existsSync(profilesDir)) {
    try {
      for (const name of readdirSync(profilesDir)) roots.push(join(profilesDir, name))
    } catch (error) {
      /* the fallback is optional */
    }
  }
  for (const root of roots) {
    const file = join(root, 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.mjs')
    try {
      if (!existsSync(file)) continue
      const module = await import(pathToFileURL(file).href)
      if (module !== undefined && module.default !== undefined) return module.default
    } catch (error) {
      /* try the next candidate */
    }
  }
  try {
    const module = await import('@deepseek-ai/schemastery')
    return module !== undefined && module.default !== undefined ? module.default : undefined
  } catch (error) {
    return undefined
  }
}

const z = await loadSchemastery()

/**
 * Live plugin settings. Every field is `volatile()`: the settings form commits
 * a value into the running config, and each read picks up the new value.
 */
export const Config = z === undefined ? undefined : z.object({
  enabled: z.boolean().description('总开关：关闭后系统提示不再注入追问规则，followup 调用会被拒绝').default(true).volatile(),
  strategy: z.union(['always', 'balanced', 'conservative'])
    .description('追问策略：always = 应出尽出；balanced = 平衡（额外省略严格格式与连续未点击）；conservative = 克制（再额外省略待工具的轮次）')
    .default('always')
    .volatile(),
  max_replies: z.number().step(1).min(1).max(3).description('每轮快捷回复上限（1–3）').default(3).volatile(),
  render_mode: z.union(['ui', 'markdown', 'tag'])
    .description('ui = 调用 followup 并渲染胶囊；markdown / tag = 纯提示词降级（不调用工具）')
    .default('ui')
    .volatile(),
  language: z.union(['follow_user', 'zh', 'en'])
    .description('follow_user = 追问内容跟随用户语言；zh / en 同时固定规则文本语言')
    .default('follow_user')
    .volatile(),
  skip_on_refusal: z.boolean().description('本轮是拒绝回答时，是否整块省略').default(true).volatile(),
  skip_on_emotional: z.boolean().description('用户处于情绪危机、哀伤、自伤风险时，是否整块省略').default(true).volatile(),
})

/** Arguments accepted by the `followup` tool. */
export const PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['replies'],
  properties: {
    hook: { type: 'string' },
    replies: { type: 'array', items: { type: 'string' } },
  },
})

/** Model-visible receipt returned by one successful call. */
export const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'kind', 'count', 'receipt'],
  properties: {
    ok: { type: 'boolean' },
    kind: { type: 'string' },
    count: { type: 'integer' },
    receipt: { type: 'string' },
  },
})

/** Plain-object test that also rejects arrays. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one config field, following the live reference `volatile()` produces.
 * Plain values are accepted too, which keeps tests and the bundle row simple.
 */
function liveValue(field, fallback) {
  if (field === undefined || field === null) return fallback
  if (typeof field === 'object' && typeof field.get === 'function') {
    const current = field.get()
    return current === undefined ? fallback : current
  }
  return field
}

/**
 * Snapshot the live row configuration into the normalized settings shape.
 * @param {unknown} config
 * @returns {ReturnType<typeof normalizeConfig>}
 */
export function readSettings(config) {
  const source = isRecord(config) ? config : {}
  return normalizeConfig({
    enabled: liveValue(source.enabled, true),
    strategy: liveValue(source.strategy, 'always'),
    max_replies: liveValue(source.max_replies, 3),
    render_mode: liveValue(source.render_mode, 'ui'),
    language: liveValue(source.language, 'follow_user'),
    skip_on_refusal: liveValue(source.skip_on_refusal, true),
    skip_on_emotional: liveValue(source.skip_on_emotional, true),
  })
}

/**
 * Build one registry-ready tool definition.
 * @param {ReturnType<typeof normalizeConfig> | (() => ReturnType<typeof normalizeConfig>)} settingsOrProvider
 */
export function defineFollowupTool(settingsOrProvider) {
  const read = typeof settingsOrProvider === 'function' ? settingsOrProvider : () => settingsOrProvider
  const initial = read()
  return {
    name: TOOL_NAME,
    description: toolDescription(initial.promptLanguage, initial.maxReplies),
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: value.receipt }]
      },
      presentationMeta(args) {
        // Persisted in the session log and read back by client.js as block.meta.
        return buildMeta(args, read().maxReplies)
      },
    },
    async execute(args) {
      const settings = read()
      if (!settings.enabled) {
        throw new FollowupError('hook-followup is disabled in the plugin settings')
      }
      if (settings.renderMode !== 'ui') {
        throw new FollowupError('followup is only available when render_mode is ui')
      }
      const normalized = normalizeFollowup(args, settings.maxReplies)
      // No concludeTurn: the answer is written after this tool result, and a
      // turn-closing tool-call step would make the chat treat that answer as
      // process. See the module comment.
      return {
        ok: true,
        kind: META_KIND,
        count: normalized.replies.length,
        receipt: buildReceipt(normalized, settings.promptLanguage),
      }
    },
  }
}

/**
 * Register the tool (ui mode) and the prompt section, unless disabled.
 * @param {object} ctx - plugin context with `tools`, `systemPrompt` and `effect`.
 * @param {object} [config]
 */
export function apply(ctx, config = {}) {
  const initial = readSettings(config)
  if (!initial.enabled) return
  if (initial.renderMode === 'ui') {
    // The definition is registered once; its policy is read live on every call.
    ctx.tools.register(defineFollowupTool(() => readSettings(config)))
  }
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    // A function text keeps the strategy switches live: the section is rebuilt
    // for every assembly with the current config values.
    text: () => {
      const settings = readSettings(config)
      return settings.enabled ? buildPromptSection(settings) : ''
    },
  }))
}

export { FollowupError }
