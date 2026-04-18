import { describe, expect, it } from 'vitest';

import { createLogger, initLogger } from './logger.js';
import { dataDir, logsDir } from './paths.js';

describe('paths', () => {
  it('dataDir returns a non-empty path', () => {
    const d = dataDir();
    expect(d).toBeTruthy();
    expect(d.length).toBeGreaterThan(0);
  });

  it('logsDir lives under dataDir by default', () => {
    const original = process.env['FACTORY5_LOG_DIR'];
    delete process.env['FACTORY5_LOG_DIR'];
    try {
      const d = dataDir();
      const l = logsDir();
      expect(l.startsWith(d)).toBe(true);
    } finally {
      if (original !== undefined) process.env['FACTORY5_LOG_DIR'] = original;
    }
  });

  it('FACTORY5_LOG_DIR overrides logsDir', () => {
    const previous = process.env['FACTORY5_LOG_DIR'];
    process.env['FACTORY5_LOG_DIR'] = '/tmp/factory5-test-logs';
    try {
      expect(logsDir()).toBe('/tmp/factory5-test-logs');
    } finally {
      if (previous === undefined) delete process.env['FACTORY5_LOG_DIR'];
      else process.env['FACTORY5_LOG_DIR'] = previous;
    }
  });
});

describe('createLogger', () => {
  it('produces a logger with the component field set', () => {
    initLogger({ processName: 'factory', noFile: true, noConsole: true });
    const log = createLogger('test.component');
    expect(log.bindings()['component']).toBe('test.component');
  });

  it('child loggers carry both component and correlation context', () => {
    initLogger({ processName: 'factory', noFile: true, noConsole: true });
    const log = createLogger('test.component');
    const child = log.child({ directiveId: 'd-1', taskId: 't-1' });
    expect(child.bindings()['component']).toBe('test.component');
    expect(child.bindings()['directiveId']).toBe('d-1');
    expect(child.bindings()['taskId']).toBe('t-1');
  });
});
