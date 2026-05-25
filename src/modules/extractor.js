// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTOR MODULE
// MemoLearning: upserts curriculum_items + user_item_progress + user_exposures.
// exam_important / daily_important / seen_in_texts removed (not in v3 schema).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";

const TODAY = () => new Date().toISOString().split("T")[0];
const log = (fn, msg, data) => console.error(`[extractor:${fn}] ${msg}`, data ? JSON.stringify(data) : "");

// ── Store source text ─────────────────────────────────────────────────────────
export async function createSourceText({ content, source_type, source_label, agent_model, agent_version }) {
  const { data, error } = await supabase
    .from("source_texts")
    .insert({
      user_id:       BIBS_USER_ID,
      content:       content      ?? "",
      source_type:   source_type  ?? "other",
      source_label:  source_label ?? null,
      agent_model:   agent_model  ?? null,
      agent_version: agent_version ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createSourceText failed: ${error.message}`);
  return data.id;
}

// ── Update source text counts ─────────────────────────────────────────────────
export async function updateSourceTextCounts(source_text_id, { kanji_added, kotoba_added, kanji_seen, kotoba_seen }) {
  const { error } = await supabase
    .from("source_texts")
    .update({ kanji_added, kotoba_added, kanji_seen, kotoba_seen })
    .eq("id", source_text_id);
  if (error) log("updateSourceTextCounts", "ERROR", error);
}

// ── Core: upsert one item into curriculum + user progress ─────────────────────
async function storeItem({ item_type, value, ciFields, source_text_id }) {
  const today = TODAY();

  // 1. Upsert curriculum_items (creates or updates canonical entry)
  const { data: ci, error: ciErr } = await supabase
    .from("curriculum_items")
    .upsert({ item_type, value, ...ciFields,
      source_dataset: "memo_learning", curation_status: "auto_accepted", seeded_by: "extractor" },
      { onConflict: "item_type,value", ignoreDuplicates: false })
    .select("id")
    .single();
  if (ciErr) throw new Error(`storeItem upsert curriculum_items (${value}): ${ciErr.message}`);

  const curriculum_item_id = ci.id;

  // 2. Check for existing progress row
  const { data: existing, error: fetchErr } = await supabase
    .from("user_item_progress")
    .select("id")
    .eq("user_id", BIBS_USER_ID)
    .eq("curriculum_item_id", curriculum_item_id)
    .maybeSingle();
  if (fetchErr) throw new Error(`storeItem fetch progress (${value}): ${fetchErr.message}`);

  let isNew = false;
  if (!existing) {
    const { error: ipErr } = await supabase.from("user_item_progress").insert({
      user_id:           BIBS_USER_ID,
      curriculum_item_id,
      next_review:       today,
      first_seen:        today,
      last_seen:         today,
    });
    if (ipErr) throw new Error(`storeItem create progress (${value}): ${ipErr.message}`);
    isNew = true;
  } else {
    await supabase.from("user_item_progress")
      .update({ last_seen: today })
      .eq("id", existing.id);
  }

  // 3. Log exposure
  if (source_text_id) {
    await supabase.from("user_exposures").insert({
      user_id:           BIBS_USER_ID,
      curriculum_item_id,
      source_text_id,
      exposure_type:     "memo_learning",
    });
  }

  return isNew;
}

// ── Store kanji ───────────────────────────────────────────────────────────────
export async function storeKanji({ items, source_text_id }) {
  log("storeKanji", `processing ${items?.length ?? 0} items`);
  if (!items || items.length === 0) return { added: 0, seen_again: 0, new_items: [], seen_again_items: [] };

  let added = 0, seen_again = 0;
  const new_items = [], seen_again_items = [];

  for (const item of items) {
    try {
      const isNew = await storeItem({
        item_type: "kanji",
        value:     item.char,
        ciFields: {
          onyomi:       item.onyomi      ?? null,
          kunyomi:      item.kunyomi     ?? null,
          romaji_on:    item.romaji_on   ?? null,
          romaji_kun:   item.romaji_kun  ?? null,
          core_meaning: item.meaning,
          jlpt_level:   item.jlpt_level !== "unknown" ? item.jlpt_level : null,
        },
        source_text_id,
      });
      if (isNew) { added++;      new_items.push(item.char); }
      else        { seen_again++; seen_again_items.push(item.char); }
    } catch (err) {
      log("storeKanji", `ERROR on ${item.char}`, err.message);
    }
  }

  return { added, seen_again, new_items, seen_again_items };
}

// ── Store kotoba ──────────────────────────────────────────────────────────────
export async function storeKotoba({ items, source_text_id }) {
  log("storeKotoba", `processing ${items?.length ?? 0} items`);
  if (!items || items.length === 0) return { added: 0, seen_again: 0, new_items: [], seen_again_items: [] };

  let added = 0, seen_again = 0;
  const new_items = [], seen_again_items = [];

  for (const item of items) {
    try {
      const isNew = await storeItem({
        item_type: "kotoba",
        value:     item.word,
        ciFields: {
          reading_hiragana: item.reading  ?? null,
          romaji:           item.romaji   ?? null,
          core_meaning:     item.meaning,
          jlpt_level:       item.jlpt_level !== "unknown" ? item.jlpt_level : null,
        },
        source_text_id,
      });
      if (isNew) { added++;      new_items.push(item.word); }
      else        { seen_again++; seen_again_items.push(item.word); }
    } catch (err) {
      log("storeKotoba", `ERROR on ${item.word}`, err.message);
    }
  }

  return { added, seen_again, new_items, seen_again_items };
}
