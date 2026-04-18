# BI Model Documenter

## Project Overview

An AI agent that connects to any SQL database, reads the schema, and generates comprehensive living documentation — data dictionaries, ER diagrams, and plain-English descriptions.

## Tech Stack

- Python 3.11+, SQLAlchemy (database introspection), Claude API (Anthropic SDK)
- Jinja2 (templating), Markdown + Mermaid diagrams (output)

## Key Modules

1. `documenter/introspector.py` — Connect to DB via connection string, read all tables/columns/types/constraints
2. `documenter/relationship_finder.py` — FK detection + name-pattern inference (e.g., `user_id` → `users.id`)
3. `documenter/ai_describer.py` — Send schema + sample rows to Claude, get column/table descriptions with confidence scores
4. `documenter/diagram_generator.py` — Generate Mermaid ER diagrams from relationships
5. `documenter/doc_renderer.py` — Render Jinja2 templates → Markdown data dictionary + HTML site

## Coding Standards

- Type hints, pydantic models, Google-style docstrings
- Support PostgreSQL, SQLite, MySQL via SQLAlchemy dialects
- Include a bundled SQLite sample DB for demos (sample_data/chinook.db)
- Confidence scoring: 0-1 on each AI-generated description

## Testing

- pytest, test against bundled SQLite chinook.db
- Test introspector: correct table/column extraction
- Test relationship finder: FK detection accuracy
- Test AI describer: mock LLM, verify prompt construction
- Test renderer: output valid markdown with correct structure
