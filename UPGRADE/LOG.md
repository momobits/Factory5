# Upgrade log

Session-by-session handoff log. Append a new section at the **top** at session end. Most recent entry is what a new session reads first.

Each entry should answer: what was done, what was decided, what's next.

---

## 2026-05-02 — Audit + roadmap captured

Frozen the audit and the four-tier upgrade roadmap into this `UPGRADE/` directory. No code changes this session beyond the doc cleanup commits below; the roadmap is the deliverable.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (876 passed, 3 skipped)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- 15 packages, 3 apps, 28 ADRs, ~35.6k LOC of source

**Recent commits on `main` leading into this session:**

- `de17274` — `docs: consolidate to single ARCHITECTURE.md, drop build journal and resolved-issue tracker`
- `f6fb28c` — `chore: remove Control framework workflow`
- `fe5f770` — `chore(phase-15): close phase 15 still-quiet (no sub-steps shipped)` (last pre-cleanup commit)

**Decisions made this session:**

- Keep `docs/decisions/` (ADRs are load-bearing, cited from 150+ inline source comments).
- Removed `docs/issues/` (all 15 RESOLVED; bug-history is in git; design implications are captured in ADRs). Upgrade-time issues now live in [`ISSUES.md`](ISSUES.md).
- This `UPGRADE/` directory is not a Control-framework recreation — no hooks, no auto-snapshots, no slash commands. Just a workspace.
- Tier order: docs → channel parity → web UI → CLI completion. See [`ROADMAP.md`](ROADMAP.md).

**What's next:**

Pick **Tier 1** — the doc sweep. See [`plans/tier-1-doc-sweep.md`](plans/tier-1-doc-sweep.md). It's the shortest, least controversial, and the doc fixes will be cited from later tiers (especially Tier 2's channel responses, which should link to `docs/WORKFLOWS.md`).
