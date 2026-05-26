// ─────────────────────────────────────────────────────────────────────────────
// KANJIDEN MCP SERVER v2.1
// Two entry points:
//   /mcp        → MCP protocol (Claude.ai connects here)
//   /tools/:name → REST API (website calls here)
//   /health     → Railway health check
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { McpServer }                    from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z }                            from "zod";
import http                             from "http";

import { getConfig, getLearningContext }                                        from "./modules/context.js";
import { createSourceText, updateSourceTextCounts, storeKanji, storeKotoba }   from "./modules/extractor.js";
import { getDueToday }                                                          from "./modules/scheduler.js";
import { processQuizAnswer }                                                    from "./modules/review.js";
import { createSession, getPendingSession, getSession, createCourse, createContentCourse } from "./modules/session.js";
import { getProgress, getWeakWords, getConfusionReport, getItems, getNewItems, getItemsByTag, getRelatedWords } from "./modules/analytics.js";

// ── Gateway key ───────────────────────────────────────────────────────────────
const GATEWAY_KEY = process.env.GATEWAY_KEY;
if (!GATEWAY_KEY) throw new Error("Missing GATEWAY_KEY in .env");
const validate = (key) => { if (key !== GATEWAY_KEY) throw new Error("Invalid gateway key."); };
const gk = z.string().describe("Gateway key for authentication");
const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

const PORT = process.env.PORT || 3000;

// ── CORS headers ──────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── complete_session helper ───────────────────────────────────────────────────
// Called by website after session finishes. Marks completed + saves results.
import { supabase, BIBS_USER_ID } from "./db.js";

async function completeSession({ session_id, marks_percent }) {
  if (!session_id) throw new Error("session_id required");
  const { error } = await supabase
    .from("sessions")
    .update({ status: "completed" })
    .eq("id", session_id);
  if (error) throw new Error(`completeSession failed: ${error.message}`);
  return { success: true, session_id, marks_percent: marks_percent ?? 0 };
}

// ── REST tool map (website uses these directly) ───────────────────────────────
const REST_TOOLS = {
  get_config:           (_)    => getConfig(),
  get_progress:         (args) => getProgress(args),
  get_weak_words:       (args) => getWeakWords(args),
  get_due_today:        (args) => getDueToday(args),
  create_session:       (args) => createSession(args),
  create_course:        (args) => createCourse(args),
  process_quiz_answer:  (args) => processQuizAnswer(args),
  get_learning_context: (_)    => getLearningContext(),
  get_confusion_report: (_)    => getConfusionReport(),
  complete_session:     (args) => completeSession(args),
  get_session:          (args) => getSession(args.session_id),
  get_pending_session:      ()     => getPendingSession(),
  create_content_course:    (args) => createContentCourse(args),
  get_new_items:        (args) => getNewItems(args),
  get_items_by_tag:     (args) => getItemsByTag(args),
  get_related_words:    (args) => getRelatedWords(args),
  get_source_text: async ({ id }) => {
    if (!id) throw new Error("id required");
    const { data, error } = await supabase
      .from("source_texts")
      .select("id, goal_content, content, created_at")
      .eq("id", id)
      .single();
    if (error) throw new Error(`get_source_text failed: ${error.message}`);
    return data ?? null;
  },
};

// ── MCP Server (for Claude.ai) ────────────────────────────────────────────────
const server = new McpServer({ name: "kanjiden-mcp", version: "2.1.0" });

// 1. get_config
server.tool("get_config",
  "Call at the start of every session. Returns agent identity, options, preferences, and summarized learning context.",
  { gateway_key: gk },
  async ({ gateway_key }) => { validate(gateway_key); return ok(await getConfig()); }
);

// 2. get_learning_context
server.tool("get_learning_context",
  "Lightweight summarized learning state. Use mid-conversation to reference current stats.",
  { gateway_key: gk },
  async ({ gateway_key }) => { validate(gateway_key); return ok(await getLearningContext()); }
);

// 3. store_memo_learning
server.tool("store_memo_learning",
  "ONLY call when user explicitly says 'MemoLearning' or 'save to KanjiDen'. Never call automatically. Explicit keyword required.",
  {
    gateway_key:   gk,
    content:       z.string().describe("The original pasted Japanese text"),
    source_type:   z.enum(["chat","article","textbook","tv","conversation","other"]).optional(),
    source_label:  z.string().optional(),
    agent_model:   z.string().optional(),
    agent_version: z.string().optional(),
    kanji_items: z.array(z.object({
      char:       z.string(),
      onyomi:     z.array(z.string()).optional(),
      kunyomi:    z.array(z.string()).optional(),
      romaji_on:  z.array(z.string()).optional(),
      romaji_kun: z.array(z.string()).optional(),
      meaning:    z.string(),
      jlpt_level: z.enum(["N1","N2","N3","N4","N5","unknown"]).optional(),
    })).optional().default([]),
    kotoba_items: z.array(z.object({
      word:       z.string(),
      reading:    z.string(),
      romaji:     z.string(),
      meaning:    z.string(),
      jlpt_level: z.enum(["N1","N2","N3","N4","N5","unknown"]).optional(),
    })).optional().default([]),
  },
  async ({ gateway_key, content, source_type, source_label, agent_model, agent_version, kanji_items, kotoba_items }) => {
    validate(gateway_key);
    const sourceTextId = await createSourceText({ content, source_type, source_label, agent_model, agent_version });
    const kanjiResult  = await storeKanji({ items: kanji_items,  source_text_id: sourceTextId });
    const kotobaResult = await storeKotoba({ items: kotoba_items, source_text_id: sourceTextId });
    await updateSourceTextCounts(sourceTextId, {
      kanji_added: kanjiResult.added, kotoba_added: kotobaResult.added,
      kanji_seen:  kanjiResult.seen_again, kotoba_seen: kotobaResult.seen_again,
    });
    return ok({
      source_text_id: sourceTextId, kanji: kanjiResult, kotoba: kotobaResult,
      summary: `✅ Stored! ${kanjiResult.added} new kanji, ${kotobaResult.added} new kotoba. ` +
               `${kanjiResult.seen_again + kotobaResult.seen_again} already known.`,
    });
  }
);

// 4. process_quiz_answer
server.tool("process_quiz_answer",
  "Called by website after each flashcard answer. Runs SM-2, computes mastery, logs to review_log.",
  {
    gateway_key:      gk,
    session_id:       z.string().uuid().optional(),
    item_type:        z.enum(["kanji","kotoba"]),
    item_id:          z.string().uuid(),
    correct:          z.boolean(),
    rating:           z.enum(["again","hard","good","easy"]),
    question_type:    z.enum(["meaning","onyomi","kunyomi","reading","production"]),
    user_answer:      z.string().optional(),
    correct_answer:   z.string().optional(),
    confused_with_id: z.string().uuid().optional(),
    response_ms:      z.number().optional(),
    hints_used:       z.boolean().optional(),
  },
  async ({ gateway_key, ...args }) => { validate(gateway_key); return ok(await processQuizAnswer(args)); }
);

// 5. create_session
server.tool("create_session",
  "Build a study session. Default source='due'. Sources: due/new/weak/today/this_week/all.",
  {
    gateway_key: gk,
    level:  z.enum(["N1","N2","N3","N4","N5","all"]).optional().default("all"),
    source: z.enum(["due","new","weak","today","this_week","all"]).optional().default("due"),
    type:   z.enum(["kanji","kotoba","both"]).optional().default("both"),
    count:  z.number().optional().default(10),
  },
  async ({ gateway_key, level, source, type, count }) => { validate(gateway_key); return ok(await createSession({ level, source, type, count })); }
);

// 5b. create_course
server.tool("create_course",
  "Create a structured course session for a JLPT level+type. Groups unmastered items by radical (kanji) or difficulty/level order, adds 2-3 mastered items for reinforcement, writes learning_paths rows, and returns a ready session_id.",
  {
    gateway_key: gk,
    level:    z.enum(["N1","N2","N3","N4","N5"]),
    type:     z.enum(["kanji","kotoba"]),
    order_by: z.enum(["radical","difficulty","level"]).optional().default("radical"),
  },
  async ({ gateway_key, level, type, order_by }) => { validate(gateway_key); return ok(await createCourse({ level, type, order_by })); }
);

// 5c. create_content_course
server.tool("create_content_course",
  "Creates a named, phased content course from a saved source text. Each phase becomes one session ordered by JLPT level (easiest first). Returns session IDs for all phases.",
  {
    gateway_key:     gk,
    source_text_id:  z.string().uuid().describe("UUID of the source_texts row"),
    course_title:    z.string().describe("Human-readable title with romaji and timestamp"),
    course_description: z.string().optional(),
    goal_content:    z.string().optional().describe("Original Japanese text for final re-read"),
    phases: z.array(z.object({
      phase:    z.number(),
      label:    z.string(),
      item_ids: z.array(z.string().uuid()),
    })).describe("Phases ordered easiest-first (N5=1, N4=2, N3+=3)"),
  },
  async ({ gateway_key, source_text_id, course_title, course_description, goal_content, phases }) => {
    validate(gateway_key);
    return ok(await createContentCourse({
      sourceTextId:       source_text_id,
      courseTitle:        course_title,
      courseDescription:  course_description,
      goalContent:        goal_content,
      phases,
    }));
  }
);

// 6. get_due_today
server.tool("get_due_today",
  "All cards due for review today per SM-2 schedule.",
  { gateway_key: gk, type: z.enum(["kanji","kotoba","both"]).optional().default("both") },
  async ({ gateway_key, type }) => { validate(gateway_key); return ok(await getDueToday({ type })); }
);

// 7. get_progress
server.tool("get_progress",
  "Full progress: mastery breakdown, JLPT breakdown, due today. Optional level/type filters narrow to a specific JLPT level or item type.",
  {
    gateway_key: gk,
    level: z.enum(["N1","N2","N3","N4","N5"]).optional(),
    type:  z.enum(["kanji","kotoba","both"]).optional(),
  },
  async ({ gateway_key, level, type }) => { validate(gateway_key); return ok(await getProgress({ level, type })); }
);

// 8. get_weak_words
server.tool("get_weak_words",
  "Items with mastery < 3 sorted by weak_score DESC.",
  { gateway_key: gk, type: z.enum(["kanji","kotoba","both"]).optional().default("both") },
  async ({ gateway_key, type }) => { validate(gateway_key); return ok(await getWeakWords({ type })); }
);

// 9b. get_new_items
server.tool("get_new_items",
  "Items with review_count=0 (never reviewed). Optional level and type filters.",
  {
    gateway_key: gk,
    type:  z.enum(["kanji","kotoba","both"]).optional().default("both"),
    level: z.enum(["N1","N2","N3","N4","N5"]).optional(),
  },
  async ({ gateway_key, type, level }) => { validate(gateway_key); return ok(await getNewItems({ type, level })); }
);

// 9. get_confusion_report
server.tool("get_confusion_report",
  "Analyzes review_log confusion patterns.",
  { gateway_key: gk },
  async ({ gateway_key }) => { validate(gateway_key); return ok(await getConfusionReport()); }
);

// ── HTTP Server ───────────────────────────────────────────────────────────────
const httpServer = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // Add CORS to all responses
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "2.1.0" }));
    return;
  }

  // REST endpoints for website → /tools/:toolName
  const toolMatch = req.url?.match(/^\/tools\/([a-z_]+)$/);
  if (toolMatch && req.method === "POST") {
    const toolName = toolMatch[1];
    const fn = REST_TOOLS[toolName];
    if (!fn) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Unknown tool: ${toolName}` }));
      return;
    }
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const args = JSON.parse(body || "{}");
        // Validate gateway key
        if (args.gateway_key !== GATEWAY_KEY) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid gateway key" }));
          return;
        }
        const { gateway_key, ...rest } = args;
        console.error(`[REST] ${toolName}`, Object.keys(rest));
        const result = await fn(rest);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`[REST] ${toolName} error:`, err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /items → browse endpoint for website
  if (req.method === "GET" && req.url?.startsWith("/items")) {
    const url  = new URL(req.url, `http://localhost`);
    const key  = url.searchParams.get("gateway_key");
    if (key !== GATEWAY_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid gateway key" }));
      return;
    }
    try {
      const args = {
        level:     url.searchParams.get("level")     || undefined,
        type:      url.searchParams.get("type")      || undefined,
        order_by:  url.searchParams.get("order_by")  || undefined,
        page:      url.searchParams.get("page")      ? Number(url.searchParams.get("page"))      : 1,
        page_size: url.searchParams.get("page_size") ? Number(url.searchParams.get("page_size")) : 50,
      };
      console.error(`[REST] GET /items`, args);
      const result = await getItems(args);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error(`[REST] GET /items error:`, err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // MCP protocol endpoint → Claude.ai connects here
  if (req.url === "/mcp" || req.url === "/") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(PORT, () => {
  console.log(`✅ KanjiDen MCP Server v2.1 running on port ${PORT}`);
  console.log(`   /health       → health check`);
  console.log(`   /mcp          → Claude.ai MCP protocol`);
  console.log(`   /tools/:name  → website REST API`);
});