-- ============================================================
-- KANJIDEN v3.0 PATCH
-- Run AFTER v3_schema.sql
-- ============================================================

-- 1. visual_components (rename from components_simple)
ALTER TABLE curriculum_items 
  RENAME COLUMN components_simple TO visual_components;

-- 2. curation_status in curriculum_items
ALTER TABLE curriculum_items
  ADD COLUMN curation_status TEXT DEFAULT 'pending'
    CHECK (curation_status IN (
      'pending','reviewed','approved',
      'rejected','auto_accepted','needs_regeneration'
    ));

-- 3. Provenance fields
ALTER TABLE curriculum_items
  ADD COLUMN source_dataset   TEXT DEFAULT 'manual_curation',
  ADD COLUMN source_version   TEXT,
  ADD COLUMN source_reference TEXT;

-- 4. curation_status in generated_sentences
ALTER TABLE generated_sentences
  ADD COLUMN curation_status TEXT DEFAULT 'pending'
    CHECK (curation_status IN (
      'pending','reviewed','approved',
      'rejected','auto_accepted','needs_regeneration'
    ));

-- 5. Remove item_ids from learning_paths
ALTER TABLE learning_paths
  DROP COLUMN IF EXISTS item_ids;

-- 6. Add learning_path_items table
CREATE TABLE learning_path_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id       UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  item_id       UUID NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,
  display_order INT DEFAULT 0,
  is_required   BOOLEAN DEFAULT true,
  unlocks_after UUID REFERENCES curriculum_items(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(path_id, item_id)
);

-- RLS for new table
ALTER TABLE learning_path_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read path items"
  ON learning_path_items FOR SELECT USING (true);

-- 7. updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER trg_curriculum_items_updated
  BEFORE UPDATE ON curriculum_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_user_item_progress_updated
  BEFORE UPDATE ON user_item_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sessions_updated
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_config_updated
  BEFORE UPDATE ON config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 8. Verify
SELECT 'patch applied successfully' AS status;