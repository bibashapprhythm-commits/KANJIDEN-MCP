// ─────────────────────────────────────────────────────────────────────────────
// REVIEW MODULE
// Processes quiz answers: SM-2, mastery, weak_score, review_log.
// item_id = curriculum_items.id (not user_item_progress.id).
// Creates user_item_progress row on first review if not yet present.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";
import { calculateSM2, ALGORITHM_VERSION } from "./scheduler.js";
import { computeMastery, computeWeakScore } from "./mastery.js";

export async function processQuizAnswer({
  session_id,
  item_type,
  item_id,           // = curriculum_items.id
  correct,
  rating,            // again | hard | good | easy
  question_type,     // meaning | onyomi | kunyomi | reading | production
  user_answer,
  correct_answer,
  confused_with_id,
  response_ms,
  hints_used,
}) {
  const today = new Date().toISOString().split("T")[0];

  // 1. Fetch progress row (create if first review)
  let { data: current, error: fetchErr } = await supabase
    .from("user_item_progress")
    .select("id, mastery_level, times_correct, times_wrong, streak, interval, ease_factor, review_count, perf_by_type, confused_with, avg_response_ms, response_samples, last_correct_date, weak_score")
    .eq("user_id", BIBS_USER_ID)
    .eq("curriculum_item_id", item_id)
    .single();

  if (fetchErr?.code === "PGRST116") {
    // No row — create default progress
    const { data: created, error: createErr } = await supabase
      .from("user_item_progress")
      .insert({ user_id: BIBS_USER_ID, curriculum_item_id: item_id, first_seen: today })
      .select()
      .single();
    if (createErr) throw new Error(`processQuizAnswer create progress: ${createErr.message}`);
    current = created;
  } else if (fetchErr) {
    throw new Error(`processQuizAnswer fetch: ${fetchErr.message}`);
  }

  // 2. SM-2
  const sm2 = await calculateSM2({
    rating,
    interval:     current.interval,
    ease_factor:  current.ease_factor,
    review_count: current.review_count,
  });

  // 3. Mastery (multi-signal)
  const newTimesCorrect = correct ? (current.times_correct ?? 0) + 1 : (current.times_correct ?? 0);
  const newTimesWrong   = correct ? (current.times_wrong   ?? 0)     : (current.times_wrong   ?? 0) + 1;
  const newStreak       = correct ? (current.streak        ?? 0) + 1 : 0;

  const newMastery = computeMastery({
    streak:          newStreak,
    ease_factor:     sm2.new_ease_factor,
    times_correct:   newTimesCorrect,
    times_wrong:     newTimesWrong,
    avg_response_ms: current.avg_response_ms,
    interval:        sm2.new_interval,
    review_count:    (current.review_count ?? 0) + 1,
  });

  // 4. Weak score (seen_in_texts removed from schema — pass 0)
  const newWeakScore = computeWeakScore({
    times_wrong:       newTimesWrong,
    seen_in_texts:     0,
    streak:            newStreak,
    mastery_level:     newMastery,
    last_correct_date: correct ? today : current.last_correct_date,
    avg_response_ms:   current.avg_response_ms ?? 0,
    ease_factor:       sm2.new_ease_factor,
  });

  // 5. perf_by_type cache
  const perf = { ...(current.perf_by_type ?? {}) };
  const typePerf = perf[question_type] ?? { correct: 0, wrong: 0 };
  perf[question_type] = {
    correct: correct ? typePerf.correct + 1 : typePerf.correct,
    wrong:   correct ? typePerf.wrong       : typePerf.wrong + 1,
  };

  // 6. Response time rolling average
  const samples    = (current.response_samples ?? 0) + 1;
  const currentAvg = current.avg_response_ms ?? 0;
  const newAvgMs   = response_ms
    ? Math.round((currentAvg * (samples - 1) + response_ms) / samples)
    : currentAvg;

  // 7. Confusion tracking
  let confusedWith  = current.confused_with ?? [];
  let confusionType = null;
  if (!correct && user_answer) {
    if (!confusedWith.includes(user_answer)) {
      confusedWith = [...confusedWith, user_answer].slice(-10);
    }
    confusionType = classifyConfusion(question_type);
  }

  // 8. Write updated state
  const updates = {
    interval:         sm2.new_interval,
    ease_factor:      sm2.new_ease_factor,
    next_review:      sm2.new_review_date,
    review_count:     (current.review_count ?? 0) + 1,
    last_rating:      rating,
    mastery_level:    newMastery,
    weak_score:       newWeakScore,
    times_correct:    newTimesCorrect,
    times_wrong:      newTimesWrong,
    streak:           newStreak,
    perf_by_type:     perf,
    avg_response_ms:  newAvgMs,
    response_samples: samples,
    confused_with:    confusedWith,
    last_seen:        today,
    ...(confusionType ? { confusion_type: confusionType }  : {}),
    ...(correct       ? { last_correct_date: today }       : { last_wrong_date: today }),
  };

  const { error: updateErr } = await supabase
    .from("user_item_progress")
    .update(updates)
    .eq("id", current.id);
  if (updateErr) throw new Error(`processQuizAnswer update: ${updateErr.message}`);

  // 9. review_log (permanent — never delete)
  const { error: logErr } = await supabase.from("review_log").insert({
    user_id:            BIBS_USER_ID,
    session_id:         session_id     ?? null,
    curriculum_item_id: item_id,
    item_type,
    question_type,
    rating,
    correct,
    response_ms:        response_ms    ?? null,
    ease_before:        current.ease_factor,
    interval_before:    current.interval,
    mastery_before:     current.mastery_level,
    ease_after:         sm2.new_ease_factor,
    interval_after:     sm2.new_interval,
    mastery_after:      newMastery,
    user_answer:        user_answer    ?? null,
    correct_answer:     correct_answer ?? null,
    confused_with_id:   confused_with_id ?? null,
    hints_used:         hints_used ?? false,
    algorithm_version:  ALGORITHM_VERSION,
  });
  if (logErr) throw new Error(`review_log insert: ${logErr.message}`);

  return {
    success:          true,
    item_id,
    item_type,
    rating,
    correct,
    new_mastery:      newMastery,
    new_interval:     sm2.new_interval,
    new_ease_factor:  Math.round(sm2.new_ease_factor * 100) / 100,
    next_review:      sm2.new_review_date,
    new_streak:       newStreak,
    new_weak_score:   newWeakScore,
  };
}

function classifyConfusion(question_type) {
  if (question_type === "meaning")    return "meaning";
  if (question_type === "production") return "production";
  if (["onyomi","kunyomi","reading"].includes(question_type)) return "reading";
  return "mixed";
}
