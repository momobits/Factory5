import { initLogger, createLogger } from '@factory5/logger';
import { newId, type OutboundMessage } from '@factory5/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createCliRpcChannel } from './cli-rpc.js';

beforeAll(() => {
  initLogger({ processName: 'cli-rpc-test', noFile: true, noConsole: true });
});

function msg(targetRef: string, text: string): OutboundMessage {
  return {
    id: newId(),
    targetChannel: 'cli',
    targetRef,
    text,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

describe('CliRpcChannel', () => {
  it('delivers to a registered session listener', async () => {
    const chan = createCliRpcChannel();
    await chan.start({
      log: createLogger('test.cli-rpc'),
      onInbound: () => undefined,
    });

    const received: string[] = [];
    const unregister = chan.registerSession('sess-1', (m) => {
      received.push(m.text);
    });

    const result = await chan.send(msg('sess-1', 'hello world'));
    expect(result.delivered).toBe(true);
    expect(received).toEqual(['hello world']);

    unregister();
    await chan.stop();
  });

  it('reports delivered=false without a live session so CLI polling can pick it up', async () => {
    const chan = createCliRpcChannel();
    await chan.start({
      log: createLogger('test.cli-rpc'),
      onInbound: () => undefined,
    });

    const result = await chan.send(msg('sess-nonexistent', 'hi'));
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('no live session');
    await chan.stop();
  });

  it('refuses to send when not started', async () => {
    const chan = createCliRpcChannel();
    const result = await chan.send(msg('sess-1', 'hi'));
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('not started');
  });

  it('unregister removes the session listener', async () => {
    const chan = createCliRpcChannel();
    await chan.start({
      log: createLogger('test.cli-rpc'),
      onInbound: () => undefined,
    });

    const received: string[] = [];
    const unregister = chan.registerSession('sess-1', (m) => received.push(m.text));
    unregister();

    expect(chan.activeSessions()).toEqual([]);
    await chan.send(msg('sess-1', 'ignored'));
    expect(received).toEqual([]);

    await chan.stop();
  });
});
