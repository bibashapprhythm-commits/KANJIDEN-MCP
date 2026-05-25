# KanjiDen MCP — System Documentation
**Version:** 2.1.0  
**DB Schema:** v3.0 + patch.sql + expand_item_types + add_school_grade_and_nanori  
**Last updated:** 2026-05-25  
**Stack:** Node.js (ESM) · Supabase (Postgres 17) · MCP SDK 1.12  

---

## Architecture

```
Claude (AI agent)
    │  MCP protocol
    ▼
KANJIDEN-MCP (src/index.js)
    │  @supabase/supabase-js
    ▼
Supabase DB (nxgvevmhdzjsjbiuvcqv · ap-southeast-1)
```

MCP server exposes tools Claude calls directly. No REST API. No frontend auth layer. Supabase = single source of truth.

---

## Database Schema — Layer Overview

### Layer 1: Canonical (The Map)
Content that never changes per-user. Seeded from dictionary sources.

| Table | Purpose |
|-------|---------|
| `curriculum_items` | Every item (kanji, vocab, name, place, station…) |
| `curriculum_tags` | Controlled tag vocabulary with dimensions |
| `radicals` | 20 core kanji radicals with mnemonics |
| `kanji_radicals` | Kanji ↔ radical relationships |
| `kanji_components` | Full visual decomposition per kanji |
| `item_relationships` | depends_on / confused_with / visually_similar / related_family |
| `learning_paths` | Curated + AI study routes |
| `learning_path_items` | Items in each path with order |
| `generated_sentences` | Example sentences (Tatoeba + AI-generated) |

### Layer 2: User Journey
Per-user state. MCP handles all writes.

| Table | Purpose |
|-------|---------|
| `config` | User preferences + identity |
| `user_item_progress` | SM-2 state per item (mastery, intervals, scores) |
| `user_exposures` | Passive encounter tracking |
| `sessions` | Active study sessions |
| `review_log` | Permanent event history (never delete) |
| `user_progress_snapshots` | Weekly state for progress graphs |
| `source_texts` | MemoLearning paste history |

---

## curriculum_items — Field Reference

### Identity
| Field | Type | Notes |
|-------|------|-------|
| `item_type` | TEXT | `kanji` `kotoba` `name` `place` `station` `grammar` `phrase` `particle` |
| `value` | TEXT | The Japanese character/word |
| `category` | TEXT | Non-JLPT grouping: `person_name` `station_name` `prefecture` etc. |
| `jlpt_level` | TEXT? | `N5`–`N1` or NULL. Kanji: tagged from kanjidic2. Kotoba: NULL — enrichment pass pending |
| `is_core` | BOOL | N5 kanji = true |
| `priority` | INT | Learning order within level/category |
| `frequency_rank` | INT | Corpus frequency (lower = more common) |
| `school_grade` | INT? | Japanese school grade 1–6 (kanji only, from kanjidic2) |

### Readings
| Field | Notes |
|-------|-------|
| `reading_hiragana` | Primary kana reading |
| `reading_katakana` | Katakana form (kanji onyomi) |
| `romaji` | Hepburn romanization |
| `alt_forms` | Alternative spellings/readings |
| `onyomi` / `kunyomi` | Kanji-specific reading arrays |
| `romaji_on` / `romaji_kun` | Romanized arrays |
| `nanori` | Name readings (kanji only, from kanjidic2) |

### Meaning
| Field | Notes |
|-------|-------|
| `core_meaning` | Primary English gloss |
| `meaning_extended` | Additional senses (Phase C enrichment) |
| `tags` | TEXT[] — must exist in `curriculum_tags` |

### Kanji-specific
| Field | Notes |
|-------|-------|
| `stroke_count` | From kanjidic2 |
| `radical` / `primary_radical` | Classical radical character |
| `visual_components` | Full decomposition array (from kradfile) |
| `mnemonic` | Phase C — Claude-generated |
| `stroke_svg` / `stroke_data` | KanjiVG future integration |

### Kotoba-specific
| Field | Notes |
|-------|-------|
| `part_of_speech` | noun / verb_u / verb_ru / i_adjective etc. |
| `verb_type` | verb_u / verb_ru / irregular |
| `formality` | formal / casual / polite |

### Provenance
| Field | Notes |
|-------|-------|
| `source_dataset` | kanjidic2 / jmdict / jmnedict |
| `source_version` | Dataset release version (e.g. `3.6.2`) |
| `source_reference` | jmdict word ID on kotoba rows — used to link Tatoeba examples |
| `curation_status` | pending / auto_accepted / reviewed / approved |
| `seeded_by` | Script identifier |

---

## Tag System — Dimensions

Tags are the primary classification axis. JLPT level is one dimension among many.

| Dimension | Examples | Purpose |
|-----------|---------|---------|
| `jlpt` | N5 N4 N3 N2 N1 | JLPT curriculum level |
| `item_type` | kanji kotoba name place station | What kind of item |
| `category` | person_name station_name prefecture city | Non-JLPT content grouping |
| `semantic` | nature school family food transport | Topic/theme |
| `frequency` | very_high high medium low rare | Corpus frequency bucket |
| `visual_group` | simple_shape similar_犬大 water_radical | Visual similarity clusters |
| `grammar` | verb_u noun i_adjective particle | Part of speech |
| `context` | daily_life anime business travel | Usage context |
| `cognitive` | easy_shape hard_reading high_confusion_risk | Difficulty signals |
| `reading_family` | さん_group こう_group | Shared reading patterns |
| `radical_group` | water_氵 tree_木 mouth_口 | Radical family |

---

## Data Sources

### Active (seeder v2 — complete)

| Source | File | Covers | Format |
|--------|------|--------|--------|
| jmdict-simplified | `kanjidic2-en-3.6.2.json` | N5-N2 kanji + readings + strokes + school grade + nanori | JSON |
| jmdict-simplified | `jmdict-eng-3.6.2.json` | ~22k common vocab + readings + POS (no JLPT) | JSON |
| jmdict-simplified | `jmdict-examples-eng-3.6.2.json` | ~17k Tatoeba example sentences | JSON |
| jmdict-simplified | `kradfile-3.6.2.json` | Kanji → component radicals | JSON |

All from: `github.com/scriptin/jmdict-simplified` · release `3.6.2+20260518145612`

**Note:** jmdict-simplified 3.x has no `jlpt` field on vocab entries (removed from JMdict source in 2009).  
Kotoba `jlpt_level` is NULL — will be tagged in enrichment pass once N1–N5 vocab list is sourced.

**Note:** kanjidic2 uses pre-2010 JLPT (4-level system). No N1 kanji data exists in this source.  
N1 kanji need a separate community list to be added in Phase B.

### Future (Phase B expansion)

| Source | File | Covers |
|--------|------|--------|
| jmdict-simplified | `jmnedict-all.json` | 743k proper names — people, places, stations, orgs |
| community list | TBD | N1 kanji (~1000 items) |
| community list | TBD | N1–N5 vocab JLPT tags (match by jmdict word ID in `source_reference`) |

### Legacy (replaced)
| Source | Why replaced |
|--------|-------------|
| `kanjidic2.xml.gz` (EDRDG direct) | Replaced by pre-parsed `kanjidic2-en.json` |
| `JMdict_e.gz` (EDRDG direct) | JLPT tags removed 2009 — useless for JLPT filtering |

---

## Seeder Pipeline

### seed_canonical.js (v2 — complete, stable)

```
[1/5] Parse kanjidic2-en.json + kradfile.json → 2230 kanji rows (N5–N2)
[2/5] Upsert curriculum_items (kanji)
[3/5] Seed kanji_components (8368 rows) + kanji_radicals (871 links)
[4/5] Parse jmdict-eng.json → 22402 common words, upsert as kotoba
[5/5] Seed generated_sentences from jmdict-examples (17036 Tatoeba rows)
```

**v1 → v2 changes:**
- Removed: XML/gzip download, `xml2js`, `https`/`zlib` imports, streaming JMdict parser
- Added: JSON readers, kradfile visual decomposition, Tatoeba sentences, school_grade, nanori
- Kotoba filter: `common: true` (proxy for frequency — ~22k words) instead of broken `&jlpt-` entity filter
- `.in()` queries batched at 300 items to avoid PostgREST URL length 400
- Kotoba fetch paginated (`.range()`) to avoid 1000-row default limit

**DB state after full seed:**
- 24,632 curriculum_items (2230 kanji + 22402 kotoba)
- 17,036 sentences in generated_sentences
- 8,368 kanji_components rows
- 871 kanji_radicals links

### Phase C: enrich_items.js (pending)
Claude API enrichment pass:
- Mnemonics per kanji
- Extended meanings
- AI-generated sentences for items without Tatoeba coverage
- Confusion pair detection → `item_relationships`
- JLPT tagging for kotoba (once N1–N5 vocab list sourced, match by `source_reference` = jmdict word ID)

> See **Enrichment Plan** section below for detailed step-by-step breakdown.

---

## Curated Data (hand-authored)

### N5 Kanji Curation (N5_CURATION in seed_canonical.js)
92 N5 kanji with manual tags + priority ordering (1–92).  
Priority = teaching order (simple shapes before complex, numbers before directions).  
Remaining 11 N5 kanji are auto-tagged only.

### Radicals (seed_radicals.sql / v3_schema.sql)
20 core radicals seeded with: character, meaning, romaji, stroke count, position, mnemonic, JLPT introduced.

---

## What Changed from Original Plan

### Data Source Pivot

**Original assumption:** Use EDRDG raw XML files (`kanjidic2.xml.gz`, `JMdict_e.gz`) with `xml2js` parser.

**What happened:**
1. JMdict removed JLPT data from their source in **2009**. `JMdict_e.gz` has no JLPT tags at all — would have seeded 22k kotoba with null regardless.
2. XML streaming was error-prone. Switched to `jmdict-simplified 3.6.2` (pre-parsed JSON) — cleaner, version-pinned, already maps field names.
3. `xml2js` removed from dependencies entirely.

**Impact:** `source_reference` field on kotoba rows stores jmdict word IDs. This is the join key for future JLPT enrichment — when we source an external N1–N5 vocab list, we match by word ID to tag `jlpt_level`.

### JLPT Gap — Both Kanji and Kotoba

| Type | Gap | Cause |
|------|-----|-------|
| Kotoba N1–N5 | All 22402 rows `jlpt_level = NULL` | JMdict dropped JLPT tags in 2009 |
| Kanji N1 | ~1000 kanji untagged | kanjidic2 uses pre-2010 4-level system (only N5/N4/N3/N2) |

Neither gap was anticipated before discovering the actual source data.

### Schema Rewrite

Original plan assumed the old `kanji` / `kotoba` tables. Schema was rebuilt as:
- `curriculum_items` — canonical content (all types)
- `user_item_progress` — per-user SM-2 state (join via `curriculum_item_id`)

All 6 MCP modules (`analytics`, `context`, `extractor`, `scheduler`, `session`, `review`) were fully rewritten to query the new schema.

### MCP Module Bugs Fixed (2026-05-25)

8 issues discovered and fixed after module rewrite:
1. `get_config` + `get_confusion_report` missing from REST endpoint map
2. `answers` array sent to `completeSession` but no table to store it (dropped)
3. Ghost UI fields (`exam_important`, `daily_important`, `seen_in_texts`) in frontend — removed
4. Zod schema accepted those fields but extractor silently dropped them — removed from schema
5. Wrong-answer pool skipped `romaji_kun` fallback
6. `completeSession` could be called twice on "Study Again" — fixed with `completedRef`
7. `PROGRESS_SELECT` was potentially duplicated — consolidated to `scheduler.js` export
8. `seen_in_texts` param hardcoded to 0 in `computeWeakScore` — removed dead field

### Frontend Session UI Rebuild (2026-05-25)

Full visual layer rewrite of `Session.jsx`. Logic unchanged. Key changes:
- Kanji display: `72px → 120px` (reading), `64px → 96px` (quiz). Adaptive size for kotoba (scales with char count).
- Card padding: `32px → 52px/40px` — significantly more breathing room
- Option buttons: `minHeight 58px`, `15px` font — proper touch targets
- Rating buttons: `minHeight 68px` — mobile-safe
- Phase entrance animation: 0.22s fade+slide via `phase-enter` CSS class
- Hover/active states added via CSS classes (inline styles can't do `:hover`)
- Progress bar: `3px → 4px` + glow
- `romaji_on`/`romaji_kun` added to `PROGRESS_SELECT` and `mapProgress` in scheduler

---

## Roadmap

### Phase A — COMPLETE (seeder v2)
- [x] Download 4 files from jmdict-simplified 3.6.2 into `resources/`
- [x] Rewrite `seed_canonical.js`: JSON readers replacing XML parsers
- [x] Seed kanji (2230 items N5-N2) with school_grade + nanori + visual_components
- [x] Seed kotoba (22402 common words via `common: true` filter)
- [x] Seed 17036 Tatoeba example sentences
- [x] Populate `kanji_components` from kradfile
- [x] Remove `xml2js` dependency
- [x] Rewrite all 6 MCP modules for v3 schema
- [x] Fix 8 MCP/frontend bugs
- [x] Session UI redesign (typography, spacing, animation, mobile)

### Phase B — NEXT (data completion before enrichment)
- [ ] **N1 kanji:** source community N1 kanji list (~1000 items), seed into `curriculum_items` with `jlpt_level='N1'`
- [ ] **Kotoba JLPT tags:** source N1–N5 vocab list with jmdict word IDs → match against `source_reference` → `UPDATE jlpt_level`. Expected ~3,000–5,000 matches.
- [ ] **JMnedict:** download `jmnedict-all.json`, build `seed_names.js` for proper names/places/stations
- [ ] item_types: `name` `place` `station` seeded from jmnedict
- [ ] Category tags: `person_name` `family_name` `station_name` `prefecture` `city`

### Phase C — ENRICHMENT
> See **Enrichment Plan** section below for detailed breakdown.

- [ ] Mnemonics for all kanji (Claude API, batch script)
- [ ] Extended meanings for all items
- [ ] AI-generated sentences for items without Tatoeba coverage
- [ ] Confusion pair detection → `item_relationships`
- [ ] Priority/curation for N4–N2 kanji (currently auto-tagged only)

### Phase D — FUTURE
- [ ] KanjiVG stroke order SVGs → `stroke_svg` / `stroke_data` fields
- [ ] Multilingual: swap `jmdict-eng.json` → `jmdict-all.json`
- [ ] `item_relationships`: auto-detect visually_similar pairs via component overlap
- [ ] Grammar points as `item_type = 'grammar'`

---

## Enrichment Plan (Phase C)

This is the detailed execution plan for `enrich_items.js`. Run after Phase B (JLPT gaps filled) for maximum usefulness.

### Step 1 — Kotoba JLPT Tagging (prerequisite, Phase B)

**Not Claude API — pure data match.**

```
1. Download community N1–N5 vocab list (e.g. Jonathan Waller's JLPT word lists, or
   JMdict-based community lists that still carry JLPT metadata)
2. Each entry needs: Japanese word + jmdict word ID (or word + reading as fallback)
3. Run UPDATE:
   UPDATE curriculum_items
   SET jlpt_level = <level>
   WHERE source_reference = <jmdict_word_id>
   AND item_type = 'kotoba'
```

Match strategy: primary = `source_reference` (jmdict word ID). Fallback = `value` + `reading_hiragana` exact match.
Expected coverage: ~3,000–5,000 of 22,402 kotoba get tagged. Remainder stay NULL (obscure/non-JLPT vocab).

### Step 2 — Kanji Mnemonics

**Claude API batch script. Write to `curriculum_items.mnemonic`.**

For each kanji where `mnemonic IS NULL`:

```
Prompt context to include:
- item.value (the kanji character)
- item.core_meaning
- item.onyomi, item.kunyomi (reading hints for the story)
- item.visual_components (decomposition — e.g. [口, 日, 木])
- item.radical (classical radical)
- item.stroke_count

Output: 1–2 sentence mnemonic. Must reference the components/radicals.
Style: vivid but concise. No anime references. No condescension.
Example: 明 (bright/clear) — "The sun 日 and moon 月 together make the night bright."
```

Batch: 50 kanji per API call using structured output. 2230 kanji = ~45 calls.
Store result in `curriculum_items.mnemonic`.

### Step 3 — Extended Meanings

**Claude API. Write to `curriculum_items.meaning_extended`.**

For each item where `meaning_extended IS NULL`:

```
Context: item.value, item.core_meaning, item.jlpt_level, item.part_of_speech (kotoba)
Output: JSON object with:
  - nuance: subtle usage differences from core_meaning
  - formality: when to use (casual/formal/written/spoken)
  - common_patterns: 2–3 example compound words or phrases that use this item
  - confusables: 1–2 items it's commonly confused with (value + reason)
```

Priority order: N5 → N4 → N3 → N2 → N1 → untagged.
Batch: 20 items per API call.

### Step 4 — AI Example Sentences

**Claude API. Insert into `generated_sentences` with `source='ai_generated'`.**

Target: items where `generated_sentences` has zero rows (no Tatoeba coverage).
After Phase A seed: check which curriculum_items have no linked sentences.

```sql
SELECT ci.id, ci.value, ci.core_meaning, ci.item_type
FROM curriculum_items ci
LEFT JOIN generated_sentences gs ON gs.curriculum_item_id = ci.id
WHERE gs.id IS NULL
```

For each item:
```
Generate 2 sentences:
- Sentence 1: simple (N5–N4 grammar, daily life context)
- Sentence 2: natural (N3+ grammar, shows the word in context)
Each sentence: Japanese + hiragana reading + English translation
```

Insert rows with: `curriculum_item_id`, `japanese`, `reading`, `english`, `source='ai_generated'`, `difficulty` estimate.

### Step 5 — Confusion Pair Detection

**Two sources: review_log data + visual similarity heuristic.**

**Source A — Review log (after real usage data exists):**
```sql
SELECT correct_answer, user_answer, COUNT(*) as confusion_count
FROM review_log
WHERE correct = false AND user_answer IS NOT NULL
GROUP BY correct_answer, user_answer
HAVING COUNT(*) >= 3
ORDER BY confusion_count DESC
```
Map `correct_answer`/`user_answer` strings back to `curriculum_items.id`.
Insert pairs into `item_relationships` with `relationship_type = 'confused_with'`.

**Source B — Visual component overlap:**
Two kanji share 2+ components AND have different meanings = confusion risk.
Query `kanji_components` for overlap, compute score, insert pairs above threshold.

**Source C — Reading overlap:**
Items with identical or near-identical romaji but different meanings (e.g. 橋/箸 — hashi).
Query by `romaji` collision on `curriculum_items`.

All pairs inserted into `item_relationships`:
```
relationship_type: 'confused_with' | 'visually_similar'
source: 'review_log' | 'component_analysis' | 'reading_analysis'
strength: float (confusion frequency or overlap score)
```

### Step 6 — N4–N2 Kanji Priority Curation

Currently only N5 (92 kanji) has manual priority ordering.
N4–N2 kanji sorted by `frequency_rank` only — no pedagogical ordering.

Manual curation pass:
- Review N4 kanji (~166 items) — set `priority` field in teaching order
- Group by visual similarity + radical family to cluster related kanji
- Flag high-confusion pairs for `item_relationships` — done before Step 5 to seed initial confusion data

### Enrichment Execution Order

```
Phase B first:
  1. N1 kanji seeding
  2. Kotoba JLPT tagging (Step 1 above)

Phase C — run in this order:
  3. Mnemonics (Step 2) — no dependencies, run immediately
  4. Extended meanings (Step 3) — no dependencies
  5. AI sentences (Step 4) — run after JLPT tagging (priority ordering by level)
  6. Confusion pairs — Source B+C first (no usage data needed), Source A after real reviews accumulate
  7. Priority curation (Step 6) — human review, not automated
```

### `enrich_items.js` Architecture

Suggested script structure:

```javascript
// enrich_items.js
// Usage: node enrich_items.js --step mnemonics --limit 100 --dry-run
//        node enrich_items.js --step sentences --jlpt N5
//        node enrich_items.js --step confusion --source component

// Steps: mnemonics | extended_meanings | sentences | confusion | all
// Each step: fetch batch from DB → call Claude API → upsert results
// --dry-run: log output without writing
// --limit N: max items per run (for cost control)
// --resume: skip items already enriched (check target field IS NOT NULL)

import Anthropic from '@anthropic-ai/sdk'
import { supabase } from './db.js'

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
```

Rate limiting: 50 RPM Claude API tier. Build in `p-limit` concurrency control (max 5 parallel).
Cost estimate: ~$0.002 per mnemonic (haiku) × 2230 = ~$4.50 for full kanji mnemonic pass.

---

## MCP Tools (src/index.js)

| Tool | Purpose |
|------|---------|
| `create_session` | Start study session |
| `get_due_today` | SM-2 items due for review |
| `process_quiz_answer` | Record answer, update SM-2 state |
| `get_progress` | User mastery stats |
| `get_weak_words` | Items with high weak_score |
| `get_confusion_report` | Confusion pair analysis |
| `get_learning_context` | Full context for an item |
| `get_config` | User preferences |
| `store_memo_learning` | MemoLearning paste processing |

---

## Known Issues / Decisions

| Issue | Status | Decision |
|-------|--------|---------|
| JMdict no JLPT tags | Accepted | Kotoba jlpt_level=NULL; tag via enrichment once list sourced |
| kanjidic2 no N1 data | Accepted | Pre-2010 4-level system — N1 needs separate community list |
| service_role no INSERT on curriculum_items | Fixed 2026-05-25 | GRANT ALL on all 16 tables applied via migration |
| item_type constraint too narrow | Fixed 2026-05-25 | Expanded CHECK + nullable jlpt_level |
| xml2js dependency | Fixed 2026-05-25 | Removed; seeder v2 is pure JSON |
| N4-N2 kanji no manual curation | Accepted | Auto-tagged; manual priority curation = Phase C Step 6 |
| Kotoba no priority field | Accepted | No JLPT rank → frequency_rank used instead |
| get_config/get_confusion_report missing REST | Fixed 2026-05-25 | Added to REST_TOOLS map in index.js |
| romaji_on/romaji_kun missing from session items | Fixed 2026-05-25 | Added to PROGRESS_SELECT + mapProgress in scheduler.js |
| Session UI: old field names (item.char, item.word) | Fixed 2026-05-25 | Migrated to item.value throughout Session.jsx |
| completeSession double-call on Study Again | Fixed 2026-05-25 | completedRef guard added |
| seen_in_texts dead param in computeWeakScore | Fixed 2026-05-25 | Removed from signature and formula |

---

## File Structure

```
KANJIDEN-MCP/
├── src/
│   ├── index.js                    MCP server entry
│   ├── modules/
│   │   ├── analytics.js
│   │   ├── context.js
│   │   ├── extractor.js
│   │   ├── mastery.js
│   │   ├── review.js
│   │   ├── scheduler.js
│   │   └── session.js
│   ├── scripts/
│   │   ├── seed_canonical.js       v2 — stable, replaces v1 XML seeder
│   │   ├── seed_n5.js              Legacy N5-only seeder (superseded)
│   │   ├── seed_radicals.sql       Radical seed (applied)
│   │   └── enrich_items.js         Phase C Claude enrichment (pending)
│   ├── migrations/
│   │   ├── v3_schema.sql           Full schema (applied)
│   │   └── patch.sql               v3.0 patch (applied)
│   └── data/                       Cached source downloads (gitignored)
├── resources/
│   ├── kanjidic2-en-3.6.2.json    Active — kanji source
│   ├── jmdict-eng-3.6.2.json      Active — vocab source
│   ├── jmdict-examples-eng-3.6.2.json  Active — Tatoeba sentences
│   ├── kradfile-3.6.2.json        Active — kanji component decomposition
│   └── jitendex-yomitan/          NOT USED — no JLPT data
├── KanjiDen_v2.1_Status_and_Plan.pdf  Project status + roadmap document
├── package.json                    kanjiden-mcp@2.1.0
└── SYSTEM.md                       This file
```
