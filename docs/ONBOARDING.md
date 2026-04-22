# Onboarding — new dev on a new PC

This guide walks you through getting factory5 running from a fresh clone. It covers the common case (one factory instance per clone, lives at `<repo>/.factory/`) and the multi-instance case (several parallel factories with different configs, each in its own tree).

If you only read one section, read [§3 "Configure your instance"](#3-configure-your-instance) — everything else is standard Node/pnpm setup.

---

## 1. Prerequisites

- **Node 20+** (factory5 targets `node20` per ADR 0001).
- **pnpm** — `npm install -g pnpm` if you don't have it.
- **Claude CLI** (`claude`) on your `$PATH`, authenticated. Install from [claude.com/claude-code](https://claude.com/claude-code); run `claude --version` to confirm.
- **Git**, obviously.
- **Python 3.11+** if you plan to have factory build Python projects — the assessor uses `venv`.
- For the optional channels:
  - **A Discord application** if you want the Discord channel (§5).
  - **A Telegram bot** if you want the Telegram channel (§6).

---

## 2. Clone and build

```bash
git clone <repo-url> factory5
cd factory5
pnpm install
pnpm build
```

Run the test suite to confirm the environment is healthy:

```bash
pnpm test
```

All packages should be green. If anything fails, don't proceed — fix the environment first.

---

## 3. Configure your instance

Factory's runtime state (config, database, logs) lives in an **instance directory**. For a single-factory setup you keep this inside the repo so everything is colocated.

### 3.1 Create the instance directory

```bash
mkdir .factory
```

This directory is already in the repo's `.gitignore` — it will never be committed. Your bot tokens stay local.

### 3.2 Copy the template

```bash
cp config.example.toml .factory/config.toml
```

`config.example.toml` at the repo root is the authoritative template. Every section has inline comments explaining what it does.

### 3.3 Edit `.factory/config.toml`

Open `.factory/config.toml` and fill in:

- **`[general].workspace`** — absolute path where factory will build projects INTO. Pick an empty directory outside the repo (e.g. `C:\Users\<you>\factory5-workspace` or `~/factory5-workspace`). Projects land as `<workspace>/<project-name>/`.
- **`[general].autonomy`** — your default. `assisted` is the safest first setting (asks at checkpoints). You can always override per-build with `--autonomy`.
- **`[providers].claudeCliPath`** — only needed if the `claude` binary isn't on `$PATH`. `factory doctor` will tell you.
- **`[categories.*]`** — leave defaults unless you have a specific reason to change which model handles which category.
- **`[budget.defaults]`** — optional ceilings. Leave commented to start (unlimited). Recommendation: `maxUsd = 5.0` is a reasonable early-stage guardrail.

The channel sections (`[channels.discord]`, `[channels.telegram]`) are optional — skip them if you don't want those channels. See §5 and §6 for walkthroughs.

### 3.4 Validate

```bash
pnpm exec node apps/factory/dist/main.js doctor
```

Or, once factory5 is on your `$PATH`:

```bash
factory doctor
```

`doctor` probes:

- `claude-cli` is reachable.
- Discord is reachable (if `[channels.discord].token` is set).
- Telegram is reachable (if `[channels.telegram].botToken` is set).
- A quick triage call round-trips successfully.

A clean `factory doctor` run means your instance is configured end-to-end.

---

## 4. First build

From the repo root:

```bash
factory build hello-world --autonomy assisted --max-usd 3
```

Factory will:

- Triage your directive.
- Plan + build the project at `<workspace>/hello-world/`.
- Stop at budget ($3 ceiling in this example) or when the build completes.

To see where spend went:

```bash
factory spend
```

Per-project rollup over your entire history. Use `--group-by directive` / `--group-by day` / `--group-by model` for other views.

---

## 5. Optional — Discord channel

If you want to drive builds and receive replies via Discord:

### 5.1 Create the Discord application

1. Go to <https://discord.com/developers/applications>.
2. **New Application** → give it a name (e.g. `Factory5 Bot`).
3. Copy the **Application ID** from the General Information page.
4. **Bot** tab → **Add Bot** → **Copy Token**. Store this — it's your `token`.
5. Under **Bot** → enable **Message Content Intent** (factory needs to read message contents).

### 5.2 Invite the bot

**OAuth2 → URL Generator** → check scopes:

- `bot`

And permissions:

- `Send Messages`
- `Read Message History`
- `Use Slash Commands`
- `Create Public Threads`
- `Send Messages in Threads`

Copy the generated URL, open it in a browser, and authorize the bot into your guild (server).

### 5.3 Record the config

With developer mode enabled in Discord (Settings → Advanced → Developer Mode), right-click your guild and "Copy Server ID" → that's `guildId`. Right-click a channel and "Copy Channel ID" → that's `defaultChannelId`.

Uncomment the `[channels.discord]` block in `.factory/config.toml` and fill in:

```toml
[channels.discord]
token            = "<paste-your-bot-token>"
applicationId    = "<paste-your-application-id>"
guildId          = "<paste-your-guild-id>"
defaultChannelId = "<paste-your-channel-id>"
```

Run `factory doctor` — you should see `Checking Discord (channel)` with `rest: ok` and `login: ok`. Then `@`-mention the bot from your guild with `/build <name>` and watch the directive flow through.

### 5.4 Security note

The Discord token gives full bot-identity access. Keep `.factory/config.toml` out of git (already enforced by `.gitignore`). If you ever leak it, regenerate via the Discord developer portal.

---

## 6. Optional — Telegram channel

### 6.1 Create the bot via @BotFather

1. In Telegram, open a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`. Follow the prompts:
   - Display name (e.g. `Factory5 Bot`).
   - Username (must end in `bot`, e.g. `your_factory5_bot`).
3. BotFather replies with a token in the format `<digits>:<alphanumeric-35>`. Copy it — that's `botToken`.

### 6.2 Get your test chat-id

You need a chat-id factory can send kickoff messages to during `factory doctor` and the live-smoke script.

1. In Telegram, open a chat with your new bot (tap the link BotFather returned or search `@<your-bot-username>`).
2. Send the bot any message (e.g. "hi"). This is required — until the bot receives at least one message, its `getUpdates` endpoint returns empty.
3. From a terminal, ask the Bot API what chats it knows about:

   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```

4. In the JSON response, look for `"chat":{"id":<number>}` — that's your `testChatId`.

### 6.3 Record the config

Uncomment `[channels.telegram]` in `.factory/config.toml`:

```toml
[channels.telegram]
botToken       = "<paste-your-telegram-bot-token>"
testChatId     = <paste-your-chat-id-as-integer>
# allowedChatIds = [<id1>, <id2>]   # optional allowlist; empty = any
# pollTimeoutSec = 30               # default is fine
# buildPrefix    = "/build"         # Telegram renders /build as a native command
```

Run `factory doctor` — you should see `Checking Telegram (channel)` with `getMe: ok` and your bot's `@username`.

### 6.4 Live smoke

To prove the round-trip works end-to-end:

```bash
pnpm --filter @factory5/scripts telegram-smoke
```

The script sends a kickoff to your `testChatId`, waits up to 60 seconds for you to reply, echoes your reply back, and exits. Zero LLM spend (Telegram's API is pure HTTP).

---

## 7. Multiple factory instances

If you want several factories running in parallel (e.g. a `primary` for daily work and a separate `client-acme` with its own bot + workspace), you create **multiple instance directories** — one per factory.

Each instance lives at its own path; factory uses cwd-walk to figure out which one you're in (ADR 0023).

### 7.1 Create the second instance

Pick a path, create `.factory/`, copy the template:

```bash
mkdir -p ~/factory-instances/client-acme
cd ~/factory-instances/client-acme
mkdir .factory
cp <path-to-repo>/config.example.toml .factory/config.toml
# edit .factory/config.toml — different workspace, different bot tokens, etc.
```

### 7.2 Use it by `cd`-ing

```bash
cd ~/factory-instances/client-acme
factory spend                # operates on THIS instance's db
factory build widget ...     # builds into THIS instance's workspace
```

And `cd`ing to the original repo uses the primary:

```bash
cd <path-to-factory5-repo>
factory spend                # operates on the primary instance's db
```

No env var, no flag. The physical cwd tells factory which instance you're using.

### 7.3 Daemons on different ports

If you want the factoryd daemon running for each instance in parallel, they need to bind to different ports (default is `127.0.0.1:25295`). Add `[daemon]` with a unique `port` to each instance's config:

```toml
[daemon]
port = 25296   # primary uses 25295 (default); this one uses 25296
```

The CLI client and the daemon both read this port from config at startup.

### 7.4 Escape hatch

If you ever need factory to ignore cwd-walk (e.g. running inside a CI container with a specific mount), set `FACTORY5_DATA_DIR` explicitly:

```bash
FACTORY5_DATA_DIR=/mnt/factory-state factory build ...
```

That overrides everything.

---

## 8. Backups

`.factory/factory.db` is your cumulative state — directive history, spend, findings, pending questions. Back it up on whatever cadence matches how much history you'd regret losing.

The config file is harmless to lose (you can regenerate it from the template + the docs); the database isn't (regenerating means losing spend history).

---

## 9. Troubleshooting

- **`factory doctor` says `claude-cli: NOT AVAILABLE`** — install Claude Code from <https://claude.com/claude-code> or set `providers.claudeCliPath` in config.
- **Discord probe says `login: FAILED`** — wrong token, Message Content Intent off, or bot was deleted. Regenerate from the Discord developer portal.
- **Telegram probe says `getMe: FAILED`** — token is wrong or the bot was deleted via @BotFather.
- **`factory spend` says no rows** — no builds have run yet; run one first.
- **Config didn't take effect** — run from a directory that has `.factory/config.toml` above it (cwd-walk needs this). `pwd` and verify.
- **Two factories fighting over the same port** — both bound to default `127.0.0.1:25295`. Give one an alternate `[daemon].port` in config.

---

## Pointers

- `CompleteArchitecture.md` — the canonical design at scaffold time.
- `docs/ARCHITECTURE.md` — the evolved architecture (mirrors the snapshot).
- `docs/PROGRESS.md` — session-by-session history.
- `docs/decisions/` — ADRs. Start with [0004 (routing)](decisions/0004-category-based-model-routing.md), [0020 (budget)](decisions/0020-pre-call-budget-enforcement.md), [0021 (project identity)](decisions/0021-first-class-project-identity.md), [0023 (storage layout)](decisions/0023-repo-local-instance-and-cwd-walk.md).
- `docs/Phase7_Progress.md` — where budget enforcement, spend dashboard, and the Telegram channel came from.
