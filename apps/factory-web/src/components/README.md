# `apps/factory-web/src/components/`

The factory5 Astro component library. Eight server-rendered components
covering the dashboard's structural surface — cards, tables, alerts,
forms, page shells. Step 3.4 wired every page in
`apps/factory-web/src/pages/` through these and retired the inline
`el(...)` + `loadInto(...)` helpers from `lib/api.ts`.

> **3.4 status — fully consumed by every page in `pages/`.** Each
> component owns its scoped CSS via Astro's `<style>` block; the
> `id?` / `loading?` extensions on `<Card>` and `<Table>` (added
> during 3.4) cover the runtime-fetched-data pattern where the page's
> `<script>` populates a server-rendered placeholder by `id`.
>
> **Note on `Dashboard.astro` CSS.** The dashboard layout's class-based
> styles (`.cards`, `.card`, `.empty`, `.err`, `.btn*`, `.alert*`,
> `.form-*`, `table`/`th`/`td`) survive the conversion intentionally
> — Astro's scoped CSS does not propagate the layout's
> `data-astro-cid-*` attribute to slot content, so those rules already
> only matched elements rendered directly inside `Dashboard.astro`'s
> own template (the `<header class="shell">` chrome and the inner
> `<h2>`). Pruning them would not visually regress anything because
> they were not applying to slot content; leaving them in place keeps
> the door open for a future `<style is:global>` adoption that would
> let the layout actually style slot-level `<div class="cards">`,
> `<p class="err">`, etc. without per-page repetition. `<PageShell>`
> adoption likewise sits as deferred sugar — Dashboard's inner `<h2>`
> still owns the page title; PageShell can be wired across all pages
> in a focused follow-up step alongside removing that `<h2>` and
> shifting Dashboard styles to `is:global`.

## Conventions

- **Palette.** Every component uses
  `color-mix(in srgb, currentColor X%, transparent)` so it inherits
  the page's `color-scheme: light dark` automatically. Don't hardcode
  hex colors except for the three semantic accents — green `#22824d`
  (success), amber `#b87b1a` (caution), red `#c24` (danger / conflict).
- **Spacing.** Components don't add outer margin; the parent
  (`<PageShell>` or a wrapping `<div>`) decides spacing. The exception
  is `<Form>`, which adds `margin-top: 1rem` because forms always sit
  below an intro paragraph.
- **Typography.** Inherits `system-ui` from `Dashboard.astro`. Numeric
  cells / values use `font-variant-numeric: tabular-nums`. Monospace
  is `ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo,
monospace`.
- **Scoped styles.** Every component's CSS lives in its `<style>`
  block (Astro auto-scopes). Don't reach into a sibling component's
  internals — pass behavior through props instead.
- **Props.** Required vs. optional matches `interface Props`. Optional
  props use `?` and TypeScript's `exactOptionalPropertyTypes: true`,
  so `undefined` is an explicit signal "no value" rather than a stale
  `''`. Don't pass `null` — the components don't read it.

## Components

### `<Card title value unit? trend? href? id?/>`

Single overview metric for the dashboard's `.cards` grid. Renders as
an `<article>` by default; promotes to an `<a>` when `href` is set.

```astro
<Card title="Open findings" value={12} />
<Card title="Today spend" value="3.42" unit="USD" trend="up" />
<Card title="Pending questions" value={3} href="/app/questions/" />
```

For runtime-fetched metrics, render the card with a placeholder value
(`"—"`) and a stable `id`; the page's `<script>` updates the inner
`.value` after `apiFetch`:

```astro
<Card title="Today spend" value="—" id="card-spend-today" />
```

```ts
const cell = document.querySelector('#card-spend-today .value');
if (cell !== null) cell.textContent = `$${todaySpend.toFixed(2)}`;
```

### `<Table columns rows emptyMessage? caption? loading? id?/>`

Generic data table. `columns` is `{ key, label, align?, width?, numeric? }[]`;
`rows` is `Record<string, unknown>[]` indexed by `col.key`. Renders
`emptyMessage` (default "None") when `rows` is empty.

```astro
<Table
  columns={[
    { key: 'id', label: 'ID', width: '8rem' },
    { key: 'status', label: 'Status' },
    { key: 'spend', label: 'Spend', align: 'right', numeric: true },
  ]}
  rows={[
    { id: '01K…', status: 'running', spend: '$1.23' },
    { id: '01K…', status: 'complete', spend: '$0.04' },
  ]}
/>
```

For runtime-fetched data, render the table with `rows={[]} loading id="…"`
server-side — the table chrome (caption + thead) appears immediately
with a single "Loading…" row in tbody — and have the page's `<script>`
replace `tbody` contents on `apiFetch` resolution:

```astro
<Table id="findings-table" columns={…} rows={[]} loading />
```

```ts
const tbody = document.querySelector('#findings-table tbody');
if (tbody !== null) {
  tbody.innerHTML = '';
  for (const row of resp.items) {
    const tr = document.createElement('tr');
    // …append <td> per column…
    tbody.appendChild(tr);
  }
}
```

For empty results from the fetch, the script writes a single
`<tr><td colspan="N" class="empty">No findings match.</td></tr>` row
into the same tbody so the column headers stay visible.

(3.4 leaves a Solid/Preact island helper for fully-reactive cases —
chat / directive detail — to a later step if it becomes necessary.)

### `<EmptyState title body cta?/>`

Friendlier than a "None" line when the absence is actionable.

```astro
<EmptyState
  title="No projects yet"
  body="Run `factory init` in a workspace to register one."
  cta={{ label: 'Read the onboarding guide', href: '/docs/onboarding' }}
/>
```

### `<Alert kind title body?/>`

Banner for inline messages. `kind` is one of `info` | `success` |
`conflict`. The default slot accepts arbitrary children (links, code
blocks, etc.) — `body` is a convenience for the common single-paragraph
case.

```astro
<Alert kind="conflict" title="Submit failed" body="Try again." />

<Alert kind="info" title="Web UI is read-only">
  <p>Run <code>factory build</code> from a terminal to kick off a directive.</p>
</Alert>
```

### `<Form id? action? method? wide?/>` + `<Field>` + `<Submit>`

Composable form primitives. `<Form>` is a slot wrapper that applies the
dashboard's grid layout + max-width. `<Field>` handles the labeled
input — text/number/email/password (default), `select` (with
`options`), or `textarea` (with `rows`). `<Submit>` renders the
primary/default/danger button variants and is always `type='submit'`.

```astro
<Form id="buildForm">
  <Field name="project" label="Project" type="select" required
    options={[
      { value: 'apex', label: 'apex' },
      { value: 'tlx', label: 'tlx' },
    ]}
    hint="2 known projects."
  />
  <div class="form-row">
    <Field name="language" label="Language" type="select"
      options={[
        { value: '', label: '(use project default)' },
        { value: 'python', label: 'python' },
        { value: 'node', label: 'node' },
      ]}
    />
    <Field name="autonomy" label="Autonomy" type="select"
      options={[
        { value: '', label: '(server default)' },
        { value: 'assisted', label: 'assisted' },
        { value: 'autonomous', label: 'autonomous' },
      ]}
    />
  </div>
  <Field name="claudemd" label="CLAUDE.md" type="textarea" rows={10}
    placeholder="Optional project brief…"
  />
  <div class="form-actions">
    <Submit label="Kick off build" />
    <Submit label="Cancel" variant="danger" id="cancelBtn" />
  </div>
</Form>
```

The page's `<script>` reads field values via `document.getElementById`
(or by `name`) and posts via `apiPost`. Astro components are server-
rendered, so reactive form state remains a client concern.

### `<PageShell title description?/>`

Per-page layout — sits inside `Dashboard.astro`'s slot and renders the
page title + optional description + body slot. Once 3.4 lands, every
page wraps content in `<PageShell title="…">` instead of relying on
`Dashboard.astro`'s `title` prop.

```astro
<Dashboard title="Build">
  <PageShell title="Kick off a build" description="Mints a new directive on the server.">
    <Form id="buildForm">…</Form>
  </PageShell>
</Dashboard>
```

## Migration map (3.4 — done)

| Pre-3.4                                                 | Post-3.4                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `el('div', { class: 'card' }, …)`                       | `<Card title=… value=… id?=… />`                                                                              |
| `<table><thead>…<tbody>…`                               | `<Table columns=… rows=… loading? id?/>`                                                                      |
| `<p class="empty">None</p>`                             | `<EmptyState title=… body=… />` (or single `<td colspan class="empty">` row inside a `<Table>`)               |
| `el('div', { class: 'alert alert--conflict' }, …)`      | `<Alert kind="conflict" title=… />` (hidden placeholder + script populates inner `h4`/`p` for dynamic alerts) |
| `el('form', { class: 'form' }, …)` with `<button>` etc. | `<Form>` + `<Field>` + `<Submit>`                                                                             |
| `<Dashboard title="…">` (title in chrome)               | `<Dashboard title="…">` — `<PageShell>` adoption deferred (see status note above)                             |

`lib/api.ts` retired the `el()` and `loadInto()` helpers in 3.4's
final commit. The single in-page `el()` definition that survives
lives at the top of `pages/directives/detail.astro`'s `<script>`
block — that page's render path rebuilds the entire mount on every
SSE event, and a per-page DOM helper is the natural endpoint for
that pattern.

## Patterns introduced by `/app/chat` (3.5)

The chat page (`pages/chat.astro`) is a second site where the
component library can't carry the load — bubble layouts, hand-rolled
markdown, and an `apiStream` subscription that resets per turn don't
fit the static-component shape. Patterns worth surfacing for the
next streaming-page author:

- **Bubble layout.** Two side-aligned variants (`bubble--user` right,
  `bubble--factory` left) plus full-width `bubble--system` /
  `bubble--error` rows. Each bubble carries a `bubble-meta` strip
  (who-said-it + optional `bubble-annotation` like `via stream` or
  `direct`). Same `color-mix(currentColor)` palette + semantic
  accents (`#c24` for errors) the rest of the dashboard uses.
- **Auto-scroll-pin.** Mirrors the log-tail pattern in
  `pages/directives/detail.astro` lines 284-336 — a `pinned` flag
  defaulting to `true`, scroll listener flips it on the messages
  container's `scrollHeight - scrollTop - clientHeight < 4`
  threshold, a "Resume scroll" pip surfaces via `.chat-shell.paused`
  and snaps back on click.
- **Hand-rolled markdown.** ~30 LOC covering fenced code (extracted
  first to survive HTML escape), inline code, bold, italic,
  paragraphs from blank lines, line-breaks from single newlines.
  No new dep. User text never markdown-renders (textContent only) —
  same trust boundary stance as the rest of the dashboard.
- **`/cmd` shortcut path.** Page parses the first non-whitespace
  token of the composer; if it starts with `/<word>`, dispatches
  client-side to existing `/api/v1/{status,spend,findings}` GETs
  rather than minting a chat directive. Bubble lands annotated
  `direct` so the operator can tell stream-vs-direct at a glance.
  Unknown commands surface as inline `bubble--error` pointing at
  the supported set.
- **Per-turn stream lifecycle.** Each user message closes any
  prior `apiStream` handle, opens a fresh one against the new
  directive's SSE path, and listens for `log.line` events filtered
  by `component === 'brain.chat'`. `directive.completed` and
  `astro:before-swap` both close the stream so a navigation away
  doesn't leak an `EventSource`.

A future streaming-page (e.g. a /app/build kickoff that watches
findings flow live) can follow the same shape without needing a
component-library extension. If two pages converge on the same
bubble or markdown helper, the right move is to lift it into a
component then — premature lifting before that's the case.
