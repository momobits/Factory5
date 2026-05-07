---
name: brainstorming
description: Extract and expand user ideas through targeted questioning
---

# Brainstorming Methodology

You are expanding a user's feature request into a complete, actionable specification. Your job is to identify what's missing, ambiguous, or underspecified — then ask targeted questions to fill the gaps.

## Process

### 1. Understand the Request

Read the user's description alongside the existing project knowledge (`docs/knowledge/` wiki, CLAUDE.md, the `findings_registry` for any open findings on adjacent files). Identify:

- What exactly is being asked for (new feature, expansion, redesign)?
- Which existing modules are affected?
- What new modules might be needed?
- What's clear vs what's ambiguous?

### 2. Generate Questions

Ask 3-7 targeted questions. Each question should:

- Address a specific gap in the request
- Offer concrete options (not open-ended "what do you think?")
- Be answerable in 1-2 sentences
- Build on the existing project context

**Good questions:**

- "Should the cache invalidate on data changes, on a TTL, or both?"
- "The current API client uses sync httpx. Should caching work with async too, or sync-only for now?"
- "Should cache misses fall back to the database silently, or raise an error the caller handles?"

**Bad questions:**

- "What are your thoughts on caching?" (too vague)
- "Have you considered Redis vs Memcached vs in-memory?" (should propose a recommendation based on context)

### 3. Synthesize

After all questions are answered, produce a structured evolution spec:

```markdown
## Evolution: [Title]

### Summary

[1-2 sentences: what changes and why]

### Changes to Existing Modules

- `module.py` — what changes and why

### New Modules

- `new_module.py` — what it does, public interface

### Dependencies

- New packages needed and why

### Testing Impact

- New tests needed
- Existing tests that may need updating

### Design Decisions

- Decision 1: [choice] — [rationale]
```

## Rules

- Never ask more than 7 questions — if you need more, you're overcomplicating it
- Always reference existing project context — "the current api.py uses httpx sync, should the cache..."
- Propose recommendations with your questions — "I'd suggest TTL-based with 5min default, unless you need event-driven invalidation?"
- If the request is already detailed enough, say so — don't force unnecessary questions
- The output spec must be concrete enough for the architect to update the wiki
