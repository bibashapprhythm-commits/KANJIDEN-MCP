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

---

## Curated Data (hand-authored)

### N5 Kanji Curation (N5_CURATION in seed_canonical.js)
92 N5 kanji with manual tags + priority ordering (1–92).  
Priority = teaching order (simple shapes before complex, numbers before directions).  
Remaining 11 N5 kanji are auto-tagged only.

### Radicals (seed_radicals.sql / v3_schema.sql)
20 core radicals seeded with: character, meaning, romaji, stroke count, position, mnemonic, JLPT introduced.

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

### Phase B — NEXT
- [ ] N1 kanji: find community N1 kanji list, seed ~1000 items
- [ ] Kotoba JLPT tags: source N1–N5 vocab list, match by `source_reference` (jmdict word ID), update `jlpt_level`
- [ ] JMnedict: download `jmnedict-all.json`, build `seed_names.js`
- [ ] item_type: `name` `place` `station`
- [ ] Category tags: `person_name` `family_name` `station_name` `prefecture` `city`

### Phase C — ENRICHMENT
- [ ] Mnemonics for all kanji (Claude API)
- [ ] Extended meanings
- [ ] AI-generated sentences for items without Tatoeba coverage
- [ ] Confusion pair detection + `item_relationships` population

### Phase D — FUTURE
- [ ] KanjiVG stroke order SVGs → `stroke_svg` / `stroke_data` fields
- [ ] Multilingual: swap `jmdict-eng.json` → `jmdict-all.json`
- [ ] `item_relationships`: auto-detect visually_similar pairs
- [ ] Grammar points as `item_type = 'grammar'`

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
| service_role no INSERT on curriculum_items | Fixed 2026-05-25 | Migration applied |
| item_type constraint too narrow | Fixed 2026-05-25 | Expanded CHECK + nullable jlpt_level |
| xml2js dependency | Fixed 2026-05-25 | Removed from package.json; seeder v2 is pure JSON |
| N4-N2 kanji no manual curation | Accepted | Auto-tagged; manual curation = Phase C priority |
| Kotoba no priority field | Accepted | No JLPT rank → frequency_rank used instead |

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
