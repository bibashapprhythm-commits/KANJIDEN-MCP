// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER MODULE
// Responsibility: SM-2 algorithm execution, interval calculation, due dates.
// Single source of truth for all scheduling decisions.
// Calls sm2_calculate DB function — keeping algorithm in SQL for portability.
// When algorithm changes: bump algorithm_version, create new DB function.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";

export const ALGORITHM_VERSION = "sm2_v1";

// ── Run SM-2 calculation via DB function ──────────────────────────────────────
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

  if (type === "kanji" || type === "both") {
    const { data, error } = await supabase
      .from("kanji")
      .select("id, char, meaning, jlpt_level, mastery_level, interval, ease_factor, next_review_date, weak_score, review_count, perf_by_type, exam_important, daily_important")
      .eq("user_id", BIBS_USER_ID)
      .lte("next_review_date", today)
      .order("weak_score", { ascending: false });
    if (error) throw new Error(`getDueToday kanji failed: ${error.message}`);
    kanjiDue = (data ?? []).map(k => ({ ...k, item_type: "kanji", item: k.char }));
  }

  if (type === "kotoba" || type === "both") {
    const { data, error } = await supabase
      .from("kotoba")
      .select("id, word, reading, romaji, meaning, jlpt_level, mastery_level, interval, ease_factor, next_review_date, weak_score, review_count, perf_by_type, exam_important, daily_important")
      .eq("user_id", BIBS_USER_ID)
      .lte("next_review_date", today)
      .order("weak_score", { ascending: false });
    if (error) throw new Error(`getDueToday kotoba failed: ${error.message}`);
    kotobaDue = (data ?? []).map(k => ({ ...k, item_type: "kotoba", item: k.word }));
  }

  const all = [...kanjiDue, ...kotobaDue].sort((a, b) => b.weak_score - a.weak_score);

  return {
    total_due:   all.length,
    kanji_due:   kanjiDue.length,
    kotoba_due:  kotobaDue.length,
    items:       all,
  };
}
