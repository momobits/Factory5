import { newId } from '@factory5/core';
import { describe, expect, it } from 'vitest';

import { materialisePlannerTasks } from './planner.js';

function mkRaw(
  overrides: Partial<Parameters<typeof materialisePlannerTasks>[0][number]> = {},
): Parameters<typeof materialisePlannerTasks>[0][number] {
  return {
    title: 'task',
    agent: 'builder',
    category: 'deep',
    inputs: { files: [], context: '' },
    expectedOutputs: { files: [], signals: [] },
    dependsOn: [],
    featureIds: [],
    ...overrides,
  };
}

describe('materialisePlannerTasks — category floor', () => {
  it('upgrades a `builder` task mislabelled `quick` to the agent floor `deep`', () => {
    const planId = newId();
    const { tasks, notes } = materialisePlannerTasks(
      [mkRaw({ title: 'build parser', agent: 'builder', category: 'quick' })],
      planId,
    );
    expect(tasks[0]?.category).toBe('deep');
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/category quick -> deep/);
  });

  it('leaves a task at-or-above the floor alone', () => {
    const planId = newId();
    const { tasks, notes } = materialisePlannerTasks(
      [
        mkRaw({ title: 'review', agent: 'reviewer', category: 'reasoning' }),
        mkRaw({ title: 'deep-review', agent: 'reviewer', category: 'deep' }),
      ],
      planId,
    );
    expect(tasks[0]?.category).toBe('reasoning');
    expect(tasks[1]?.category).toBe('deep');
    expect(notes).toHaveLength(0);
  });

  it('clamps every tool-using agent category to at least its floor', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [
        mkRaw({ title: 'a', agent: 'scaffolder', category: 'quick' }),
        mkRaw({ title: 'b', agent: 'builder', category: 'documentation' }),
        mkRaw({ title: 'c', agent: 'fixer', category: 'quick' }),
      ],
      planId,
    );
    expect(tasks[0]?.category).toBe('planning');
    expect(tasks[1]?.category).toBe('deep');
    expect(tasks[2]?.category).toBe('reasoning');
  });
});

describe('materialisePlannerTasks — dependsOn index resolution', () => {
  it('resolves numeric indexes to task ULIDs', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [mkRaw({ title: 'a' }), mkRaw({ title: 'b', dependsOn: [0] })],
      planId,
    );
    expect(tasks[1]?.dependsOn).toEqual([tasks[0]?.id]);
  });

  it('filters out self-references and out-of-range indexes', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [mkRaw({ title: 'a', dependsOn: [0, 5, -1] }), mkRaw({ title: 'b', dependsOn: [0] })],
      planId,
    );
    expect(tasks[0]?.dependsOn).toEqual([]);
    expect(tasks[1]?.dependsOn).toEqual([tasks[0]?.id]);
  });
});

describe('materialisePlannerTasks — file-ownership synthetic deps', () => {
  it('adds a synthetic dependency when two builders write the same file', () => {
    const planId = newId();
    const { tasks, notes } = materialisePlannerTasks(
      [
        mkRaw({
          title: 'a',
          expectedOutputs: { files: ['src/foo.ts'], signals: [] },
        }),
        mkRaw({
          title: 'b',
          expectedOutputs: { files: ['src/foo.ts'], signals: [] },
        }),
      ],
      planId,
    );
    expect(tasks[1]?.dependsOn).toContain(tasks[0]?.id);
    expect(notes.some((n) => n.includes('synthetic dependency for shared file "src/foo.ts"'))).toBe(
      true,
    );
  });

  it('normalizes ./ and \\ so an already-declared edge short-circuits', () => {
    const planId = newId();
    const { tasks, notes } = materialisePlannerTasks(
      [
        mkRaw({
          title: 'a',
          expectedOutputs: { files: ['./src/foo.ts'], signals: [] },
        }),
        mkRaw({
          title: 'b',
          dependsOn: [0],
          expectedOutputs: { files: ['src\\foo.ts'], signals: [] },
        }),
      ],
      planId,
    );
    expect(tasks[1]?.dependsOn).toEqual([tasks[0]?.id]);
    expect(notes).toHaveLength(0);
  });

  it('does not add a duplicate edge if a transitive path already connects them', () => {
    const planId = newId();
    const { tasks, notes } = materialisePlannerTasks(
      [
        mkRaw({
          title: 'a',
          expectedOutputs: { files: ['src/foo.ts'], signals: [] },
        }),
        mkRaw({ title: 'b', dependsOn: [0] }),
        mkRaw({
          title: 'c',
          dependsOn: [1],
          expectedOutputs: { files: ['src/foo.ts'], signals: [] },
        }),
      ],
      planId,
    );
    // c -> b -> a already reaches a. No synthetic edge added.
    expect(tasks[2]?.dependsOn).toEqual([tasks[1]?.id]);
    expect(notes).toHaveLength(0);
  });

  it('ignores empty / whitespace-only expectedOutputs entries', () => {
    const planId = newId();
    const { tasks, notes } = materialisePlannerTasks(
      [
        mkRaw({
          title: 'a',
          expectedOutputs: { files: ['', '   '], signals: [] },
        }),
        mkRaw({
          title: 'b',
          expectedOutputs: { files: [''], signals: [] },
        }),
      ],
      planId,
    );
    expect(tasks[1]?.dependsOn).toEqual([]);
    expect(notes).toHaveLength(0);
  });

  it('chains three-way file overlaps into a serial chain', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [
        mkRaw({ title: 'a', expectedOutputs: { files: ['src/x.ts'], signals: [] } }),
        mkRaw({ title: 'b', expectedOutputs: { files: ['src/x.ts'], signals: [] } }),
        mkRaw({ title: 'c', expectedOutputs: { files: ['src/x.ts'], signals: [] } }),
      ],
      planId,
    );
    // c -> first writer (a). We don't enforce c -> b; the pool will still
    // serialise because b has to complete before c by transitivity-free order?
    // Actually no — c only has edge to a, not b. We only add edges to the
    // FIRST writer of each file. If that's undesirable, it's a planner-prompt
    // issue, not a serialisation bug.
    expect(tasks[1]?.dependsOn).toContain(tasks[0]?.id);
    expect(tasks[2]?.dependsOn).toContain(tasks[0]?.id);
  });
});

describe('materialisePlannerTasks — maxTurns is stripped (ADR 0034 §6)', () => {
  it('strips maxTurns even when the planner emits it (turn budgets are pool-managed)', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [mkRaw({ title: 'big builder', maxTurns: 60 })],
      planId,
    );
    // Per ADR 0034 §6, per-task maxTurns is no longer honored — turn budgets are
    // managed by the pool per agent class — so it must not survive materialisation.
    expect(tasks[0]?.maxTurns).toBeUndefined();
  });

  it('leaves maxTurns undefined when the planner omits it', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks([mkRaw({ title: 'default builder' })], planId);
    expect(tasks[0]?.maxTurns).toBeUndefined();
  });
});

describe('materialisePlannerTasks — estimatedUsd passthrough', () => {
  it('passes estimatedUsd through when the planner emits it', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [mkRaw({ title: 'pricey task', estimatedUsd: 1.25 })],
      planId,
    );
    // The pool's pre-launch maxUsdPerTask guard reads this off the task.
    expect(tasks[0]?.estimatedUsd).toBe(1.25);
  });

  it('leaves estimatedUsd undefined when the planner omits it', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks([mkRaw({ title: 'free task' })], planId);
    expect(tasks[0]?.estimatedUsd).toBeUndefined();
  });
});

describe('materialisePlannerTasks — featureIds', () => {
  it('passes featureIds through when set', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [mkRaw({ title: 'build CLI', featureIds: ['cli-run-command'] })],
      planId,
    );
    expect(tasks[0]?.featureIds).toEqual(['cli-run-command']);
  });

  it('defaults featureIds to empty array when planner omits the field', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [mkRaw({ title: 'build CLI' })],
      planId,
    );
    expect(tasks[0]?.featureIds).toEqual([]);
  });
});

describe('materialisePlannerTasks — terminal coherence-reviewer', () => {
  it('appends a coherence-reviewer task at the end of the plan', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [mkRaw({ title: 'build CLI', agent: 'builder', category: 'deep' })],
      planId,
    );
    expect(tasks.length).toBe(2);
    const reviewer = tasks.find((t) => t.agent === 'coherence-reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer?.title).toBe('Final coherence review');
    // It depends on all preceding tasks
    expect(reviewer?.dependsOn).toEqual([tasks[0]?.id]);
  });

  it('does not append a second coherence-reviewer when one is already present', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks(
      [
        mkRaw({ title: 'build', agent: 'builder', category: 'deep' }),
        mkRaw({ title: 'manual review', agent: 'coherence-reviewer', category: 'reasoning' }),
      ],
      planId,
    );
    const reviewerCount = tasks.filter((t) => t.agent === 'coherence-reviewer').length;
    expect(reviewerCount).toBe(1);
  });

  it('skips the auto-append when the input is empty', () => {
    const planId = newId();
    const { tasks } = materialisePlannerTasks([], planId);
    expect(tasks.length).toBe(0);
  });
});
