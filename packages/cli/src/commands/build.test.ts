import { describe, expect, it } from 'vitest';

import type { ProjectMetadata } from '@factory5/wiki';

import { languageFromProjectMeta } from './build.js';

const baseMeta = (metadata: Record<string, unknown>): ProjectMetadata => ({
  id: '01KQ0P14MZZPJRPA5RW929TTSJ',
  name: 'sample',
  createdAt: '2026-04-25T00:00:00.000Z',
  factoryVersion: '0.x',
  metadata,
});

describe('languageFromProjectMeta (Phase 10.8 fallback)', () => {
  it('returns the recognised language when set', () => {
    expect(languageFromProjectMeta(baseMeta({ language: 'node' }))).toBe('node');
    expect(languageFromProjectMeta(baseMeta({ language: 'python' }))).toBe('python');
    expect(languageFromProjectMeta(baseMeta({ language: 'go' }))).toBe('go');
    expect(languageFromProjectMeta(baseMeta({ language: 'rust' }))).toBe('rust');
  });

  it('returns undefined when metadata.language is absent', () => {
    expect(languageFromProjectMeta(baseMeta({}))).toBeUndefined();
  });

  it('returns undefined when metadata.language is an unrecognised string', () => {
    expect(languageFromProjectMeta(baseMeta({ language: 'kotlin' }))).toBeUndefined();
  });

  it('returns undefined when metadata.language is non-string', () => {
    expect(languageFromProjectMeta(baseMeta({ language: 42 }))).toBeUndefined();
    expect(languageFromProjectMeta(baseMeta({ language: null }))).toBeUndefined();
    expect(languageFromProjectMeta(baseMeta({ language: ['node'] }))).toBeUndefined();
  });
});
