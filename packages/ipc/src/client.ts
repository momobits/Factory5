/**
 * Typed HTTP client for the daemon's IPC endpoints.
 *
 * Validates request shape (so the brain catches mistakes before the wire) and
 * response shape (so the brain catches a misbehaving daemon).
 */

import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import { request } from 'undici';
import type { z } from 'zod';

import { IpcRequestError } from './errors.js';
import {
  cancelDirectiveRequestSchema,
  cancelDirectiveResponseSchema,
  directiveNotifyRequestSchema,
  directiveNotifyResponseSchema,
  ipcErrorSchema,
  reloadConfigResponseSchema,
  sendRequestSchema,
  sendResponseSchema,
  statusResponseSchema,
  uiTokenResponseSchema,
  type CancelDirectiveRequest,
  type CancelDirectiveResponse,
  type DirectiveNotifyRequest,
  type DirectiveNotifyResponse,
  type ReloadConfigResponse,
  type SendRequest,
  type SendResponse,
  type StatusResponse,
  type UiTokenResponse,
} from './schemas.js';

const log = createLogger('ipc.client');

export interface DaemonClientOptions {
  host?: string;
  port?: number;
  /** Per-request timeout in ms. Default: 5000. */
  timeoutMs?: number;
}

export interface DaemonClient {
  status(): Promise<StatusResponse>;
  send(req: SendRequest): Promise<SendResponse>;
  notifyDirective(req: DirectiveNotifyRequest): Promise<DirectiveNotifyResponse>;
  /**
   * Active-cancel a directive (Phase 2.4). Flips the row to `failed` and
   * fires the brain's per-directive AbortController. Throws
   * {@link IpcRequestError} with code `NOT_FOUND` (404) for unknown ids
   * and `ALREADY_TERMINAL` (409) when the directive is already in a
   * terminal status.
   */
  cancelDirective(id: string, req?: CancelDirectiveRequest): Promise<CancelDirectiveResponse>;
  reloadConfig(): Promise<ReloadConfigResponse>;
  /**
   * Fetch the live UI token + dashboard URL. Returns the same shape every
   * time the daemon is up; throws {@link IpcRequestError} with code
   * `UI_DISABLED` (status 503) when the daemon is running CLI-only (no UI
   * token configured).
   */
  uiToken(): Promise<UiTokenResponse>;
}

export function createDaemonClient(opts: DaemonClientOptions = {}): DaemonClient {
  const host = opts.host ?? process.env['FACTORY5_DAEMON_HOST'] ?? DEFAULT_DAEMON_HOST;
  const port = opts.port ?? Number(process.env['FACTORY5_DAEMON_PORT'] ?? DEFAULT_DAEMON_PORT);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const base = `http://${host}:${port}`;

  return {
    async status(): Promise<StatusResponse> {
      return get(base, '/status', statusResponseSchema, timeoutMs);
    },
    async send(req: SendRequest): Promise<SendResponse> {
      const validated = sendRequestSchema.parse(req);
      return post(base, '/send', validated, sendResponseSchema, timeoutMs);
    },
    async notifyDirective(req: DirectiveNotifyRequest): Promise<DirectiveNotifyResponse> {
      const validated = directiveNotifyRequestSchema.parse(req);
      return post(base, '/directives/notify', validated, directiveNotifyResponseSchema, timeoutMs);
    },
    async cancelDirective(
      id: string,
      req: CancelDirectiveRequest = {},
    ): Promise<CancelDirectiveResponse> {
      const validated = cancelDirectiveRequestSchema.parse(req);
      return post(
        base,
        `/directives/${encodeURIComponent(id)}/cancel`,
        validated,
        cancelDirectiveResponseSchema,
        timeoutMs,
      );
    },
    async reloadConfig(): Promise<ReloadConfigResponse> {
      return post(base, '/reload-config', {}, reloadConfigResponseSchema, timeoutMs);
    },
    async uiToken(): Promise<UiTokenResponse> {
      return get(base, '/ui-token', uiTokenResponseSchema, timeoutMs);
    },
  };
}

async function get<T extends z.ZodTypeAny>(
  base: string,
  path: string,
  schema: T,
  timeoutMs: number,
): Promise<z.infer<T>> {
  return doRequest(base, path, 'GET', undefined, schema, timeoutMs);
}

async function post<T extends z.ZodTypeAny>(
  base: string,
  path: string,
  body: unknown,
  schema: T,
  timeoutMs: number,
): Promise<z.infer<T>> {
  return doRequest(base, path, 'POST', body, schema, timeoutMs);
}

async function doRequest<T extends z.ZodTypeAny>(
  base: string,
  path: string,
  method: 'GET' | 'POST',
  body: unknown,
  schema: T,
  timeoutMs: number,
): Promise<z.infer<T>> {
  const url = `${base}${path}`;
  log.debug({ method, url }, 'ipc request');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await request(url, {
      method,
      signal: ac.signal,
      ...(body !== undefined
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const text = await res.body.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch (err) {
      throw new IpcRequestError(
        res.statusCode,
        'INVALID_JSON',
        `daemon returned non-JSON response (status ${res.statusCode})`,
        { text: text.slice(0, 500), parseError: String(err) },
      );
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const env = ipcErrorSchema.safeParse(parsed);
      if (env.success) {
        throw new IpcRequestError(
          res.statusCode,
          env.data.error.code,
          env.data.error.message,
          env.data.error.details,
        );
      }
      throw new IpcRequestError(
        res.statusCode,
        'UNEXPECTED_RESPONSE',
        `daemon returned ${res.statusCode}`,
        parsed,
      );
    }
    return schema.parse(parsed) as z.infer<T>;
  } finally {
    clearTimeout(timer);
  }
}
