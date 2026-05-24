# Phase 15 steps

- [x] 15.1 Scaffold tier (committed at 30fc07f)
- [x] 15.2 ADR 0034 (new) + ADR 0032 Status update + ADR 0030 amendment + ADR 0020 amendment
- [x] 15.3 Core: project-level config scalars (`autoIncreaseBudgets`, `autoIncreaseCeilingMultiplier`)
- [x] 15.4 State (wiki): project-metadata reads/writes for new scalars; delete `resolveDirectivePayloadBudgets`
- [x] 15.5 Brain: `computePoolUsage` helper in `pool-usage.ts`
- [x] 15.6 Brain: `pool-resume.ts` chokidar watcher
- [x] 15.7 Brain: pool-driven dispatcher rewrite (`pool.ts` + planner emit drop + worker watchdog wire-up)
- [x] 15.8 Brain: delete `budget-escalation.ts` + `[BUDGET]` branch in `auto-answer.ts`
- [x] 15.9 Daemon: HTTP/SSE surface (PUT /budget-defaults extended, GET /pool-usage, pool.tally SSE event)
- [x] 15.10 Web UI: project page tabbed cockpit
- [x] 15.11 Web UI: directive detail pool pill + build form copy update
- [x] 15.12 Phase close: recordkeeping complete; live browser smoke deferred to operator
