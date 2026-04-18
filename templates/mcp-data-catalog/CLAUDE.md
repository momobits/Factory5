# MCP Data Catalog

## Project Overview

MCP server exposing an organization's data catalog to AI assistants like Claude.

## Tech Stack

- TypeScript strict mode, MCP SDK (@modelcontextprotocol/sdk), zod for validation

## Key Modules

1. `src/server.ts` — MCP server setup with tool registration
2. `src/tools/search.ts` — search_tables tool: fuzzy search across table/column names
3. `src/tools/schema.ts` — get_schema tool: full schema for a given table
4. `src/tools/lineage.ts` — get_lineage tool: upstream/downstream dependencies
5. `src/tools/quality.ts` — get_quality_score tool: quality metrics per table
6. `src/ingestion/postgres.ts` — Introspect PostgreSQL and populate catalog
7. `src/store/catalog.ts` — In-memory catalog store with search index

## Coding Standards

- TypeScript strict, ESLint + Prettier, zod for all tool inputs
- Demo mode: in-memory store from sample JSON schema (no DB required)
- Include example Claude conversation in examples/

## Testing

- vitest, test each tool handler, test search matching, test ingestion
