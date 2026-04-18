# Retail Channel Optimizer

## Project Overview

Multi-channel attribution engine with Markov chain model, what-if simulator, and Sankey visualizations.

## Tech Stack

- Python 3.11+, pandas, networkx, Streamlit, Plotly

## Key Modules

1. `optimizer/data_generator.py` — 50k synthetic customer journeys across banking channels
2. `optimizer/attribution_models.py` — First-touch, last-touch, linear, time-decay
3. `optimizer/markov_chain.py` — Markov chain with removal effect calculation
4. `optimizer/journey_analyzer.py` — Path analysis and conversion funnels
5. `optimizer/simulator.py` — What-if budget reallocation predictor
6. `dashboard/app.py` — Streamlit with model comparison, Sankey, simulator

## Coding Standards

- Type hints, pydantic, realistic SA banking data patterns

## Testing

- pytest, hand-calculated attribution verification, Markov matrix tests
