// ─────────────────────────────────────────────────────────────────────────────
// SESSION MODULE
// Builds study sessions from user_item_progress joined with curriculum_items.
// source=new: progress rows with review_count=0 (added via MemoLearning).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase, BIBS_USER_ID } from "../db.js";
import { PROGRESS_SELECT, mapProgress } from "./scheduler.js";

const TODAY = () => new Date().toISOString().split("T")[0];

// Build a session item directly from a curriculum_items row + optional progress row.
// Used by createCourse and the item_ids path of createSession.
function buildDirectItem(ci, p) {
  return {
    id:            ci.id,
    progress_id:   p?.id ?? null,
    item_type:     ci.item_type,
    item:          ci.value,
    value:         ci.value,
    reading:       ci.reading_hiragana,
    romaji:        ci.romaji        ?? null,
    romaji_on:     ci.romaji_on     ?? [],
    romaji_kun:    ci.romaji_kun    ?? [],
    meaning:       ci.core_meaning,
    jlpt_level:    ci.jlpt_level,
    onyomi:        ci.onyomi        ?? [],
    kunyomi:       ci.kunyomi       ?? [],
    mastery_level: p?.mastery_level ?? 0,
    interval:      p?.interval      ?? 0,
    ease_factor:   p?.ease_factor   ?? 2.5,
    next_review:   p?.next_review   ?? null,
    weak_score:    p?.weak_score    ?? 0,
    review_count:  p?.review_count  ?? 0,
    perf_by_type:  p?.perf_by_type  ?? {},
    streak:        p?.streak        ?? 0,
  };
}

const CI_SELECT = "id, item_type, value, reading_hiragana, romaji, romaji_on, romaji_kun, core_meaning, jlpt_level, onyomi, kunyomi";
const PROG_FIELDS = "id, curriculum_item_id, mastery_level, interval, ease_factor, next_review, weak_score, review_count, perf_by_type, streak";

export async function createSession({ level, source, type, count, item_ids }) {
  const today = TODAY();

  // ── item_ids path: build session from exact curriculum_items ─────────────
  if (item_ids?.length) {
    const { data: ciItems, error: ciErr } = await supabase
      .from("curriculum_items").select(CI_SELECT).in("id", item_ids);
    if (ciErr) throw new Error(`createSession item_ids fetch: ${ciErr.message}`);

    const { data: progressRows } = await supabase
      .from("user_item_progress").select(PROG_FIELDS)
      .eq("user_id", BIBS_USER_ID).in("curriculum_item_id", item_ids);
    const progMap = Object.fromEntries((progressRows ?? []).map(p => [p.curriculum_item_id, p]));

    const allItems = (ciItems ?? []).map(ci => buildDirectItem(ci, progMap[ci.id]));
    if (!allItems.length) return { success: false, message: "No items found." };

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({ user_id: BIBS_USER_ID, date: today, params: { source: "direct", item_ids }, items: allItems, status: "pending" })
      .select().single();
    if (sessionError) throw new Error(`createSession insert: ${sessionError.message}`);

    return {
      success: true, session_id: session.id, total_items: allItems.length,
      kanji_count:  allItems.filter(i => i.item_type === "kanji").length,
      kotoba_count: allItems.filter(i => i.item_type === "kotoba").length,
      source_used: "direct",
      message: `Session ready! ${allItems.length} item(s). Open your study site.`,
    };
  }

  // ── standard source/level/type path ──────────────────────────────────────
  const itemCount   = count  ?? 10;
  const studyType   = type   ?? "both";
  const studyLevel  = level  ?? "all";
  const studySource = source ?? "due";

  const buildQuery = (itemType) => {
    let q = supabase
      .from("user_item_progress")
      .select(PROGRESS_SELECT)
      .eq("user_id", BIBS_USER_ID)
      .eq("curriculum_items.item_type", itemType);

    if (studyLevel !== "all") q = q.eq("curriculum_items.jlpt_level", studyLevel);

    switch (studySource) {
      case "due":
        q = q.lte("next_review", today).order("weak_score", { ascending: false });
        break;
      case "new":
        q = q.eq("review_count", 0).order("created_at", { ascending: false });
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
    if (error) throw new Error(`createSession kanji: ${error.message}`);
    kanjiItems = (data ?? []).map(mapProgress);
  }

  if (studyType === "kotoba" || studyType === "both") {
    const limit = studyType === "both" ? Math.floor(itemCount / 2) : itemCount;
    const { data, error } = await buildQuery("kotoba").limit(limit);
    if (error) throw new Error(`createSession kotoba: ${error.message}`);
    kotobaItems = (data ?? []).map(mapProgress);
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
  if (sessionError) throw new Error(`createSession insert: ${sessionError.message}`);

  return {
    success:      true,
    session_id:   session.id,
    total_items:  allItems.length,
    kanji_count:  kanjiItems.length,
    kotoba_count: kotobaItems.length,
    source_used:  studySource,
    message: `Session ready! ${allItems.length} items (${kanjiItems.length} kanji, ${kotobaItems.length} kotoba). Open your study site.`,
  };
}

export async function getPendingSession() {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, date, params, items")
    .eq("user_id", BIBS_USER_ID)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

export async function getSession(sessionId) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (error) throw new Error(`getSession failed: ${error.message}`);
  return data;
}

// ── Create a structured course session ───────────────────────────────────────
export async function createCourse({ level, type, order_by = "radical" }) {
  if (!level)                throw new Error("level required");
  if (!type || type === "both") throw new Error("type must be 'kanji' or 'kotoba'");

  const today    = TODAY();
  const typeName = type === "kanji" ? "Kanji" : "Kotoba";

  // 1. Fetch all curriculum_items for this level+type
  const { data: allItems, error: itemsErr } = await supabase
    .from("curriculum_items")
    .select(`${CI_SELECT}, stroke_count, frequency_rank, priority, primary_radical, primary_radical_meaning`)
    .eq("item_type", type)
    .eq("jlpt_level", level);
  if (itemsErr) throw new Error(`createCourse items: ${itemsErr.message}`);
  if (!allItems?.length) return { success: false, message: `No ${level} ${typeName} items found.` };

  // 2. Fetch progress for all those items
  const ids = allItems.map(i => i.id);
  const { data: progressRows, error: progErr } = await supabase
    .from("user_item_progress").select(PROG_FIELDS)
    .eq("user_id", BIBS_USER_ID).in("curriculum_item_id", ids);
  if (progErr) throw new Error(`createCourse progress: ${progErr.message}`);
  const progressMap = Object.fromEntries((progressRows ?? []).map(p => [p.curriculum_item_id, p]));

  // 3. Split unmastered (no progress OR mastery < 3) vs mastered (mastery >= 3)
  const unmastered = allItems.filter(item => {
    const p = progressMap[item.id];
    return !p || (p.mastery_level ?? 0) < 3;
  });
  const mastered = allItems.filter(item => {
    const p = progressMap[item.id];
    return p && (p.mastery_level ?? 0) >= 3;
  });

  // 4. Order unmastered by order_by
  let orderedUnmastered;
  let topRadical = null;

  if (order_by === "radical" && type === "kanji") {
    const groups = {};
    for (const item of unmastered) {
      const rad = item.primary_radical ?? "other";
      if (!groups[rad]) groups[rad] = [];
      groups[rad].push(item);
    }
    const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    if (!sorted.length) {
      orderedUnmastered = [...unmastered].sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));
    } else {
      topRadical = sorted[0][0];
      let grp = [...sorted[0][1]];
      const parentIdx = grp.findIndex(i => i.value === topRadical);
      if (parentIdx !== -1) {
        const parent = grp.splice(parentIdx, 1)[0];
        grp.sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));
        orderedUnmastered = [parent, ...grp];
      } else {
        orderedUnmastered = grp.sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));
      }
    }
  } else if (order_by === "difficulty") {
    orderedUnmastered = [...unmastered].sort((a, b) =>
      (a.stroke_count ?? 99) - (b.stroke_count ?? 99) || (a.priority ?? 9999) - (b.priority ?? 9999)
    );
  } else {
    orderedUnmastered = [...unmastered].sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999));
  }

  // 5. Build chunk: 4 new + 3 review if mastered exist, else 5 new
  const reviewItems  = mastered.slice(0, 3);
  const hasMastered  = reviewItems.length > 0;
  const newCount     = hasMastered ? 4 : 5;
  const chunkItems   = hasMastered
    ? [...orderedUnmastered.slice(0, newCount), ...reviewItems]
    : orderedUnmastered.slice(0, newCount);

  if (!chunkItems.length) {
    return { success: false, message: `All ${level} ${typeName} items mastered! Nothing left to study.` };
  }

  // 6. Course name
  let courseName;
  if (order_by === "radical" && topRadical && topRadical !== "other") {
    courseName = `${level} ${typeName} — Radical: ${topRadical}`;
  } else {
    const { count: existingCount } = await supabase
      .from("learning_paths").select("id", { count: "exact", head: true })
      .eq("jlpt_level", level).ilike("title", `${level} ${typeName}%`);
    courseName = `${level} ${typeName} — Batch ${(existingCount ?? 0) + 1}`;
  }

  // 7. Write learning_paths + learning_path_items
  const { data: path, error: pathErr } = await supabase
    .from("learning_paths")
    .insert({ title: courseName, path_type: "ai_generated", jlpt_level: level })
    .select().single();
  if (pathErr) throw new Error(`createCourse learning_paths: ${pathErr.message}`);

  const { error: pathItemsErr } = await supabase.from("learning_path_items").insert(
    chunkItems.map((item, idx) => ({ path_id: path.id, item_id: item.id, display_order: idx }))
  );
  if (pathItemsErr) throw new Error(`createCourse learning_path_items: ${pathItemsErr.message}`);

  // 8. Create session
  const sessionItems = chunkItems.map(item => buildDirectItem(item, progressMap[item.id]));
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      user_id: BIBS_USER_ID,
      date:    today,
      params:  { is_course: true, course_name: courseName, learning_path_id: path.id, level, type, order_by },
      items:   sessionItems,
      status:  "pending",
    })
    .select().single();
  if (sessionError) throw new Error(`createCourse session: ${sessionError.message}`);

  return {
    success:          true,
    session_id:       session.id,
    course_name:      courseName,
    learning_path_id: path.id,
    item_count:       sessionItems.length,
    items:            sessionItems,
  };
}
