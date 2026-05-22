-- ============================================================
-- KANJIDEN v3.0 SCHEMA
-- Full reset — drops all old tables, creates new architecture
-- Run in Supabase SQL editor
-- ============================================================

-- ── DROP OLD TABLES ──────────────────────────────────────────
DROP TABLE IF EXISTS review_log          CASCADE;
DROP TABLE IF EXISTS results             CASCADE;
DROP TABLE IF EXISTS sessions            CASCADE;
DROP TABLE IF EXISTS grammar_knowledge   CASCADE;
DROP TABLE IF EXISTS generated_sentences CASCADE;
DROP TABLE IF EXISTS source_texts        CASCADE;
DROP TABLE IF EXISTS kotoba              CASCADE;
DROP TABLE IF EXISTS kanji               CASCADE;
DROP TABLE IF EXISTS config              CASCADE;

-- ── DROP OLD FUNCTIONS ───────────────────────────────────────
DROP FUNCTION IF EXISTS sm2_calculate CASCADE;

-- ============================================================
-- LAYER 1 — CANONICAL (The Map)
-- ============================================================

-- ── curriculum_tags ──────────────────────────────────────────
-- Strict controlled vocabulary. Only valid tags.
CREATE TABLE curriculum_tags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag           TEXT UNIQUE NOT NULL,
  dimension     TEXT NOT NULL,
  label         TEXT,
  description   TEXT,
  display_order INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── radicals ─────────────────────────────────────────────────
-- Structural DNA of kanji
CREATE TABLE radicals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  radical         TEXT UNIQUE NOT NULL,
  meaning         TEXT NOT NULL,
  meaning_jp      TEXT,
  romaji          TEXT,
  stroke_count    INT,
  position_type   TEXT,       -- left, right, top, bottom, enclosing, standalone
  mnemonic        TEXT,
  jlpt_introduced TEXT,       -- N5, N4, N3, N2
  frequency_rank  INT,        -- how common in N5-N2 kanji
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── curriculum_items ─────────────────────────────────────────
-- The canonical Japanese map. N5-N2 kanji + kotoba.
CREATE TABLE curriculum_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  item_type               TEXT NOT NULL CHECK (item_type IN ('kanji', 'kotoba')),
  value                   TEXT NOT NULL,

  -- Representations
  reading_hiragana        TEXT,
  reading_katakana        TEXT,
  romaji                  TEXT,
  alt_forms               TEXT[],
  search_tokens           TEXT,         -- full blob: "yama mountain 山 やま N5"

  -- Classification
  jlpt_level              TEXT NOT NULL CHECK (jlpt_level IN ('N5','N4','N3','N2','N1')),
  is_core                 BOOLEAN DEFAULT true,
  priority                INT,          -- learning order within level
  frequency_rank          INT,

  -- Meaning
  core_meaning            TEXT NOT NULL,
  meaning_extended        TEXT,

  -- Tags (must exist in curriculum_tags)
  tags                    TEXT[] DEFAULT '{}',

  -- Kanji-specific
  onyomi                  TEXT[],
  kunyomi                 TEXT[],
  romaji_on               TEXT[],
  romaji_kun              TEXT[],
  stroke_count            INT,
  radical                 TEXT,

  -- Visual / KanjiVG (future-proofed)
  kanjivg_id              TEXT,
  stroke_svg              JSONB,
  stroke_data             JSONB,

  -- Mnemonic + decomposition
  mnemonic                TEXT,
  components_simple       TEXT[],
  primary_radical         TEXT,
  primary_radical_meaning TEXT,

  -- Kotoba-specific
  part_of_speech          TEXT,
  verb_type               TEXT,
  formality               TEXT,

  -- Version control
  version                 INT DEFAULT 1,
  change_notes            TEXT,
  seeded_by               TEXT DEFAULT 'script_v1',
  validated               BOOLEAN DEFAULT false,

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(item_type, value)
);

-- ── kanji_radicals ───────────────────────────────────────────
-- Kanji ↔ radical relationships
CREATE TABLE kanji_radicals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kanji_id    UUID NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,
  radical_id  UUID NOT NULL REFERENCES radicals(id) ON DELETE CASCADE,
  role_type   TEXT CHECK (role_type IN ('semantic','phonetic','visual','primary')),
  position    TEXT,
  is_primary  BOOLEAN DEFAULT false,
  UNIQUE(kanji_id, radical_id)
);

-- ── kanji_components ─────────────────────────────────────────
-- Visual decomposition of kanji
CREATE TABLE kanji_components (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kanji_id        UUID NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,
  component       TEXT NOT NULL,
  component_type  TEXT CHECK (component_type IN ('radical','kanji','element')),
  position        TEXT,
  display_order   INT DEFAULT 0,
  meaning_hint    TEXT
);

-- ── item_relationships ───────────────────────────────────────
-- How items connect (v1: 4 types only)
CREATE TABLE item_relationships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_item_id    UUID NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,
  target_item_id    UUID NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (
    relationship_type IN (
      'depends_on',
      'confused_with',
      'visually_similar',
      'related_family'
    )
  ),
  strength          FLOAT DEFAULT 1.0 CHECK (strength >= 0 AND strength <= 1),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_item_id, target_item_id, relationship_type)
);

-- ── learning_paths ───────────────────────────────────────────
-- Curated + AI-generated study routes
CREATE TABLE learning_paths (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  tags        TEXT[],
  path_type   TEXT NOT NULL CHECK (
    path_type IN ('canonical','ai_generated','user_weakness')
  ),
  jlpt_level  TEXT,
  difficulty  INT CHECK (difficulty BETWEEN 1 AND 5),
  item_ids    UUID[],
  created_by  TEXT DEFAULT 'system',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- LAYER 2 — USER JOURNEY
-- ============================================================

-- ── config ───────────────────────────────────────────────────
CREATE TABLE config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE,
  identity    JSONB DEFAULT '{}',
  preferences JSONB DEFAULT '{}',
  options     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── source_texts ─────────────────────────────────────────────
-- What user pasted via MemoLearning
CREATE TABLE source_texts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  content         TEXT NOT NULL,
  source_type     TEXT DEFAULT 'other',
  source_label    TEXT,
  agent_model     TEXT,
  agent_version   TEXT,
  kanji_added     INT DEFAULT 0,
  kotoba_added    INT DEFAULT 0,
  kanji_seen      INT DEFAULT 0,
  kotoba_seen     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── user_item_progress ───────────────────────────────────────
-- Core user state per curriculum item
CREATE TABLE user_item_progress (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  curriculum_item_id    UUID NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,

  -- Multi-dimensional mastery
  mastery_level         INT DEFAULT 0 CHECK (mastery_level BETWEEN 0 AND 5),
  recognition_score     FLOAT DEFAULT 0,
  recall_score          FLOAT DEFAULT 0,
  reading_score         FLOAT DEFAULT 0,

  -- SM-2 scheduling
  interval              INT DEFAULT 1,
  ease_factor           FLOAT DEFAULT 2.5,
  next_review           DATE DEFAULT CURRENT_DATE,
  streak                INT DEFAULT 0,
  last_rating           TEXT,

  -- Performance
  review_count          INT DEFAULT 0,
  times_correct         INT DEFAULT 0,
  times_wrong           INT DEFAULT 0,
  avg_response_ms       INT DEFAULT 0,
  response_samples      INT DEFAULT 0,
  weak_score            FLOAT DEFAULT 0,
  perf_by_type          JSONB DEFAULT '{}',

  -- Confusion tracking
  confused_with         TEXT[] DEFAULT '{}',
  confusion_type        TEXT,

  -- Dates
  first_seen            DATE DEFAULT CURRENT_DATE,
  last_seen             DATE,
  last_correct_date     DATE,
  last_wrong_date       DATE,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, curriculum_item_id)
);

-- ── user_exposures ───────────────────────────────────────────
-- Passive encounter tracking
CREATE TABLE user_exposures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  curriculum_item_id    UUID REFERENCES curriculum_items(id) ON DELETE SET NULL,
  source_text_id        UUID REFERENCES source_texts(id) ON DELETE SET NULL,
  exposure_type         TEXT CHECK (
    exposure_type IN ('memo_learning','conversation','search','session')
  ),
  context_snippet       TEXT,
  encountered_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── sessions ─────────────────────────────────────────────────
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  date        DATE DEFAULT CURRENT_DATE,
  params      JSONB DEFAULT '{}',
  items       JSONB DEFAULT '[]',
  status      TEXT DEFAULT 'pending' CHECK (
    status IN ('pending','reading','completed','abandoned')
  ),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── review_log ───────────────────────────────────────────────
-- Permanent event history. Never delete.
CREATE TABLE review_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  session_id        UUID REFERENCES sessions(id) ON DELETE SET NULL,
  curriculum_item_id UUID REFERENCES curriculum_items(id) ON DELETE SET NULL,
  item_type         TEXT,
  question_type     TEXT,
  rating            TEXT CHECK (rating IN ('again','hard','good','easy')),
  correct           BOOLEAN,
  response_ms       INT,
  ease_before       FLOAT,
  interval_before   INT,
  mastery_before    INT,
  ease_after        FLOAT,
  interval_after    INT,
  mastery_after     INT,
  user_answer       TEXT,
  correct_answer    TEXT,
  confused_with_id  UUID,
  hints_used        BOOLEAN DEFAULT false,
  algorithm_version TEXT DEFAULT 'sm2_v1',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── user_progress_snapshots ──────────────────────────────────
-- Weekly state capture for progress graphs
CREATE TABLE user_progress_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  snapshot_date         DATE DEFAULT CURRENT_DATE,
  jlpt_progress         JSONB DEFAULT '{}',
  mastery_distribution  JSONB DEFAULT '{}',
  weak_items            UUID[],
  due_count             INT DEFAULT 0,
  total_items           INT DEFAULT 0,
  mastered_items        INT DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, snapshot_date)
);

-- ============================================================
-- LAYER 3 — ENRICHMENT
-- ============================================================

-- ── generated_sentences ──────────────────────────────────────
CREATE TABLE generated_sentences (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_item_id    UUID REFERENCES curriculum_items(id) ON DELETE CASCADE,
  japanese              TEXT NOT NULL,
  reading               TEXT,
  english               TEXT NOT NULL,
  jlpt_level            TEXT,
  vocab_coverage        FLOAT,
  grammar_level         TEXT,
  sentence_type         TEXT CHECK (
    sentence_type IN ('ai_generated','user_example','textbook','imported')
  ) DEFAULT 'ai_generated',
  generated_by          TEXT,
  prompt_version        TEXT,
  validated             BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Curriculum search
CREATE INDEX idx_curriculum_search
  ON curriculum_items USING GIN (to_tsvector('english', search_tokens));
CREATE INDEX idx_curriculum_jlpt
  ON curriculum_items (jlpt_level);
CREATE INDEX idx_curriculum_tags
  ON curriculum_items USING GIN (tags);
CREATE INDEX idx_curriculum_type
  ON curriculum_items (item_type);
CREATE INDEX idx_curriculum_value
  ON curriculum_items (value);

-- User progress
CREATE INDEX idx_progress_user
  ON user_item_progress (user_id);
CREATE INDEX idx_progress_review
  ON user_item_progress (user_id, next_review);
CREATE INDEX idx_progress_mastery
  ON user_item_progress (user_id, mastery_level);
CREATE INDEX idx_progress_weak
  ON user_item_progress (user_id, weak_score DESC);

-- Exposures
CREATE INDEX idx_exposures_user
  ON user_exposures (user_id);
CREATE INDEX idx_exposures_item
  ON user_exposures (curriculum_item_id);

-- Review log
CREATE INDEX idx_review_log_user
  ON review_log (user_id);
CREATE INDEX idx_review_log_item
  ON review_log (curriculum_item_id);
CREATE INDEX idx_review_log_session
  ON review_log (session_id);

-- Sessions
CREATE INDEX idx_sessions_user_status
  ON sessions (user_id, status);

-- ============================================================
-- SM-2 FUNCTION (updated)
-- ============================================================

CREATE OR REPLACE FUNCTION sm2_calculate(
  p_rating       TEXT,
  p_interval     INT,
  p_ease_factor  FLOAT,
  p_review_count INT
)
RETURNS TABLE (
  new_interval     INT,
  new_ease_factor  FLOAT,
  new_review_date  DATE
)
LANGUAGE plpgsql AS $$
DECLARE
  v_interval    INT;
  v_ease        FLOAT;
  v_quality     INT;
BEGIN
  -- Map rating to SM-2 quality (0-5)
  v_quality := CASE p_rating
    WHEN 'again' THEN 1
    WHEN 'hard'  THEN 2
    WHEN 'good'  THEN 4
    WHEN 'easy'  THEN 5
    ELSE 3
  END;

  -- Update ease factor
  v_ease := p_ease_factor + (0.1 - (5 - v_quality) * (0.08 + (5 - v_quality) * 0.02));
  v_ease := GREATEST(1.3, v_ease);

  -- Calculate new interval
  IF v_quality < 3 THEN
    v_interval := 1;
  ELSIF p_review_count = 0 THEN
    v_interval := 1;
  ELSIF p_review_count = 1 THEN
    v_interval := 3;
  ELSE
    v_interval := ROUND(p_interval * v_ease);
  END IF;

  -- Easy bonus
  IF p_rating = 'easy' THEN
    v_interval := ROUND(v_interval * 1.3);
  END IF;

  -- Cap at 365 days
  v_interval := LEAST(365, v_interval);

  RETURN QUERY SELECT
    v_interval,
    v_ease,
    CURRENT_DATE + v_interval;
END;
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE curriculum_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_tags          ENABLE ROW LEVEL SECURITY;
ALTER TABLE radicals                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanji_radicals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanji_components         ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_relationships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_paths           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_item_progress       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_exposures           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_sentences      ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_texts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE config                   ENABLE ROW LEVEL SECURITY;

-- Canonical tables: public read
CREATE POLICY "public read curriculum"
  ON curriculum_items FOR SELECT USING (true);
CREATE POLICY "public read tags"
  ON curriculum_tags FOR SELECT USING (true);
CREATE POLICY "public read radicals"
  ON radicals FOR SELECT USING (true);
CREATE POLICY "public read kanji_radicals"
  ON kanji_radicals FOR SELECT USING (true);
CREATE POLICY "public read kanji_components"
  ON kanji_components FOR SELECT USING (true);
CREATE POLICY "public read relationships"
  ON item_relationships FOR SELECT USING (true);
CREATE POLICY "public read paths"
  ON learning_paths FOR SELECT USING (true);
CREATE POLICY "public read sentences"
  ON generated_sentences FOR SELECT USING (true);

-- User tables: service role only (MCP handles all writes)
CREATE POLICY "service only progress"
  ON user_item_progress FOR ALL USING (true);
CREATE POLICY "service only exposures"
  ON user_exposures FOR ALL USING (true);
CREATE POLICY "service only sessions"
  ON sessions FOR ALL USING (true);
CREATE POLICY "service only review_log"
  ON review_log FOR ALL USING (true);
CREATE POLICY "service only snapshots"
  ON user_progress_snapshots FOR ALL USING (true);
CREATE POLICY "service only source_texts"
  ON source_texts FOR ALL USING (true);
CREATE POLICY "service only config"
  ON config FOR ALL USING (true);

-- ============================================================
-- SEED: CONFIG
-- ============================================================

INSERT INTO config (user_id, identity, preferences, options)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '{
    "name": "KanjiDen",
    "owner": "Bibs",
    "version": "3.0",
    "description": "Bibs personal Japanese study agent"
  }',
  '{
    "daily_goal": 10,
    "session_size": 10,
    "default_level": "N5",
    "show_romaji": true,
    "mnemonic_style": "visual"
  }',
  '{
    "sm2_enabled": true,
    "auto_advance": true,
    "reading_phase": true
  }'
);

-- ============================================================
-- SEED: CURRICULUM TAGS
-- ============================================================

INSERT INTO curriculum_tags (tag, dimension, label, display_order) VALUES

-- JLPT
('N5', 'jlpt', 'N5', 1),
('N4', 'jlpt', 'N4', 2),
('N3', 'jlpt', 'N3', 3),
('N2', 'jlpt', 'N2', 4),
('N1', 'jlpt', 'N1', 5),

-- Semantic
('nature',      'semantic', '🌿 Nature',      1),
('school',      'semantic', '🏫 School',      2),
('family',      'semantic', '👨‍👩‍👧 Family',  3),
('food',        'semantic', '🍱 Food',        4),
('transport',   'semantic', '🚃 Transport',   5),
('weather',     'semantic', '🌤 Weather',     6),
('body',        'semantic', '🫀 Body',        7),
('home',        'semantic', '🏠 Home',        8),
('office',      'semantic', '🏢 Office',      9),
('technology',  'semantic', '💻 Technology',  10),
('emotion',     'semantic', '💭 Emotion',     11),
('time',        'semantic', '🕒 Time',        12),
('numbers',     'semantic', '🔢 Numbers',     13),
('places',      'semantic', '🗺️ Places',      14),
('shopping',    'semantic', '🛒 Shopping',    15),
('health',      'semantic', '🏥 Health',      16),
('government',  'semantic', '🏛️ Government',  17),
('culture',     'semantic', '⛩️ Culture',     18),
('people',      'semantic', '👥 People',      19),
('actions',     'semantic', '⚡ Actions',     20),
('directions',  'semantic', '🧭 Directions',  21),

-- Frequency
('very_high', 'frequency', 'Very Common',  1),
('high',      'frequency', 'Common',       2),
('medium',    'frequency', 'Moderate',     3),
('low',       'frequency', 'Uncommon',     4),
('rare',      'frequency', 'Rare',         5),

-- Visual groups
('simple_shape',    'visual_group', 'Simple Shape',     1),
('complex_shape',   'visual_group', 'Complex Shape',    2),
('similar_犬大',    'visual_group', '犬 vs 大',         3),
('similar_土士',    'visual_group', '土 vs 士',         4),
('similar_未末',    'visual_group', '未 vs 末',         5),
('similar_己已巳',  'visual_group', '己已巳 group',     6),
('water_radical',   'visual_group', '氵 Water family',  7),
('person_radical',  'visual_group', '亻 Person family', 8),
('mouth_radical',   'visual_group', '口 Mouth family',  9),
('tree_radical',    'visual_group', '木 Tree family',   10),
('sun_radical',     'visual_group', '日 Sun family',    11),

-- Grammar
('verb_u',          'grammar', 'U-verb',          1),
('verb_ru',         'grammar', 'Ru-verb',          2),
('verb_irregular',  'grammar', 'Irregular verb',   3),
('i_adjective',     'grammar', 'い-adjective',     4),
('na_adjective',    'grammar', 'な-adjective',     5),
('noun',            'grammar', 'Noun',             6),
('counter',         'grammar', 'Counter',          7),
('particle',        'grammar', 'Particle',         8),
('conjunction',     'grammar', 'Conjunction',      9),
('prefix',          'grammar', 'Prefix',           10),
('suffix',          'grammar', 'Suffix',           11),
('adverb',          'grammar', 'Adverb',           12),

-- Context
('daily_life',  'context', '🗣️ Daily Life',  1),
('anime',       'context', '🎌 Anime',        2),
('business',    'context', '💼 Business',     3),
('travel',      'context', '✈️ Travel',       4),
('restaurant',  'context', '🍜 Restaurant',   5),
('hospital',    'context', '🏥 Hospital',     6),
('academic',    'context', '📚 Academic',     7),
('news',        'context', '📰 News',         8),
('literature',  'context', '📖 Literature',   9),

-- Cognitive
('easy_shape',        'cognitive', 'Easy to write',     1),
('hard_reading',      'cognitive', 'Hard reading',      2),
('multiple_onyomi',   'cognitive', 'Multiple onyomi',   3),
('irregular_reading', 'cognitive', 'Irregular reading', 4),
('high_confusion_risk','cognitive','Easy to confuse',   5),

-- Reading families
('さん_group', 'reading_family', 'さん readings', 1),
('き_group',   'reading_family', 'き readings',   2),
('こう_group', 'reading_family', 'こう readings', 3),
('しょう_group','reading_family', 'しょう readings',4),
('かい_group', 'reading_family', 'かい readings', 5),

-- Radical groups
('water_氵',   'radical_group', '氵 Water',  1),
('tree_木',    'radical_group', '木 Tree',   2),
('mouth_口',   'radical_group', '口 Mouth',  3),
('person_亻',  'radical_group', '亻 Person', 4),
('sun_日',     'radical_group', '日 Sun',    5),
('moon_月',    'radical_group', '月 Moon',   6),
('hand_扌',    'radical_group', '扌 Hand',   7),
('heart_忄',   'radical_group', '忄 Heart',  8),
('speech_言',  'radical_group', '言 Speech', 9),
('gold_金',    'radical_group', '金 Metal',  10);

-- ============================================================
-- SEED: RADICALS (N5 high-value, 20 core)
-- ============================================================

INSERT INTO radicals (radical, meaning, meaning_jp, romaji, stroke_count, position_type, mnemonic, jlpt_introduced, frequency_rank) VALUES
('氵', 'water',    'みず',   'mizu',   3, 'left',       'three drops of water flowing left',      'N5', 1),
('木', 'tree',     'き',     'ki',     4, 'standalone', 'trunk with branches up and roots down',  'N5', 2),
('口', 'mouth',    'くち',   'kuchi',  3, 'standalone', 'a square open mouth',                    'N5', 3),
('亻', 'person',   'ひと',   'hito',   2, 'left',       'a person standing upright',              'N5', 4),
('日', 'sun/day',  'ひ',     'hi',     4, 'standalone', 'the sun with a line through it',         'N5', 5),
('月', 'moon',     'つき',   'tsuki',  4, 'standalone', 'a crescent moon on its side',            'N5', 6),
('山', 'mountain', 'やま',   'yama',   3, 'standalone', 'three mountain peaks side by side',      'N5', 7),
('火', 'fire',     'ひ',     'hi',     4, 'standalone', 'flames rising from a base',              'N5', 8),
('水', 'water',    'みず',   'mizu',   4, 'standalone', 'flowing water with a central stream',    'N5', 9),
('土', 'earth',    'つち',   'tsuchi', 3, 'standalone', 'a cross planted in the ground',          'N5', 10),
('手', 'hand',     'て',     'te',     4, 'standalone', 'fingers spread from a palm',             'N5', 11),
('扌', 'hand',     'て',     'te',     3, 'left',       'a simplified hand reaching left',        'N5', 12),
('心', 'heart',    'こころ', 'kokoro', 4, 'standalone', 'a heart with three beats',               'N5', 13),
('忄', 'heart',    'こころ', 'kokoro', 3, 'left',       'a heart on the left side',               'N5', 14),
('目', 'eye',      'め',     'me',     5, 'standalone', 'an eye turned on its side',              'N5', 15),
('耳', 'ear',      'みみ',   'mimi',   6, 'standalone', 'an ear shape with horizontal lines',     'N5', 16),
('足', 'foot/leg', 'あし',   'ashi',   7, 'standalone', 'a leg with a foot at the bottom',        'N5', 17),
('言', 'speech',   'こと',   'koto',   7, 'standalone', 'words coming from a mouth',              'N5', 18),
('女', 'woman',    'おんな', 'onna',   3, 'standalone', 'a person kneeling gracefully',           'N5', 19),
('子', 'child',    'こ',     'ko',     3, 'standalone', 'a child with arms outstretched',         'N5', 20);

-- ============================================================
-- DONE
-- ============================================================

-- Verify
SELECT 'curriculum_tags'         AS table_name, COUNT(*) FROM curriculum_tags
UNION ALL
SELECT 'radicals',                              COUNT(*) FROM radicals
UNION ALL
SELECT 'curriculum_items',                      COUNT(*) FROM curriculum_items
UNION ALL
SELECT 'config',                                COUNT(*) FROM config;