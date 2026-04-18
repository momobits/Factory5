# Data Quality Sentinel

## Project Overview

Data quality monitoring framework: auto-profiles datasets, scores quality across 6 dimensions, tracks trends, alerts on drops.

## Tech Stack

- Python 3.11+, DuckDB (profiling), Great Expectations (validation), Streamlit (dashboard), YAML (config)

## Key Modules

1. `sentinel/profiler.py` — Auto-profile: row count, types, nulls, uniques, distributions per column
2. `sentinel/scorer.py` — Score 6 dimensions (0-100): completeness, validity, uniqueness, consistency, timeliness, accuracy
3. `sentinel/drift_detector.py` — Compare current schema to baseline, flag additions/removals/type changes
4. `sentinel/alerter.py` — Webhook/email dispatch on score drops below threshold
5. `sentinel/rules_engine.py` — Parse YAML rules, validate data against rules
6. `dashboard/app.py` — Streamlit dashboard with quality trend charts and drill-down

## Coding Standards

- Type hints, pydantic, Google-style docstrings
- YAML rule format for non-engineers
- Include sample banking and retail data in examples/

## Testing

- pytest, test profiler accuracy, scorer edge cases, drift detection, rules engine
