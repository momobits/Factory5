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
 * After step 2.2 each handler is a thin wrapper around the transport-agnostic
 * `command-handlers.ts` module — Telegram dispatches through the same
 * `runStatus` / `runSpend` / etc. so the two surfaces never drift.
 *
 * Registration: definitions are emitted as a single top-level `factory`
 * command with seven subcommands. The discord plugin calls
 * `client.application.commands.set([buildFactorySlashCommand()], guildId)`
 * on `Events.ClientReady`; guild-scoped when `config.guildId` is set
 * (instant register), global otherwise (~1 hour propagation).
 *
 * Dispatch: the plugin registers an `interactionCreate` listener that routes
 * any `factory` chat-input interaction through {@link dispatchSlashInteraction}.
 * Handlers respond via `interaction.editReply()` after a `deferReply()` so a
 * slow read (large registry) doesn't blow Discord's three-second window.
 */

import { BUDGET_DEFAULTS, type AutonomyMode } from '@factory5/core';
import type { Logger } from '@factory5/logger';
import { type Database, type FindingsRegistryEntry, spend as spendQ } from '@factory5/state';
import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';

import {
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  makeProjectNameLookup,
  PROJECT_LANGUAGES,
  runBudget,
  runBuild,
  runCancel,
  runFindings,
  runResume,
  runSpend,
  runStatus,
  SPEND_GROUPS,
  type BudgetData,
  type BudgetInput,
  type BuildData,
  type CancelData,
  type CommandHandlerContext,
  type CommandResult,
  type FindingsData,
  type ResumeData,
  type SpendData,
  type StatusData,
} from './command-handlers.js';
import type { ChannelContext } from './types.js';

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

const AUTONOMY_MODES = ['chat', 'assisted', 'autonomous'] as const;

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
 * Discord caps slash-command option descriptions at 100 characters. Truncate
 * the BUDGET_DEFAULTS explainer strings at the nearest word boundary so the
 * single source-of-truth string is still used without duplicating prose.
 */
function budgetExplainer(axis: keyof typeof BUDGET_DEFAULTS): string {
  const s = BUDGET_DEFAULTS[axis].explainer;
  if (s.length <= 100) return s;
  // Truncate at the last space before char 97 and append '…'
  const cut = s.slice(0, 97);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

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
          .addChoices(...FINDING_SEVERITIES.map((sv) => ({ name: sv, value: sv }))),
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
      .setDescription('set per-project budget defaults — all axes optional; omit all to clear')
      .addStringOption((o) => o.setName('project').setDescription('project name').setRequired(true))
      .addNumberOption((o) =>
        o.setName('max-usd').setDescription(budgetExplainer('maxUsd')).setMinValue(0),
      )
      .addIntegerOption((o) =>
        o.setName('max-steps').setDescription(budgetExplainer('maxSteps')).setMinValue(0),
      )
      .addIntegerOption((o) =>
        o
          .setName('max-turns-scaffolder')
          .setDescription(budgetExplainer('maxTurnsScaffolder'))
          .setMinValue(1),
      )
      .addIntegerOption((o) =>
        o
          .setName('max-turns-builder')
          .setDescription(budgetExplainer('maxTurnsBuilder'))
          .setMinValue(1),
      )
      .addIntegerOption((o) =>
        o
          .setName('max-turns-fixer')
          .setDescription(budgetExplainer('maxTurnsFixer'))
          .setMinValue(1),
      )
      .addNumberOption((o) =>
        o
          .setName('max-usd-per-task')
          .setDescription(budgetExplainer('maxUsdPerTask'))
          .setMinValue(0),
      )
      .addIntegerOption((o) =>
        o
          .setName('ask-user-deadline-ms')
          .setDescription(budgetExplainer('askUserDeadlineMs'))
          .setMinValue(1),
      )
      .addIntegerOption((o) =>
        o
          .setName('max-wiki-readiness-attempts')
          .setDescription(budgetExplainer('maxWikiReadinessAttempts'))
          .setMinValue(0),
      )
      .addBooleanOption((o) =>
        o
          .setName('auto-increase-budgets')
          .setDescription(
            'Auto-bump exhausted turn-pool axes instead of parking the directive (ADR 0034 §5).',
          ),
      )
      .addIntegerOption((o) =>
        o
          .setName('auto-increase-ceiling-multiplier')
          .setDescription(
            'Safety ceiling for auto-bump: abort when cap exceeds projectDefault × multiplier. Min 1.',
          )
          .setMinValue(1),
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
          .addChoices(...PROJECT_LANGUAGES.map((l) => ({ name: l, value: l }))),
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
// Per-interaction context — superset of CommandHandlerContext with the
// Discord-specific allow-list. The plugin builds this once per interaction.
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
    const errEmbed = new EmbedBuilder()
      .setColor(COLOR_ERROR)
      .setTitle(`/factory ${sub} — error`)
      .setDescription(`\`${truncateForEmbed(message, 1900)}\``);
    await interaction.editReply({ embeds: [errEmbed] });
  }
}

async function runSubcommand(
  ctx: DiscordCommandContext,
  interaction: ChatInputCommandInteraction,
  sub: FactorySubcommand,
): Promise<EmbedBuilder> {
  const handlerCtx = toHandlerContext(ctx);
  switch (sub) {
    case 'status':
      return embedStatus(ctx.db, await runStatus(handlerCtx, statusInput(interaction)));
    case 'spend':
      return embedSpend(
        await runSpend(handlerCtx, spendInput(interaction)),
        interaction.options.getString('project') ?? undefined,
      );
    case 'findings':
      return embedFindings(await runFindings(handlerCtx, findingsInput(interaction)));
    case 'resume':
      return embedResume(await runResume(handlerCtx, resumeInput(interaction)));
    case 'cancel':
      return embedCancel(await runCancel(handlerCtx, cancelInput(interaction)));
    case 'budget':
      return embedBudget(await runBudget(handlerCtx, budgetInput(interaction)));
    case 'build':
      return embedBuild(await runBuild(handlerCtx, buildInput(interaction)));
  }
}

/**
 * Phase 2.5 — run the chat-routed read-side command and return the
 * Discord embed. Shared between slash dispatch and the inbound chat
 * handler so both surfaces produce identical replies.
 *
 * The dispatch's `command` is one of `status` / `spend` / `findings` /
 * `resume` / `build` (cancel and budget are explicit-only via slash);
 * the matching `run<Cmd>` from `command-handlers.ts` produces typed
 * data which the existing embed renderers format.
 */
export async function runChatRoutedDiscordCommand(
  handlerCtx: CommandHandlerContext,
  db: Database,
  dispatch: { command: 'status' | 'spend' | 'findings' | 'resume' | 'build'; input: unknown },
): Promise<EmbedBuilder> {
  switch (dispatch.command) {
    case 'status':
      return embedStatus(
        db,
        await runStatus(handlerCtx, dispatch.input as Parameters<typeof runStatus>[1]),
      );
    case 'spend': {
      const input = dispatch.input as Parameters<typeof runSpend>[1];
      const projectFilter = input.project ?? undefined;
      return embedSpend(await runSpend(handlerCtx, input), projectFilter);
    }
    case 'findings':
      return embedFindings(
        await runFindings(handlerCtx, dispatch.input as Parameters<typeof runFindings>[1]),
      );
    case 'resume':
      return embedResume(
        await runResume(handlerCtx, dispatch.input as Parameters<typeof runResume>[1]),
      );
    case 'build':
      return embedBuild(
        await runBuild(handlerCtx, dispatch.input as Parameters<typeof runBuild>[1]),
      );
  }
}

function toHandlerContext(ctx: DiscordCommandContext): CommandHandlerContext {
  return {
    db: ctx.db,
    log: ctx.log,
    source: 'discord',
    principal: ctx.user.id,
    channelRef: `discord-slash-${Date.now().toString()}`,
    onInbound: ctx.onInbound,
    resolveProjectPath: ctx.resolveProjectPath,
    resolveBuildLimits: ctx.resolveBuildLimits,
    setProjectBudget: ctx.setProjectBudget,
  };
}

// ---------------------------------------------------------------------------
// Interaction → input adapters
// ---------------------------------------------------------------------------

function statusInput(interaction: ChatInputCommandInteraction): { limit?: number } {
  const limit = interaction.options.getInteger('limit') ?? undefined;
  return limit !== undefined ? { limit } : {};
}

function spendInput(interaction: ChatInputCommandInteraction): {
  groupBy?: string;
  project?: string;
} {
  const groupBy = interaction.options.getString('group-by') ?? undefined;
  const project = interaction.options.getString('project') ?? undefined;
  return {
    ...(groupBy !== undefined ? { groupBy } : {}),
    ...(project !== undefined && project.length > 0 ? { project } : {}),
  };
}

function findingsInput(interaction: ChatInputCommandInteraction): {
  project?: string;
  severity?: string;
  status?: string;
} {
  const project = interaction.options.getString('project') ?? undefined;
  const severity = interaction.options.getString('severity') ?? undefined;
  const status = interaction.options.getString('status') ?? undefined;
  return {
    ...(project !== undefined && project.length > 0 ? { project } : {}),
    ...(severity !== undefined ? { severity } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

function resumeInput(interaction: ChatInputCommandInteraction): { project: string } {
  return { project: interaction.options.getString('project', true) };
}

function cancelInput(interaction: ChatInputCommandInteraction): {
  directiveId: string;
  reason?: string;
} {
  const directiveId = interaction.options.getString('directive-id', true);
  const reason = interaction.options.getString('reason') ?? undefined;
  return reason !== undefined ? { directiveId, reason } : { directiveId };
}

function budgetInput(interaction: ChatInputCommandInteraction): BudgetInput {
  const project = interaction.options.getString('project', true);
  const maxUsd = interaction.options.getNumber('max-usd') ?? undefined;
  const maxSteps = interaction.options.getInteger('max-steps') ?? undefined;
  const maxTurnsScaffolder = interaction.options.getInteger('max-turns-scaffolder') ?? undefined;
  const maxTurnsBuilder = interaction.options.getInteger('max-turns-builder') ?? undefined;
  const maxTurnsFixer = interaction.options.getInteger('max-turns-fixer') ?? undefined;
  const maxUsdPerTask = interaction.options.getNumber('max-usd-per-task') ?? undefined;
  const askUserDeadlineMs = interaction.options.getInteger('ask-user-deadline-ms') ?? undefined;
  const maxWikiReadinessAttempts =
    interaction.options.getInteger('max-wiki-readiness-attempts') ?? undefined;
  const autoIncreaseBudgets = interaction.options.getBoolean('auto-increase-budgets') ?? undefined;
  const autoIncreaseCeilingMultiplier =
    interaction.options.getInteger('auto-increase-ceiling-multiplier') ?? undefined;
  return {
    project,
    ...(maxUsd !== undefined ? { maxUsd } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
    ...(maxTurnsScaffolder !== undefined ? { maxTurnsScaffolder } : {}),
    ...(maxTurnsBuilder !== undefined ? { maxTurnsBuilder } : {}),
    ...(maxTurnsFixer !== undefined ? { maxTurnsFixer } : {}),
    ...(maxUsdPerTask !== undefined ? { maxUsdPerTask } : {}),
    ...(askUserDeadlineMs !== undefined ? { askUserDeadlineMs } : {}),
    ...(maxWikiReadinessAttempts !== undefined ? { maxWikiReadinessAttempts } : {}),
    ...(autoIncreaseBudgets !== undefined ? { autoIncreaseBudgets } : {}),
    ...(autoIncreaseCeilingMultiplier !== undefined ? { autoIncreaseCeilingMultiplier } : {}),
  };
}

function buildInput(interaction: ChatInputCommandInteraction): {
  project: string;
  spec?: string;
  autonomy?: AutonomyMode;
  language?: 'python' | 'node' | 'go' | 'rust';
  maxUsd?: number;
  maxSteps?: number;
} {
  const project = interaction.options.getString('project', true);
  const spec = interaction.options.getString('spec') ?? undefined;
  const autonomy = (interaction.options.getString('autonomy') ?? undefined) as
    | AutonomyMode
    | undefined;
  const language = (interaction.options.getString('language') ?? undefined) as
    | 'python'
    | 'node'
    | 'go'
    | 'rust'
    | undefined;
  const maxUsd = interaction.options.getNumber('max-usd') ?? undefined;
  const maxSteps = interaction.options.getInteger('max-steps') ?? undefined;
  return {
    project,
    ...(spec !== undefined && spec.length > 0 ? { spec } : {}),
    ...(autonomy !== undefined ? { autonomy } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(maxUsd !== undefined ? { maxUsd } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  };
}

// ---------------------------------------------------------------------------
// Result → embed renderers
// ---------------------------------------------------------------------------

function embedStatus(db: Database, data: StatusData): EmbedBuilder {
  const sections: string[] = [];

  if (data.projects.length === 0) {
    sections.push('**Projects** — _(none registered)_');
  } else {
    const lines = data.projects
      .slice(0, 8)
      .map((p) => `• \`${p.name}\` — ${p.status} — ${truncatePath(p.workspacePath)}`);
    if (data.projects.length > 8) lines.push(`_…and ${data.projects.length - 8} more_`);
    sections.push(`**Projects** (${data.projects.length})`, lines.join('\n'));
  }

  if (data.recent.length === 0) {
    sections.push('**Recent directives** — _(none yet)_');
  } else {
    const projectNameOf = makeProjectNameLookup(data.projects);
    const lines: string[] = ['```'];
    lines.push(
      `${'id'.padEnd(8)}  ${'project'.padEnd(14)}  ${'status'.padEnd(8)}  ${'intent'.padEnd(11)}  ${'spent'.padStart(9)}  created`,
    );
    for (const e of data.recent) {
      const d = e.directive;
      const proj = truncate(projectNameOf(d.projectId), 14).padEnd(14);
      lines.push(
        `${d.id.slice(-8)}  ${proj}  ${d.status.padEnd(8)}  ${d.intent.padEnd(11)}  ${`$${e.spendUsd.toFixed(4)}`.padStart(9)}  ${d.createdAt.slice(0, 19)}Z`,
      );
    }
    lines.push('```');
    sections.push(`**Recent directives** (${data.recent.length})`, lines.join('\n'));
  }

  // The handler context already produced the data; `db` is unused here but
  // kept in the signature to keep the call site aligned with the other
  // renderers (status takes a DB read for spend; future expansion may want it).
  void db;

  return new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle('factory status')
    .setDescription(joinBounded(sections, 4000))
    .setTimestamp();
}

function embedSpend(result: CommandResult<SpendData>, projectFilter?: string): EmbedBuilder {
  if (!result.ok) return errorEmbed('spend', result.message);
  const data = result.data;
  let body: string;
  switch (data.groupBy) {
    case 'project':
      body = renderSpendProject(data.rows);
      break;
    case 'directive':
      body = renderSpendDirective(data.rows);
      break;
    case 'day':
      body = renderSpendDay(data.rows);
      break;
    case 'model':
      body = renderSpendModel(data.rows);
      break;
  }
  const titleSuffix =
    projectFilter !== undefined && projectFilter.length > 0 ? ` — project=${projectFilter}` : '';
  return new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle(`factory spend (group-by ${data.groupBy})${titleSuffix}`)
    .setDescription(body)
    .setTimestamp();
}

function embedFindings(result: CommandResult<FindingsData>): EmbedBuilder {
  if (!result.ok) return errorEmbed('findings', result.message);
  const { rows, filters } = result.data;
  const titleParts: string[] = [`status=${filters.status}`];
  if (filters.severity !== undefined) titleParts.push(`severity=${filters.severity}`);
  if (filters.project !== undefined) titleParts.push(`project=${filters.project}`);
  return new EmbedBuilder()
    .setColor(rows.length === 0 ? COLOR_OK : COLOR_INFO)
    .setTitle(`factory findings (${titleParts.join(', ')})`)
    .setDescription(renderFindings(rows))
    .setTimestamp();
}

function embedResume(result: CommandResult<ResumeData>): EmbedBuilder {
  if (!result.ok) return errorEmbed('resume', result.message);
  const data = result.data;
  return new EmbedBuilder()
    .setColor(COLOR_OK)
    .setTitle('factory resume — queued')
    .setDescription(
      [
        `**Project:** \`${data.project}\``,
        `**Path:** \`${truncatePath(data.projectPath)}\``,
        `**Resuming from:** \`${data.priorId.slice(-8)}\` (${data.priorStatus})`,
        `**New directive:** \`${data.newDirectiveId.slice(-8)}\``,
        '',
        '_The daemon will claim it shortly._',
      ].join('\n'),
    )
    .setTimestamp();
}

function embedCancel(result: CommandResult<CancelData>): EmbedBuilder {
  if (!result.ok) return errorEmbed('cancel', result.message);
  const data = result.data;
  return new EmbedBuilder()
    .setColor(COLOR_WARN)
    .setTitle('factory cancel — directive marked blocked')
    .setDescription(
      [
        `**Directive:** \`${data.directiveId.slice(-8)}\``,
        `**Was:** ${data.prevStatus}`,
        `**Reason:** ${data.reason}`,
        '',
        '_2.1 marks the row blocked. Step 2.4 will additionally kill running workers within 10 s._',
      ].join('\n'),
    )
    .setTimestamp();
}

function embedBudget(result: CommandResult<BudgetData>): EmbedBuilder {
  if (!result.ok) return errorEmbed('budget', result.message);
  const data = result.data;
  const lines: string[] = [`**Project:** \`${data.project}\` (\`…${data.projectId.slice(-4)}\`)`];
  const persisted = data.defaults;
  const axisKeys = Object.keys(persisted) as Array<keyof typeof persisted>;
  const hasScalars =
    data.autoIncreaseBudgets !== undefined || data.autoIncreaseCeilingMultiplier !== undefined;
  if (axisKeys.length === 0 && !hasScalars) {
    lines.push('**Budget:** _cleared_ — directives now run uncapped from this project tier.');
  } else {
    const parts: string[] = [];
    if (persisted.maxUsd !== undefined) parts.push(`max-usd \`$${persisted.maxUsd.toFixed(2)}\``);
    if (persisted.maxSteps !== undefined)
      parts.push(`max-steps \`${persisted.maxSteps.toString()}\``);
    if (persisted.maxTurnsScaffolder !== undefined)
      parts.push(`max-turns-scaffolder \`${persisted.maxTurnsScaffolder.toString()}\``);
    if (persisted.maxTurnsBuilder !== undefined)
      parts.push(`max-turns-builder \`${persisted.maxTurnsBuilder.toString()}\``);
    if (persisted.maxTurnsFixer !== undefined)
      parts.push(`max-turns-fixer \`${persisted.maxTurnsFixer.toString()}\``);
    if (persisted.maxUsdPerTask !== undefined)
      parts.push(`max-usd-per-task \`$${persisted.maxUsdPerTask.toFixed(2)}\``);
    if (persisted.askUserDeadlineMs !== undefined)
      parts.push(`ask-user-deadline-ms \`${persisted.askUserDeadlineMs.toString()}\``);
    if (persisted.maxWikiReadinessAttempts !== undefined)
      parts.push(
        `max-wiki-readiness-attempts \`${persisted.maxWikiReadinessAttempts.toString()}\``,
      );
    if (data.autoIncreaseBudgets !== undefined)
      parts.push(`auto-increase-budgets \`${data.autoIncreaseBudgets ? 'on' : 'off'}\``);
    if (data.autoIncreaseCeilingMultiplier !== undefined)
      parts.push(
        `auto-increase-ceiling-multiplier \`${data.autoIncreaseCeilingMultiplier.toString()}x\``,
      );
    if (parts.length > 0) lines.push(`**Budget:** ${parts.join(' · ')}`);
  }
  return new EmbedBuilder()
    .setColor(COLOR_OK)
    .setTitle('factory budget — updated')
    .setDescription(lines.join('\n'))
    .setTimestamp();
}

function embedBuild(data: BuildData): EmbedBuilder {
  const lines: string[] = [
    `**Project:** \`${data.project}\``,
    `**Path:** \`${data.projectPath !== undefined ? truncatePath(data.projectPath) : '(unresolved — daemon will retry)'}\``,
    `**Directive:** \`${data.directiveId.slice(-8)}\``,
    `**Autonomy:** ${data.autonomy}`,
  ];
  if (data.language !== undefined) lines.push(`**Language:** ${data.language}`);
  if (data.limits !== undefined) {
    const parts: string[] = [];
    if (data.limits.maxUsd !== undefined)
      parts.push(`max-usd \`$${data.limits.maxUsd.toFixed(2)}\``);
    if (data.limits.maxSteps !== undefined)
      parts.push(`max-steps \`${data.limits.maxSteps.toString()}\``);
    lines.push(`**Limits:** ${parts.join(' · ')}`);
  }
  if (data.spec !== undefined && data.spec.length > 0) {
    lines.push('', `**Spec:** ${truncate(data.spec, 1500)}`);
  }
  lines.push('', '_The daemon will claim it shortly._');
  return new EmbedBuilder()
    .setColor(COLOR_OK)
    .setTitle('factory build — queued')
    .setDescription(lines.join('\n'))
    .setTimestamp();
}

// ---------------------------------------------------------------------------
// Spend / findings table renderers
// ---------------------------------------------------------------------------

function renderSpendProject(
  rows: ReadonlyArray<{
    display: string;
    directiveCount: number;
    callCount: number;
    totalUsd: number;
  }>,
): string {
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

function renderSpendDirective(
  rows: ReadonlyArray<{
    directiveId: string;
    projectId: string | null;
    projectName: string | null;
    callCount: number;
    totalUsd: number;
    lastCalledAt: string;
  }>,
): string {
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

function renderSpendDay(
  rows: ReadonlyArray<{ date: string; callCount: number; totalUsd: number }>,
): string {
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

function renderSpendModel(
  rows: ReadonlyArray<{ provider: string; model: string; callCount: number; totalUsd: number }>,
): string {
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

function renderFindings(rows: ReadonlyArray<FindingsRegistryEntry>): string {
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
// Generic helpers
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
