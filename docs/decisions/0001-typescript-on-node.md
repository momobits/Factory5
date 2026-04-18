# 0001 — TypeScript on Node 20+ as the implementation language

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Factory 5 needs a primary implementation language. The candidates were Rust, TypeScript on Bun, TypeScript on Node, and Python. Several factors push the decision:

- The factory must run on Windows and Linux without compile pain or platform-specific native-build trauma.
- It must integrate with multiple LLM provider SDKs (Anthropic, OpenAI, OpenRouter, Codex). The official Anthropic and OpenAI SDKs have first-class TypeScript support; the official Claude Agent SDK is TypeScript and Python only. Rust SDKs are community-maintained and lag features.
- It will be edited and reshaped frequently for months. A fast iteration loop (no recompile) significantly outpaces compile-heavy languages over the project's lifetime.
- Some referenced tools (`clawhip`) are Rust; others (`oh-my-openagent`, `oh-my-claudecode`, `openclaw`) are TypeScript. The TypeScript ecosystem produced the larger share of pattern inspiration.
- Factory's own performance bottleneck is LLM call latency (seconds per call). Rust vs TypeScript performance at the orchestration layer is microseconds vs milliseconds — invisible to the user.
- Cross-platform Node has been battle-tested for 15+ years; Bun's Windows native-module support is newer and occasionally surprising.

## Decision

All factory5 source code is **TypeScript** in strict mode, targeting **Node 20+**, ESM modules, NodeNext resolution.

- Bundler for production: `tsup` (esbuild-based)
- Dev runner: `tsx` (zero-config TypeScript execution with watch mode)
- Test runner: `vitest`
- Workspace manager: `pnpm`
- Lint: `eslint` + `@typescript-eslint`
- Format: `prettier`

The native dependency we accept is `better-sqlite3`, which ships prebuilt binaries for `win32-x64`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`. No C toolchain required for users on these platforms.

Python only appears as a runtime requirement on the user's machine _if_ they're building Python projects (so the assessor can run `pytest`). Python is not part of factory itself.

Rust appears only in `clawhip`, which is a separate optional reference daemon and is not depended on by factory itself for v0.

## Consequences

**Positive:**

- Cross-platform without compile hell
- Official LLM SDKs available (Anthropic, OpenAI, etc.)
- Fast iteration loop (no recompile)
- Familiar to a broad set of contributors
- Mature libraries for everything we need: `discord.js`, `chokidar`, `simple-git`, `fastify`, `commander`, `pino`, `zod`
- Single binary distribution still feasible via `pkg` / `@yao-pkg/pkg` later

**Negative:**

- Higher resident memory than Rust (~50–150 MB per process). Acceptable for personal/single-machine use.
- Dependency on Node runtime at install time (we ship a `.nvmrc` and document Node 20+ as the requirement).
- TypeScript strictness requires discipline; we enforce via `tsconfig.base.json` strict family + `eslint`.

**Reversible?** Partially. Pure TypeScript packages can be ported to Rust later if a specific component justifies it (e.g., extracting the daemon for performance under heavy load). The two-binary split (ADR 0002) makes such extractions contained.

## Alternatives considered

- **Rust everywhere** — Tempting because clawhip is already Rust and a single static binary is operationally clean. Rejected because:
  - LLM SDK story is weak (community Rust SDKs lag; Claude Agent SDK doesn't exist in Rust)
  - Cross-platform compile pain on Windows (libgit2, openssl-sys, sqlx native bindings)
  - Slower iteration during a months-long architecture-shaping phase
  - The performance benefit is invisible because the bottleneck is LLM latency

- **TypeScript on Bun** — Faster runtime, nicer DX. Rejected for v0 because Bun's Windows native-module compatibility is still maturing. Re-evaluate in a future ADR once architecture stabilizes.

- **Python (continuation of factory2)** — Rejected because Python orchestration was identified as a structural problem in factory2 (rigid, slow IPC with `claude -p`). Also: the patterns we want to lift are written in TypeScript.

- **Hybrid (Rust daemon + TypeScript brain)** — Considered seriously. Rejected for v0 because two languages = two toolchains = double the cross-platform pain. Single language with a clean two-binary split (ADR 0002) gives most of the architectural benefit without the toolchain tax.
