# `apps/factory-web/src/components/`

The factory5 Astro component library. Eight server-rendered components
covering the dashboard's structural surface — cards, tables, alerts,
forms, page shells. Page-conversion (3.4) wires every page in
`apps/factory-web/src/pages/` through these and retires the inline
`el(...)` DOM-creation pattern from `lib/api.ts`.

> **3.3 status — library only.** No page in `pages/` consumes these yet;
> page-conversion is gated on step 3.4. The visual is unchanged
> meanwhile because each component duplicates the matching CSS from
> `layouts/Dashboard.astro` (scoped, so no global conflict). The
> Dashboard-level CSS is gutted as part of 3.4.

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

### `<Table columns rows emptyMessage? caption?/>`

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

For runtime-fetched data, render the table with `rows={[]}` server-side
and append `<tr>` rows from the client `<script>` after `apiFetch`. (3.4
introduces a Solid/Preact island helper for fully-reactive cases —
chat / directive detail.)

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

## Migration map (3.4)

| Today                                                   | After 3.4                           |
| ------------------------------------------------------- | ----------------------------------- |
| `el('div', { class: 'card' }, …)`                       | `<Card title=… value=… />`          |
| `<table><thead>…<tbody>…`                               | `<Table columns=… rows=… />`        |
| `<p class="empty">None</p>`                             | `<EmptyState title=… body=… />`     |
| `el('div', { class: 'alert alert--conflict' }, …)`      | `<Alert kind="conflict" title=… />` |
| `el('form', { class: 'form' }, …)` with `<button>` etc. | `<Form>` + `<Field>` + `<Submit>`   |
| `<Dashboard title="…">` (title in chrome)               | `<Dashboard><PageShell title="…">`  |

After every page is converted, `lib/api.ts` retires the `el()` helper
(it survives 3.3 because pages still use it).
