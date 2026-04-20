# ADRs live under `docs/decisions/`

factory5 maintains its Architecture Decision Records under [`docs/decisions/`](../../../docs/decisions/), not here. The authoritative index is [`docs/decisions/INDEX.md`](../../../docs/decisions/INDEX.md) — currently 17 accepted ADRs (0001 → 0017).

## Why this directory is empty

factory5's ADR shape (100–200 lines per record, `INNN` numbering, Context / Decision / Alternatives / Consequences with enumerated reasoning) predates the Control install (2026-04-21). Control's `/new-adr` default template is a 20-line skeleton — thinner than factory5's established practice. Rather than fork into two ADR homes, factory5's `docs/decisions/` stays authoritative.

See `CLAUDE.md` §"Control framework (operational layer)" for the full content-vs-operational split.

## If you run `/new-adr`

Point the output at `docs/decisions/NNNN-<slug>.md` using factory5's shape (copy an existing ADR as a template; ADR-0017 is the most recent and richest exemplar at 223 lines). Update `docs/decisions/INDEX.md`. Do not create files in this directory.

## This directory is reserved for

A future decision to migrate to Control-native ADRs. Not planned.
