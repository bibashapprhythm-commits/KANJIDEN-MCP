// ─────────────────────────────────────────────────────────────────────────────
// SESSION MODULE
// Responsibility: build and serve study sessions.
// Default source = "due" (SM-2 scheduled cards).
// Session composition priority:
//   1. Due today (SM-2) — always first
//   2. Weak items (high weak_score) — if source=weak
//   3. New items (never reviewed) — if source=new
//   4. Today's additions — if source=today
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";

const TODAY = () => new Date().toISOString().split("T")[0];

export async function createSession({ level, source, type, count }) {
  const today       = TODAY();
  const itemCount   = count  ?? 10;
  const studyType   = type   ?? "both";
  const studyLevel  = level  ?? "all";
  const studySource = source ?? "due";

  const buildQuery = (table) => {
    let q = supabase.from(table).select("*").eq("user_id", BIBS_USER_ID);

    if (studyLevel !== "all") q = q.eq("jlpt_level", studyLevel);

    switch (studySource) {
      case "due":
        q = q.lte("next_review_date", today).order("weak_score", { ascending: false });
        break;
      case "new":
        q = q.eq("review_count", 0).order("seen_in_texts", { ascending: false });
        break;
      case "weak":
        q = q.lt("mastery_level", 3).order("weak_score", { ascending: false });
        break;
      case "today":
        q = q.eq("first_seen", today);
        break;
      case "this_week": {
        const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().split("T")[0];
        q = q.gte("first_seen", weekAgo).order("weak_score", { ascending: false });
        break;
      }
      case "all":
        q = q.order("mastery_level", { ascending: true });
        break;
    }

    return q;
  };

  let kanjiItems = [], kotobaItems = [];

  if (studyType === "kanji" || studyType === "both") {
    const limit = studyType === "both" ? Math.ceil(itemCount / 2) : itemCount;
    const { data, error } = await buildQuery("kanji").limit(limit);
    if (error) throw new Error(`createSession kanji failed: ${error.message}`);
    kanjiItems = (data ?? []).map(k => ({ ...k, item_type: "kanji" }));
  }

  if (studyType === "kotoba" || studyType === "both") {
    const limit = studyType === "both" ? Math.floor(itemCount / 2) : itemCount;
    const { data, error } = await buildQuery("kotoba").limit(limit);
    if (error) throw new Error(`createSession kotoba failed: ${error.message}`);
    kotobaItems = (data ?? []).map(k => ({ ...k, item_type: "kotoba" }));
  }

  const allItems = [...kanjiItems, ...kotobaItems];

  if (allItems.length === 0) {
    return {
      success: false,
      message: `No items found for source='${studySource}'. Try: study all, study weak, or import more text first.`,
    };
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      user_id: BIBS_USER_ID,
      date:    today,
      params:  { level: studyLevel, source: studySource, type: studyType, count: itemCount },
      items:   allItems,
      status:  "pending",
    })
    .select()
    .single();

  if (sessionError) throw new Error(`createSession insert failed: ${sessionError.message}`);

  return {
    success:      true,
    session_id:   session.id,
    total_items:  allItems.length,
    kanji_count:  kanjiItems.length,
    kotoba_count: kotobaItems.length,
    source_used:  studySource,
    message:      `Session ready! ${allItems.length} items (${kanjiItems.length} kanji, ${kotobaItems.length} kotoba). Open your study site.`,
  };
}
export async function getPendingSession() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, date, params, items')
    .eq('user_id', BIBS_USER_ID)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  
  if (error) return null
  return data
}

export async function getSession(sessionId) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single()
  if (error) throw new Error(`getSession failed: ${error.message}`)
  return data
}