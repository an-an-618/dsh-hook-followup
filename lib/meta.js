/**
 * Hook Follow-up — argument normalization and the persisted metadata shape.
 *
 * Everything the Client renders comes from `output.presentationMeta`, which
 * DSH snapshots into the tool result and persists in the session log. The Host
 * keeps this module dependency-free and synchronous so the same functions can
 * run in `execute` (where errors become a retryable tool error) and in
 * `presentationMeta` (where they must not throw for already-validated input).
 *
 * No dynamic code and no I/O.
 *
 * @module hook-followup/lib/meta
 */

/** Metadata version understood by client.js. Bump only with a Client change. */
export const META_VERSION = 1

/** Discriminator written next to the version. */
export const META_KIND = 'followup'

/** Soft guard against a runaway Hook; the prompt asks for 40 Han chars / 25 words. */
export const MAX_HOOK_CHARS = 200

/** Soft guard against a runaway quick reply. */
export const MAX_REPLY_CHARS = 200

/** Invalid model arguments that deserve a visible, retryable tool error. */
export class FollowupError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FollowupError'
  }
}

/** Plain-object test that also rejects arrays. */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Clamp the configured quick-reply cap to the 1-3 range the prompt promises. */
export function clampMaxReplies(value) {
  const number = Number(value)
  if (!Number.isInteger(number)) return 3
  return Math.min(3, Math.max(1, number))
}

/** Trimmed, non-empty Hook text or an empty string when the Hook is omitted. */
function normalizeHook(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new FollowupError('hook must be a string when present')
  const text = value.trim()
  if (text.length > MAX_HOOK_CHARS) {
    throw new FollowupError(`hook must be at most ${MAX_HOOK_CHARS} characters`)
  }
  return text
}

/** 1..limit trimmed, distinct quick replies in the model's order. */
function normalizeReplies(value, limit) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FollowupError('replies must be a non-empty array of strings')
  }
  if (value.length > limit) {
    throw new FollowupError(`replies must contain at most ${limit} item(s)`)
  }
  const replies = []
  const seen = new Set()
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    if (typeof item !== 'string') {
      throw new FollowupError(`replies[${index}] must be a string`)
    }
    const text = item.trim()
    if (text === '') {
      throw new FollowupError(`replies[${index}] must not be empty`)
    }
    if (text.length > MAX_REPLY_CHARS) {
      throw new FollowupError(`replies[${index}] must be at most ${MAX_REPLY_CHARS} characters`)
    }
    const key = text.toLowerCase()
    if (seen.has(key)) {
      throw new FollowupError(`replies[${index}] duplicates an earlier quick reply`)
    }
    seen.add(key)
    replies.push(text)
  }
  return replies
}

/**
 * Validate one `followup` call.
 * @param {unknown} args - raw tool arguments after schema validation.
 * @param {number} maxReplies - configured cap, clamped to 1-3.
 * @returns {{ hook: string, replies: string[] }} normalized content.
 * @throws {FollowupError} when the model arguments are unusable.
 */
export function normalizeFollowup(args, maxReplies) {
  if (!isRecord(args)) throw new FollowupError('arguments must be an object')
  const limit = clampMaxReplies(maxReplies)
  return {
    hook: normalizeHook(args.hook),
    replies: normalizeReplies(args.replies, limit),
  }
}

/**
 * The exact object persisted through `output.presentationMeta`.
 * @param {unknown} args - raw tool arguments.
 * @param {number} maxReplies - configured cap.
 * @returns {{ v: number, kind: string, hook: string, replies: string[] }}
 */
export function buildMeta(args, maxReplies) {
  const normalized = normalizeFollowup(args, maxReplies)
  return {
    v: META_VERSION,
    kind: META_KIND,
    hook: normalized.hook,
    replies: normalized.replies,
  }
}

/**
 * Whether a persisted object is a metadata record this Client version renders.
 * @param {unknown} meta - `block.meta` from the chat node.
 */
export function isFollowupMeta(meta) {
  return isRecord(meta)
    && meta.v === META_VERSION
    && meta.kind === META_KIND
    && typeof meta.hook === 'string'
    && Array.isArray(meta.replies)
    && meta.replies.length > 0
    && meta.replies.every((reply) => typeof reply === 'string' && reply.trim() !== '')
}
