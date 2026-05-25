// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER MODULE
// SM-2 calculation + getDueToday.
// Queries user_item_progress joined with curriculum_items.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";

export const ALGORITHM_VERSION = "sm2_v1";

// ── Shared select + mapper (used by session.js too) ───────────────────────────
export const PROGRESS_SELECT = `
  id, curriculum_item_id, mastery_level, interval, ease_factor, next_review,
  weak_score, review_count, perf_by_type, streak, first_seen,
  curriculum_items!inner(item_type, value, reading_hiragana, romaji, core_meaning, jlpt_level, onyomi, kunyomi)
`;

export function mapProgress(p) {
  const ci = p.curriculum_items;
  return {
    id:            p.curriculum_item_id,  // item_id for processQuizAnswer
    progress_id:   p.id,
    item_type:     ci.item_type,
    item:          ci.value,
    value:         ci.value,
    reading:       ci.reading_hiragana,
    romaji:        ci.romaji,
    meaning:       ci.core_meaning,
    jlpt_level:    ci.jlpt_level,
    onyomi:        ci.onyomi,
    kunyomi:       ci.kunyomi,
    mastery_level: p.mastery_level,
    interval:      p.interval,
    ease_factor:   p.ease_factor,
    next_review:   p.next_review,
    weak_score:    p.weak_score,
    review_count:  p.review_count,
    perf_by_type:  p.perf_by_type,
    streak:        p.streak,
  };
}

// ── SM-2 via DB function ──────────────────────────────────────────────────────
export async function calculateSM2({ rating, interval, ease_factor, review_count }) {
  const { data, error } = await supabase.rpc("sm2_calculate", {
    p_rating:       rating,
    p_interval:     interval      ?? 1,
    p_ease_factor:  ease_factor   ?? 2.5,
    p_review_count: review_count  ?? 0,
  });
  if (error) throw new Error(`SM-2 calculation failed: ${error.message}`);
  return data[0]; // { new_interval, new_ease_factor, new_review_date }
}

// ── Get due cards today ───────────────────────────────────────────────────────
export async function getDueToday({ type = "both" } = {}) {
  const today = new Date().toISOString().split("T")[0];
  let kanjiDue = [], kotobaDue = [];

  const buildQuery = (itemType) => supabase
    .from("user_item_progress")
    .select(PROGRESS_SELECT)
    .eq("user_id", BIBS_USER_ID)
    .eq("curriculum_items.item_type", itemType)
    .lte("next_review", today)
    .order("weak_score", { ascending: false });

  if (type === "kanji" || type === "both") {
    const { data, error } = await buildQuery("kanji");
    if (error) throw new Error(`getDueToday kanji: ${error.message}`);
    kanjiDue = (data ?? []).map(mapProgress);
  }

  if (type === "kotoba" || type === "both") {
    const { data, error } = await buildQuery("kotoba");
    if (error) throw new Error(`getDueToday kotoba: ${error.message}`);
    kotobaDue = (data ?? []).map(mapProgress);
  }

  const all = [...kanjiDue, ...kotobaDue].sort((a, b) => b.weak_score - a.weak_score);
  return {
    total_due:  all.length,
    kanji_due:  kanjiDue.length,
    kotoba_due: kotobaDue.length,
    items:      all,
  };
}
