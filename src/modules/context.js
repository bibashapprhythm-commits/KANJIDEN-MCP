// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MODULE
// Returns summarized learning state for Claude.
// Reads user_item_progress joined with curriculum_items.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";

export async function getLearningContext() {
  const today = new Date().toISOString().split("T")[0];

  const { data: progressData } = await supabase
    .from("user_item_progress")
    .select(`
      mastery_level, next_review, weak_score, perf_by_type,
      curriculum_items!inner(item_type, value, jlpt_level)
    `)
    .eq("user_id", BIBS_USER_ID);

  const { data: configData } = await supabase
    .from("config")
    .select("preferences")
    .eq("user_id", BIBS_USER_ID)
    .single();

  const all    = progressData ?? [];
  const kanji  = all.filter(p => p.curriculum_items.item_type === "kanji");
  const kotoba = all.filter(p => p.curriculum_items.item_type === "kotoba");
  const total  = all.length;

  const dueToday       = all.filter(i => i.next_review <= today).length;
  const mastered       = all.filter(i => i.mastery_level === 5).length;
  const masteryPercent = total > 0 ? Math.round((mastered / total) * 100) : 0;

  const weakItems = [...all]
    .filter(i => i.mastery_level < 3)
    .sort((a, b) => b.weak_score - a.weak_score)
    .slice(0, 5)
    .map(i => i.curriculum_items.value);

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
    if (t > 5) {
      const ratio = counts.correct / t;
      if (ratio < weakestRatio) { weakestRatio = ratio; weakestType = qtype; }
    }
  }

  const jlptCounts = {};
  for (const item of all) {
    const jl = item.curriculum_items.jlpt_level;
    if (jl) jlptCounts[jl] = (jlptCounts[jl] ?? 0) + 1;
  }
  const activeJlpt = Object.entries(jlptCounts).sort((a,b) => b[1]-a[1])[0]?.[0] ?? "N5";

  return {
    owner:            configData?.preferences?.owner ?? "Bibs",
    total_kanji:      kanji.length,
    total_kotoba:     kotoba.length,
    total_items:      total,
    mastered,
    mastery_percent:  masteryPercent,
    due_today:        dueToday,
    active_jlpt:      activeJlpt,
    weakest_question_type: weakestType,
    weakest_accuracy: weakestType ? Math.round(weakestRatio * 100) : null,
    top_weak_items:   weakItems,
    preferences:      configData?.preferences ?? {},
  };
}

// ── Full config (for agent initialization) ────────────────────────────────────
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
