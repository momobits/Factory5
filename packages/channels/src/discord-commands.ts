/**
 * Discord slash commands — `/factory <subcommand>` (Phase 2 step 2.1, U011).
 *
 * Wires seven subcommands that mirror the brain's eight-intent vocabulary:
 *
 *   - `/factory status`    — list active + recent directives + projects
 *   - `/factory spend`     — spend rollup (project / directive / day / model)
 *   - `/factory findings`  — list registry findings
 *   - `/factory resume`    — re-enter the build pipeline for a project
 *   - `/factory cancel`    — cancel a running directive (2.1: marks blocked;
 *                            2.4 swaps to actual worker abort)
 *   - `/factory budget`    — set per-project budget defaults
 *   - `/factory build`     — kick off a build directive
 *
 * Read commands (status / spend / findings) hit SQLite directly — no LLM
 * round-trip — via the same query helpers the CLI and Web UI use. Mutations
 * (build / resume / budget / cancel) re-use the existing channel-context
 * callbacks (`onInbound`, `resolveProjectPath`, `resolveBuildLimits`,
 * `setProjectBudget`) so the slash path is structurally identical to a
 * `messageCreate`-driven `/build` — same insert, same daemon claim loop.
 *
 * Registration: definitions are emitted as a single top-level `factory`
 * command with seven subcommands. The discord plugin calls
 * `client.application.commands.set([buildFactorySlashCommand()], guildId)`
 * on `Events.ClientReady`; guild-scoped when `config.guildId` is set
 * (instant register), global otherwise (~1 hour propagation).
 *
 * Dispatch: the plugin registers an `interactionCreate` listener that
 * routes any `factory` chat-input interaction through
 * {@link dispatchSlashInteraction}. Handlers respond via
 * `interaction.editReply()` after a `deferReply()` so a slow read
 * (large registry) doesn't blow Discord's three-second window.
 */

import {
  type AutonomyMode,
  type Directive,
  type DirectiveLimits,
  directiveSchema,
  newId,
  type Intent,
  type ProjectBudgetDefaults,
} from '@factory5/core';
import type { Logger } from '@factory5/logger';
import {
  directives as directivesQ,
  findingsRegistry,
  modelUsage,
  projects as projectsQ,
  spend as spendQ,
  type Database,
  type FindingsRegistryEntry,
  type PerDaySpend,
  type PerDirectiveSpend,
  type PerModelSpend,
  type PerProjectSpend,
  MarkBlockedError,
} from '@factory5/state';
import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';

import { SetProjectBudgetError, type ChannelContext } from './types.js';

// ---------------------------------------------------------------------------
// Subcommand inventory
// ---------------------------------------------------------------------------

export const FACTORY_SUBCOMMANDS = [
  'status',
  'spend',
  'findings',
  'resume',
  'cancel',
  'budget',
  'build',
] as const;
export type FactorySubcommand = (typeof FACTORY_SUBCOMMANDS)[number];

const SPEND_GROUPS = ['project', 'directive', 'day', 'model'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const FINDING_STATUSES = ['OPEN', 'FIXED', 'VERIFIED', 'WONTFIX'] as const;
const AUTONOMY_MODES = ['chat', 'assisted', 'autonomous'] as const;
const LANGUAGES = ['python', 'node', 'go', 'rust'] as const;

// ---------------------------------------------------------------------------
// Embed colors
// ---------------------------------------------------------------------------

const COLOR_INFO = 0x5865f2; // Discord blurple — neutral reads
const COLOR_OK = 0x57f287;
const COLOR_WARN = 0xfee75c;
const COLOR_ERROR = 0xed4245;

// ---------------------------------------------------------------------------
// Slash command definition (single command, seven subcommands)
// ---------------------------------------------------------------------------

/**
 * Build the JSON payload registered with Discord's REST API. The shape is
 * stable across discord.js minor versions (verified against 14.x) so this
 * is safe to cache, but we rebuild on each `start()` to keep the codepath
 * test-friendly.
 */
export function buildFactorySlashCommand(): RESTPostAPIApplicationCommandsJSONBody {
  const cmd = new SlashCommandBuilder()
    .setName('factory')
    .setDescription(
      'factory5 directives — status / spend / findings / resume / cancel / budget / build',
    );

  cmd.addSubcommand((s) =>
    s
      .setName('status')
      .setDescription('list active and recent directives plus registered projects')
      .addIntegerOption((o) =>
        o
          .setName('limit')
          .setDescription('how many recent directives to show (default: 10)')
          .setMinValue(1)
          .setMaxValue(50),
      ),
  );

  cmd.addSubcommand((s) =>
    s
      .setName('spend')
      .setDescription('cross-session spend rollup')
      .addStringOption((o) =>
        o
          .setName('group-by')
          .setDescription('how to roll up rows (default: project)')
          .addChoices(...SPEND_GROUPS.map((g) => ({ name: g, value: g }))),
      )
      .addStringOption((o) =>
        o.setName('project').setDescription('filter to a single project name'),
      ),
  );

  cmd.addSubcommand((s) =>
    s
      .setName('findings')
      .setDescription('list registry findings (default: open + blocking)')
      .addStringOption((o) =>
        o.setName('project').setDescription('filter to a single project (name or glob)'),
      )
      .addStringOption((o) =>
        o
          .setName('severity')
          .setDescription('filter by severity')
          .addChoices(...SEVERITIES.map((sv) => ({ name: sv, value: sv }))),
      )
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('filter by status (default: OPEN)')
          .addChoices(...FINDING_STATUSES.map((st) => ({ name: st, value: st }))),
      ),
  );

  cmd.addSubcommand((s) =>
    s
      .setName('resume')
      .setDescription('re-enter the build pipeline for a project')
      .addStringOption((o) =>
        o.setName('project').setDescription('project name to resume').setRequired(true),
      ),
  );

  cmd.addSubcommand((s) =>
    s
      .setName('cancel')
      .setDescription('cancel a directive (2.1: marks blocked; 2.4 will kill workers)')
      .addStringOption((o) =>
        o.setName('directive-id').setDescription('directive ULID').setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('reason recorded with the cancel'),
      ),
  );

  cmd.addSubcommand((s) =>
    s
      .setName('budget')
      .setDescription('set per-project budget defaults (overwrites; omit both to clear)')
      .addStringOption((o) => o.setName('project').setDescription('project name').setRequired(true))
      .addNumberOption((o) =>
        o.setName('max-usd').setDescription('hard USD ceiling').setMinValue(0.01),
      )
      .addIntegerOption((o) =>
        o.setName('max-steps').setDescription('hard call-count ceiling').setMinValue(1),
      ),
  );

  cmd.addSubcommand((s) =>
    s
      .setName('build')
      .setDescription('kick off a build directive')
      .addStringOption((o) => o.setName('project').setDescription('project name').setRequired(true))
      .addStringOption((o) => o.setName('spec').setDescription('build spec text'))
      .addStringOption((o) =>
        o
          .setName('autonomy')
          .setDescription('autonomy mode (default: autonomous)')
          .addChoices(...AUTONOMY_MODES.map((m) => ({ name: m, value: m }))),
      )
      .addStringOption((o) =>
        o
          .setName('language')
          .setDescription('assessor runtime')
          .addChoices(...LANGUAGES.map((l) => ({ name: l, value: l }))),
      )
      .addNumberOption((o) =>
        o.setName('max-usd').setDescription('hard USD ceiling').setMinValue(0.01),
      )
      .addIntegerOption((o) =>
        o.setName('max-steps').setDescription('hard call-count ceiling').setMinValue(1),
      ),
  );

  return cmd.toJSON();
}

// ---------------------------------------------------------------------------
// Per-interaction context — a subset of ChannelContext plus the live DB and
// the invoking user. The Discord plugin builds this once per interaction.
// ---------------------------------------------------------------------------

export interface DiscordCommandContext {
  db: Database;
  log: Logger;
  /** The Discord user invoking the slash command (`interaction.user`). */
  user: { id: string; tag: string };
  /** Guild the interaction came from (undefined in DMs). */
  guildId: string | undefined;
  /** Same shape as ChannelContext.onInbound — used by build/resume to enqueue. */
  onInbound: ChannelContext['onInbound'];
  resolveProjectPath: ChannelContext['resolveProjectPath'];
  resolveBuildLimits: ChannelContext['resolveBuildLimits'];
  setProjectBudget: ChannelContext['setProjectBudget'];
  /** Allow-list copied from DiscordConfig — empty array = open to anyone. */
  allowedUserIds: ReadonlyArray<string>;
}

/**
 * Top-level dispatch for an `interactionCreate` event. Returns silently
 * for non-`factory` commands (other slash commands, button interactions,
 * autocomplete, etc.) — the plugin's listener is the only entry point so
 * everything routes through here.
 */
export async function dispatchSlashInteraction(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.commandName !== 'factory') return;

  // Allow-list gate parallel to `messageCreate`'s — silent ignore if the user
  // isn't on the list. Slash commands have no automatic visibility-based
  // gate, so this is the only enforcement.
  if (ctx.allowedUserIds.length > 0 && !ctx.allowedUserIds.includes(interaction.user.id)) {
    ctx.log.debug(
      { userId: interaction.user.id, command: interaction.commandName },
      'discord-commands: user not in allowlist — ignoring slash command',
    );
    await interaction.reply({
      content: 'You are not authorised to invoke factory commands here.',
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand(false) as FactorySubcommand | null;
  if (sub === null || !FACTORY_SUBCOMMANDS.includes(sub)) {
    await interaction.reply({
      content: `Unknown subcommand. Try one of: ${FACTORY_SUBCOMMANDS.join(' | ')}.`,
      ephemeral: true,
    });
    return;
  }

  // Defer immediately — every handler does at least one DB query, and the
  // remote callbacks (resolveProjectPath, setProjectBudget) hit the file
  // system. Three-second budget on a fresh interaction is too tight.
  await interaction.deferReply();

  try {
    const embed = await runSubcommand(ctx, interaction, sub);
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.error({ err, sub, userId: interaction.user.id }, 'discord-commands: handler threw');
    const errorEmbed = new EmbedBuilder()
      .setColor(COLOR_ERROR)
      .setTitle(`/factory ${sub} — error`)
      .setDescription(`\`${truncateForEmbed(message, 1900)}\``);
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function runSubcommand(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
  sub: FactorySubcommand,
): Promise<EmbedBuilder> {
  switch (sub) {
    case 'status':
      return handleStatus(ctx, interaction);
    case 'spend':
      return handleSpend(ctx, interaction);
    case 'findings':
      return handleFindings(ctx, interaction);
    case 'resume':
      return handleResume(ctx, interaction);
    case 'cancel':
      return handleCancel(ctx, interaction);
    case 'budget':
      return handleBudget(ctx, interaction);
    case 'build':
      return handleBuild(ctx, interaction);
  }
}

// ---------------------------------------------------------------------------
// /factory status
// ---------------------------------------------------------------------------

export async function handleStatus(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<EmbedBuilder> {
  const limit = interaction.options.getInteger('limit') ?? 10;
  const recent = directivesQ.listRecent(ctx.db, limit);
  const projects = projectsQ.listAll(ctx.db);

  const sections: string[] = [];

  if (projects.length === 0) {
    sections.push('**Projects** — _(none registered)_');
  } else {
    const lines = projects
      .slice(0, 8)
      .map((p) => `• \`${p.name}\` — ${p.status} — ${truncatePath(p.workspacePath)}`);
    if (projects.length > 8) lines.push(`_…and ${projects.length - 8} more_`);
    sections.push(`**Projects** (${projects.length})`, lines.join('\n'));
  }

  if (recent.length === 0) {
    sections.push('**Recent directives** — _(none yet)_');
  } else {
    const lines: string[] = ['```'];
    lines.push(
      `${'id'.padEnd(8)}  ${'status'.padEnd(8)}  ${'intent'.padEnd(11)}  ${'spent'.padStart(9)}  created`,
    );
    for (const d of recent) {
      const cost = modelUsage.totalCostForDirective(ctx.db, d.id);
      lines.push(
        `${d.id.slice(-8)}  ${d.status.padEnd(8)}  ${d.intent.padEnd(11)}  ${`$${cost.toFixed(4)}`.padStart(9)}  ${d.createdAt.slice(0, 19)}Z`,
      );
    }
    lines.push('```');
    sections.push(`**Recent directives** (${recent.length})`, lines.join('\n'));
  }

  return new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle('factory status')
    .setDescription(joinBounded(sections, 4000))
    .setTimestamp();
}

// ---------------------------------------------------------------------------
// /factory spend
// ---------------------------------------------------------------------------

export async function handleSpend(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<EmbedBuilder> {
  const groupRaw = interaction.options.getString('group-by') ?? 'project';
  if (!(SPEND_GROUPS as readonly string[]).includes(groupRaw)) {
    return errorEmbed(
      'spend',
      `invalid --group-by "${groupRaw}" (expected: ${SPEND_GROUPS.join(' | ')})`,
    );
  }
  const group = groupRaw as (typeof SPEND_GROUPS)[number];

  const projectArg = interaction.options.getString('project') ?? undefined;
  const filter: { projectId?: string } = {};
  if (projectArg !== undefined && projectArg.length > 0) {
    const matches = projectsQ.findByName(ctx.db, projectArg);
    if (matches.length === 0) {
      return errorEmbed('spend', `no project matches \`${projectArg}\``);
    }
    if (matches.length > 1) {
      const lines = matches.map(
        (p) => `• \`${p.name}\` — ${p.id} — ${truncatePath(p.workspacePath)}`,
      );
      return errorEmbed(
        'spend',
        `\`${projectArg}\` is ambiguous (${matches.length} projects):\n${lines.join('\n')}`,
      );
    }
    const only = matches[0]!;
    filter.projectId = only.id;
  }

  let body: string;
  switch (group) {
    case 'project': {
      const rows = spendQ.perProject(ctx.db, filter).slice(0, 15);
      body = renderSpendProject(rows);
      break;
    }
    case 'directive': {
      const rows = spendQ.perDirective(ctx.db, filter).slice(0, 15);
      body = renderSpendDirective(rows);
      break;
    }
    case 'day': {
      const rows = spendQ.perDay(ctx.db, filter).slice(0, 15);
      body = renderSpendDay(rows);
      break;
    }
    case 'model': {
      const rows = spendQ.perModel(ctx.db, filter).slice(0, 15);
      body = renderSpendModel(rows);
      break;
    }
  }

  const titleSuffix =
    projectArg !== undefined && projectArg.length > 0 ? ` — project=${projectArg}` : '';
  return new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle(`factory spend (group-by ${group})${titleSuffix}`)
    .setDescription(body)
    .setTimestamp();
}

function renderSpendProject(rows: PerProjectSpend[]): string {
  if (rows.length === 0) return '_(no spend recorded)_';
  const lines = ['```'];
  lines.push(
    `${'project'.padEnd(28)}  ${'dirs'.padStart(5)}  ${'calls'.padStart(6)}  ${'spent'.padStart(11)}`,
  );
  let totalUsd = 0;
  let totalCalls = 0;
  for (const r of rows) {
    const display = truncate(r.display, 28);
    lines.push(
      `${display.padEnd(28)}  ${String(r.directiveCount).padStart(5)}  ${String(r.callCount).padStart(6)}  ${`$${r.totalUsd.toFixed(4)}`.padStart(11)}`,
    );
    totalUsd += r.totalUsd;
    totalCalls += r.callCount;
  }
  lines.push(
    `${'TOTAL'.padEnd(28)}  ${''.padStart(5)}  ${String(totalCalls).padStart(6)}  ${`$${totalUsd.toFixed(4)}`.padStart(11)}`,
  );
  lines.push('```');
  return lines.join('\n');
}

function renderSpendDirective(rows: PerDirectiveSpend[]): string {
  if (rows.length === 0) return '_(no spend recorded)_';
  const lines = ['```'];
  lines.push(
    `${'directive'.padEnd(8)}  ${'project'.padEnd(20)}  ${'calls'.padStart(6)}  ${'spent'.padStart(11)}  last`,
  );
  for (const r of rows) {
    const proj = truncate(spendQ.formatProjectDisplay(r.projectName, r.projectId), 20);
    lines.push(
      `${r.directiveId.slice(-8).padEnd(8)}  ${proj.padEnd(20)}  ${String(r.callCount).padStart(6)}  ${`$${r.totalUsd.toFixed(4)}`.padStart(11)}  ${r.lastCalledAt.slice(0, 19)}Z`,
    );
  }
  lines.push('```');
  return lines.join('\n');
}

function renderSpendDay(rows: PerDaySpend[]): string {
  if (rows.length === 0) return '_(no spend recorded)_';
  const lines = ['```'];
  lines.push(`${'date'.padEnd(11)}  ${'calls'.padStart(6)}  ${'spent'.padStart(11)}`);
  let totalUsd = 0;
  let totalCalls = 0;
  for (const r of rows) {
    lines.push(
      `${r.date.padEnd(11)}  ${String(r.callCount).padStart(6)}  ${`$${r.totalUsd.toFixed(4)}`.padStart(11)}`,
    );
    totalUsd += r.totalUsd;
    totalCalls += r.callCount;
  }
  lines.push(
    `${'TOTAL'.padEnd(11)}  ${String(totalCalls).padStart(6)}  ${`$${totalUsd.toFixed(4)}`.padStart(11)}`,
  );
  lines.push('```');
  return lines.join('\n');
}

function renderSpendModel(rows: PerModelSpend[]): string {
  if (rows.length === 0) return '_(no spend recorded)_';
  const lines = ['```'];
  lines.push(`${'provider/model'.padEnd(36)}  ${'calls'.padStart(6)}  ${'spent'.padStart(11)}`);
  for (const r of rows) {
    const label = truncate(`${r.provider}/${r.model}`, 36);
    lines.push(
      `${label.padEnd(36)}  ${String(r.callCount).padStart(6)}  ${`$${r.totalUsd.toFixed(4)}`.padStart(11)}`,
    );
  }
  lines.push('```');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// /factory findings
// ---------------------------------------------------------------------------

export async function handleFindings(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<EmbedBuilder> {
  const project = interaction.options.getString('project') ?? undefined;
  const severity = interaction.options.getString('severity') ?? undefined;
  const status = interaction.options.getString('status') ?? 'OPEN';

  // The CLI defaults to blocking-only; mirror that here so a Discord operator
  // sees the same default as `factory findings list`.
  const filter: Parameters<typeof findingsRegistry.list>[1] = {
    advisory: false,
    limit: 25,
    status: status as 'OPEN' | 'FIXED' | 'VERIFIED' | 'WONTFIX',
    ...(severity !== undefined
      ? { severity: severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }
      : {}),
    ...(project !== undefined && project.length > 0 ? { project } : {}),
  };

  const rows = findingsRegistry.list(ctx.db, filter);
  const body = renderFindings(rows);

  const titleParts: string[] = [`status=${status}`];
  if (severity !== undefined) titleParts.push(`severity=${severity}`);
  if (project !== undefined && project.length > 0) titleParts.push(`project=${project}`);

  return new EmbedBuilder()
    .setColor(rows.length === 0 ? COLOR_OK : COLOR_INFO)
    .setTitle(`factory findings (${titleParts.join(', ')})`)
    .setDescription(body)
    .setTimestamp();
}

function renderFindings(rows: FindingsRegistryEntry[]): string {
  if (rows.length === 0) return '_(no findings match)_';
  const lines = ['```'];
  lines.push(
    `${'project'.padEnd(20)}  ${'id'.padEnd(6)}  ${'sev'.padEnd(8)}  ${'status'.padEnd(8)}  source         description`,
  );
  for (const e of rows) {
    const project = truncate(e.projectId.slice(-12), 20);
    const sev = e.finding.advisory === true ? `[adv]${e.finding.severity}` : e.finding.severity;
    const desc = truncate(firstLine(e.finding.description), 60);
    lines.push(
      `${project.padEnd(20)}  ${e.finding.id.padEnd(6)}  ${sev.padEnd(8)}  ${e.finding.status.padEnd(8)}  ${e.finding.source.padEnd(13)}  ${desc}`,
    );
  }
  lines.push(`(${rows.length} finding${rows.length === 1 ? '' : 's'})`);
  lines.push('```');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// /factory resume
// ---------------------------------------------------------------------------

export async function handleResume(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<EmbedBuilder> {
  const project = interaction.options.getString('project', true);

  // Match the CLI resume's "find prior directive" logic. We don't run inline
  // (channels never run the brain inline) — we just enqueue a fresh
  // resume-shaped directive and let the daemon claim it.
  const recent = directivesQ.listRecent(ctx.db, 200);
  const namedProjects = projectsQ.findByName(ctx.db, project);
  const projectRow = namedProjects[0];

  const prior = findPriorMatch(recent, project, projectRow?.workspacePath);
  if (prior === undefined) {
    return errorEmbed(
      'resume',
      `no prior directive found for \`${project}\`. Try \`/factory build project:${project}\` to start fresh.`,
    );
  }

  const priorPayload =
    typeof prior.payload === 'object' && prior.payload !== null
      ? (prior.payload as Record<string, unknown>)
      : undefined;
  const projectPath =
    (priorPayload?.['projectPath'] as string | undefined) ?? projectRow?.workspacePath;

  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    return errorEmbed(
      'resume',
      `prior directive ${prior.id.slice(-8)} has no projectPath; resume needs an absolute path.`,
    );
  }

  const inheritedProjectId = prior.projectId ?? projectRow?.id;
  const priorLanguage = priorPayload?.['language'];
  const carriedLanguage =
    priorLanguage === 'python' ||
    priorLanguage === 'node' ||
    priorLanguage === 'go' ||
    priorLanguage === 'rust'
      ? priorLanguage
      : undefined;

  const directive = directiveSchema.parse({
    id: newId(),
    source: 'discord',
    principal: ctx.user.id,
    channelRef: `discord-resume-${Date.now().toString()}`,
    intent: 'build' satisfies Intent,
    payload: {
      project,
      projectPath,
      resumeFrom: prior.id,
      ...(carriedLanguage !== undefined ? { language: carriedLanguage } : {}),
    },
    autonomy: 'assisted' satisfies AutonomyMode,
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
    parentDirectiveId: prior.id,
    ...(inheritedProjectId !== undefined ? { projectId: inheritedProjectId } : {}),
  });

  await ctx.onInbound(directive);
  ctx.log.info(
    { directiveId: directive.id, parentId: prior.id, project },
    'discord-commands: resume directive enqueued',
  );

  return new EmbedBuilder()
    .setColor(COLOR_OK)
    .setTitle('factory resume — queued')
    .setDescription(
      [
        `**Project:** \`${project}\``,
        `**Path:** \`${truncatePath(projectPath)}\``,
        `**Resuming from:** \`${prior.id.slice(-8)}\` (${prior.status})`,
        `**New directive:** \`${directive.id.slice(-8)}\``,
        '',
        '_The daemon will claim it shortly._',
      ].join('\n'),
    )
    .setTimestamp();
}

function findPriorMatch(
  recent: readonly Directive[],
  name: string,
  projectPath: string | undefined,
): Directive | undefined {
  const nameLower = name.toLowerCase();
  const pathLower = projectPath?.toLowerCase();
  // Same priority as cli/resume.ts: running > blocked > claimed/pending > terminal.
  const sorted = [...recent].sort((a, b) => priority(a) - priority(b));
  for (const d of sorted) {
    if (typeof d.payload !== 'object' || d.payload === null) continue;
    const p = d.payload as Record<string, unknown>;
    const projectName = typeof p['project'] === 'string' ? p['project'].toLowerCase() : undefined;
    const dirPath =
      typeof p['projectPath'] === 'string' ? p['projectPath'].toLowerCase() : undefined;
    if (projectName === nameLower) return d;
    if (pathLower !== undefined && dirPath === pathLower) return d;
  }
  return undefined;
}

function priority(d: Directive): number {
  if (d.status === 'running') return 0;
  if (d.status === 'blocked') return 1;
  if (d.status === 'claimed' || d.status === 'pending') return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// /factory cancel
// ---------------------------------------------------------------------------

export async function handleCancel(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<EmbedBuilder> {
  const directiveId = interaction.options.getString('directive-id', true);
  const reason = interaction.options.getString('reason') ?? 'cancelled via Discord slash command';

  // Accept either a full ULID or the trailing 8-char suffix that
  // /factory status renders. Suffix lookup walks the recent list — bounded
  // to 200 to keep the query cheap.
  const resolvedId = resolveDirectiveId(ctx.db, directiveId);
  if (resolvedId === undefined) {
    return errorEmbed('cancel', `no directive matches \`${directiveId}\``);
  }
  if (resolvedId === 'AMBIGUOUS') {
    return errorEmbed(
      'cancel',
      `\`${directiveId}\` is ambiguous (suffix matches multiple). Pass the full 26-char ULID.`,
    );
  }

  try {
    const updated = directivesQ.markBlocked(ctx.db, resolvedId, reason);
    ctx.log.info(
      { directiveId: resolvedId, reason, userId: ctx.user.id },
      'discord-commands: directive cancelled (markBlocked)',
    );
    return new EmbedBuilder()
      .setColor(COLOR_WARN)
      .setTitle('factory cancel — directive marked blocked')
      .setDescription(
        [
          `**Directive:** \`${resolvedId.slice(-8)}\``,
          `**Was:** ${updated.status === 'blocked' ? 'flipped to' : updated.status}`,
          `**Reason:** ${reason}`,
          '',
          '_2.1 marks the row blocked. Step 2.4 will additionally kill running workers within 10 s._',
        ].join('\n'),
      )
      .setTimestamp();
  } catch (err) {
    if (err instanceof MarkBlockedError) {
      if (err.code === 'NOT_FOUND') {
        return errorEmbed('cancel', `directive \`${resolvedId}\` not found`);
      }
      return errorEmbed('cancel', err.message);
    }
    throw err;
  }
}

function resolveDirectiveId(db: Database, raw: string): string | 'AMBIGUOUS' | undefined {
  // Full 26-char ULID — try direct fetch first.
  if (raw.length === 26) {
    const direct = directivesQ.getById(db, raw);
    if (direct !== undefined) return direct.id;
  }
  // Suffix — walk recent directives.
  const recent = directivesQ.listRecent(db, 200);
  const matches = recent.filter((d) => d.id.endsWith(raw));
  if (matches.length === 0) return undefined;
  if (matches.length > 1) return 'AMBIGUOUS';
  return matches[0]!.id;
}

// ---------------------------------------------------------------------------
// /factory budget
// ---------------------------------------------------------------------------

export async function handleBudget(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<EmbedBuilder> {
  if (ctx.setProjectBudget === undefined) {
    return errorEmbed(
      'budget',
      'budget mutation is not wired (no daemon binding). This is expected in test/standalone mode.',
    );
  }

  const project = interaction.options.getString('project', true);
  const maxUsd = interaction.options.getNumber('max-usd') ?? undefined;
  const maxSteps = interaction.options.getInteger('max-steps') ?? undefined;

  const defaults: ProjectBudgetDefaults = {
    ...(maxUsd !== undefined ? { maxUsd } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  };

  try {
    const result = await ctx.setProjectBudget(project, defaults);
    ctx.log.info(
      { projectId: result.projectId, defaults, userId: ctx.user.id },
      'discord-commands: project budget updated',
    );
    const lines: string[] = [`**Project:** \`${project}\` (\`…${result.projectId.slice(-4)}\`)`];
    const persisted = result.defaults;
    if (persisted.maxUsd === undefined && persisted.maxSteps === undefined) {
      lines.push('**Budget:** _cleared_ — directives now run uncapped from this project tier.');
    } else {
      const parts: string[] = [];
      if (persisted.maxUsd !== undefined) parts.push(`max-usd \`$${persisted.maxUsd.toFixed(2)}\``);
      if (persisted.maxSteps !== undefined)
        parts.push(`max-steps \`${persisted.maxSteps.toString()}\``);
      lines.push(`**Budget:** ${parts.join(' · ')}`);
    }
    return new EmbedBuilder()
      .setColor(COLOR_OK)
      .setTitle('factory budget — updated')
      .setDescription(lines.join('\n'))
      .setTimestamp();
  } catch (err) {
    if (err instanceof SetProjectBudgetError) {
      return errorEmbed('budget', err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// /factory build
// ---------------------------------------------------------------------------

export async function handleBuild(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
): Promise<EmbedBuilder> {
  const project = interaction.options.getString('project', true);
  const spec = interaction.options.getString('spec') ?? undefined;
  const autonomyRaw = interaction.options.getString('autonomy') ?? 'autonomous';
  const language = interaction.options.getString('language') ?? undefined;
  const maxUsdFlag = interaction.options.getNumber('max-usd') ?? undefined;
  const maxStepsFlag = interaction.options.getInteger('max-steps') ?? undefined;

  const autonomy = autonomyRaw as AutonomyMode;

  // Mirror the messageCreate `/build` path: resolve project → absolute
  // path; resolve limits via the daemon's three-tier helper. Slash flags
  // override the project tier (parallels CLI flags).
  let projectPath: string | undefined;
  if (ctx.resolveProjectPath !== undefined) {
    try {
      projectPath = await ctx.resolveProjectPath(project);
    } catch (err) {
      ctx.log.warn(
        { err, project },
        'discord-commands: resolveProjectPath failed — directive will carry raw name',
      );
    }
  }

  let limits: DirectiveLimits | undefined;
  if (maxUsdFlag !== undefined || maxStepsFlag !== undefined) {
    limits = {
      ...(maxUsdFlag !== undefined ? { maxUsd: maxUsdFlag } : {}),
      ...(maxStepsFlag !== undefined ? { maxSteps: maxStepsFlag } : {}),
    };
  } else if (ctx.resolveBuildLimits !== undefined) {
    try {
      limits = await ctx.resolveBuildLimits(project);
    } catch (err) {
      ctx.log.warn(
        { err, project },
        'discord-commands: resolveBuildLimits failed — directive will run uncapped',
      );
    }
  }

  const payload: Record<string, unknown> = {
    project,
    ...(projectPath !== undefined ? { projectPath } : {}),
    ...(spec !== undefined && spec.length > 0 ? { spec } : {}),
    ...(language !== undefined ? { language } : {}),
  };

  const directive = directiveSchema.parse({
    id: newId(),
    source: 'discord',
    principal: ctx.user.id,
    channelRef: `discord-slash-${Date.now().toString()}`,
    intent: 'build' satisfies Intent,
    payload,
    autonomy,
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
    ...(limits !== undefined ? { limits } : {}),
  });

  await ctx.onInbound(directive);
  ctx.log.info(
    { directiveId: directive.id, project, autonomy },
    'discord-commands: build directive enqueued',
  );

  const lines: string[] = [
    `**Project:** \`${project}\``,
    `**Path:** \`${projectPath !== undefined ? truncatePath(projectPath) : '(unresolved — daemon will retry)'}\``,
    `**Directive:** \`${directive.id.slice(-8)}\``,
    `**Autonomy:** ${autonomy}`,
  ];
  if (language !== undefined) lines.push(`**Language:** ${language}`);
  if (limits !== undefined) {
    const parts: string[] = [];
    if (limits.maxUsd !== undefined) parts.push(`max-usd \`$${limits.maxUsd.toFixed(2)}\``);
    if (limits.maxSteps !== undefined) parts.push(`max-steps \`${limits.maxSteps.toString()}\``);
    lines.push(`**Limits:** ${parts.join(' · ')}`);
  }
  if (spec !== undefined && spec.length > 0) {
    lines.push('', `**Spec:** ${truncate(spec, 1500)}`);
  }
  lines.push('', '_The daemon will claim it shortly._');

  return new EmbedBuilder()
    .setColor(COLOR_OK)
    .setTitle('factory build — queued')
    .setDescription(lines.join('\n'))
    .setTimestamp();
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function errorEmbed(sub: FactorySubcommand, message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR_ERROR)
    .setTitle(`/factory ${sub} — error`)
    .setDescription(truncateForEmbed(message, 1900));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function firstLine(s: string): string {
  const nl = s.indexOf('\n');
  return nl < 0 ? s : s.slice(0, nl);
}

/**
 * Truncate a workspace path for embed display. Keeps the leading drive /
 * separator and the project basename, collapses the middle.
 */
function truncatePath(p: string): string {
  if (p.length <= 56) return p;
  const sepIdx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (sepIdx < 0) return truncate(p, 56);
  const tail = p.slice(sepIdx);
  const headBudget = Math.max(8, 56 - tail.length - 3);
  return `${p.slice(0, headBudget)}…${tail}`;
}

/** Discord embed description limit is 4096 chars; keep a small buffer. */
function truncateForEmbed(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Join sections with double-newline separators, stopping when the running
 * length would exceed `cap`. Keeps the output under Discord's 4096-char
 * embed description limit.
 */
function joinBounded(sections: string[], cap: number): string {
  const out: string[] = [];
  let total = 0;
  for (const s of sections) {
    const next = out.length === 0 ? s : `\n\n${s}`;
    if (total + next.length > cap) {
      out.push('\n\n_(output truncated)_');
      break;
    }
    out.push(next);
    total += next.length;
  }
  return out.join('');
}
