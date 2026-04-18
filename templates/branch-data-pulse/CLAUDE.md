# Branch Data Pulse

## Project Overview
Real-time branch performance dashboard with anomaly detection. Simulates ingesting bank branch KPIs and flags anomalies. Includes ETL completion time predictor.

## Tech Stack
- Python 3.11+, FastAPI (backend), DuckDB (analytics), React + Recharts (frontend)
- Simple anomaly detection (z-scores, rolling averages)

## Key Modules
1. `backend/main.py` — FastAPI with endpoints: /branches, /branches/{id}, /anomalies, /etl-status
2. `backend/data_generator.py` — Synthetic data for 50 branches: transactions, queue_time, cash_level, digital_adoption
3. `backend/anomaly_engine.py` — Z-score + rolling average anomaly detection, configurable thresholds
4. `backend/etl_predictor.py` — Linear regression on historical ETL run times → completion ETA
5. `frontend/src/App.jsx` — Main layout with branch grid and detail panel
6. `frontend/src/BranchGrid.jsx` — RAG-status grid of all branches
7. `frontend/src/BranchDetail.jsx` — Drill-down charts for individual branch

## Coding Standards
- Python: type hints, pydantic, async FastAPI endpoints
- Frontend: React functional components, Tailwind for styling
- CORS enabled for local dev
- docker-compose.yml for one-command startup

## Testing
- pytest for backend (FastAPI TestClient)
- Test data generator outputs correct shape
- Test anomaly engine flags known anomalies
- Test ETL predictor with synthetic history
