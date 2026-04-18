# OmniForge — AI Content Laboratory

## Project Overview
A centralized, API-first AI content engine. Ingests source material (video, audio, text, URLs), applies LLM routing and brand-voice cloning via RAG, and outputs platform-perfect social media posts, generated images, and programmatic faceless videos. Exposes a FastAPI service that a frontend or external tools (Make.com, Zapier) can drive. Bridges the gap between raw thought and omnichannel distribution via automated scheduling and publishing.

## Tech Stack
- Python 3.11+
- FastAPI for the API layer (async throughout)
- PostgreSQL for persistent storage (users, OAuth tokens, content nodes, schedules) — localhost, db `omniforge`, user `momomo`
- pgvector extension for brand voice embeddings (no separate vector DB needed)
- Redis + ARQ (async task queue) for heavy background jobs (video rendering, mass generation, cron publishing)
- SQLAlchemy 2.0 (async) + Alembic for ORM and migrations
- Pydantic 2.0+ for all request/response models and settings
- httpx for external API calls (OpenAI, Anthropic, ElevenLabs, image APIs)
- yt-dlp for video/audio extraction
- OpenAI Whisper (via API) for transcription
- Playwright for article scraping (bypass anti-bot walls, extract markdown)
- FFmpeg + moviepy for server-side video composition and caption rendering
- Pillow + WeasyPrint for carousel PDF generation
- feedparser for RSS monitoring

## Architecture
```
                         ┌──────────────────────────┐
                         │     FastAPI Gateway       │
                         │  /api/v1/...              │
                         └────────┬─────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                    │
     ┌────────▼───────┐  ┌───────▼────────┐  ┌───────▼────────┐
     │   Ingestion     │  │   Generation    │  │   Publishing   │
     │   Engine        │  │   Engine        │  │   Engine       │
     │                 │  │                 │  │                │
     │ • URL scraping  │  │ • LLM routing   │  │ • OAuth mgmt   │
     │ • Transcription │  │ • Brand voice   │  │ • Slot scheduler│
     │ • RSS monitor   │  │ • Image gen     │  │ • Social APIs   │
     │ • Brand voice   │  │ • Video compose │  │ • Token refresh │
     │   ingestion     │  │ • Carousel gen  │  │                │
     └────────┬───────┘  └───────┬────────┘  └───────┬────────┘
              │                   │                    │
              └───────────────────┼───────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │   Shared Infrastructure     │
                    │                             │
                    │ • PostgreSQL + pgvector      │
                    │ • Redis / ARQ task queue     │
                    │ • LLM router (OpenAI/Claude) │
                    │ • Credit tracker             │
                    │ • BYOK key vault             │
                    └─────────────────────────────┘
```

## Key Modules

### Core Infrastructure
1. `src/core/config.py` — Pydantic Settings for all env vars, DB URLs, API keys, defaults
2. `src/core/database.py` — Async SQLAlchemy engine, session factory, Base model
3. `src/core/models.py` — SQLAlchemy ORM models: User, Account, Content, Schedule, Slot, Credit, APIKey
4. `src/core/schemas.py` — Pydantic request/response schemas for all API endpoints
5. `src/core/security.py` — AES-256-GCM encryption for BYOK keys, JWT auth, password hashing

### LLM Router
6. `src/llm/router.py` — Unified LLM interface. Routes to OpenAI (GPT-4o, 4o-mini) or Anthropic (Claude Sonnet, Opus) based on request config. Handles retries, rate limits, streaming. Tracks token usage for credit accounting. BYOK key injection when user provides their own keys.
7. `src/llm/prompts.py` — Prompt templates for each task type: content generation, rewriting, clone-to-platform, image prompt optimization, video scripting, hook extraction. Platform-specific formatting rules (Twitter 280 chars, LinkedIn 3000, etc.)

### Ingestion Engine
8. `src/ingestion/scraper.py` — URL content extraction. Playwright for articles (bypasses anti-bot, extracts markdown, strips ads/navbars). Supports article URLs, Perplexity URLs, generic web pages. Returns clean markdown.
9. `src/ingestion/transcriber.py` — Audio/video transcription pipeline. Uses yt-dlp to extract audio from YouTube/TikTok URLs. Sends to OpenAI Whisper API for transcript with timestamps. LLM summarization pass with timestamp extraction.
10. `src/ingestion/rss_monitor.py` — RSS/Atom feed monitoring. Stores feed URLs per user. ARQ cron job polls feeds on configurable interval. On new entry: auto-ingests, generates counter-narrative draft, pushes to user's drafts.
11. `src/ingestion/brand_voice.py` — Brand Voice Genome. Syncs user's historical Twitter/LinkedIn posts via social APIs. Chunks and embeds text using OpenAI embeddings. Stores vectors in PostgreSQL pgvector. At generation time, performs RAG retrieval to inject user's vocabulary, cadence, and formatting habits into LLM context.

### Generation Engine
12. `src/generation/content.py` — Multi-platform content generation. Takes ingested source + target platforms + quantity. Generates platform-specific posts respecting character limits, hashtag conventions, formatting norms. Uses brand voice RAG when available. Supports batch generation (e.g., 5 tweets + 2 LinkedIn posts in one call).
13. `src/generation/cloner.py` — Cross-platform content adaptation. Takes a finished post from one platform, reformats for target platforms. Adjusts character limits, spacing, hashtag style, emoji usage, CTA format. Preserves core message while optimizing for each platform's algorithm preferences.
14. `src/generation/image.py` — Image generation orchestration. LLM parses post text to write optimized image prompt. Routes to DALL-E 3 (semantic accuracy) or Flux.1 API (hyper-realistic/creative). Returns image URL and stores metadata. Supports style selection: realistic, creative, text-focused.
15. `src/generation/carousel.py` — Auto-carousel generator for LinkedIn. Detects listicle/thread content. Slices text into slides. Renders each slide as styled HTML via Jinja2 templates. Converts HTML to images via Pillow. Assembles into PDF carousel using WeasyPrint.
16. `src/generation/video.py` — Faceless video composer. LLM generates timed script with scenes (15-60s). ElevenLabs API generates TTS audio with word-level timestamps. Per-scene: generates AI image or pulls stock from Pexels API. Assembles via FFmpeg: audio track + visual track + animated captions. Supports templates (POV, blank) and themes (cyberpunk, anime — via style prompts).
17. `src/generation/captions.py` — Dynamic caption renderer. Uses word-level timestamps from ElevenLabs. Generates karaoke-style animated captions: bold active word, emoji injection, configurable font/color/position. Renders caption frames as transparent PNGs, composited onto video via FFmpeg.

### Publishing Engine
18. `src/publishing/oauth.py` — OAuth 2.0 manager for social platforms (Twitter/X, LinkedIn, Facebook, Instagram, TikTok, Pinterest, YouTube). Handles authorization flows, token storage (encrypted), and automatic token refresh. Background ARQ job checks token expiry and refreshes proactively.
19. `src/publishing/scheduler.py` — Smart scheduling matrix. Users configure global time slots (e.g., Mon 9 AM → Twitter+LinkedIn). "Next Free Slot" algorithm: queries for next chronological timestamp without an active post_id for the requested platform set. Stores schedule in PostgreSQL.
20. `src/publishing/publisher.py` — Social media API dispatcher. Publishes text + media to each platform's API. Handles platform-specific media requirements (image dimensions, video formats, file size limits). Retry logic with exponential backoff. Records publish status and post URLs.
21. `src/publishing/analytics.py` — Post engagement tracking. Polls social platform Graph APIs for likes, shares, comments, impressions. Stores metrics per post over time. Feeds into predictive scheduling: analyzes historical engagement to recommend optimal time slots for the user's specific audience.

### Viral Intelligence
22. `src/viral/scraper.py` — Trending content aggregator. ARQ cron job scrapes high-performing posts from X, LinkedIn, TikTok across configurable niches (SaaS, marketing, fitness, etc.). Uses platform APIs where available, Playwright where not. Stores in PostgreSQL with engagement metrics.
23. `src/viral/analyzer.py` — Viral pattern extraction. Given a high-performing post, uses LLM to extract: the psychological hook, structural pattern (listicle, story, contrarian take, etc.), engagement drivers. Cross-platform trend translation: identifies why a TikTok script went viral and reverse-engineers it into a LinkedIn text format.

### Credits & API
24. `src/credits/tracker.py` — Credit abacus. Calculates compute cost per operation (1 text post = 1 credit, 1 image = 5, 1 video = 50). Tracks per-user balance. Enforces limits based on subscription tier. BYOK users bypass credit limits for their own API calls.
25. `src/api/routes.py` — FastAPI router aggregating all endpoint groups: auth, ingestion, generation, publishing, scheduling, viral, credits, admin
26. `src/api/auth.py` — JWT authentication, user registration, login, API key management for external integrations
27. `src/api/middleware.py` — Rate limiting, CORS, request logging, credit deduction middleware

### Background Tasks
28. `src/workers/tasks.py` — ARQ task definitions: video rendering, mass image generation, RSS polling, token refresh, engagement polling, trending content scraping. Each task is idempotent and retryable.
29. `src/workers/scheduler.py` — ARQ worker startup and cron job registration. Configurable intervals per task type.

## Database Schema

```sql
-- Users & Auth
users(id, email, password_hash, name, tier, credits_balance, created_at)
api_keys(id, user_id, key_hash, name, scopes, created_at, last_used_at)

-- Social Accounts (OAuth)
accounts(id, user_id, platform, platform_user_id, access_token_enc, refresh_token_enc, token_expires_at, username, connected_at)

-- Content Pipeline
sources(id, user_id, source_type, url, raw_content, transcript, summary, created_at)
posts(id, user_id, source_id, platform, text, media_url, status, created_at)
-- status: draft | scheduled | published | failed

-- Brand Voice
brand_voice_chunks(id, user_id, platform, text, embedding vector(1536), source_post_id, created_at)

-- Scheduling
schedule_slots(id, user_id, day_of_week, time_utc, platforms[], active)
scheduled_posts(id, post_id, slot_id, account_id, scheduled_at, published_at, publish_status)

-- Media
media(id, user_id, post_id, media_type, prompt, style, provider, url, file_path, created_at)
-- media_type: image | video | carousel_pdf
videos(id, media_id, script_json, audio_url, template, theme, duration_sec, status)

-- Credits & Billing
credit_transactions(id, user_id, operation, credits, balance_after, created_at)
byok_keys(id, user_id, provider, encrypted_key, created_at)

-- Viral Intelligence
trending_posts(id, platform, niche, author, text, media_url, likes, shares, comments, engagement_rate, scraped_at)
viral_analyses(id, trending_post_id, hook_type, structure, engagement_drivers, cross_platform_adaptation, analyzed_at)

-- RSS Monitoring
rss_feeds(id, user_id, url, niche, poll_interval_min, last_polled_at)
rss_entries(id, feed_id, entry_url, title, ingested_at, source_id)

-- Analytics
post_metrics(id, post_id, platform, likes, shares, comments, impressions, measured_at)
```

## API Endpoints

```
# Auth
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/api-keys

# Ingestion
POST   /api/v1/ingest/url          — Ingest from URL (article, YouTube, TikTok)
POST   /api/v1/ingest/text         — Ingest raw text
POST   /api/v1/ingest/audio        — Ingest audio file (mp3/wav)
POST   /api/v1/ingest/rss          — Add RSS feed for monitoring
GET    /api/v1/ingest/sources       — List user's ingested sources

# Brand Voice
POST   /api/v1/voice/sync           — Sync historical posts from connected accounts
GET    /api/v1/voice/status          — Brand voice profile status and stats

# Generation
POST   /api/v1/generate/text        — Generate posts (requires source_id, platforms[], count)
POST   /api/v1/generate/clone       — Clone post to other platforms
POST   /api/v1/generate/image       — Generate image for a post (style: realistic|creative|text)
POST   /api/v1/generate/carousel    — Generate LinkedIn carousel PDF
POST   /api/v1/generate/video       — Generate faceless video (template, theme, voice)

# Publishing
GET    /api/v1/accounts              — List connected social accounts
POST   /api/v1/accounts/connect      — Start OAuth flow for platform
DELETE /api/v1/accounts/{id}         — Disconnect account
POST   /api/v1/publish               — Publish now (account_id, post_id)
POST   /api/v1/schedule              — Schedule post to next free slot or specific time
GET    /api/v1/schedule/slots        — List configured time slots
PUT    /api/v1/schedule/slots        — Update slot configuration

# Viral Intelligence
GET    /api/v1/viral/trending        — Browse trending posts (filters: platform, niche, engagement)
POST   /api/v1/viral/remix           — Remix a trending post into user's voice
GET    /api/v1/viral/analysis/{id}   — Get viral pattern analysis

# Credits
GET    /api/v1/credits/balance       — Current balance and tier
GET    /api/v1/credits/history       — Transaction history
POST   /api/v1/credits/byok          — Store BYOK API key (encrypted)

# Analytics
GET    /api/v1/analytics/posts       — Engagement metrics across posts
GET    /api/v1/analytics/optimal-times — Predicted best posting times
```

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (default: `postgresql+asyncpg://momomo@localhost/omniforge`)
- `REDIS_URL` — Redis connection string (default: `redis://localhost:6379`)
- `SECRET_KEY` — JWT signing key
- `ENCRYPTION_KEY` — AES-256-GCM key for BYOK and OAuth token encryption (32-byte base64)
- `OPENAI_API_KEY` — OpenAI API key (GPT-4o, DALL-E 3, Whisper, embeddings)
- `ANTHROPIC_API_KEY` — Anthropic API key (Claude Sonnet/Opus)
- `ELEVENLABS_API_KEY` — ElevenLabs TTS API key
- `PEXELS_API_KEY` — Pexels stock video/image API key
- `FLUX_API_KEY` — Flux.1 image generation API key (optional)
- `DEFAULT_LLM` — Default LLM provider: `openai` or `anthropic` (default: `openai`)
- `DEFAULT_MODEL` — Default model name (default: `gpt-4o`)
- `CORS_ORIGINS` — Allowed CORS origins, comma-separated
- `RSS_POLL_INTERVAL` — RSS feed poll interval in minutes (default: 30)
- `VIRAL_SCRAPE_INTERVAL` — Trending content scrape interval in hours (default: 6)
- `MAX_VIDEO_DURATION` — Max video duration in seconds (default: 60)
- `CREDIT_COSTS` — JSON override for credit costs per operation (optional)

## Coding Standards
- Type hints on all functions, Pydantic models for all request/response data
- Google-style docstrings on all public functions
- Async throughout — all I/O operations use async/await
- SQLAlchemy 2.0 async style (no legacy Query API)
- Parameterized SQL only — no string interpolation in queries
- All external API calls go through `src/llm/router.py` (for LLMs) or dedicated service modules (for social APIs) — no scattered httpx calls
- AES-256-GCM encryption for all stored secrets (OAuth tokens, BYOK keys) — decrypt only in RAM during use
- Structured logging via Python `logging` module with JSON formatter
- All background tasks must be idempotent and handle partial failure gracefully
- No bare except — catch specific exceptions
- Rate limit awareness on all external API calls with exponential backoff

## Testing
- pytest + pytest-asyncio
- Test database: separate `omniforge_test` PostgreSQL database, migrations applied via Alembic before test suite
- Test each module independently with mocked external APIs
- Integration tests for full pipelines: ingest URL → generate posts → schedule → publish (mocked social APIs)
- Test LLM router with mocked httpx responses for both OpenAI and Anthropic
- Test OAuth token refresh cycle with expired/valid/invalid tokens
- Test credit system: generation costs, balance enforcement, BYOK bypass
- Test brand voice RAG: embedding storage, similarity search, prompt injection
- Test video pipeline: script generation, caption timing, FFmpeg command construction (mock actual rendering)
- Test encryption: round-trip encrypt/decrypt for BYOK keys and OAuth tokens
- Test scheduler: slot algorithm correctness, "next free slot" edge cases (all slots full, timezone handling)
- Test RSS monitor: feed parsing, duplicate detection, auto-ingestion trigger
- >80% coverage target

## CLI Interface
```bash
# Start API server
uvicorn src.api.routes:app --reload

# Run background workers
arq src.workers.scheduler.WorkerSettings

# Run database migrations
alembic upgrade head

# Create test data / seed
python -m src.core.seed

# Run tests
python -m pytest -v --tb=short
```

## Git Workflow
Conventional commits per module:
- `feat: implement core models, database, and auth`
- `feat: add LLM router with OpenAI and Anthropic support`
- `feat: add ingestion engine (scraper, transcriber, RSS monitor)`
- `feat: add brand voice genome with pgvector RAG`
- `feat: add content generation and cross-platform cloning`
- `feat: add image generation and carousel PDF pipeline`
- `feat: add faceless video composer with dynamic captions`
- `feat: add OAuth manager and publishing engine`
- `feat: add smart scheduler with predictive timing`
- `feat: add viral intelligence scraper and analyzer`
- `feat: add credit system and BYOK key vault`
- `feat: add API routes, middleware, and external API`
- `test: add comprehensive test suite`
