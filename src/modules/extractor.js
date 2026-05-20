// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTOR MODULE
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";

const TODAY = () => new Date().toISOString().split("T")[0];

const log = (fn, msg, data) => console.error(`[extractor:${fn}] ${msg}`, data ? JSON.stringify(data) : "");

// ── Store source text record ──────────────────────────────────────────────────
export async function createSourceText({ content, source_type, source_label, agent_model, agent_version }) {
  log("createSourceText", "inserting source text...");
  const { data, error } = await supabase
    .from("source_texts")
    .insert({
      user_id:       BIBS_USER_ID,
      content:       content ?? "",
      source_type:   source_type  ?? "other",
      source_label:  source_label ?? null,
      agent_model:   agent_model  ?? null,
      agent_version: agent_version ?? null,
    })
    .select("id")
    .single();

  if (error) {
    log("createSourceText", "ERROR", error);
    throw new Error(`createSourceText failed: ${error.message}`);
  }
  log("createSourceText", "success, id:", data);
  return data.id;
}

// ── Update source text with extraction counts ─────────────────────────────────
export async function updateSourceTextCounts(source_text_id, { kanji_added, kotoba_added, kanji_seen, kotoba_seen }) {
  log("updateSourceTextCounts", "updating counts for", { source_text_id });
  const { error } = await supabase
    .from("source_texts")
    .update({ kanji_added, kotoba_added, kanji_seen, kotoba_seen })
    .eq("id", source_text_id);
  if (error) log("updateSourceTextCounts", "ERROR", error);
}

// ── Store kanji ───────────────────────────────────────────────────────────────
export async function storeKanji({ items, source_text_id }) {
  log("storeKanji", `processing ${items?.length ?? 0} items`);
  if (!items || items.length === 0) return { added: 0, seen_again: 0, new_items: [], seen_again_items: [] };

  const chars = items.map(i => i.char);
  log("storeKanji", "checking existing chars", chars);

  const { data: existing, error } = await supabase
    .from("kanji")
    .select("id, char, seen_in_texts")
    .eq("user_id", BIBS_USER_ID)
    .in("char", chars);

  if (error) {
    log("storeKanji", "ERROR fetching existing", error);
    throw new Error(`storeKanji fetch failed: ${error.message}`);
  }

  const existingMap   = new Map((existing ?? []).map(e => [e.char, e]));
  const newItems      = items.filter(i => !existingMap.has(i.char));
  const existingItems = items.filter(i =>  existingMap.has(i.char));
  const today         = TODAY();

  log("storeKanji", `new: ${newItems.length}, existing: ${existingItems.length}`);

  if (newItems.length > 0) {
    const rows = newItems.map(item => ({
      user_id:          BIBS_USER_ID,
      char:             item.char,
      onyomi:           item.onyomi          ?? [],
      kunyomi:          item.kunyomi         ?? [],
      romaji_on:        item.romaji_on        ?? [],
      romaji_kun:       item.romaji_kun       ?? [],
      meaning:          item.meaning,
      jlpt_level:       item.jlpt_level       ?? "unknown",
      exam_important:   item.exam_important   ?? false,
      daily_important:  item.daily_important  ?? false,
      first_seen_in:    source_text_id        ?? null,
      interval:         1,
      ease_factor:      2.5,
      next_review_date: today,
      review_count:     0,
      mastery_level:    0,
      seen_in_texts:    1,
      first_seen:       today,
      last_seen:        today,
    }));
    log("storeKanji", "inserting new rows", rows.map(r => r.char));
    const { error: ie } = await supabase.from("kanji").insert(rows);
    if (ie) {
      log("storeKanji", "ERROR inserting", ie);
      throw new Error(`storeKanji insert failed: ${ie.message}`);
    }
  }

  for (const item of existingItems) {
    const ex = existingMap.get(item.char);
    const { error: ue } = await supabase
      .from("kanji")
      .update({ seen_in_texts: (ex.seen_in_texts ?? 0) + 1, last_seen: today })
      .eq("id", ex.id);
    if (ue) log("storeKanji", "ERROR updating seen_in_texts", ue);
  }

  log("storeKanji", "done");
  return {
    added:            newItems.length,
    seen_again:       existingItems.length,
    new_items:        newItems.map(i => i.char),
    seen_again_items: existingItems.map(i => i.char),
  };
}

// ── Store kotoba ──────────────────────────────────────────────────────────────
export async function storeKotoba({ items, source_text_id }) {
  log("storeKotoba", `processing ${items?.length ?? 0} items`);
  if (!items || items.length === 0) return { added: 0, seen_again: 0, new_items: [], seen_again_items: [] };

  const words = items.map(i => i.word);
  log("storeKotoba", "checking existing words", words);

  const { data: existing, error } = await supabase
    .from("kotoba")
    .select("id, word, seen_in_texts")
    .eq("user_id", BIBS_USER_ID)
    .in("word", words);

  if (error) {
    log("storeKotoba", "ERROR fetching existing", error);
    throw new Error(`storeKotoba fetch failed: ${error.message}`);
  }

  const existingMap   = new Map((existing ?? []).map(e => [e.word, e]));
  const newItems      = items.filter(i => !existingMap.has(i.word));
  const existingItems = items.filter(i =>  existingMap.has(i.word));
  const today         = TODAY();

  log("storeKotoba", `new: ${newItems.length}, existing: ${existingItems.length}`);

  if (newItems.length > 0) {
    const rows = newItems.map(item => ({
      user_id:          BIBS_USER_ID,
      word:             item.word,
      reading:          item.reading,
      romaji:           item.romaji,
      meaning:          item.meaning,
      jlpt_level:       item.jlpt_level      ?? "unknown",
      exam_important:   item.exam_important  ?? false,
      daily_important:  item.daily_important ?? false,
      first_seen_in:    source_text_id       ?? null,
      interval:         1,
      ease_factor:      2.5,
      next_review_date: today,
      review_count:     0,
      mastery_level:    0,
      seen_in_texts:    1,
      first_seen:       today,
      last_seen:        today,
    }));
    log("storeKotoba", "inserting new rows", rows.map(r => r.word));
    const { error: ie } = await supabase.from("kotoba").insert(rows);
    if (ie) {
      log("storeKotoba", "ERROR inserting", ie);
      throw new Error(`storeKotoba insert failed: ${ie.message}`);
    }
  }

  for (const item of existingItems) {
    const ex = existingMap.get(item.word);
    const { error: ue } = await supabase
      .from("kotoba")
      .update({ seen_in_texts: (ex.seen_in_texts ?? 0) + 1, last_seen: today })
      .eq("id", ex.id);
    if (ue) log("storeKotoba", "ERROR updating seen_in_texts", ue);
  }

  log("storeKotoba", "done");
  return {
    added:            newItems.length,
    seen_again:       existingItems.length,
    new_items:        newItems.map(i => i.word),
    seen_again_items: existingItems.map(i => i.word),
  };
}