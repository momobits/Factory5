# Phase 14 Steps — Carry-forward continuation + ergonomics

> **Sub-step 14.1 opens next.** Subjects below are placeholders. Each
> sub-step body grows when its session opens — bound to whichever
> carry-forward is biting the operator at that moment.

## Phase 14 — Carry-forward continuation + ergonomics

- [x] 14.1 — **Stale-dist dev-loop gotcha (overdue since Phase 9).**
      Conditional exports + `tsx --conditions=development`: each
      `packages/*/package.json` adds `"development": "./src/<entry>.ts"`
      to its `exports` map; root `pnpm factoryd` / `pnpm factory` and
      each app's `dev` script pass `--conditions=development` so dev
      runs route to source. Prod path (`node dist/main.js`) unchanged.
      Verified: factoryd boots cleanly with `packages/daemon/dist/`
      removed; same boot fails with `ERR_MODULE_NOT_FOUND` when the
      flag is absent. 855 tests still green.

- [ ] 14.2 — **Second carry-forward.** Same shape as 14.1. Pick from
      the remaining candidate pool by demand signal.

- [ ] 14.3 — **Third carry-forward.** Same.

- [ ] 14.4 — _(optional)_ **Fourth carry-forward.** May not be
      reached if the first three exhaust the pain.

- [ ] 14.5 — **Phase close.** Tag
      `phase-14-carry-forward-continuation-closed`. Author
      `docs/Phase14_Progress.md`, prepend a Phase 14 entry to
      `docs/PROGRESS.md`. Likely no `CompleteArchitecture.md` change
      (sweep phase). Scaffold Phase 15 by demand signal.
