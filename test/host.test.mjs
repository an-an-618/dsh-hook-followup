/**
 * Host-half tests for @an-an-618/dsh-hook-followup.
 *
 * Zero dependencies beyond node:test / node:assert. Run with:
 *
 *   node test/host.test.mjs
 *
 * Covers config normalization, tool and prompt registration per render mode,
 * argument validation (the retryable error path), the persisted metadata, the
 * concludeTurn marker that keeps the feature free of extra model requests, and
 * the prompt-template guard that broke the Intelligent UI v2.0.0 install.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Config,
  PARAMETERS,
  TOOL_NAME,
  apply,
  defineFollowupTool,
  readSettings,
} from '../index.js'
import { FollowupError, buildMeta, isFollowupMeta, normalizeFollowup } from '../lib/meta.js'
import {
  SECTION_NAME,
  SECTION_ORDER,
  buildPromptSection,
  buildReceipt,
  normalizeConfig,
  toolDescription,
} from '../lib/prompt.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const VALID_ARGS = {
  hook: '这三种里，你更想先试哪一种？',
  replies: [
    '先从走路开始',
    '在家练自重的话怎么安排？',
    '我体能很差，爬三楼就喘，这种情况先做什么比较稳',
  ],
}

function fakeCtx() {
  const tools = []
  const sections = []
  return {
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {}
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
    effect(callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    logger: { warn() {} },
    _tools: tools,
    _sections: sections,
  }
}

function sectionText(section) {
  return typeof section.text === 'function' ? section.text({}) : section.text
}

function acceptingExec() {
  return {
    concluded: false,
    concludeTurn() {
      this.concluded = true
    },
  }
}

/* ------------------------------------------------------------------ *
 * 1. Configuration
 * ------------------------------------------------------------------ */

test('config defaults match the documented row', () => {
  assert.deepEqual(normalizeConfig({}), {
    enabled: true,
    maxReplies: 3,
    renderMode: 'ui',
    language: 'follow_user',
    promptLanguage: 'zh',
    strategy: 'always',
    skipOnRefusal: true,
    skipOnEmotional: true,
    skipOnStrictFormat: false,
    skipOnUnclickedRounds: false,
    skipOnPendingTools: false,
  })
})

test('max_replies is clamped to 1-3 and invalid values fall back to 3', () => {
  assert.equal(normalizeConfig({ max_replies: 1 }).maxReplies, 1)
  assert.equal(normalizeConfig({ max_replies: 3 }).maxReplies, 3)
  assert.equal(normalizeConfig({ max_replies: 9 }).maxReplies, 3)
  assert.equal(normalizeConfig({ max_replies: 0 }).maxReplies, 1)
  assert.equal(normalizeConfig({ max_replies: 2.5 }).maxReplies, 3)
  assert.equal(normalizeConfig({ max_replies: '2' }).maxReplies, 2)
})

test('invalid render_mode and language fall back without failing activation', () => {
  assert.equal(normalizeConfig({ render_mode: 'nope' }).renderMode, 'ui')
  assert.equal(normalizeConfig({ render_mode: 'tag' }).renderMode, 'tag')
  assert.equal(normalizeConfig({ render_mode: 'markdown' }).renderMode, 'markdown')
  assert.equal(normalizeConfig({ language: 'fr' }).language, 'follow_user')
  assert.equal(normalizeConfig({ language: 'en' }).promptLanguage, 'en')
  assert.equal(normalizeConfig({ language: 'follow_user' }).promptLanguage, 'zh')
})

test('strategy and skip switches normalize without failing activation', () => {
  assert.equal(normalizeConfig({ strategy: 'nope' }).strategy, 'always')
  assert.equal(normalizeConfig({ strategy: 'balanced' }).skipOnStrictFormat, true)
  assert.equal(normalizeConfig({ strategy: 'conservative' }).skipOnPendingTools, true)
  assert.equal(normalizeConfig({ skip_on_refusal: false }).skipOnRefusal, false)
  assert.equal(normalizeConfig({ skip_on_emotional: false }).skipOnEmotional, false)
})

/* ------------------------------------------------------------------ *
 * 2. Registration per mode
 * ------------------------------------------------------------------ */

test('ui mode registers the followup tool and the prompt section', () => {
  const ctx = fakeCtx()
  apply(ctx, {})
  assert.equal(ctx._tools.length, 1)
  assert.equal(ctx._tools[0].name, TOOL_NAME)
  assert.equal(ctx._sections.length, 1)
  assert.equal(ctx._sections[0].name, SECTION_NAME)
  assert.equal(ctx._sections[0].order, SECTION_ORDER)
  const text = sectionText(ctx._sections[0])
  assert.ok(text.includes('`followup`'))
  assert.ok(text.includes('40 字'))
  assert.ok(text.includes('25 词'))
})

test('strategy switches reshape the omission rules', () => {
  const always = fakeCtx()
  apply(always, { strategy: 'always' })
  const alwaysText = sectionText(always._sections[0])
  assert.equal(alwaysText.includes('用户要求严格格式的输出'), false)
  assert.equal(alwaysText.includes('最近两轮'), false)

  const balanced = fakeCtx()
  apply(balanced, { strategy: 'balanced' })
  const balancedText = sectionText(balanced._sections[0])
  assert.ok(balancedText.includes('用户要求严格格式的输出'))
  assert.ok(balancedText.includes('最近两轮'))

  const conservative = fakeCtx()
  apply(conservative, { strategy: 'conservative' })
  assert.ok(sectionText(conservative._sections[0]).includes('仍有工具调用'))

  const refused = fakeCtx()
  apply(refused, { skip_on_refusal: false, skip_on_emotional: false })
  const refusedText = sectionText(refused._sections[0])
  assert.equal(refusedText.includes('情绪危机'), false)
  assert.equal(refusedText.includes('拒绝回答'), false)
})

test('volatile config fields are read live on every assembly', () => {
  let current = 'always'
  const ctx = fakeCtx()
  apply(ctx, { strategy: { get: () => current } })
  const section = ctx._sections[0]
  assert.equal(sectionText(section).includes('最近两轮'), false)
  current = 'balanced'
  assert.equal(sectionText(section).includes('最近两轮'), true)
})

test('live settings gate execute and cap replies', async () => {
  let limit = 1
  const ctx = fakeCtx()
  apply(ctx, { max_replies: { get: () => limit } })
  const tool = ctx._tools[0]
  await assert.rejects(() => tool.execute({ replies: ['a', 'b'] }), FollowupError)
  limit = 3
  const value = await tool.execute({ replies: ['a', 'b'] })
  assert.equal(value.count, 2)
})

test('readSettings follows live references and plain values', () => {
  assert.equal(readSettings({ max_replies: { get: () => 1 } }).maxReplies, 1)
  assert.equal(readSettings({ strategy: { get: () => 'balanced' } }).strategy, 'balanced')
  assert.equal(readSettings({ enabled: { get: () => false } }).enabled, false)
})

test('Config schema is exposed when schemastery is reachable', () => {
  if (Config === undefined) return
  assert.equal(typeof Config, 'function')
  assert.ok(String(Config).includes('strategy'))
})

test('markdown and tag modes are prompt-only fallbacks (no tool)', () => {
  for (const mode of ['markdown', 'tag']) {
    const ctx = fakeCtx()
    apply(ctx, { render_mode: mode })
    assert.equal(ctx._tools.length, 0, mode + ' must not register a tool')
    assert.equal(ctx._sections.length, 1, mode + ' must keep the prompt section')
  }
  const markdown = buildPromptSection({ language: 'zh', maxReplies: 3, renderMode: 'markdown' })
  assert.ok(markdown.includes('---'))
  assert.ok(markdown.includes('→ 快捷回复 1'))
  const tag = buildPromptSection({ language: 'zh', maxReplies: 3, renderMode: 'tag' })
  assert.ok(tag.includes('<followup>'))
  assert.ok(tag.includes('<reply>'))
})

test('enabled: false registers nothing at all', () => {
  const ctx = fakeCtx()
  apply(ctx, { enabled: false })
  assert.equal(ctx._tools.length, 0)
  assert.equal(ctx._sections.length, 0)
})

/* ------------------------------------------------------------------ *
 * 3. Tool contract
 * ------------------------------------------------------------------ */

test('the tool schema requires replies and accepts an optional hook', () => {
  assert.deepEqual(PARAMETERS.required, ['replies'])
  assert.equal(PARAMETERS.properties.hook.type, 'string')
  assert.equal(PARAMETERS.properties.replies.type, 'array')
  const tool = defineFollowupTool(normalizeConfig({ max_replies: 2 }))
  assert.ok(tool.description.includes('1–2'))
  assert.equal(tool.output.schema.required.includes('count'), true)
})

test('execute validates and returns a receipt that asks for the answer next', async () => {
  const tool = defineFollowupTool(normalizeConfig({}))
  const value = await tool.execute(VALID_ARGS)
  assert.equal(value.ok, true)
  assert.equal(value.kind, 'followup')
  assert.equal(value.count, 3)
  const content = tool.output.render(VALID_ARGS, value)
  assert.equal(content[0].type, 'text')
  assert.ok(content[0].text.includes('3 条快捷回复'))
  assert.ok(content[0].text.includes('请立即输出完整正文'))
})

test('execute never calls concludeTurn (the answer must stay outside a tool step)', async () => {
  const tool = defineFollowupTool(normalizeConfig({}))
  const exec = acceptingExec()
  await tool.execute(VALID_ARGS, exec)
  assert.equal(exec.concluded, false, 'a concluding step would fold the answer into the process block')
})

test('presentationMeta persists exactly the normalized metadata', () => {
  const tool = defineFollowupTool(normalizeConfig({}))
  const meta = tool.output.presentationMeta(VALID_ARGS)
  assert.deepEqual(meta, buildMeta(VALID_ARGS, 3))
  assert.equal(meta.v, 1)
  assert.equal(meta.kind, 'followup')
  assert.equal(meta.hook, VALID_ARGS.hook)
  assert.deepEqual(meta.replies, VALID_ARGS.replies)
  assert.equal(isFollowupMeta(meta), true)
})

test('hook may be omitted; replies stay required', async () => {
  const tool = defineFollowupTool(normalizeConfig({}))
  const value = await tool.execute({ replies: ['我每天只有半小时，怎么安排'] }, acceptingExec())
  assert.equal(value.count, 1)
  const meta = tool.output.presentationMeta({ replies: ['我每天只有半小时，怎么安排'] })
  assert.equal(meta.hook, '')
})

/* ------------------------------------------------------------------ *
 * 4. Validation errors stay retryable
 * ------------------------------------------------------------------ */

test('rejects empty, non-string, duplicate and over-limit replies', async () => {
  const tool = defineFollowupTool(normalizeConfig({ max_replies: 2 }))
  const exec = acceptingExec()
  await assert.rejects(() => tool.execute({ replies: [] }, exec), FollowupError)
  await assert.rejects(() => tool.execute({ replies: ['a', 2] }, exec), FollowupError)
  await assert.rejects(() => tool.execute({ replies: ['一样', ' 一样 '] }, exec), FollowupError)
  await assert.rejects(() => tool.execute({ replies: ['a', 'b', 'c'] }, exec), FollowupError)
  await assert.rejects(() => tool.execute({ replies: ['   '] }, exec), FollowupError)
  assert.equal(exec.concluded, false, 'a rejected call must not end the turn')
})

test('rejects an oversized hook and non-object arguments', async () => {
  const tool = defineFollowupTool(normalizeConfig({}))
  await assert.rejects(() => tool.execute({ hook: 'x'.repeat(201), replies: ['a'] }, acceptingExec()), FollowupError)
  await assert.rejects(() => tool.execute(null, acceptingExec()), FollowupError)
  await assert.rejects(() => tool.execute([], acceptingExec()), FollowupError)
})

test('normalizeFollowup trims content and keeps model order', () => {
  const normalized = normalizeFollowup({ hook: ' A？ ', replies: [' 一 ', '二'] }, 3)
  assert.equal(normalized.hook, 'A？')
  assert.deepEqual(normalized.replies, ['一', '二'])
})

/* ------------------------------------------------------------------ *
 * 5. Prompt and descriptions
 * ------------------------------------------------------------------ */

test('prompt sections never contain a double brace (DSH template guard)', () => {
  for (const language of ['zh', 'en']) {
    for (const mode of ['ui', 'markdown', 'tag']) {
      const text = buildPromptSection({ language, maxReplies: 3, renderMode: mode })
      assert.equal(text.includes('{{'), false, language + '/' + mode + ' prompt contains "{{"')
      assert.ok(text.length > 900, language + '/' + mode + ' prompt is suspiciously short')
    }
    const description = toolDescription(language, 3)
    assert.equal(description.includes('{{'), false)
  }
})

test('prompt carries the skip list, hook limit and quick-reply rules', () => {
  const zh = buildPromptSection({ language: 'zh', maxReplies: 3, renderMode: 'ui' })
  for (const needle of ['情绪危机', '40 字', '同义改写', '历史中已经出现过', '不得为了制造 Hook', '默认都要在输出正文之前调用', '写不出精彩的追问不是跳过理由', '不要每次都按「短→中→长」排列', '不要为了凑满三条硬造同质回复', '其余情况一律调用', '严格格式不构成省略理由', '1–3 条', '先想清楚这一轮的完整正文', '不要在正文之后调用']) {
    assert.ok(zh.includes(needle), 'zh prompt is missing: ' + needle)
  }
  const en = buildPromptSection({ language: 'en', maxReplies: 2, renderMode: 'ui' })
  for (const needle of ['25 words', '1-2 quick replies', 'Never reuse', 'emotional crisis', 'Every reply must call', 'do not sort them short→medium→long', 'do not pad to three', 'In every other case call', 'submit first', 'Do not call `followup` after the answer']) {
    assert.ok(en.includes(needle), 'en prompt is missing: ' + needle)
  }
})

test('receipt names the hook and count in both languages', () => {
  const normalized = normalizeFollowup(VALID_ARGS, 3)
  assert.ok(buildReceipt(normalized, 'zh').includes('「' + VALID_ARGS.hook + '」'))
  assert.ok(buildReceipt(normalized, 'zh').includes('请立即输出完整正文'))
  assert.ok(buildReceipt(normalized, 'en').includes('3 quick replies'))
  assert.ok(buildReceipt(normalized, 'en').includes('Now write the complete answer'))
  const noHook = normalizeFollowup({ replies: ['a'] }, 3)
  assert.ok(buildReceipt(noHook, 'en').startsWith('Recorded 1 quick reply. Now write the complete answer'))
})

/* ------------------------------------------------------------------ *
 * 6. Manifest and patch
 * ------------------------------------------------------------------ */

test('manifest, exports and bundle patch point at real files', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@an-an-618/dsh-hook-followup')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-chat'))
  for (const target of Object.values(manifest.exports)) {
    if (target.includes('*')) continue
    assert.doesNotThrow(() => readFileSync(path.join(ROOT, target)))
  }
  const patch = readFileSync(path.join(ROOT, manifest.dsh.bundle.patch), 'utf8')
  assert.ok(patch.includes("name: '@an-an-618/dsh-hook-followup'"))
  assert.ok(patch.includes('max_replies: 3'))
})
