import { describe, expect, it } from 'vitest';

import {
  AskUserEnvError,
  AskUserRpcError,
  askUserHandler,
  type AskUserHandlerEnv,
} from './handler.js';

const validEnv: AskUserHandlerEnv = {
  BRAIN_RPC_URL: 'http://127.0.0.1:25295',
  BRAIN_RPC_TOKEN: 'test-token-abc123',
  TASK_ID: '01J0TASK0000000000000000000',
  DIRECTIVE_ID: '01J0DIRECTIVE000000000000000',
};

function fetchOk(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function fetchErr(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

describe('askUserHandler — env validation', () => {
  it('throws AskUserEnvError listing every missing var', async () => {
    let thrown: unknown;
    try {
      await askUserHandler(
        { question: 'hi' },
        { env: { BRAIN_RPC_URL: 'http://x', BRAIN_RPC_TOKEN: 'y' } },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AskUserEnvError);
    const e = thrown as AskUserEnvError;
    expect(e.missing).toEqual(['TASK_ID', 'DIRECTIVE_ID']);
  });

  it('treats empty-string env vars as missing', async () => {
    let thrown: unknown;
    try {
      await askUserHandler(
        { question: 'hi' },
        {
          env: {
            BRAIN_RPC_URL: '',
            BRAIN_RPC_TOKEN: 'y',
            TASK_ID: 'x',
            DIRECTIVE_ID: 'x',
          },
        },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AskUserEnvError);
    expect((thrown as AskUserEnvError).missing).toEqual(['BRAIN_RPC_URL']);
  });
});

describe('askUserHandler — happy path', () => {
  it('returns the answer + questionId from the brain RPC envelope', async () => {
    const result = await askUserHandler(
      { question: 'jwt or session?' },
      {
        env: validEnv,
        fetchImpl: fetchOk({
          questionId: '01J0QUESTION00000000000000',
          answer: 'jwt',
          timedOut: false,
          aborted: false,
        }),
      },
    );
    expect(result.answer).toBe('jwt');
    expect(result.questionId).toBe('01J0QUESTION00000000000000');
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it('returns empty answer + timedOut=true when brain reports timeout', async () => {
    const result = await askUserHandler(
      { question: 'pick one' },
      {
        env: validEnv,
        fetchImpl: fetchOk({
          questionId: '01J0QUESTION00000000000000',
          timedOut: true,
          aborted: false,
        }),
      },
    );
    expect(result.timedOut).toBe(true);
    expect(result.answer).toBe('');
  });

  it('hits the correct URL with bearer auth + JSON body', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: string | undefined;
    const fetchImpl: typeof fetch = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          questionId: '01J0QUESTION00000000000000',
          answer: 'ok',
          timedOut: false,
          aborted: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    await askUserHandler(
      { question: 'pick', options: ['a', 'b'], deadlineSeconds: 1800 },
      { env: validEnv, fetchImpl },
    );

    expect(capturedUrl).toBe('http://127.0.0.1:25295/worker/ask-user');
    expect(capturedHeaders?.authorization).toBe('Bearer test-token-abc123');
    const body = JSON.parse(capturedBody ?? '{}') as Record<string, unknown>;
    expect(body.taskId).toBe(validEnv.TASK_ID);
    expect(body.directiveId).toBe(validEnv.DIRECTIVE_ID);
    expect(body.question).toBe('pick');
    expect(body.options).toEqual(['a', 'b']);
    expect(body.deadlineSeconds).toBe(1800);
  });

  it('omits options + deadlineSeconds from body when not provided', async () => {
    let capturedBody: string | undefined;
    const fetchImpl: typeof fetch = (async (_url: string | URL, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          questionId: '01J0QUESTION00000000000000',
          answer: 'ok',
          timedOut: false,
          aborted: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    await askUserHandler({ question: 'pick' }, { env: validEnv, fetchImpl });
    const body = JSON.parse(capturedBody ?? '{}') as Record<string, unknown>;
    expect(body.options).toBeUndefined();
    expect(body.deadlineSeconds).toBeUndefined();
  });

  it('strips trailing slash from BRAIN_RPC_URL', async () => {
    let capturedUrl: string | undefined;
    const fetchImpl: typeof fetch = (async (url: string | URL) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          questionId: '01J0QUESTION00000000000000',
          answer: 'ok',
          timedOut: false,
          aborted: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    await askUserHandler(
      { question: 'hi' },
      {
        env: { ...validEnv, BRAIN_RPC_URL: 'http://127.0.0.1:25295/' },
        fetchImpl,
      },
    );
    expect(capturedUrl).toBe('http://127.0.0.1:25295/worker/ask-user');
  });
});

describe('askUserHandler — error path', () => {
  it('surfaces 401 with upstream WORKER_AUTH_REQUIRED code', async () => {
    let thrown: unknown;
    try {
      await askUserHandler(
        { question: 'hi' },
        {
          env: validEnv,
          fetchImpl: fetchErr(401, {
            error: { code: 'WORKER_AUTH_REQUIRED', message: 'bad token' },
          }),
        },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AskUserRpcError);
    const e = thrown as AskUserRpcError;
    expect(e.httpStatus).toBe(401);
    expect(e.code).toBe('WORKER_AUTH_REQUIRED');
  });

  it('surfaces network failure as NETWORK_ERROR with status 0', async () => {
    let thrown: unknown;
    try {
      await askUserHandler(
        { question: 'hi' },
        {
          env: validEnv,
          fetchImpl: (async () => {
            throw new Error('econnrefused');
          }) as typeof fetch,
        },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AskUserRpcError);
    const e = thrown as AskUserRpcError;
    expect(e.httpStatus).toBe(0);
    expect(e.code).toBe('NETWORK_ERROR');
    expect(e.message).toContain('econnrefused');
  });

  it('falls back to UPSTREAM_ERROR when error body is not JSON', async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response('not json', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      })) as typeof fetch;
    let thrown: unknown;
    try {
      await askUserHandler({ question: 'hi' }, { env: validEnv, fetchImpl });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AskUserRpcError);
    const e = thrown as AskUserRpcError;
    expect(e.httpStatus).toBe(500);
    expect(e.code).toBe('UPSTREAM_ERROR');
  });
});
