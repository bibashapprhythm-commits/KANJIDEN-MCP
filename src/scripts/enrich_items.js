#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// enrich_items.js — Phase C AI enrichment
// Reads curriculum_items where mnemonic IS NULL, calls Claude API in batches
// of 5, writes mnemonic + visual_components + search_tokens.
//
// Usage: node src/scripts/enrich_items.js
// Optional: node src/scripts/enrich_items.js --level N5
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import Anthropic    from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ── Validate env ──────────────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in .env");
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase  = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL      = "claude-haiku-4-5-20251001";
const BATCH_SIZE = 5;
const DELAY_MS   = 600; // between batches to avoid rate limits

// Optional --level filter (e.g. --level N5)
const levelArg = (() => {
  const i = process.argv.indexOf("--level");
  return i !== -1 ? process.argv[i + 1] : null;
})();

// ── Fetch pending items ───────────────────────────────────────────────────────
async function fetchPending(offset) {
  let query = supabase
    .from("curriculum_items")
    .select("id, item_type, value, jlpt_level, core_meaning, onyomi, kunyomi, romaji, romaji_on, stroke_count, radical, part_of_speech")
    .is("mnemonic", null)
    .order("jlpt_level")
    .order("priority", { ascending: true, nullsFirst: false })
    .range(offset, offset + BATCH_SIZE - 1);

  if (levelArg) query = query.eq("jlpt_level", levelArg);

  const { data, error } = await query;
  if (error) throw new Error(`fetch failed: ${error.message}`);
  return data ?? [];
}

// ── Count pending ─────────────────────────────────────────────────────────────
async function countPending() {
  let query = supabase
    .from("curriculum_items")
    .select("*", { count: "exact", head: true })
    .is("mnemonic", null);
  if (levelArg) query = query.eq("jlpt_level", levelArg);
  const { count } = await query;
  return count ?? 0;
}

// ── Build prompt for a batch ──────────────────────────────────────────────────
function buildPrompt(items) {
  const list = items.map((item, i) => {
    if (item.item_type === "kanji") {
      const on  = (item.onyomi  || []).join(", ") || "—";
      const kun = (item.kunyomi || []).join(", ") || "—";
      return `${i + 1}. KANJI ${item.value} | meaning: ${item.core_meaning} | on: ${on} | kun: ${kun} | strokes: ${item.stroke_count ?? "?"} | radical: ${item.radical ?? "?"}`;
    } else {
      return `${i + 1}. WORD ${item.value} | reading: ${item.romaji ?? "?"} | meaning: ${item.core_meaning} | pos: ${item.part_of_speech ?? "noun"}`;
    }
  }).join("\n");

  return `Generate learning aids for these Japanese items. Return ONLY a JSON array with one object per item, same order.

Each object needs:
- "mnemonic": one vivid sentence ≤12 words. Kanji: use shape/strokes as visual story. Word: anchor meaning via sound or image. No JLPT mentions.
- "visual_components": array of 1-3 visual parts seen in character (kanji only). For words use ["N/A"].
- "search_tokens": space-separated string with the character/word, reading(s), meaning keywords, and common English variants.

Items:
${list}

JSON array only, no explanation:`;
}

// ── Call Claude ───────────────────────────────────────────────────────────────
async function enrichBatch(items) {
  const msg = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 700,
    messages:   [{ role: "user", content: buildPrompt(items) }],
  });

  const text = msg.content[0]?.text ?? "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON array in response. Got: ${text.slice(0, 300)}`);

  return JSON.parse(jsonMatch[0]);
}

// ── Apply enrichment to single item ──────────────────────────────────────────
async function applyEnrichment(item, data) {
  const visualComponents = (data.visual_components || []).filter(c => c !== "N/A");

  const { error } = await supabase
    .from("curriculum_items")
    .update({
      mnemonic:          data.mnemonic          || null,
      visual_components: visualComponents.length ? visualComponents : null,
      search_tokens:     data.search_tokens      || null,
      // AI content stays 'pending' — needs human review before 'approved'
      curation_status:   "pending",
    })
    .eq("id", item.id);

  if (error) throw new Error(`update failed for ${item.value}: ${error.message}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log(` KanjiDen Enrichment — Phase C`);
  console.log(` Model: ${MODEL}`);
  if (levelArg) console.log(` Filter: ${levelArg} only`);
  console.log("═══════════════════════════════════════════════════\n");

  const total = await countPending();
  console.log(`Items needing enrichment: ${total}`);
  if (!total) { console.log("Nothing to do."); return; }

  let processed = 0;
  let offset    = 0;
  let errors    = 0;
  const maxErrors = 5;

  while (true) {
    const items = await fetchPending(offset);
    if (!items.length) break;

    try {
      const enriched = await enrichBatch(items);

      for (let i = 0; i < items.length; i++) {
        if (!enriched[i]) continue;
        await applyEnrichment(items[i], enriched[i]);
        processed++;
      }

      process.stdout.write(`\r  ${processed}/${total} enriched (${errors} errors)`);
      offset += items.length;

      // Rate limit pause
      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err) {
      errors++;
      console.error(`\n  [error] batch offset ${offset}: ${err.message}`);
      offset += BATCH_SIZE; // skip this batch
      if (errors >= maxErrors) {
        console.error(`  Too many errors (${maxErrors}). Stopping.`);
        break;
      }
    }
  }

  console.log(`\n\n═══════════════════════════════════════════════════`);
  console.log(` ✅ Done!  ${processed} enriched  |  ${errors} errors`);
  if (errors > 0) console.log("    Re-run to retry failed batches.");
  console.log("═══════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("\n[FATAL]", err.message);
  process.exit(1);
});
