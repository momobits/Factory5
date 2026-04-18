# Agent ETL

## Project Overview

An AI agent that takes natural language descriptions of data flows and generates, validates, and executes ETL pipelines. Uses LangGraph for orchestration and MCP for tool connectivity.

## Tech Stack

- Python 3.11+
- LangGraph for agent graph
- DuckDB as execution engine
- Claude API (Anthropic SDK) for LLM
- MCP SDK (Python) for exposing pipeline operations

## Architecture

```
Natural language description → Planner → Validator → Executor → Results
                                                         ↕
                                               MCP Server (external access)
```

## Key Modules

1. `agent/graph.py` — LangGraph agent with plan→validate→execute flow
2. `agent/planner.py` — Parses NL into pipeline DAG (source, transforms, sink)
3. `agent/validator.py` — Validates pipeline: checks sources exist, types compatible, transforms valid
4. `agent/executor.py` — Executes pipeline using DuckDB for transforms
5. `agent/tools/schema_inspector.py` — Reads source schemas (CSV headers, DB tables, JSON structure)
6. `agent/tools/data_profiler.py` — Quick profile: row count, types, nulls, distributions
7. `agent/tools/transform_library.py` — Built-in transforms: rename, cast, filter, join, aggregate, pivot
8. `mcp_server/server.py` — MCP server exposing: create_pipeline, list_pipelines, run_pipeline, get_status

## Coding Standards

- Type hints everywhere, pydantic models for pipeline definitions
- Pipeline definitions stored as JSON (human-readable, version-controllable)
- All generated code must be inspectable before execution
- DuckDB for transforms — no pandas for large data
- Async where possible (MCP server, agent loop)

## Pipeline Definition Schema (pydantic)

```python
class PipelineStep(BaseModel):
    name: str
    type: Literal["source", "transform", "sink"]
    config: dict

class Pipeline(BaseModel):
    name: str
    description: str
    steps: list[PipelineStep]
    created_at: datetime
```

## Sample Pipelines for Testing

1. "Take the CSV at sample_data/sales.csv, clean the dates, aggregate by month, save as parquet"
2. "Read customers.csv and orders.csv, join on customer_id, filter to last 90 days, output to analytics.parquet"

## Environment Variables

- `ANTHROPIC_API_KEY` — Required
- `DATA_DIR` — Working data directory (default: ./data)
- `MCP_PORT` — MCP server port (default: 3100)

## Testing

- pytest + pytest-asyncio
- Test planner: NL input → correct pipeline DAG structure
- Test validator: invalid pipelines should fail with clear errors
- Test executor: known input → expected output
- Test MCP server: tool invocations return correct responses
- Test end-to-end: NL description → output file verification

## Git Workflow

Conventional commits per module.
