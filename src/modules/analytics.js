// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS MODULE
// Responsibility: progress stats, weak words, confusion patterns.
// All reads only — never writes learning state.
// Source of truth for confusion = review_log (not cached fields).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";

const TODAY = () => new Date().toISOString().split("T")[0];

// ── Full progress report ──────────────────────────────────────────────────────
export async function getProgress() {
  const { data: kanjiData,  error: ke  } = await supabase
    .from("kanji")
    .select("jlpt_level, mastery_level, times_correct, times_wrong, weak_score, next_review_date, perf_by_type, avg_response_ms")
    .eq("user_id", BIBS_USER_ID);

  const { data: kotobaData, error: koe } = await supabase
    .from("kotoba")
    .select("jlpt_level, mastery_level, times_correct, times_wrong, weak_score, next_review_date, perf_by_type, avg_response_ms")
    .eq("user_id", BIBS_USER_ID);

  if (ke)  throw new Error(`getProgress kanji failed: ${ke.message}`);
  if (koe) throw new Error(`getProgress kotoba failed: ${koe.message}`);

  const today = TODAY();

  const summarize = (items) => {
    // Aggregate perf_by_type across all items
    const typePerf = {};
    for (const item of items) {
      for (const [qtype, counts] of Object.entries(item.perf_by_type ?? {})) {
        if (!typePerf[qtype]) typePerf[qtype] = { correct: 0, wrong: 0 };
        typePerf[qtype].correct += counts.correct ?? 0;
        typePerf[qtype].wrong   += counts.wrong   ?? 0;
      }
    }

    // Find weakest question type by accuracy
    let weakestType = null, weakestRatio = 1;
    for (const [qtype, counts] of Object.entries(typePerf)) {
      const total = counts.correct + counts.wrong;
      if (total > 0) {
        const ratio = counts.correct / total;
        if (ratio < weakestRatio) { weakestRatio = ratio; weakestType = qtype; }
      }
    }

    return {
      total:     items.length,
      new:       items.filter(i => i.mastery_level === 0).length,
      learning:  items.filter(i => i.mastery_level === 1).length,
      familiar:  items.filter(i => i.mastery_level === 2).length,
      good:      items.filter(i => i.mastery_level === 3).length,
      strong:    items.filter(i => i.mastery_level === 4).length,
      mastered:  items.filter(i => i.mastery_level === 5).length,
      due_today: items.filter(i => i.next_review_date <= today).length,
      total_correct:          items.reduce((a,i) => a + (i.times_correct  ?? 0), 0),
      total_wrong:            items.reduce((a,i) => a + (i.times_wrong    ?? 0), 0),
      avg_response_ms:        Math.round(items.reduce((a,i) => a + (i.avg_response_ms ?? 0), 0) / Math.max(items.length, 1)),
      performance_by_type:    typePerf,
      weakest_question_type:  weakestType,
      weakest_accuracy:       weakestType ? Math.round(weakestRatio * 100) : null,
      by_jlpt: ["N1","N2","N3","N4","N5","unknown"].map(level => ({
        level,
        count:    items.filter(i => i.jlpt_level === level).length,
        mastered: items.filter(i => i.jlpt_level === level && i.mastery_level === 5).length,
        due:      items.filter(i => i.jlpt_level === level && i.next_review_date <= today).length,
      })).filter(j => j.count > 0),
    };
  };

  const kanji   = summarize(kanjiData  ?? []);
  const kotoba  = summarize(kotobaData ?? []);
  const total   = kanji.total   + kotoba.total;
  const mastered = kanji.mastered + kotoba.mastered;

  return {
    kanji,
    kotoba,
    overall: {
      total,
      mastered,
      due_today:       kanji.due_today + kotoba.due_today,
      mastery_percent: total > 0 ? Math.round((mastered / total) * 100) : 0,
    },
  };
}

// ── Weak words ────────────────────────────────────────────────────────────────
export async function getWeakWords({ type = "both" } = {}) {
  const fields = "id, meaning, jlpt_level, mastery_level, times_wrong, times_correct, seen_in_texts, streak, weak_score, interval, ease_factor, perf_by_type, confused_with, confusion_type, avg_response_ms, exam_important, daily_important, last_correct_date";

  let kanjiWeak = [], kotobaWeak = [];

  if (type === "kanji" || type === "both") {
    const { data, error } = await supabase
      .from("kanji")
      .select(`char, ${fields}`)
      .eq("user_id", BIBS_USER_ID)
      .lt("mastery_level", 3)
      .order("weak_score", { ascending: false })
      .limit(20);
    if (error) throw new Error(`getWeakWords kanji failed: ${error.message}`);
    kanjiWeak = (data ?? []).map(k => ({ ...k, item_type: "kanji", item: k.char }));
  }

  if (type === "kotoba" || type === "both") {
    const { data, error } = await supabase
      .from("kotoba")
      .select(`word, reading, romaji, ${fields}`)
      .eq("user_id", BIBS_USER_ID)
      .lt("mastery_level", 3)
      .order("weak_score", { ascending: false })
      .limit(20);
    if (error) throw new Error(`getWeakWords kotoba failed: ${error.message}`);
    kotobaWeak = (data ?? []).map(k => ({ ...k, item_type: "kotoba", item: k.word }));
  }

  const all = [...kanjiWeak, ...kotobaWeak].sort((a, b) => b.weak_score - a.weak_score);
  return { total_weak: all.length, items: all };
}

// ── Confusion report ──────────────────────────────────────────────────────────
// Source of truth = review_log via confusion_patterns view
export async function getConfusionReport() {
  const { data, error } = await supabase
    .from("confusion_patterns")
    .select("*")
    .eq("user_id", BIBS_USER_ID)
    .order("times_confused", { ascending: false })
    .limit(20);
  if (error) throw new Error(`getConfusionReport failed: ${error.message}`);

  // Aggregate by question type
  const byType = {};
  for (const row of data ?? []) {
    byType[row.question_type] = (byType[row.question_type] ?? 0) + row.times_confused;
  }

  const weakestType = Object.entries(byType).sort((a,b) => b[1]-a[1])[0]?.[0] ?? null;

  return {
    total_confusion_events: (data ?? []).reduce((a,r) => a + Number(r.times_confused), 0),
    weakest_question_type:  weakestType,
    confusion_by_type:      byType,
    top_confused_items:     data ?? [],
  };
}
