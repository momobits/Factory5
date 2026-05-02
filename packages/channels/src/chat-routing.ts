/**
 * Phase 2.5 — chat-shaped message → read-side command router.
 *
 * The triage agent emits one of 8 intents
 * (`build|fix|review|investigate|chat|status|resume|cancel`). Channels
 * map four of those to read-only commands shared with slash dispatch
 * (`runStatus / runSpend / runFindings / runResume`); the rest fall
 * through to the existing chat-directive path.
 *
 * Why not extend the intent enum to include `spend`/`findings`? It would
 * require a SQLite migration on the `directives.intent` CHECK constraint
 * for two values that are sub-cases of `status`. Keeping the 8-intent
 * vocabulary stable and resolving spend/findings via a tiny keyword pass
 * on the original text trades a clean enum for one fewer migration. The
 * model still emits high-confidence `intent=status` for "show me the
 * spend" / "any open findings?" — see the triage prompt's status row.
 */

import type { BuildInput, ResumeInput, StatusInput } from './command-handlers.js';
import type { IntentClassification } from './types.js';

/**
 * Read-side commands the channel handler dispatches against. Names match
 * the exported `run<Cmd>` functions in `command-handlers.ts`.
 */
export type ChatRoutedCommand = 'status' | 'spend' | 'findings' | 'resume' | 'build';

export interface ChatRoutedDispatch {
  command: ChatRoutedCommand;
  /**
   * Argument bag passed to the matching command handler. Shape varies by
   * command — `status` / `spend` / `findings` accept loose filters with
   * sensible defaults; `resume` requires `project`.
   */
  input:
    | StatusInput // status
    | { groupBy?: string; project?: string } // spend
    | { project?: string; severity?: string; status?: string } // findings
    | ResumeInput // resume
    | BuildInput; // build (free-form chat that classified as `build`)
}

/**
 * Decide whether a free-form chat message should re-route to a read-side
 * command (Phase 2.5). Returns `undefined` when the channel handler
 * should fall back to the legacy "create chat directive" path.
 *
 * Precedence (first match wins):
 *
 *   1. `intent=resume` + a parseable `<project>` token → run `resume`.
 *      Heuristic: the first non-stopword token after stripping the
 *      verb. If extraction is ambiguous (no clear single token),
 *      returns `undefined` so the brain handles the chat directive.
 *   2. `intent=status` → keyword pass on the raw text:
 *        - `/spend|cost|usd|usage|\$/i` → `spend`
 *        - `/finding|advisor|warning|issue|bug/i` → `findings`
 *        - else → `status`
 *   3. `intent=build` + a parseable `<project>` token → run `build`.
 *      Mirrors the resume heuristic. Falls through when the project
 *      isn't an obvious single token (the brain pipeline takes over).
 *   4. Everything else (`fix`, `review`, `investigate`, `chat`, low-
 *      confidence anything) → `undefined`.
 *
 * `cancel` is intentionally not auto-routed: cancellation needs a ULID
 * argument that's awkward to extract from chat, and the explicit slash
 * surface (`/factory cancel <id>` / `/cancel <id>`) is the operator's
 * canonical entry point.
 */
export function routeChatIntent(
  classification: IntentClassification,
  text: string,
): ChatRoutedDispatch | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;

  switch (classification.intent) {
    case 'resume': {
      const project = extractProjectName(trimmed, ['resume', 'continue']);
      if (project === undefined) return undefined;
      return { command: 'resume', input: { project } satisfies ResumeInput };
    }
    case 'status': {
      const subtype = pickStatusSubtype(trimmed);
      if (subtype === 'spend') return { command: 'spend', input: {} };
      if (subtype === 'findings') return { command: 'findings', input: { status: 'OPEN' } };
      return { command: 'status', input: {} satisfies StatusInput };
    }
    case 'build': {
      const project = extractProjectName(trimmed, ['build', 'make', 'create']);
      if (project === undefined) return undefined;
      return { command: 'build', input: { project } satisfies BuildInput };
    }
    default:
      return undefined;
  }
}

/**
 * Decide whether an `intent=status` message is really about spend or
 * findings. Conservative: only matches whole-word keywords so a
 * `/status spending-tracker` doesn't get misrouted.
 */
export function pickStatusSubtype(text: string): 'status' | 'spend' | 'findings' {
  // Strip leading "show me", "what's the", etc. so the keyword scan sees
  // the noun.
  const lower = text.toLowerCase();
  if (/\b(spend|cost|costs|usd|usage|spent|\$)\b/i.test(lower)) return 'spend';
  if (
    /\b(finding|findings|advisor|advisory|warning|warnings|issue|issues|bug|bugs)\b/i.test(lower)
  ) {
    return 'findings';
  }
  return 'status';
}

/**
 * Extract a single-token project name from text like "resume foo",
 * "build the dropbox-clone", "build me a notes-app". Returns `undefined`
 * when the text doesn't have a clear single project token.
 *
 * Strips:
 *   - one of the verb prefixes the caller passes (case-insensitive)
 *   - filler words ("the", "a", "an", "me", "please")
 *
 * Then accepts the result iff the remainder is a single token of
 * length ≥ 2 made of `[A-Za-z0-9_-]`. Anything looser (whitespace,
 * punctuation, multiple words) returns `undefined` — the brain
 * handles the ambiguous chat directive.
 */
export function extractProjectName(text: string, verbs: ReadonlyArray<string>): string | undefined {
  let body = text.trim();
  // Strip leading verb (whole word, case-insensitive).
  for (const v of verbs) {
    const re = new RegExp(`^${v}\\b\\s*`, 'i');
    if (re.test(body)) {
      body = body.slice(body.match(re)![0].length);
      break;
    }
  }
  // Strip filler words.
  body = body.replace(/^\s*(?:the|a|an|me|please)\s+/i, '');
  body = body.trim();
  if (body.length < 2) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]+$/.test(body)) return undefined;
  return body;
}
