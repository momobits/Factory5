# FinServ Knowledge Graph

## Project Overview

Knowledge graph mapping regulations to data entities, systems, and processes. Blast radius impact analysis.

## Tech Stack

- Python 3.11+, NetworkX (graph engine), FastAPI (API), Claude API, React + D3.js (frontend)

## Key Modules

1. `graph/schema.py` — Node types: Regulation, DataEntity, System, Process, Control
2. `graph/ingester.py` — Parse regulation text into graph entities via LLM
3. `graph/analyzer.py` — BFS impact analysis, coverage gap detection
4. `graph/query_engine.py` — Natural language to graph queries
5. `api/main.py` — FastAPI endpoints for impact, coverage, graph data
6. `frontend/src/GraphViz.jsx` — D3 force-directed graph visualization
7. `frontend/src/ImpactView.jsx` — Blast radius tree view

## Coding Standards

- NetworkX for portability, sample SA regulation data (POPIA, NCA summaries)
- Type hints, pydantic

## Testing

- pytest, test graph construction, impact analysis, coverage analysis
