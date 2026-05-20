// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MODULE
// Responsibility: return summarized learning state for Claude.
// Returns ONLY what Claude needs — not the entire DB.
// Prevents context window bloat on long conversations.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";

export async function getLearningContext() {
  const today = new Date().toISOString().split("T")[0];

  // Fetch minimal fields only
  const { data: kanjiData } = await supabase
    .from("kanji")
    .select("mastery_level, next_review_date, weak_score, jlpt_level, perf_by_type, char")
    .eq("user_id", BIBS_USER_ID);

  const { data: kotobaData } = await supabase
    .from("kotoba")
    .select("mastery_level, next_review_date, weak_score, jlpt_level, perf_by_type, word")
    .eq("user_id", BIBS_USER_ID);

  const { data: configData } = await supabase
    .from("config")
    .select("preferences")
    .eq("user_id", BIBS_USER_ID)
    .single();

  const kanji  = kanjiData  ?? [];
  const kotoba = kotobaData ?? [];
  const all    = [...kanji, ...kotoba];
  const total  = all.length;

  // Due today
  const dueToday = all.filter(i => i.next_review_date <= today).length;

  // Mastery breakdown
  const mastered = all.filter(i => i.mastery_level === 5).length;
  const masteryPercent = total > 0 ? Math.round((mastered / total) * 100) : 0;

  // Top weak items (max 5 for context summary)
  const weakItems = [...kanji, ...kotoba]
    .filter(i => i.mastery_level < 3)
    .sort((a, b) => b.weak_score - a.weak_score)
    .slice(0, 5)
    .map(i => i.char ?? i.word);

  // Weakest question type across all items
  const typeAgg = {};
  for (const item of all) {
    for (const [qtype, counts] of Object.entries(item.perf_by_type ?? {})) {
      if (!typeAgg[qtype]) typeAgg[qtype] = { correct: 0, wrong: 0 };
      typeAgg[qtype].correct += counts.correct ?? 0;
      typeAgg[qtype].wrong   += counts.wrong   ?? 0;
    }
  }
  let weakestType = null, weakestRatio = 1;
  for (const [qtype, counts] of Object.entries(typeAgg)) {
    const t = counts.correct + counts.wrong;
    if (t > 5) { // only meaningful if enough data
      const ratio = counts.correct / t;
      if (ratio < weakestRatio) { weakestRatio = ratio; weakestType = qtype; }
    }
  }

  // Active JLPT level (most common level in deck)
  const jlptCounts = {};
  for (const item of all) {
    if (item.jlpt_level && item.jlpt_level !== "unknown") {
      jlptCounts[item.jlpt_level] = (jlptCounts[item.jlpt_level] ?? 0) + 1;
    }
  }
  const activeJlpt = Object.entries(jlptCounts).sort((a,b) => b[1]-a[1])[0]?.[0] ?? "N5";

  return {
    // Greeting info
    owner:            configData?.preferences?.owner ?? "Bibs",
    total_kanji:      kanji.length,
    total_kotoba:     kotoba.length,
    total_items:      total,
    mastered,
    mastery_percent:  masteryPercent,

    // Study queue
    due_today:        dueToday,

    // Intelligence signals
    active_jlpt:      activeJlpt,
    weakest_question_type: weakestType,
    weakest_accuracy: weakestType ? Math.round(weakestRatio * 100) : null,
    top_weak_items:   weakItems,

    // Preferences
    preferences:      configData?.preferences ?? {},
  };
}

// ── Get config (full — for agent initialization) ──────────────────────────────
export async function getConfig() {
  const { data, error } = await supabase
    .from("config")
    .select("identity, preferences, options")
    .eq("user_id", BIBS_USER_ID)
    .single();
  if (error) throw new Error(`getConfig failed: ${error.message}`);

  const context = await getLearningContext();

  return {
    identity:        data.identity,
    preferences:     data.preferences,
    options:         data.options,
    current_context: context,
  };
}
