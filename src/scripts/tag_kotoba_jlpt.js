#!/usr/bin/env node
// tag_kotoba_jlpt.js — Phase B: Tag kotoba jlpt_level from Waller CSVs + Yomitan meta banks.
// Source 1: resources/vocab-level/original_data/n{1-5}.csv — match by source_reference (jmdict seq)
// Source 2: resources/vocab-level/yomitan-jlpt-vocab/term_meta_bank_*.json — match by value+reading

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES  = resolve(__dirname, "../../resources");
const CSV_DIR    = join(RESOURCES, "vocab-level/original_data");
const YOMITAN_DIR = join(RESOURCES, "vocab-level/yomitan-jlpt-vocab");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const PAGE_SIZE    = 1000;
const UPDATE_BATCH = 200;

// ── Source 1: CSV → Map<wordId, jlpt_level> ──────────────────────────────────

function loadCsvMap() {
  const map = new Map();
  for (const level of ["n5", "n4", "n3", "n2", "n1"]) {
    const text  = readFileSync(join(CSV_DIR, `${level}.csv`), "utf8");
    const lines = text.replace(/\r/g, "").trim().split("\n");
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const wordId = lines[i].split(",")[0]?.trim();
      if (wordId) { map.set(wordId, level.toUpperCase()); count++; }
    }
    console.log(`[LOAD] ${level}.csv → ${count} entries`);
  }
  return map;
}

// ── Source 2: Yomitan → Map<"word+reading", {jlpt_level, frequency_rank}> ───

function loadYomitanMap() {
  const map   = new Map();
  const files = readdirSync(YOMITAN_DIR)
    .filter(f => f.startsWith("term_meta_bank_") && f.endsWith(".json"))
    .sort();

  for (const file of files) {
    const entries = JSON.parse(readFileSync(join(YOMITAN_DIR, file), "utf8"));
    let count = 0;
    for (const entry of entries) {
      const [word, type, meta] = entry;
      if (type !== "freq" || !meta || typeof meta !== "object") continue;

      const reading      = meta.reading ?? "";
      const displayValue = meta.frequency?.displayValue ?? "";
      const freqValue    = meta.frequency?.value ?? -1;

      const lvlMatch = displayValue.match(/N([12345])/);
      if (!lvlMatch) continue;

      const key = `${word}+${reading}`;
      if (!map.has(key)) {
        map.set(key, {
          jlpt_level:     `N${lvlMatch[1]}`,
          frequency_rank: freqValue > 0 ? freqValue : null,
        });
        count++;
      }
    }
    console.log(`[LOAD] ${file} → ${count} entries`);
  }
  return map;
}

// ── Fetch kotoba page ─────────────────────────────────────────────────────────

async function fetchPage(offset) {
  const { data, error } = await supabase
    .from("curriculum_items")
    .select("id, value, reading_hiragana, source_reference, jlpt_level, tags, frequency_rank")
    .eq("item_type", "kotoba")
    .is("jlpt_level", null)
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw new Error(`fetch failed: ${error.message}`);
  return data ?? [];
}

// ── Batch update ──────────────────────────────────────────────────────────────

async function flushBatch(updates, batchNum, totalBatches) {
  const results = await Promise.all(
    updates.map(({ id, jlpt_level, frequency_rank, tags }) =>
      supabase
        .from("curriculum_items")
        .update({ jlpt_level, frequency_rank, tags })
        .eq("id", id)
    )
  );
  const errCount = results.filter(r => r.error).length;
  if (errCount) console.error(`  [WARN] ${errCount} update errors in batch ${batchNum}`);
  console.log(`[UPDATE] batch ${batchNum}/${totalBatches} → ${updates.length} rows`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const csvMap     = loadCsvMap();
  const yomitanMap = loadYomitanMap();

  let offset       = 0;
  let csvMatched   = 0;
  let jsonMatched  = 0;
  let unmatched    = 0;
  let freqUpdated  = 0;
  const pending    = [];

  while (true) {
    const rows = await fetchPage(offset);
    if (!rows.length) break;

    for (const row of rows) {
      const srcRef = row.source_reference != null ? String(row.source_reference) : null;
      const yomKey = `${row.value}+${row.reading_hiragana ?? ""}`;

      let jlpt_level     = null;
      let frequency_rank = row.frequency_rank ?? null;

      if (srcRef && csvMap.has(srcRef)) {
        jlpt_level = csvMap.get(srcRef);
        console.log(`[MATCH CSV] ${row.value} (${srcRef}) → ${jlpt_level}`);
        csvMatched++;
      } else if (yomitanMap.has(yomKey)) {
        const yom  = yomitanMap.get(yomKey);
        jlpt_level = yom.jlpt_level;
        if (yom.frequency_rank !== null) {
          frequency_rank = yom.frequency_rank;
          freqUpdated++;
          console.log(`[MATCH JSON] ${row.value}+${row.reading_hiragana} → ${jlpt_level}, freq: ${yom.frequency_rank}`);
        } else {
          console.log(`[MATCH JSON] ${row.value}+${row.reading_hiragana} → ${jlpt_level}`);
        }
        jsonMatched++;
      } else {
        unmatched++;
        continue;
      }

      const existingTags = Array.isArray(row.tags) ? row.tags : [];
      const newTags = existingTags.includes(jlpt_level)
        ? existingTags
        : [...existingTags, jlpt_level];

      pending.push({ id: row.id, jlpt_level, frequency_rank, tags: newTags });
    }

    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }

  const totalBatches = Math.ceil(pending.length / UPDATE_BATCH) || 1;
  let totalUpdated = 0;
  for (let i = 0; i < pending.length; i += UPDATE_BATCH) {
    const batch    = pending.slice(i, i + UPDATE_BATCH);
    const batchNum = Math.floor(i / UPDATE_BATCH) + 1;
    await flushBatch(batch, batchNum, totalBatches);
    totalUpdated += batch.length;
  }

  console.log("\n[DONE]");
  console.log(`  CSV matched:       ${csvMatched}`);
  console.log(`  JSON matched:      ${jsonMatched}`);
  console.log(`  Unmatched:         ${unmatched}`);
  console.log(`  Total updated:     ${totalUpdated}`);
  console.log(`  frequency_rank updated: ${freqUpdated}`);
}

main().catch(err => {
  console.error("\n[FATAL]", err.message);
  process.exit(1);
});
