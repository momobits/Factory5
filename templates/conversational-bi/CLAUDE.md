# Conversational BI

## Project Overview

A conversational BI agent that takes natural language business questions, generates SQL, executes against DuckDB, and returns auto-visualizations with narrative explanations.

## Tech Stack

- Python 3.11+
- LangGraph for agent orchestration
- DuckDB as the query engine
- Streamlit for the chat interface
- Plotly for auto-generated visualizations
- Claude API (via Anthropic SDK) for NL-to-SQL and narrative generation

## Architecture

```
User question (Streamlit) → LangGraph agent → SQL Generator → DuckDB → Visualizer → Narrator → Response
```

## Key Modules

1. `agent/graph.py` — LangGraph conversation agent with state management
2. `agent/sql_generator.py` — Schema-aware NL-to-SQL with prompt templates
3. `agent/visualizer.py` — Auto-detects chart type (bar, line, pie, scatter, table) based on result shape
4. `agent/narrator.py` — Generates plain English explanations of query results
5. `agent/guardrails.py` — Query safety: read-only enforcement, row limits, injection prevention
6. `app/streamlit_app.py` — Chat interface with conversation history

## Coding Standards

- Use type hints on all functions
- Docstrings on all public functions (Google style)
- Use `pydantic` for data models and config
- Use `python-dotenv` for env vars
- Error handling: never swallow exceptions, always log
- SQL injection prevention: parameterized queries only
- All DuckDB queries must be read-only (no INSERT/UPDATE/DELETE)

## Sample Data

Create two sample Parquet files in `sample_data/`:

1. `retail_sales.parquet` — 10,000 rows: date, product, category, region, units_sold, revenue, cost
2. `banking_transactions.parquet` — 10,000 rows: date, customer_id, channel, transaction_type, amount, status

Generate realistic South African banking/retail data patterns.

## Environment Variables

- `ANTHROPIC_API_KEY` — Required for Claude API
- `DATA_DIR` — Path to data files (default: ./sample_data)
- `MAX_ROWS` — Max rows returned per query (default: 10000)

## Testing

- Use pytest with pytest-asyncio
- Test SQL generation with known questions → expected SQL patterns
- Test guardrails with malicious inputs (DROP TABLE, etc.)
- Test visualizer chart type selection logic
- Test narrator with sample query results
- Test end-to-end: question → chart type verification

## Git Workflow

Commit after each module with conventional commits:

- `feat: implement sql_generator with schema-aware prompting`
- `feat: add auto-visualization with Plotly`
- `test: add comprehensive test suite`
