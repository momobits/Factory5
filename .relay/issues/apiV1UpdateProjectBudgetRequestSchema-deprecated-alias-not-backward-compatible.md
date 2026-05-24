*Created: 2026-05-24*

# Deprecated `apiV1UpdateProjectBudgetRequestSchema` alias is not backward-compatible

**Severity:** P3 low — the alias label says `@deprecated Use {@link apiV1ProjectBudgetDefaultsPutBodySchema} directly` and "any downstream consumer that still imports the old name compiles." Grep confirms zero in-repo consumers still import the old name. But external code (operator scripts, integrations, snapshots in tooling outside this repo) reading the old shape — `{maxUsd: 5, maxSteps: 100}` directly — would fail at runtime because Tier 15.9 changed the body shape to a wrapper: `{budgetDefaults: {...}, autoIncreaseBudgets, autoIncreaseCeilingMultiplier}`. The alias is a *lie about compatibility*.

## Problem statement

`packages/ipc/src/schemas.ts:651-658`:

```ts
/**
 * Pre-Tier-15 alias for the PUT body schema. Kept as a re-export so any
 * downstream consumer that still imports the old name compiles; the schema
 * now accepts the wrapped shape so callers must update their request bodies.
 *
 * @deprecated Use {@link apiV1ProjectBudgetDefaultsPutBodySchema} directly.
 */
export const apiV1UpdateProjectBudgetRequestSchema = apiV1ProjectBudgetDefaultsPutBodySchema;
export type ApiV1UpdateProjectBudgetRequest = z.infer<typeof apiV1UpdateProjectBudgetRequestSchema>;
```

The comment itself admits the breakage: _"the schema now accepts the wrapped shape so callers must update their request bodies."_ So the alias compiles symbol-level (the name resolves) but the **runtime contract is different**. A consumer that did:

```ts
// Pre-Tier-15 valid:
const body: ApiV1UpdateProjectBudgetRequest = { maxUsd: 5, maxSteps: 100 };
fetch('/api/v1/projects/x/budget', { method: 'PUT', body: JSON.stringify(body) });
```

…compiles type-clean against the new type (because the type is now `{budgetDefaults?, autoIncreaseBudgets?, autoIncreaseCeilingMultiplier?}` — all optional, the structure is wrong but TypeScript allows it because `maxUsd` and `maxSteps` are excess properties that get stripped at JSON-serialize). But the daemon's PUT route uses `.strict()` mode (`packages/ipc/src/schemas.ts:639-645`) and rejects with a Zod parse error.

This is the WORST kind of deprecation:
1. Symbol still resolves (compiler is silent)
2. JSDoc says "compiles" (misleading — compile vs runtime)
3. Runtime behavior is silently broken (strict-mode rejection)

A clean deprecation would either:
- **Delete the alias** (consumers get a clear "module has no exported member" compile error and migrate)
- **Make the alias a NEW schema that accepts the OLD shape** (true backward compat: alias accepts `{maxUsd, maxSteps}` and adapts to the wrapped shape internally)
- **Re-export with a runtime adapter** (parse old shape, return new shape's parse result)

The current implementation is the worst of all worlds.

## Current state

- `packages/ipc/src/schemas.ts:657` — the alias just re-exports the new schema
- `packages/ipc/src/schemas.ts:658` — type alias inferred from the same
- No in-repo consumers: `grep -rn "apiV1UpdateProjectBudgetRequestSchema" packages/` returns only the definition site
- ADR 0027 still documents the old shape in its illustrative code at `docs/decisions/0027-web-ui-mutation-surface.md:229`

## Impact

External consumers using the deprecated alias (operator integration scripts, the example body shape in ADR 0027 that operators might copy) will see strict-mode 400 errors at runtime with no compile-time signal. The doc-comment explicitly suggests it's safe to leave the import in place — which it isn't.

This is a tier-12-13 era doc-debt that became active risk in tier 15 when the body shape widened.

## Proposed fix

Three real options, ordered by clean:

1. **Delete the alias.** It's been deprecated long enough; consumers had time to migrate; grep confirms no in-repo usage. The deletion produces a clear compile-time error message for any external consumer still on the old name, and the JSDoc on the new name (`apiV1ProjectBudgetDefaultsPutBodySchema`) explains the body shape clearly.

2. **Rewrite the alias as a true back-compat shim.** Define a separate schema that accepts the old `{maxUsd?, maxSteps?}` flat shape, then wrap it server-side into the new `{budgetDefaults: {...}}` shape before persisting. Adds runtime work but lets the deprecation actually be a deprecation.

3. **Rewrite the alias's JSDoc to be honest.** _"WARNING: This alias points at the new (Tier 15.9) wrapped body shape. The old flat `{maxUsd, maxSteps}` shape no longer parses. Update your client immediately."_

Recommend option 1. Minimal blast radius — no in-repo consumers, single import-site deletion, ADR 0027 amendment to drop the line. Operators using the alias will see a clear compile error on their next pull rather than a silent runtime 400.

## Affected files

- `packages/ipc/src/schemas.ts:651-658` — delete the alias + type alias
- `packages/ipc/src/index.ts` — drop re-export if present
- `docs/decisions/0027-web-ui-mutation-surface.md:229` — amend to show the new wrapped shape
- Possibly `UPGRADE/LOG.md` or `CHANGELOG.md` to record the breaking-name change (already breaking at runtime; the deletion just makes it a compile signal)
