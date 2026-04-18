# Insight Engine

## Project Overview

A drop-and-go AI data platform. Drop CSV files into an intake folder and the engine automatically runs the full pipeline: ingestion with file tracking, ETL, data quality scoring, schema documentation, AI-driven analysis, and trend detection. Supports temporal awareness — when updated files are dropped (same name, new timestamp), the engine detects what changed, tracks history, and surfaces trends across snapshots. A conversational interface lets users ask natural language questions across all data and all generated insights.

## Tech Stack

- Python 3.11+
- DuckDB as the unified query and storage engine (raw data, profiles, quality scores, insights — all in one DB)
- LangGraph for agent orchestration (ingest pipeline + conversational agent)
- **LLM Backend (dual-provider):**
  - Claude API (Anthropic SDK) — primary production provider
  - Ollama — local/network alternative for development, testing, and cost-free operation
  - Both accessed through a unified `LLMProvider` abstraction so all modules are backend-agnostic
- Streamlit for the dashboard and chat interface
- Plotly for auto-generated visualizations
- Watchdog for filesystem monitoring (watch intake folder)
- Pydantic for all data models
- YAML for user-configurable quality rules

## Architecture

```
intake/                          (user drops CSVs here)
  ├── sales_20260401.csv
  ├── sales_20260407.csv
  └── customers.csv
         │
         ▼
  ┌─────────────────┐
  │   File Watcher   │  ← Watchdog monitors intake/ for new files
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  File Registry   │  ← Tracks every file: name, timestamp, hash, lineage group
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │   ETL Pipeline   │  ← Infer schema, clean, type-cast, load into DuckDB
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  Quality Scorer  │  ← Profile + score 6 dimensions per dataset
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  Documenter      │  ← AI-generated table/column descriptions, ER diagrams
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  Auto Analyst    │  ← AI analyzes data, quality, docs → generates insights
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  Trend Tracker   │  ← Compares snapshots, detects drift, temporal patterns
  └────────┬────────┘
           ▼
  ┌─────────────────────────────────────────────┐
  │  Streamlit Dashboard + Conversational Agent  │
  │  - Data catalog with docs                    │
  │  - Quality scores and trends                 │
  │  - AI insights feed                          │
  │  - Chat: ask questions across all data       │
  └─────────────────────────────────────────────┘
```

## Key Modules

### LLM Provider

0. `engine/llm/provider.py` — Unified LLM abstraction. Exposes a single interface (`generate`, `generate_structured`) that all modules call instead of hitting Claude or Ollama directly. Selects backend based on `LLM_PROVIDER` env var (`claude` or `ollama`). Handles prompt formatting differences between providers internally. For Ollama, uses the REST API (`/api/generate`, `/api/chat`) via `httpx`. For Claude, uses the Anthropic SDK. Both return the same `LLMResponse` pydantic model. Includes retry logic, timeout handling, and token usage tracking for both providers.

   `engine/llm/ollama_client.py` — Ollama-specific client. Connects to an Ollama instance over the network via its HTTP API. Supports model selection, temperature, JSON mode for structured output, and streaming. Handles connection errors gracefully with clear messages ("Cannot reach Ollama at {host}:{port}").

   `engine/llm/claude_client.py` — Claude-specific client wrapping the Anthropic SDK. Handles API key auth, rate limiting, and response parsing.

   `engine/llm/models.py` — Shared pydantic models: `LLMRequest`, `LLMResponse`, `LLMConfig`. Config includes provider, model name, temperature, max_tokens, base_url (for Ollama).

### File Intake & Registry

1. `engine/watcher.py` — Watchdog-based file monitor on `intake/` directory. Detects new/modified CSVs, triggers the pipeline. Also supports manual `engine.ingest(path)` for scripted use.
2. `engine/registry.py` — File registry stored in DuckDB table `_file_registry`. Tracks: filename, file_hash (SHA-256), ingested_at, row_count, lineage_group (base name without timestamp), snapshot_order. Detects whether a file is new data or an update to an existing dataset by parsing timestamp patterns from filenames (e.g., `sales_20260401.csv` and `sales_20260407.csv` share lineage group `sales`).

### ETL Pipeline

3. `engine/etl/loader.py` — Read CSV into DuckDB, auto-detect types, handle encoding issues. Each file loads into a table named `{lineage_group}_{snapshot_timestamp}`. Maintains a `{lineage_group}_latest` view always pointing to the most recent snapshot.
4. `engine/etl/cleaner.py` — Standardize column names (snake_case), handle nulls, trim whitespace, parse dates, cast types. Logs all transformations applied.
5. `engine/etl/schema_inspector.py` — Infer and record schema: column names, types, nullable, sample values. Store in DuckDB table `_schemas`.

### Data Quality

6. `engine/quality/profiler.py` — Auto-profile every ingested dataset: row count, column types, null counts, unique counts, min/max, distributions, value frequencies. Store profiles in `_profiles` table.
7. `engine/quality/scorer.py` — Score 6 quality dimensions (0-100 each): completeness (non-null ratio), validity (values within expected patterns/ranges), uniqueness (duplicate detection), consistency (cross-column rule checks), timeliness (date freshness), accuracy (outlier and anomaly detection). Store scores in `_quality_scores` table with timestamp for trend tracking.
8. `engine/quality/rules_engine.py` — Parse YAML quality rules (e.g., `revenue > 0`, `email matches regex`, `date not in future`). Users drop rule files into `rules/` directory. Validate data against rules, store violations in `_quality_violations`.

### Documentation

9. `engine/documenter/describer.py` — Send schema + sample rows + quality profile to the LLM provider. Generate plain-English descriptions for each table and column. Include confidence scores (0-1). Store in `_documentation` table. Re-generate when schema changes are detected.
10. `engine/documenter/diagram_generator.py` — Detect relationships (FK patterns, naming conventions, value overlap analysis) and generate Mermaid ER diagrams. Store diagram source in `_diagrams` table.

### AI Analysis & Insights

11. `engine/analyst/auto_analyzer.py` — After each ingestion cycle completes, automatically analyze the data. Sends to the LLM provider: schema, quality scores, sample data, documentation, and (if available) prior insights and trend data. The LLM generates structured insights: key findings, anomalies, correlations, recommendations. Each insight is categorized (trend, anomaly, correlation, summary, recommendation) and scored by significance (0-1). Store in `_insights` table.
12. `engine/analyst/trend_tracker.py` — When multiple snapshots exist for a lineage group, compare them: row count changes, schema drift (added/removed/changed columns), value distribution shifts, quality score trends, new/disappeared categories. Generates temporal insights (e.g., "revenue increased 15% between April 1 and April 7 snapshots", "3 new product categories appeared", "null rate in email column worsening over time"). Store in `_trends` table.
13. `engine/analyst/comparator.py` — Deep diff between two snapshots of the same lineage group. Row-level: new rows, removed rows, changed rows. Column-level: distribution shifts, new values, disappeared values. Aggregate-level: sum/mean/median changes. Returns structured comparison report.

### Conversational Interface

14. `engine/chat/graph.py` — LangGraph conversation agent. Has access to all DuckDB tables (raw data + metadata tables). State includes conversation history, current context (which datasets are in scope), and references to relevant insights.
15. `engine/chat/sql_generator.py` — Schema-aware NL-to-SQL. Prompt includes: all table schemas, documentation, quality context, recent insights. Generates read-only DuckDB SQL. Handles questions about both raw data ("what were top sales?") and meta-data ("which columns have quality issues?", "what changed since last upload?").
16. `engine/chat/visualizer.py` — Auto-detect appropriate chart type from query results (bar, line, pie, scatter, heatmap, table). Generate Plotly figures. For temporal data, default to line charts showing trend across snapshots.
17. `engine/chat/narrator.py` — Generate plain-English narrative for query results. Reference relevant insights and trends when available. Explain significance in business context.
18. `engine/chat/guardrails.py` — Read-only enforcement, row limits, injection prevention, PII detection in outputs.

### Dashboard

19. `app/streamlit_app.py` — Main Streamlit application with pages:
    - **Data Catalog**: list all datasets, schemas, AI-generated docs, ER diagrams
    - **Quality Dashboard**: quality scores per dataset, trend charts over snapshots, violations drill-down
    - **Insights Feed**: chronological feed of AI-generated insights, filterable by category and dataset
    - **Trends**: side-by-side snapshot comparisons, drift visualization, temporal charts
    - **Chat**: conversational BI interface — ask anything across all data and insights

### Pipeline Orchestration

20. `engine/pipeline.py` — Orchestrates the full pipeline for a single file: register → load → clean → profile → score quality → document → analyze → track trends. Returns a run summary. Handles errors per stage without failing the whole pipeline.
21. `engine/scheduler.py` — Two modes: (a) watch mode — continuously monitor intake folder, (b) run-once mode — process all files currently in intake and exit. CLI entry point for both.

## DuckDB Schema (Internal Tables)

```sql
-- File tracking
_file_registry(file_id, filename, file_hash, lineage_group, snapshot_ts, ingested_at, row_count, status)

-- Schema tracking
_schemas(table_name, column_name, column_type, nullable, sample_values, recorded_at)

-- Quality
_profiles(table_name, column_name, null_count, unique_count, min_val, max_val, mean_val, distribution_json, profiled_at)
_quality_scores(table_name, dimension, score, details_json, scored_at)
_quality_violations(table_name, rule_name, column_name, violation_count, sample_violations_json, checked_at)

-- Documentation
_documentation(table_name, column_name, description, confidence, generated_at)
_diagrams(diagram_name, mermaid_source, generated_at)

-- Insights & Trends
_insights(insight_id, lineage_group, category, title, body, significance, data_json, generated_at)
_trends(trend_id, lineage_group, snapshot_a, snapshot_b, metric, direction, magnitude, detail_json, detected_at)
```

## Filename Timestamp Convention

The engine parses timestamps from filenames to determine lineage grouping and snapshot ordering. Supported patterns:

- `sales_20260401.csv` → lineage group `sales`, snapshot `2026-04-01`
- `sales_2026-04-01.csv` → lineage group `sales`, snapshot `2026-04-01`
- `sales_20260401_120000.csv` → lineage group `sales`, snapshot `2026-04-01T12:00:00`
- `customers.csv` (no timestamp) → lineage group `customers`, snapshot = ingestion time

Files with no timestamp that are re-dropped are detected via hash comparison. If the hash differs, a new snapshot is created.

## Sample Data

Create sample CSVs in `sample_data/` for testing:

1. `retail_sales_20260301.csv` — 5,000 rows: date, product, category, region, units_sold, revenue, cost
2. `retail_sales_20260401.csv` — 5,000 rows: same schema, different month, some new categories, slight quality drift
3. `customers_20260301.csv` — 2,000 rows: customer_id, name, email, region, signup_date, tier
4. `customers_20260401.csv` — 2,200 rows: same schema, 200 new customers, some email nulls introduced

Generate realistic data with intentional differences between snapshots to demonstrate trend detection.

## Quality Rules Example (rules/retail.yaml)

```yaml
dataset: retail_sales
rules:
  - column: revenue
    check: '> 0'
    severity: critical
  - column: date
    check: 'not_future'
    severity: warning
  - column: category
    check: 'not_null'
    severity: critical
  - column: email
    check: "matches_regex: ^[\\w.-]+@[\\w.-]+\\.\\w+$"
    severity: warning
```

## Environment Variables

- `LLM_PROVIDER` — LLM backend to use: `claude` or `ollama` (default: `ollama`)
- `ANTHROPIC_API_KEY` — Required when `LLM_PROVIDER=claude`
- `OLLAMA_HOST` — Ollama server address (default: `http://192.168.1.145:11434`)
- `OLLAMA_MODEL` — Ollama model to use (default: `gpt-oss:20b`)
- `INTAKE_DIR` — Folder to watch for CSV drops (default: ./intake)
- `DB_PATH` — DuckDB database file path (default: ./insight_engine.duckdb)
- `RULES_DIR` — Quality rules directory (default: ./rules)
- `MAX_ROWS` — Max rows returned per chat query (default: 10000)
- `WATCH_INTERVAL` — File watcher poll interval in seconds (default: 5)
- `AUTO_ANALYZE` — Run AI analysis after each ingestion (default: true)

## Coding Standards

- Type hints on all functions, pydantic models for all data structures
- Google-style docstrings on all public functions
- DuckDB for all data operations — no pandas for large data
- Async where possible (file watcher, agent loop)
- **No module may import `anthropic` or `httpx` (for Ollama) directly** — all LLM calls go through `engine.llm.provider`. This ensures swapping providers is a config change, not a code change.
- All LLM calls must handle rate limits, timeouts, and connection errors gracefully
- SQL injection prevention: parameterized queries only
- All generated SQL must be read-only (no INSERT/UPDATE/DELETE on user data tables)
- Internal metadata tables use underscore prefix (`_file_registry`, `_insights`, etc.)
- Logging via Python `logging` module, structured JSON logs

## LLM Provider Details

### Ollama (default for development and testing)

- **Server**: `proteus` machine at `192.168.1.145:11434`
- **Model**: `gpt-oss:20b`
- API endpoints used: `POST /api/chat` (conversational), `POST /api/generate` (single-shot)
- Use JSON mode (`"format": "json"` in request) for structured outputs (insights, quality descriptions, etc.)
- Connection timeout: 10s, generation timeout: 120s (20B model may be slower on longer prompts)
- Health check: `GET /api/tags` to verify server is reachable and model is available at startup

### Claude (production)

- Uses Anthropic SDK with `ANTHROPIC_API_KEY`
- Default model: `claude-sonnet-4-20250514`
- Handles rate limiting with exponential backoff

### Provider parity

- All prompts must work with both providers. Avoid Claude-specific features (tool_use, system prompts with caching) in the shared prompt layer. Use plain system + user message format that both APIs support.
- Structured output: for Claude, use response parsing. For Ollama, use JSON mode. The `LLMProvider.generate_structured()` method handles this difference internally.

## Testing

- pytest + pytest-asyncio
- **All tests that need an LLM should use Ollama on proteus (`192.168.1.145:11434`, model `gpt-oss:20b`)** — no API keys needed, no cost, always available on the local network. Tests that validate prompt construction or output parsing should mock the LLM provider. Tests that validate end-to-end behavior (quality of generated SQL, insight quality) should hit Ollama live.
- Test LLM provider: test both Ollama and Claude clients, test provider switching, test connection error handling
- Test file registry: filename parsing, lineage grouping, hash detection
- Test ETL: CSV load, type inference, cleaning transforms
- Test quality profiler: known data → expected profile
- Test quality scorer: edge cases (all nulls, all unique, empty dataset)
- Test rules engine: YAML parsing, rule evaluation, violation detection
- Test documenter: mock LLM provider, verify prompt construction and output parsing
- Test trend tracker: two known snapshots → expected drift report
- Test auto analyzer: mock LLM provider, verify insight structure and categorization
- Test SQL generator: known questions → valid SQL patterns
- Test guardrails: malicious inputs (DROP TABLE, etc.)
- Test full pipeline: drop CSV → verify all metadata tables populated (using Ollama)
- Test temporal flow: drop v1 CSV → drop v2 CSV → verify trends detected

## CLI Interface

```bash
# Watch mode — monitor intake folder continuously
python -m engine.scheduler watch

# Run once — process all files in intake and exit
python -m engine.scheduler run

# Ingest a specific file
python -m engine.scheduler ingest path/to/file.csv

# Launch dashboard
streamlit run app/streamlit_app.py

# Chat mode (terminal, no Streamlit)
python -m engine.chat.cli
```

## Git Workflow

Conventional commits per module:

- `feat: implement file registry with lineage grouping`
- `feat: add ETL pipeline with DuckDB loader`
- `feat: add quality profiler and scorer`
- `feat: add AI documenter with confidence scoring`
- `feat: add auto-analyzer and trend tracker`
- `feat: add conversational chat agent`
- `feat: add Streamlit dashboard`
- `test: add comprehensive test suite`
