---
description: Run the Control session bootstrap protocol
---

Follow `.control/runbooks/session-start.md` exactly:

1. Read `.control/progress/STATE.md`.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. List files in `.control/issues/OPEN/` and identify blockers for the current phase.
4. Verify git state matches STATE.md. Run:
   - `git status --porcelain`
   - `git log -1 --oneline`
   - `git rev-parse --abbrev-ref HEAD`
   - `git describe --tags --abbrev=0`
   Compare against STATE.md's "Git state" section. Any mismatch is a drift signal — flag it, don't silently proceed.
5. Report a status block in this exact shape:
   ```
   Phase <N> — <name>, step <N.M>
   Last action: <from STATE.md's Recently completed[0]>
   Git: branch=<...>, last=<sha> <subject>, uncommitted=<yes/no>, tag=<last phase tag>
   Git sync: ✓ matches STATE.md  OR  ⚠ drift: <details>
   Open blockers: <count, with IDs> OR None
   Test/eval status: <from STATE.md>
   Proposed next action: <from STATE.md>
   Ready to proceed?
   ```
6. Wait for the user's go before editing any code.
