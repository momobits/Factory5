# Control framework configuration -- tunable per project.
# This file is SOURCED by hooks and (conceptually) by command descriptions.
# Shell-compatible: bash variable assignments only, no YAML/JSON parsing required.
#
# Change values here; do not edit hook scripts or command files directly.

# --- Autonomous operation ---

# Hard cap on /loop /work-next iterations per session
CONTROL_MAX_AUTO_ITERATIONS=20

# Halt-the-loop conditions -- space-separated. /work-next reads this.
CONTROL_HALT_CONDITIONS="new_adr_needed blocker_no_hypothesis ambiguous_failing_test manual_smoke_test user_acceptance secret_needed destructive_action iteration_budget_hit"

# --- Git conventions ---

# Commit message shape (documentation; /session-end reads this to propose messages)
CONTROL_COMMIT_FORMAT='{type}({phase}.{step}): {subject}'

# Allowed commit types -- space-separated
CONTROL_COMMIT_TYPES="feat fix test docs refactor chore"

# Phase close tag shape
CONTROL_PHASE_CLOSE_TAG_FORMAT='phase-{n}-{name}-closed'

# --- Issue severity gating ---

# Severities that require a file in .control/issues/OPEN/ (space-separated)
CONTROL_ISSUE_FILE_REQUIRED_FOR="blocker major"

# Severities that only get a journal line
CONTROL_ISSUE_JOURNAL_ONLY="minor"

# --- Hook behaviour ---

# Keep at most this many snapshots in .control/snapshots/
CONTROL_SNAPSHOT_RETENTION_COUNT=50

# Or this many days -- whichever triggers first
CONTROL_SNAPSHOT_RETENTION_DAYS=14

# Fail loudly if a hook script errors (true/false)
CONTROL_FAIL_ON_HOOK_ERROR=true

# --- Session start report ---

# Keys to include in the bootstrap report (space-separated, for documentation)
CONTROL_SESSION_START_REPORT="phase_step last_action git_state git_sync_check open_blockers test_eval_status next_action"
