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
 * Fetch a path and invoke `render` with the response, or surface the error in
 * `mount` with a friendly message. Centralises the captureTokenFromUrl +
 * token-missing + try/catch that every page would otherwise duplicate.
 */
export function loadInto<T>(
  mount: HTMLElement,
  path: string,
  render: (data: T, mount: HTMLElement) => void,
): void {
  captureTokenFromUrl();
  if (getToken() === null) {
    mount.innerHTML = '';
    mount.textContent = 'No UI token present. Reopen the URL logged by factoryd.';
    return;
  }
  mount.textContent = 'Loading…';
  apiFetch<T>(path)
    .then((data) => {
      mount.innerHTML = '';
      render(data, mount);
    })
    .catch((err: unknown) => {
      mount.innerHTML = '';
      if (err instanceof NoTokenError) {
        mount.textContent = err.message;
      } else if (err instanceof ApiError) {
        const pre = document.createElement('pre');
        pre.className = 'err';
        pre.textContent = `API error ${String(err.status)} (${err.code}): ${err.message}`;
        mount.appendChild(pre);
      } else if (err instanceof Error) {
        mount.textContent = `Fetch failed: ${err.message}`;
      } else {
        mount.textContent = 'Unknown error';
      }
    });
}

export function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: (string | Node)[]
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, v);
  }
  for (const c of children) {
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}
