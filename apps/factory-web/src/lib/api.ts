import {
  directiveStreamEventSchema,
  type DirectiveStreamEvent,
  type DirectiveStreamEventType,
} from '@factory5/ipc/sse';

const TOKEN_KEY = 'factory5.ui-token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * On first load, catch `?t=<token>` from the URL, stash it in sessionStorage,
 * and strip it from the address bar via `history.replaceState`. Safe to call
 * multiple times — idempotent when no `?t=` is present.
 */
export function captureTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const t = params.get('t');
  if (t === null || t.length === 0) return;
  setToken(t);
  params.delete('t');
  const query = params.toString();
  const newUrl =
    window.location.pathname + (query.length > 0 ? `?${query}` : '') + window.location.hash;
  window.history.replaceState({}, '', newUrl);
}

export interface ApiErrorShape {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export class NoTokenError extends Error {
  constructor() {
    super('missing FACTORY5_UI_TOKEN — reopen the URL logged by factoryd');
    this.name = 'NoTokenError';
  }
}

export class ApiError extends Error implements ApiErrorShape {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Fetch an `/api/v1/*` path with the stored bearer token. Throws
 * {@link NoTokenError} when no token is stored; throws {@link ApiError} for
 * 4xx/5xx responses. Returns the decoded JSON body on success.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  if (token === null) throw new NoTokenError();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code !== undefined) code = body.error.code;
      if (body.error?.message !== undefined) message = body.error.message;
    } catch {
      // body wasn't JSON; keep defaults
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

/**
 * POST a JSON body to an `/api/v1/*` endpoint. Wraps {@link apiFetch} —
 * bearer auto-attached, `Content-Type: application/json` set, body
 * `JSON.stringify`'d. Same {@link ApiError} envelope on 4xx/5xx.
 */
export async function apiPost<TReq, TRes = unknown>(path: string, body: TReq): Promise<TRes> {
  return apiFetch<TRes>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * PUT a JSON body to an `/api/v1/*` endpoint. Wraps {@link apiFetch} —
 * bearer auto-attached, `Content-Type: application/json` set, body
 * `JSON.stringify`'d. Same {@link ApiError} envelope on 4xx/5xx.
 */
export async function apiPut<TReq, TRes = unknown>(path: string, body: TReq): Promise<TRes> {
  return apiFetch<TRes>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// SSE stream client — `apiStream(path, callbacks)`
// ---------------------------------------------------------------------------

/**
 * Connection-state machine surfaced by {@link apiStream}.
 *
 * - `connecting` — initial; underlying `EventSource` is opening.
 * - `live` — open + receiving events (or backfill on connect).
 * - `reconnecting` — `EventSource` errored; browser auto-retry in flight.
 * - `polling` — `EventSource` permanently closed; `pollingFallback` active.
 * - `disconnected` — `EventSource` closed and no fallback configured.
 * - `completed` — received `directive.completed`; stream closed cleanly.
 */
export type StreamConnectionState =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'polling'
  | 'disconnected'
  | 'completed';

export interface StreamCallbacks {
  /** Called for every parsed + validated event in arrival order. */
  onEvent: (event: DirectiveStreamEvent) => void;
  /** Optional — called on every connection-state transition. */
  onConnectionState?: (state: StreamConnectionState) => void;
  /** Optional — called when an event payload fails to parse / validate. */
  onParseError?: (raw: string, err: unknown) => void;
  /**
   * Optional — when the underlying `EventSource` enters `CLOSED` state
   * (server gave up, or the browser cannot reach the daemon), apiStream
   * fires this callback every {@link STREAM_POLL_INTERVAL_MS} ms in
   * place of live events. Provide this to gracefully degrade to a
   * polling refresh of the same data.
   */
  pollingFallback?: () => Promise<void>;
}

export interface StreamHandle {
  /** Tear down the EventSource and stop any active poll. Idempotent. */
  close: () => void;
  /** Snapshot of the helper's current connection state. */
  state: () => StreamConnectionState;
}

export const STREAM_POLL_INTERVAL_MS = 5_000;

const STREAM_EVENT_TYPES = [
  'task.started',
  'task.completed',
  'task.retried',
  'finding.created',
  'spend.updated',
  'transcript.line',
  'log.line',
  'pool.tally',
  'directive.completed',
] as const satisfies readonly DirectiveStreamEventType[];

// EventSource readyState literals per the WHATWG HTML spec — pinned here
// so apiStream tests can mock EventSource without bringing the browser
// constructor's static constants along.
const ES_CONNECTING = 0;
const ES_CLOSED = 2;

/**
 * Subscribe to a server-sent-events stream rooted at `path` (e.g.
 * `/api/v1/directives/<id>/stream`). Wraps the browser's native
 * `EventSource` with token-auth, Zod-validates each payload via
 * {@link directiveStreamEventSchema}, exposes a connection-state
 * machine, and degrades to a 5 s `pollingFallback` poll when the
 * EventSource gives up retrying.
 *
 * Auth note: `EventSource` cannot set custom headers, so the stored UI
 * token is appended as `?t=<token>` to the URL. Token-in-URL is
 * acceptable for the loopback-only daemon (ADR 0025); the token is
 * stripped from the address bar by {@link captureTokenFromUrl} on the
 * initial page load.
 *
 * Returns a {@link StreamHandle} — the caller MUST invoke `close()` on
 * page unmount to avoid leaking a long-lived `EventSource`.
 */
export function apiStream(path: string, callbacks: StreamCallbacks): StreamHandle {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return { close: () => {}, state: () => 'disconnected' };
  }

  captureTokenFromUrl();
  const token = getToken();
  if (token === null) throw new NoTokenError();

  const sep = path.includes('?') ? '&' : '?';
  const url = `${path}${sep}t=${encodeURIComponent(token)}`;

  let state: StreamConnectionState = 'connecting';
  let pollHandle: number | null = null;
  let closed = false;

  const setState = (next: StreamConnectionState): void => {
    if (state === next) return;
    state = next;
    callbacks.onConnectionState?.(next);
  };

  const stopPolling = (): void => {
    if (pollHandle !== null) {
      window.clearInterval(pollHandle);
      pollHandle = null;
    }
  };

  const startPolling = (): void => {
    const fallback = callbacks.pollingFallback;
    if (fallback === undefined) {
      setState('disconnected');
      return;
    }
    setState('polling');
    if (pollHandle !== null) return;
    const tick = (): void => {
      void fallback().catch(() => {
        // Swallow — poll keeps running on transient errors.
      });
    };
    tick();
    pollHandle = window.setInterval(tick, STREAM_POLL_INTERVAL_MS);
  };

  const es = new EventSource(url);
  callbacks.onConnectionState?.('connecting');

  es.addEventListener('open', () => {
    if (closed) return;
    stopPolling();
    setState('live');
  });

  es.addEventListener('error', () => {
    if (closed) return;
    if (es.readyState === ES_CONNECTING) {
      setState('reconnecting');
    } else if (es.readyState === ES_CLOSED) {
      startPolling();
    }
  });

  for (const eventType of STREAM_EVENT_TYPES) {
    es.addEventListener(eventType, (raw) => {
      if (closed) return;
      const ev = raw as MessageEvent;
      const dataLine = typeof ev.data === 'string' ? ev.data : '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(dataLine);
      } catch (err) {
        callbacks.onParseError?.(dataLine, err);
        return;
      }
      const result = directiveStreamEventSchema.safeParse(parsed);
      if (!result.success) {
        callbacks.onParseError?.(dataLine, result.error);
        return;
      }
      callbacks.onEvent(result.data);
      if (result.data.type === 'directive.completed') {
        setState('completed');
        closed = true;
        es.close();
        stopPolling();
      }
    });
  }

  return {
    close: () => {
      if (closed) return;
      closed = true;
      es.close();
      stopPolling();
    },
    state: () => state,
  };
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}
