# KANJIDEN-MCP

Node.js MCP server for KanjiDen — Bibs's Japanese study system.

Deployed on Railway: `https://kanjiden-mcp-production.up.railway.app/mcp`

---

## What This Does

Exposes MCP tools that the Claude agent uses to read and write all KanjiDen data. The frontend never talks to Supabase directly — everything goes through this server.

---

## Tools

| Tool | Description |
|---|---|
| `get_config` | Session init — returns agent identity, preferences, learning context |
| `get_progress` | Full mastery stats by JLPT level and question type |
| `get_learning_context` | Lightweight mid-session state |
| `get_weak_words` | Items with mastery < 3, sorted by weak_score |
| `get_due_today` | Cards due today per SM-2 schedule |
| `get_confusion_report` | Confusion pattern analysis from review_log |
| `process_quiz_answer` | Records a quiz answer, updates SM-2 and mastery |
| `store_memo_learning` | Parses and stores Japanese text (MemoLearning only) |
| `create_session` | Builds a new study session |

---

## Setup

```bash
npm install
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, GATEWAY_KEY
npm run dev
```

## Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (not anon) |
| `GATEWAY_KEY` | Auth key for MCP requests (`kanjiden-bibs-2026`) |
| `PORT` | Server port (default: 3000) |

---

## Project Structure

```
src/
├── index.js          # Entry point, tool registration
├── db.js             # Supabase client
└── modules/
    ├── analytics.js  # get_confusion_report
    ├── context.js    # get_config, get_learning_context
    ├── extractor.js  # store_memo_learning (text parsing)
    ├── mastery.js    # Mastery level calculations
    ├── review.js     # process_quiz_answer, SM-2 updates
    ├── scheduler.js  # get_due_today
    └── session.js    # create_session, get_progress, get_weak_words
```

---

## Database

Supabase (PostgreSQL) — see `docs/schema.md` for full table definitions.

Migrations are in `src/migrations/`:
- `v3_schema.sql` — full v3.0 schema
- `patch.sql` — visual_components, curation_status, provenance fields

Seeds are in `src/scripts/`:
- `seed_n5.js` — N5 kanji + kotoba (run once)
- `seed_radicals.sql` — 20 core N5 radicals (run once)

---

## Deploy (Railway)

Railway auto-deploys from the `main` branch. No manual steps needed after push.

Set environment variables in Railway dashboard under Variables.
