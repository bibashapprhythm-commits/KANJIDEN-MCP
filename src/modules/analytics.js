// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS MODULE
// Reads user_item_progress joined with curriculum_items.
// getConfusionReport queries review_log directly (no confusion_patterns view).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";

const TODAY = () => new Date().toISOString().split("T")[0];

const PROGRESS_SELECT = `
  id, curriculum_item_id, mastery_level, times_correct, times_wrong,
  weak_score, next_review, perf_by_type, avg_response_ms, streak,
  curriculum_items!inner(item_type, value, jlpt_level)
`;

// ── Full progress report ──────────────────────────────────────────────────────
export async function getProgress({ level, type } = {}) {
  let q = supabase
    .from("user_item_progress")
    .select(PROGRESS_SELECT)
    .eq("user_id", BIBS_USER_ID);

  if (level)                   q = q.eq("curriculum_items.jlpt_level", level);
  if (type && type !== "both") q = q.eq("curriculum_items.item_type",  type);

  const { data, error } = await q;
  if (error) throw new Error(`getProgress failed: ${error.message}`);

  // Count all curriculum_items matching the filter (includes unstarted items)
  let cq = supabase.from("curriculum_items").select("id", { count: "exact", head: true });
  if (level)                   cq = cq.eq("jlpt_level", level);
  if (type && type !== "both") cq = cq.eq("item_type",  type);
  const { count: curriculumTotal } = await cq;

  const today = TODAY();
  const all     = data ?? [];
  const kanji   = all.filter(p => p.curriculum_items.item_type === "kanji");
  const kotoba  = all.filter(p => p.curriculum_items.item_type === "kotoba");

  const summarize = (items) => {
    const typePerf = {};
    for (const item of items) {
      for (const [qtype, counts] of Object.entries(item.perf_by_type ?? {})) {
        if (!typePerf[qtype]) typePerf[qtype] = { correct: 0, wrong: 0 };
        typePerf[qtype].correct += counts.correct ?? 0;
        typePerf[qtype].wrong   += counts.wrong   ?? 0;
      }
    }

    let weakestType = null, weakestRatio = 1;
    for (const [qtype, counts] of Object.entries(typePerf)) {
      const total = counts.correct + counts.wrong;
      if (total > 0) {
        const ratio = counts.correct / total;
        if (ratio < weakestRatio) { weakestRatio = ratio; weakestType = qtype; }
      }
    }

    return {
      total:    items.length,
      new:      items.filter(i => i.mastery_level === 0).length,
      learning: items.filter(i => i.mastery_level === 1).length,
      familiar: items.filter(i => i.mastery_level === 2).length,
      good:     items.filter(i => i.mastery_level === 3).length,
      strong:   items.filter(i => i.mastery_level === 4).length,
      mastered: items.filter(i => i.mastery_level === 5).length,
      due_today: items.filter(i => i.next_review <= today).length,
      total_correct:          items.reduce((a,i) => a + (i.times_correct  ?? 0), 0),
      total_wrong:            items.reduce((a,i) => a + (i.times_wrong    ?? 0), 0),
      avg_response_ms:        Math.round(items.reduce((a,i) => a + (i.avg_response_ms ?? 0), 0) / Math.max(items.length, 1)),
      performance_by_type:    typePerf,
      weakest_question_type:  weakestType,
      weakest_accuracy:       weakestType ? Math.round(weakestRatio * 100) : null,
      by_jlpt: ["N1","N2","N3","N4","N5"].map(level => ({
        level,
        count:    items.filter(i => i.curriculum_items.jlpt_level === level).length,
        mastered: items.filter(i => i.curriculum_items.jlpt_level === level && i.mastery_level === 5).length,
        due:      items.filter(i => i.curriculum_items.jlpt_level === level && i.next_review <= today).length,
      })).filter(j => j.count > 0),
    };
  };

  const kanjiStats  = summarize(kanji);
  const kotobaStats = summarize(kotoba);
  const total    = kanjiStats.total + kotobaStats.total;
  const mastered = kanjiStats.mastered + kotobaStats.mastered;

  return {
    kanji:   kanjiStats,
    kotoba:  kotobaStats,
    overall: {
      total,
      mastered,
      due_today:        kanjiStats.due_today + kotobaStats.due_today,
      mastery_percent:  total > 0 ? Math.round((mastered / total) * 100) : 0,
      curriculum_total: curriculumTotal ?? 0,
    },
  };
}

// ── Items browse (curriculum_items left-joined with progress) ─────────────────
const ORDER_COLS = { priority: "priority", stroke_count: "stroke_count", frequency_rank: "frequency_rank" };

export async function getItems({ level, type, order_by = "priority", page = 1, page_size = 50 } = {}) {
  const offset   = (Number(page) - 1) * Number(page_size);
  const orderCol = ORDER_COLS[order_by] ?? "priority";

  let q = supabase
    .from("curriculum_items")
    .select("id, item_type, value, reading_hiragana, core_meaning, jlpt_level, stroke_count, frequency_rank, priority", { count: "exact" });

  if (level)                   q = q.eq("jlpt_level", level);
  if (type && type !== "both") q = q.eq("item_type",  type);

  q = q.order(orderCol, { ascending: true, nullsFirst: false })
       .range(offset, offset + Number(page_size) - 1);

  const { data: items, count, error } = await q;
  if (error) throw new Error(`getItems failed: ${error.message}`);
  if (!items?.length) return { items: [], total: count ?? 0, page: Number(page), page_size: Number(page_size) };

  const ids = items.map(i => i.id);
  const { data: progress, error: progErr } = await supabase
    .from("user_item_progress")
    .select("curriculum_item_id, mastery_level")
    .eq("user_id", BIBS_USER_ID)
    .in("curriculum_item_id", ids);
  if (progErr) throw new Error(`getItems progress: ${progErr.message}`);

  const progMap = Object.fromEntries((progress ?? []).map(p => [p.curriculum_item_id, p.mastery_level]));
  return {
    items:     items.map(item => ({ ...item, mastery_level: progMap[item.id] ?? 0 })),
    total:     count ?? 0,
    page:      Number(page),
    page_size: Number(page_size),
  };
}

// ── Weak words ────────────────────────────────────────────────────────────────
export async function getWeakWords({ type = "both" } = {}) {
  const FIELDS = `
    id, curriculum_item_id, mastery_level, times_wrong, times_correct, streak,
    weak_score, interval, ease_factor, perf_by_type, avg_response_ms, last_correct_date,
    curriculum_items!inner(item_type, value, reading_hiragana, romaji, core_meaning, jlpt_level)
  `;

  const items = [];

  if (type === "kanji" || type === "both") {
    const { data, error } = await supabase
      .from("user_item_progress")
      .select(FIELDS)
      .eq("user_id", BIBS_USER_ID)
      .eq("curriculum_items.item_type", "kanji")
      .lt("mastery_level", 3)
      .order("weak_score", { ascending: false })
      .limit(20);
    if (error) throw new Error(`getWeakWords kanji: ${error.message}`);
    for (const p of data ?? []) {
      items.push({ ...p, item_type: "kanji", item: p.curriculum_items.value,
        meaning: p.curriculum_items.core_meaning, jlpt_level: p.curriculum_items.jlpt_level });
    }
  }

  if (type === "kotoba" || type === "both") {
    const { data, error } = await supabase
      .from("user_item_progress")
      .select(FIELDS)
      .eq("user_id", BIBS_USER_ID)
      .eq("curriculum_items.item_type", "kotoba")
      .lt("mastery_level", 3)
      .order("weak_score", { ascending: false })
      .limit(20);
    if (error) throw new Error(`getWeakWords kotoba: ${error.message}`);
    for (const p of data ?? []) {
      items.push({ ...p, item_type: "kotoba", item: p.curriculum_items.value,
        word: p.curriculum_items.value, reading: p.curriculum_items.reading_hiragana,
        romaji: p.curriculum_items.romaji, meaning: p.curriculum_items.core_meaning,
        jlpt_level: p.curriculum_items.jlpt_level });
    }
  }

  items.sort((a, b) => b.weak_score - a.weak_score);
  return { total_weak: items.length, items };
}

// ── Confusion report ──────────────────────────────────────────────────────────
// Derived from review_log — no confusion_patterns view in v3 schema
export async function getConfusionReport() {
  const { data, error } = await supabase
    .from("review_log")
    .select("curriculum_item_id, item_type, question_type, correct, user_answer, confused_with_id")
    .eq("user_id", BIBS_USER_ID)
    .eq("correct", false)
    .not("user_answer", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`getConfusionReport failed: ${error.message}`);

  const rows = data ?? [];

  const byType = {};
  const pairMap = {};
  for (const row of rows) {
    byType[row.question_type] = (byType[row.question_type] ?? 0) + 1;
    if (row.confused_with_id) {
      const key = `${row.curriculum_item_id}|${row.confused_with_id}|${row.question_type}`;
      pairMap[key] = (pairMap[key] ?? 0) + 1;
    }
  }

  const weakestType = Object.entries(byType).sort((a,b) => b[1]-a[1])[0]?.[0] ?? null;

  const topPairs = Object.entries(pairMap)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 20)
    .map(([key, count]) => {
      const [item_id, confused_with_id, question_type] = key.split("|");
      return { item_id, confused_with_id, question_type, times_confused: count };
    });

  return {
    total_wrong_answers:   rows.length,
    weakest_question_type: weakestType,
    confusion_by_type:     byType,
    top_confused_items:    topPairs,
  };
}
