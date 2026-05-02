import { describe, expect, it } from 'vitest';

import { extractProjectName, pickStatusSubtype, routeChatIntent } from './chat-routing.js';

describe('routeChatIntent', () => {
  it('returns undefined for chat / fix / review / investigate', () => {
    for (const intent of ['chat', 'fix', 'review', 'investigate'] as const) {
      expect(
        routeChatIntent({ intent, confidence: 0.9, reasoning: '' }, 'something'),
      ).toBeUndefined();
    }
  });

  it('routes intent=status to runStatus by default', () => {
    const out = routeChatIntent(
      { intent: 'status', confidence: 0.9, reasoning: '' },
      "what's running",
    );
    expect(out).toEqual({ command: 'status', input: {} });
  });

  it('routes intent=status with spend keywords to runSpend', () => {
    const out = routeChatIntent(
      { intent: 'status', confidence: 0.9, reasoning: '' },
      'show me the spend',
    );
    expect(out?.command).toBe('spend');
  });

  it('routes intent=status with findings keywords to runFindings', () => {
    const out = routeChatIntent(
      { intent: 'status', confidence: 0.85, reasoning: '' },
      'any open findings?',
    );
    expect(out?.command).toBe('findings');
    expect((out?.input as { status?: string }).status).toBe('OPEN');
  });

  it('routes intent=resume with a clear single-token project', () => {
    const out = routeChatIntent(
      { intent: 'resume', confidence: 0.92, reasoning: '' },
      'resume dropbox-clone',
    );
    expect(out).toEqual({ command: 'resume', input: { project: 'dropbox-clone' } });
  });

  it('routes intent=resume strips filler words', () => {
    const out = routeChatIntent(
      { intent: 'resume', confidence: 0.92, reasoning: '' },
      'resume the dropbox',
    );
    expect(out).toEqual({ command: 'resume', input: { project: 'dropbox' } });
  });

  it('falls through on intent=resume without a clean project token', () => {
    expect(
      routeChatIntent(
        { intent: 'resume', confidence: 0.85, reasoning: '' },
        'resume the build I was working on yesterday',
      ),
    ).toBeUndefined();
  });

  it('routes intent=build with a clean project token', () => {
    const out = routeChatIntent(
      { intent: 'build', confidence: 0.95, reasoning: '' },
      'build notes-app',
    );
    expect(out).toEqual({ command: 'build', input: { project: 'notes-app' } });
  });

  it('falls through on intent=cancel (explicit-only by design)', () => {
    expect(
      routeChatIntent({ intent: 'cancel', confidence: 0.95, reasoning: '' }, 'cancel 01KQABCDEF'),
    ).toBeUndefined();
  });

  it('returns undefined on empty text', () => {
    expect(
      routeChatIntent({ intent: 'status', confidence: 0.9, reasoning: '' }, '   '),
    ).toBeUndefined();
  });
});

describe('pickStatusSubtype', () => {
  it('picks spend for cost-related text', () => {
    expect(pickStatusSubtype('how much have we spent')).toBe('spend');
    expect(pickStatusSubtype('show $ usage')).toBe('spend');
    expect(pickStatusSubtype('total cost')).toBe('spend');
  });
  it('picks findings for issue-related text', () => {
    expect(pickStatusSubtype('any open findings?')).toBe('findings');
    expect(pickStatusSubtype('show advisory warnings')).toBe('findings');
    expect(pickStatusSubtype('open bugs in the build')).toBe('findings');
  });
  it('falls back to status', () => {
    expect(pickStatusSubtype("what's running?")).toBe('status');
    expect(pickStatusSubtype('show me directives')).toBe('status');
  });
  it('treats plural and singular alike', () => {
    expect(pickStatusSubtype('issue list')).toBe('findings');
    expect(pickStatusSubtype('issues list')).toBe('findings');
  });
});

describe('extractProjectName', () => {
  it('extracts a single bare token', () => {
    expect(extractProjectName('resume foo', ['resume'])).toBe('foo');
  });
  it('strips filler words', () => {
    expect(extractProjectName('resume the foo', ['resume'])).toBe('foo');
    expect(extractProjectName('build a notes-app', ['build', 'make'])).toBe('notes-app');
  });
  it('rejects multi-word remainders', () => {
    expect(extractProjectName('resume foo bar', ['resume'])).toBeUndefined();
  });
  it('rejects empty / too-short remainders', () => {
    expect(extractProjectName('resume', ['resume'])).toBeUndefined();
    expect(extractProjectName('resume x', ['resume'])).toBeUndefined();
  });
  it('rejects punctuation in the project token', () => {
    expect(extractProjectName('resume foo.bar', ['resume'])).toBeUndefined();
    expect(extractProjectName('resume foo/bar', ['resume'])).toBeUndefined();
  });
  it('accepts dashes and underscores in the token', () => {
    expect(extractProjectName('resume my-project', ['resume'])).toBe('my-project');
    expect(extractProjectName('resume my_project', ['resume'])).toBe('my_project');
  });
  it('matches verb prefixes case-insensitively', () => {
    expect(extractProjectName('Resume Foo', ['resume'])).toBe('Foo');
    expect(extractProjectName('BUILD bar', ['build'])).toBe('bar');
  });
});
