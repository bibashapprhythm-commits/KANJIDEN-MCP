// ─────────────────────────────────────────────────────────────────────────────
// MASTERY MODULE
// Responsibility: compute mastery_level from multiple signals.
// NOT derived from interval alone — interval is scheduling, mastery is knowledge.
// Called by review pipeline after every quiz answer.
// Change the formula here freely — no DB migration needed.
// ─────────────────────────────────────────────────────────────────────────────

// ── Compute mastery from multiple signals ─────────────────────────────────────
// Signals:
//   streak          → consecutive correct answers
//   ease_factor     → personal difficulty (low = hard card for this user)
//   wrong_rate      → times_wrong / total reviews
//   response_ms     → hesitation (slow correct = not automatic)
//   interval        → one input among many, not the only signal
//
// Returns 0-5
export function computeMastery({
  streak,
  ease_factor,
  times_correct,
  times_wrong,
  avg_response_ms,
  interval,
  review_count,
}) {
  // Not enough data yet
  if (!review_count || review_count === 0) return 0;

  const total     = (times_correct ?? 0) + (times_wrong ?? 0);
  const wrongRate = total > 0 ? (times_wrong ?? 0) / total : 1;
  const currentStreak  = streak ?? 0;
  const ease      = ease_factor ?? 2.5;
  const ms        = avg_response_ms ?? 0;

  // Start with interval as base signal (scheduling state)
  // but cap its influence — knowledge matters more
  let score = 0;

  // Streak signal (0-3 points)
  if (currentStreak >= 10) score += 3;
  else if (currentStreak >= 5)  score += 2;
  else if (currentStreak >= 2)  score += 1;

  // Accuracy signal (0-3 points)
  if (wrongRate <= 0.05)       score += 3;  // almost never wrong
  else if (wrongRate <= 0.15)  score += 2;  // rarely wrong
  else if (wrongRate <= 0.30)  score += 1;  // sometimes wrong
  // else: often wrong → 0

  // Ease signal (0-2 points)
  // ease > 2.5 = card is easy for this user
  if (ease >= 2.8)       score += 2;
  else if (ease >= 2.3)  score += 1;
  // ease < 2.0 = structurally hard → 0

  // Hesitation penalty (-1 point)
  // Correct but slow = not automatic = not truly mastered
  if (ms > 6000) score -= 1;

  // Interval sanity check — boost if interval is long (not sole signal)
  if (interval >= 21) score += 1;

  // Map score to mastery level (0-5)
  if      (score >= 8)  return 5; // mastered
  else if (score >= 6)  return 4; // strong
  else if (score >= 4)  return 3; // good
  else if (score >= 2)  return 2; // familiar
  else if (score >= 1)  return 1; // learning
  else                  return 0; // new / struggling
}

// ── Compute weak_score heuristic ─────────────────────────────────────────────
// Used for prioritizing what to study next.
// Treat as recommendation signal only — not canonical knowledge state.
// NOTE: seen_in_texts × 1.5 can inflate score for common words (する、ある)
//       Monitor and adjust if needed.
export function computeWeakScore({
  times_wrong,
  streak,
  mastery_level,
  last_correct_date,
  avg_response_ms,
  ease_factor,
}) {
  const daysSinceCorrect = last_correct_date
    ? Math.floor((Date.now() - new Date(last_correct_date).getTime()) / 86400000)
    : 30;

  const hesitationPenalty =
    avg_response_ms > 8000 ? 3.0 :
    avg_response_ms > 5000 ? 1.5 :
    avg_response_ms > 3000 ? 0.5 : 0;

  const easePenalty = ease_factor < 2.0
    ? (2.0 - ease_factor) * 5
    : 0;

  return Math.round((
      (times_wrong   ?? 0) * 2.0
    - (streak        ?? 0) * 3.0
    - (mastery_level    ?? 0) * 5.0
    + daysSinceCorrect        * 0.5
    + hesitationPenalty
    + easePenalty
  ) * 100) / 100;
}
