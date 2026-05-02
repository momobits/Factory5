# Journal

Append-only, newest on top. One entry per session, short. Minor fixes land here as one-line entries (see Issue flow in `.control/PROJECT_PROTOCOL.md`).

## 2026-05-02 — Phase 1 closed; Phase 2 kicked off
- Phase 1 (doc-sweep) closed: tag `phase-1-doc-sweep-closed` on `10e400a`; close commit `1384ae8`.
- Step range 1.1-1.8 across `91541a9..10e400a` (9 commits, doc-only).
- Issues closed: U001, U002, U003, U014, U015, U016, U017 (7 of 23 catalogued; all Tier-1).
- ADRs decided: none (doc-only phase, as anticipated).
- Minor fixes: orphan `factory inspect` reference removed from `packages/logger/README.md` while sweeping for broken refs.
- Blockers hit: none. Hook drift at session start (commit-mismatch + tag-mismatch) reconciled via `91541a9` before any step work began.
- All four `pnpm` gates green throughout (build, test 876p/3s, lint, format:check).
- Next: step 2.1 — wire Discord slash commands.

## 2026-05-02 — Session bootstrap
- Control framework v2.2.1 installed (commit `e94393e`); `/bootstrap` populated SPEC + phase plan + Phase 1 scaffold.
- Next: Phase 1 doc-sweep.
