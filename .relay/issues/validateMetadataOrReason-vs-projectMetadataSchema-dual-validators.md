*Created: 2026-05-24*

# `validateMetadataOrReason` (read path) and `projectMetadataSchema` (write path) are dual validators that can drift

**Severity:** P2 medium — both validators describe the same on-disk shape but live in different packages with different validation logic. Drift risk increases every time the metadata shape evolves (e.g., adding the Tier 15 `autoIncreaseBudgets` / `autoIncreaseCeilingMultiplier` scalars).

## Problem statement

`<project>/.factory/project.json` has two validators:

1. **Write path** — `packages/wiki/src/project-metadata.ts:337` uses the Zod schema `projectMetadataSchema` from `@factory5/core` to validate before writing. Catches malformed Tier 15 scalars (e.g., `autoIncreaseCeilingMultiplier: -1`) at write time.

2. **Read path** — `packages/wiki/src/project-metadata.ts:357-379` uses a hand-rolled `validateMetadataOrReason` function inside the same file. Doesn't reference the Zod schema. Only checks the four legacy fields (id, name, createdAt, factoryVersion) and accepts `metadata` as any object.

The read-path validator's JSDoc explicitly says:
> _"Hand-validated rather than Zod-ed because the file is read at every directive-creation path — keeping this dependency-light is worth the handful of explicit checks."_

And `writeProjectMetadata`'s JSDoc says:
> _"The read path keeps its lenient `validateMetadataOrReason` for backward compat."_

The asymmetry is intentional, but it has two real consequences:

**Consequence A — Read tolerates what write rejects.** If `autoIncreaseCeilingMultiplier: -1` ever gets onto disk (manual edit, restored from a backup with a regression, third-party tooling that writes the file), the read path accepts the file silently. The pool's `parkOrAutoIncrease` (which reads `metadata.autoIncreaseCeilingMultiplier`) at `packages/brain/src/pool.ts:303-304` falls back to the default multiplier `5` if the type-check fails (`typeof === 'number'`) — so the value is silently coerced to default. Operator sees the safety-multiplier label "5" in the UI but the disk says "-1". Drift between observed and actual.

**Consequence B — Two definitions of "valid" must co-evolve.** When a future tier adds a new key (say `defaultAgentCategory` or another auto-* toggle), the developer must remember to update BOTH validators. The Zod schema enforces it at write time; the hand-rolled validator just ignores unknown keys and lets them through. Forgetting to update the Zod schema means writes reject the new key; forgetting to update the hand-rolled validator means reads silently miss validation. Tier 15 itself added two scalars and updated `projectMetadataSchema` but did NOT extend `validateMetadataOrReason`'s field-level checks.

## Current state

**Read path** — `packages/wiki/src/project-metadata.ts:357-379`:

```ts
function validateMetadataOrReason(raw: unknown): ProjectMetadata | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object';
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !ULID_RE.test(obj.id)) return 'id missing or not a ULID';
  if (typeof obj.name !== 'string' || obj.name.length === 0) return 'name missing or empty';
  if (typeof obj.createdAt !== 'string' || obj.createdAt.length === 0) {
    return 'createdAt missing or empty';
  }
  if (typeof obj.factoryVersion !== 'string' || obj.factoryVersion.length === 0) {
    return 'factoryVersion missing or empty';
  }
  const metadata =
    typeof obj.metadata === 'object' && obj.metadata !== null && !Array.isArray(obj.metadata)
      ? (obj.metadata as Record<string, unknown>)
      : {};
  return { id: obj.id, name: obj.name, createdAt: obj.createdAt, factoryVersion: obj.factoryVersion, metadata };
}
```

**Write path** — `packages/wiki/src/project-metadata.ts:336-337`:

```ts
// Validate through the typed Zod schema — catches malformed scalars at write time.
projectMetadataSchema.parse(meta);
```

**Schema** — `packages/core/src/schemas.ts` exports `projectMetadataSchema` with the full Tier 15 shape (id + name + createdAt + factoryVersion + nested metadata.budgetDefaults + autoIncreaseBudgets + autoIncreaseCeilingMultiplier).

The Tier 15.3 review note (per the original suspect list in the relay-discover prompt) flagged this exact gap; Tier 15.4 added the Zod write path but read path still uses the hand-rolled.

## Impact

1. **`autoIncreaseCeilingMultiplier: -1` (or other manually-injected bad data) bypasses validation on read.** The pool quietly falls back to default multiplier; operator sees confusing behavior with no error log.
2. **Future schema additions require careful dual-update.** Easy to miss. Phase 13.5 widened `projectBudgetDefaultsSchema` to all axes (the Zod side); the hand-rolled read path doesn't reach into `metadata.budgetDefaults` at all (it just stores the bag as `Record<string, unknown>` and delegates to per-axis readers like `budgetDefaultsFromProjectMeta`).
3. **Lenient read + strict write can produce orphan rows.** Write a `{autoIncreaseCeilingMultiplier: 5}` file with `writeProjectMetadata`; manually edit to `-1` on disk; read succeeds; pool falls back; subsequent write via `updateProjectMetadata` (read-modify-write at `project-metadata.ts:269-285`) passes the read through `validateMetadataOrReason` (does not reject `-1`) and into the mutator — then `writeProjectMetadata` rejects with Zod error. Update fails because of pre-existing bad data; operator can't easily fix from the UI.

## Proposed fix

Three options ordered by aggressive:

1. **Adopt the Zod schema on the read path too.** Remove `validateMetadataOrReason`; use `projectMetadataSchema.safeParse(parsed)` and surface Zod's first issue as the corrupt-error reason. Keeps validation in one place. The "dependency-light" rationale in the read-path JSDoc no longer holds — `@factory5/wiki` already imports `projectBudgetDefaultsSchema` and `projectMetadataSchema` from `@factory5/core` for other read helpers (`budgetDefaultsFromProjectMeta`). Adding one more parse call is a no-op cost.

2. **Make the hand-rolled validator stricter — explicitly check each known key in `metadata`.** Drifts at every new key but stays detectable.

3. **Document the asymmetry as deliberate, never fix.** Add a clearer comment at both sites pointing at the other. Acceptable only if the cost of consequence A and B is judged below the cost of either fix above.

Recommend option 1. The read path's hand-rolled implementation is older than the Tier 15.4 write-path Zod adoption; it's residue from when `@factory5/core` didn't export the schema. Drop it.

## Affected files

- `packages/wiki/src/project-metadata.ts` — delete `validateMetadataOrReason`, replace call sites with Zod parse
- `packages/wiki/src/project-metadata.test.ts` — update tests asserting on the hand-rolled error messages to match Zod's error shape (or extract via `.issues[0]`)
- `packages/core/src/schemas.ts` — possibly add a more operator-friendly error formatter helper for the corrupt-file path
