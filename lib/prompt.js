/**
 * Hook Follow-up — model-facing text and row configuration.
 *
 * `buildPromptSection` is the system-prompt section (name `hook-followup`,
 * order 2500). It carries the whole behavioural contract: when to skip, the
 * Hook rules, the quick-reply rules, and the mode-specific output contract.
 * `toolDescription` is the short `followup` tool description. `buildReceipt`
 * is the model-visible tool result.
 *
 * DSH treats system-prompt sections as templates: a double-brace sequence is a
 * variable reference and any other double-brace content fails every turn. This
 * module therefore never emits a double brace (the vocabulary section of the
 * plugin description is rewritten as single-brace ASCII or omitted).
 *
 * No dynamic code and no I/O.
 *
 * @module hook-followup/lib/prompt
 */

import { MAX_HOOK_CHARS, clampMaxReplies, isRecord } from './meta.js'

/** Prompt section identity required by `ctx.systemPrompt.section()`. */
export const SECTION_NAME = 'hook-followup'

/**
 * Section order: after `intelligent-ui` (2400), so the turn-level rule sits
 * close to the end of the assembled prompt.
 */
export const SECTION_ORDER = 2500

/** Accepted `render_mode` values. */
export const RENDER_MODES = ['ui', 'markdown', 'tag']

/** Accepted `language` values. */
export const LANGUAGES = ['follow_user', 'zh', 'en']

/** Follow-up strategies: how aggressive the omission rules are. */
export const STRATEGIES = ['always', 'balanced', 'conservative']

/**
 * Normalize the row config without failing activation.
 * @param {unknown} config - `cordis.patch.yml` row config.
 * @returns {{ enabled: boolean, maxReplies: number, renderMode: string, language: string, promptLanguage: 'zh'|'en' }}
 */
export function normalizeConfig(config) {
  const source = isRecord(config) ? config : {}
  const language = LANGUAGES.indexOf(source.language) === -1 ? 'follow_user' : source.language
  const renderMode = RENDER_MODES.indexOf(source.render_mode) === -1 ? 'ui' : source.render_mode
  const strategy = STRATEGIES.indexOf(source.strategy) === -1 ? 'always' : source.strategy
  return {
    enabled: source.enabled !== false,
    maxReplies: clampMaxReplies(source.max_replies),
    renderMode,
    language,
    // `follow_user` fixes the generated content's language only; the rules are
    // written in Chinese unless the plugin itself is configured for English.
    promptLanguage: language === 'en' ? 'en' : 'zh',
    strategy,
    skipOnRefusal: source.skip_on_refusal !== false,
    skipOnEmotional: source.skip_on_emotional !== false,
    skipOnStrictFormat: strategy !== 'always',
    skipOnUnclickedRounds: strategy !== 'always',
    skipOnPendingTools: strategy === 'conservative',
  }
}

const ZH_RULES = [
  '## 文末 Hook 追问（followup）',
  '',
  '每轮回答默认都要在输出正文之前调用一次 `followup` 工具，提交一句 Hook 追问和 1–{max} 条快捷回复；它们会显示在回答末尾。它们的作用是降低用户下一轮的输入成本，把对话引向对用户更有价值的下一步：衡量标准是用户选中之后，下一轮回答确实更有用，而不是让对话变长。',
  '',
  'Hook 与快捷回复只是附加层：先把正文答完整，不得为了制造 Hook 在正文里保留信息、留悬念或只讲一半，也不改变正文的内容、长度和格式。默认调用，只有下面「省略条件」成立时才整块省略；不要因为追问「不够精彩」而省略，写一个朴素但具体、可回答的问题就够了。',
  '',
  '@@SKIP@@',
  '',
  '### Hook（hook 字段，可留空）',
  '- 只写一句、只问一个问题。必须锚定本轮正文里的具体内容：刚提到的分支、尚未确定的变量，或一个可以落地的下一步。',
  '- 优先两类问题：让用户在几条路径中做选择（“你想先从 A 还是 B 开始？”），或索取一个能显著改善下一轮回答的个人信息（“你一周大概能挤出几天？”）。',
  '- 中文不超过 40 字，英文不超过 25 词，语气自然，像人在对话里顺口一问。',
  '- 禁止：空泛兜底句（“还有什么可以帮你的吗”“需要我进一步说明吗”“希望对你有帮助”）、重复正文已经回答过的问题、夸张或制造焦虑的钩子（“你绝对想不到……”）、一句里塞多个问题。',
  '',
  '### 快捷回复（replies 字段，1–{max} 条）',
  '- 以用户口吻写“下一句想说的话”：第一人称或省略主语，不得出现助手口吻（如“我可以帮你……”）。',
  '- 至少一条直接回答 Hook；其余可以是另一条有价值的路径：深挖一层、转向落地、结合自身情况、或提出合理质疑。',
  '- 每条意图不同，不能是同义改写；单独发出时语义完整，模型无需猜测指代，避免“这个”“上面那个”。',
  '- 按实际有价值的路径数量给：只有一条路径就给一条，有两条就给两条；不要为了凑满三条硬造同质回复。',
  '- 两条以上时长度自然参差、顺序随意：不要每次都按「短→中→长」排列，也不要几条长度一样。像真人顺手打出来的话，不需要凑固定字数区间。',
  '- 口语化，可以带一点情绪或犹豫（“有点没底，先从最简单的来吧”），不要书面腔，不要每条都用同一个句式开头。',
  '- 选中后，模型在下一轮无需用户再补充信息即可给出有价值的回答；如果某条必然需要用户补充信息，就改写成用户主动提供信息的形式（“我每天只有半小时，怎么安排”）。',
  '- 不得与历史中已经出现过的快捷回复重复。',
  '',
  '### 调用方式（先提交，再写正文）',
  '- 先想清楚这一轮的完整正文，再调用 `followup` 提交 hook 与 replies；调用时还不要输出正文。',
  '- 工具结果返回后，立即输出完整正文作为本轮回答。正文里不要重复 Hook 或快捷回复，也不要再调用任何工具。',
  '- 不要在正文之后调用 `followup`：正文会和工具调用落在同一步，被界面折叠进过程区，用户看不到回答。每轮最多调用一次。',
  '- 只有在上面「省略条件」成立时才跳过；写不出精彩的追问不是跳过理由。',
  '- Hook 与快捷回复使用用户当前使用的语言；界面上的固定文案由插件本地化。',
]

const ZH_MARKDOWN = [
  '',
  '### 降级格式（render_mode = markdown）',
  '本轮不调用工具。把下面这一块放在回复的最末尾，之后不得再有任何文字：',
  '',
  '---',
  'Hook 追问句',
  '',
  '→ 快捷回复 1',
  '→ 快捷回复 2',
  '',
  '只写一行 Hook 和 1–{max} 条快捷回复；没有 Hook 时省略 Hook 行。',
]

const ZH_TAG = [
  '',
  '### 降级格式（render_mode = tag）',
  '本轮不调用工具。把下面这一块放在回复的最末尾，之后不得再有任何文字：',
  '',
  '<followup>',
  '<hook>Hook 追问句</hook>',
  '<reply>快捷回复 1</reply>',
  '<reply>快捷回复 2</reply>',
  '</followup>',
  '',
  '只写一个 hook 和 1–{max} 个 reply；没有 Hook 时省略 hook 行。标签本身不要出现在正文其他位置。',
]

const EN_RULES = [
  '## End-of-reply hook follow-up (followup)',
  '',
  'Every reply must call the `followup` tool once before writing the answer, with one hook question and 1-{max} quick replies; they are displayed at the end of the reply. They exist to lower the cost of the user\u2019s next message and steer the conversation toward a more useful next step. The measure of success is a genuinely more useful next answer after the user picks one, not a longer conversation.',
  '',
  'The hook and quick replies are an add-on layer: finish the main answer first, never withhold information, tease, or half-answer to manufacture a hook, and never change the content, length, or format of the answer. Call it by default: skip the whole block only when one of the skip conditions below holds, and do not skip just because the question feels unimpressive; a plain but concrete, answerable question is enough.',
  '',
  '@@SKIP@@',
  '',
  '### Hook (the `hook` field, optional)',
  '- Exactly one sentence and one question. Anchor it in something specific from this answer: a branch just mentioned, a variable still undecided, or a concrete next step.',
  '- Prefer two shapes: let the user choose among a few paths ("Would you rather start with A or B?"), or ask for one personal fact that would materially improve the next answer ("How many days a week can you realistically spare?").',
  '- At most 25 words in English / 40 characters in Chinese; natural, like a person asking in passing.',
  '- Never: generic filler ("Is there anything else I can help with?", "Would you like me to explain further?", "Hope this helps"), a question the answer already resolved, exaggerated or anxiety-inducing hooks, or more than one question in a sentence.',
  '',
  '### Quick replies (the `replies` field, 1-{max} items)',
  '- Write them in the user\u2019s voice as the next sentence the user would say: first person or no subject, never assistant voice ("I can help you..." is wrong).',
  '- At least one reply answers the hook directly; the others may take another useful path: go one level deeper, move to execution, bring in the user\u2019s own situation, or raise a fair objection.',
  '- Every reply is a distinct intent, not a paraphrase; each one is self-contained, so avoid "this" or "the previous one".',
  '- Give only as many replies as there are genuinely distinct, useful paths: one path, one reply; two paths, two replies; do not pad to three with near-duplicates.',
  '- With two or more replies, let the lengths vary naturally in any order: do not sort them short→medium→long every time, and never make them all the same length. Write them like a person typing, without hitting fixed word-count bands.',
  '- Conversational, with a little emotion or hesitation if it fits ("not sure I can keep up, let\u2019s start with the easiest"); no essay tone, no repeated sentence openings.',
  '- After picking one, the model can give a useful answer without asking the user for more information; if a reply would require more information, rewrite it so the user volunteers that information ("I only have half an hour a day, how should I plan it").',
  '- Never reuse a quick reply that already appeared in the conversation history.',
  '',
  '### How to send it (submit first, then write the answer)',
  '- Plan the complete answer first, then call `followup` once with `hook` and `replies`; do not write the answer yet.',
  '- After the tool result, immediately write the complete answer as this turn\u2019s reply. Do not repeat the hook or the replies in the body, and call no further tools.',
  '- Do not call `followup` after the answer: the answer and the tool call would share a step, the UI would fold that step into the process block, and the user would not see the answer. Call it at most once per turn.',
  '- Skip only when one of the skip conditions above holds; an unimpressive question is not a reason to skip.',
  '- Write the hook and quick replies in the user\u2019s current language; fixed UI copy is localized by the plugin.',
]

const EN_MARKDOWN = [
  '',
  '### Fallback format (render_mode = markdown)',
  'Do not call the tool this turn. Put this block at the very end of the reply, with nothing after it:',
  '',
  '---',
  'Hook question',
  '',
  '\u2192 quick reply 1',
  '\u2192 quick reply 2',
  '',
  'One hook line and 1-{max} quick replies; omit the hook line when there is no hook.',
]

const EN_TAG = [
  '',
  '### Fallback format (render_mode = tag)',
  'Do not call the tool this turn. Put this block at the very end of the reply, with nothing after it:',
  '',
  '<followup>',
  '<hook>Hook question</hook>',
  '<reply>quick reply 1</reply>',
  '<reply>quick reply 2</reply>',
  '</followup>',
  '',
  'One hook and 1-{max} replies; omit the hook line when there is no hook. The tags must not appear anywhere else in the reply.',
]

/** Fill the `{max}` placeholder without touching any other braces. */
function fill(lines, max) {
  return lines.join('\n').split('{max}').join(String(max))
}

/**
 * Compose the omission rules for a strategy and the two independent switches.
 * `always` omits almost nothing; `balanced` adds strict-format and unclicked
 * turn rules; `conservative` also skips while tool results are still pending.
 */
export function buildSkipSection(settings, language) {
  const zh = language !== 'en'
  const strategy = STRATEGIES.indexOf(settings.strategy) === -1 ? 'always' : settings.strategy
  const skipOnStrictFormat = settings.skipOnStrictFormat === true || strategy !== 'always'
  const skipOnUnclickedRounds = settings.skipOnUnclickedRounds === true || strategy !== 'always'
  const skipOnPendingTools = settings.skipOnPendingTools === true || strategy === 'conservative'
  const skipOnRefusal = settings.skipOnRefusal !== false
  const skipOnEmotional = settings.skipOnEmotional !== false
  const lines = [zh ? '### 只有以下情况才整块省略' : '### Skip the whole block only in these cases']
  if (zh) {
    lines.push('- 用户明确表示结束、不需要追问，或说过“别再问我了”一类的话；')
    if (skipOnEmotional) lines.push('- 用户处于情绪危机、哀伤、自伤风险等情境，此时不做任何引导式追问；')
    if (skipOnRefusal) lines.push('- 本轮是拒绝回答（内容敏感、无法帮助），说不出有意义的下一步；')
    if (skipOnStrictFormat) lines.push('- 用户要求严格格式的输出，且结果会被直接复制或被程序消费（纯代码、纯 JSON、纯译文等）；')
    if (skipOnPendingTools) lines.push('- 仍有工具调用、仍在等待工具结果；')
    if (skipOnUnclickedRounds) lines.push('- 最近两轮用户都没有使用你给的快捷回复，且话题已经收束。')
    lines.push('')
    if (skipOnStrictFormat) {
      lines.push('除此之外都应调用 `followup`；命中上面任一条时才整块省略。')
    } else {
      lines.push('其余情况一律调用 `followup`，应出尽出。纯代码、纯 JSON、纯译文等严格格式不构成省略理由：卡片和快捷回复在正文之外，不会污染被复制的内容。')
    }
    lines.push('正文末尾已经是一个必须回答的澄清问题时，hook 留空、只给快捷回复即可，不要因为“已经有问题了”而整个省略。')
    return lines.join('\n')
  }
  lines.push('- The user says they are done, does not want questions, or asks you to stop asking;')
  if (skipOnEmotional) lines.push('- The user is in emotional crisis, grieving, or at risk of self-harm; offer no guiding questions there;')
  if (skipOnRefusal) lines.push('- This turn is a refusal (the content is sensitive or you cannot help) and no meaningful next step exists;')
  if (skipOnStrictFormat) lines.push('- The user demands a strict format whose result will be copied or consumed by a program (code only, JSON only, translation only, and so on);')
  if (skipOnPendingTools) lines.push('- A tool call is still running or its result is still pending;')
  if (skipOnUnclickedRounds) lines.push('- The user ignored your quick replies for the last two turns and the topic has settled.')
  lines.push('')
  if (skipOnStrictFormat) {
    lines.push('Otherwise call `followup`; skip the whole block only when one of the rules above applies.')
  } else {
    lines.push('In every other case call `followup`: output it whenever possible. A strict format such as code only, JSON only, or translation only is NOT a reason to skip: the card and quick replies live outside the answer text and do not pollute copied content.')
  }
  lines.push('If the answer already ends with a clarifying question, leave `hook` empty and send quick replies only instead of skipping the block.')
  return lines.join('\n')
}

/**
 * Build the full model-facing section for one configuration.
 * @param {{ language?: string, maxReplies?: number, renderMode?: string, strategy?: string, skipOnRefusal?: boolean, skipOnEmotional?: boolean }} [settings]
 * @returns {string}
 */
export function buildPromptSection(settings = {}) {
  const source = isRecord(settings) ? settings : {}
  const max = clampMaxReplies(source.maxReplies === undefined ? 3 : source.maxReplies)
  const mode = RENDER_MODES.indexOf(source.renderMode) === -1 ? 'ui' : source.renderMode
  const language = source.language === 'en' ? 'en' : 'zh'
  const rules = fill(language === 'en' ? EN_RULES : ZH_RULES, max)
    .split('@@SKIP@@').join(buildSkipSection(source, language))
  if (mode === 'markdown') return rules + fill(language === 'en' ? EN_MARKDOWN : ZH_MARKDOWN, max)
  if (mode === 'tag') return rules + fill(language === 'en' ? EN_TAG : ZH_TAG, max)
  return rules
}

/**
 * Short description for the `followup` tool.
 * @param {'zh'|'en'} language
 * @param {number} maxReplies
 * @returns {string}
 */
export function toolDescription(language, maxReplies) {
  const max = clampMaxReplies(maxReplies)
  if (language === 'en') {
    return 'Submit one hook question and 1-' + max + ' quick replies in the user\u2019s voice (give only as many as there are real paths; usually 1-2, do not pad to the maximum), shown at the end of the reply so the user can start the next turn with one click. Call it BEFORE writing the answer: plan the complete answer, submit the hook and quick replies, then write the answer after the tool result with no further tool calls. Do not call it after the answer. Whether to call it this turn, and which omission rules apply, are decided by the current hook-followup policy in the system-prompt section.'
  }
  return '提交一句 Hook 追问和 1–' + max + ' 条用户口吻的快捷回复（按实际有价值路径给，通常 1–2 条，不要凑满），显示在回答末尾，让用户点一下就能开启下一轮。要在写正文之前调用：先想清楚完整正文，提交 Hook 与快捷回复，等工具结果返回后再写正文，之后不要再调用工具。不要在正文之后调用。本轮是否调用、以及适用哪些省略条件，以系统提示里 hook-followup 段的当前策略为准。'
}

/**
 * Model-visible result of one successful call. The model does not see it in the
 * same turn (the turn is concluded), but it stays in the transcript for later
 * turns, where it also helps avoid repeating quick replies.
 * @param {{ hook: string, replies: string[] }} normalized
 * @param {'zh'|'en'} language
 * @returns {string}
 */
export function buildReceipt(normalized, language) {
  const hook = typeof normalized.hook === 'string' ? normalized.hook : ''
  const count = Array.isArray(normalized.replies) ? normalized.replies.length : 0
  if (language === 'en') {
    return 'Recorded ' + count + ' quick repl' + (count === 1 ? 'y' : 'ies')
      + (hook === '' ? '' : ' and the hook "' + hook + '"')
      + '. Now write the complete answer as this turn\u2019s reply: do not repeat the hook or the quick replies, and call no further tools.'
  }
  return '已记录 ' + count + ' 条快捷回复'
    + (hook === '' ? '' : '，Hook 为「' + hook + '」')
    + '。请立即输出完整正文作为本轮回答：不要重复 Hook 或快捷回复，也不要再调用工具。'
}

/** Re-exported so the Host can cap the Hook without importing two modules. */
export { MAX_HOOK_CHARS }
