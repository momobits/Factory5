# Example CLI App

## Project Overview
A command-line tool that fetches weather data from a public API and displays a formatted forecast. Serves as a reference template showing the CLAUDE.md format.

## Tech Stack
- Python 3.11+
- httpx for HTTP requests
- rich for terminal output
- click for CLI argument parsing

## Key Modules
1. `src/cli.py` — CLI entry point, argument parsing (city name, units, days)
2. `src/api.py` — Weather API client, request/response handling
3. `src/formatter.py` — Format API data into readable terminal output
4. `src/models.py` — Data classes for weather response

## Coding Standards
- Type hints on all functions
- Docstrings on all public functions
- No bare except — catch specific exceptions
- Handle API errors gracefully (timeouts, bad responses, rate limits)

## Testing
- pytest
- Test each module independently
- Mock HTTP calls in API client tests
- Test CLI output formatting with known data
- >80% coverage target
