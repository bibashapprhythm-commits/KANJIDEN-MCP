#!/usr/bin/env node
// Diagnostic: sample 20 unmatched kotoba, cross-reference against source data.

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

// ── Load CSV map ────────────────────────────────────────────────

function loadCsvMap() {
  const map = new Map();
  for (const level of ["n5", "n4", "n3", "n2", "n1"]) {
    const text  = readFileSync(join(CSV_DIR, `${level}.csv`), "utf8");
    const lines = text.replace(/\r/g, "").trim().split("\n");
    for (let i = 1; i < lines.length; i++) {
      const wordId = lines[i].split(",")[0]?.trim();
      if (wordId) map.set(wordId, { level: level.toUpperCase(), line: lines[i] });
    }
  }
  return map;
}

// ── Load Yomitan map ────────────────────────────────────────────

function loadYomitanMap() {
  const map = new Map();
  const files = readdirSync(YOMITAN_DIR)
    .filter(f => f.startsWith("term_meta_bank_") && f.endsWith(".json"))
    .sort();
  for (const file of files) {
    const entries = JSON.parse(readFileSync(join(YOMITAN_DIR, file), "utf8"));
    for (const entry of entries) {
      const [word, type, meta] = entry;
      if (type !== "freq" || !meta || typeof meta !== "object") continue;
      const reading = meta.reading ?? "";
      const displayValue = meta.frequency?.displayValue ?? "";
      const lvlMatch = displayValue.match(/N([12345])/);
      if (!lvlMatch) continue;
      const key = `${word}+${reading}`;
      if (!map.has(key)) {
        map.set(key, { level: `N${lvlMatch[1]}`, reading, file });
      }
    }
  }
  return map;
}

// ── Also build reverse maps for lookup by value alone ───────────

function loadCsvByValue() {
  const map = new Map(); // value → { level, reading, source_ref }
  for (const level of ["n5", "n4", "n3", "n2", "n1"]) {
    const text  = readFileSync(join(CSV_DIR, `${level}.csv`), "utf8");
    const lines = text.replace(/\r/g, "").trim().split("\n");
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      const wordId = parts[0]?.trim();
      const kana   = parts[1]?.trim();
      const kanji  = parts[2]?.trim();
      if (!wordId) continue;
      const value = kanji || kana;
      if (!map.has(value)) {
        map.set(value, { level: level.toUpperCase(), kana, kanji, source_ref: wordId });
      }
    }
  }
  return map;
}

function loadYomitanByValue() {
  const map = new Map(); // value → { level, reading, source }
  const files = readdirSync(YOMITAN_DIR)
    .filter(f => f.startsWith("term_meta_bank_") && f.endsWith(".json"))
    .sort();
  for (const file of files) {
    const entries = JSON.parse(readFileSync(join(YOMITAN_DIR, file), "utf8"));
    for (const entry of entries) {
      const [word, type, meta] = entry;
      if (type !== "freq" || !meta || typeof meta !== "object") continue;
      const displayValue = meta.frequency?.displayValue ?? "";
      const lvlMatch = displayValue.match(/N([12345])/);
      if (!lvlMatch) continue;
      if (!map.has(word)) {
        map.set(word, { level: `N${lvlMatch[1]}`, reading: meta.reading ?? "", file });
      }
    }
  }
  return map;
}

// ── Main diagnostic ─────────────────────────────────────────────

async function main() {
  console.log("Loading source data...");
  const csvMap       = loadCsvMap();
  const yomitanMap   = loadYomitanMap();
  const csvByValue   = loadCsvByValue();
  const yomitanByVal = loadYomitanByValue();
  console.log(`  CSV entries (by source_ref): ${csvMap.size}`);
  console.log(`  Yomitan entries (by value+reading): ${yomitanMap.size}\n`);

  // Fetch 20 random unmatched kotoba
  const { data, error } = await supabase
    .from("curriculum_items")
    .select("id, value, reading_hiragana, source_reference, jlpt_level")
    .eq("item_type", "kotoba")
    .is("jlpt_level", null)
    .limit(20);

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log("No unmatched kotoba found (jlpt_level IS NULL). Checking for ANY kotoba...");
    const { data: all, error: e2 } = await supabase
      .from("curriculum_items")
      .select("id, value, reading_hiragana, source_reference, jlpt_level")
      .eq("item_type", "kotoba")
      .limit(20);
    if (e2) throw e2;
    if (!all || all.length === 0) {
      console.log("No kotoba rows in the database at all.");
      process.exit(0);
    }
    console.log(`Found ${all.length} kotoba (all have jlpt_level set). Showing them anyway:\n`);
    printAnalysis(all, csvMap, yomitanMap, csvByValue, yomitanByVal);
    process.exit(0);
  }

  printAnalysis(data, csvMap, yomitanMap, csvByValue, yomitanByVal);
}

function printAnalysis(rows, csvMap, yomitanMap, csvByValue, yomitanByVal) {
  let csvDirect = 0, yomitanDirect = 0, csvByValOnly = 0, yomitanByValOnly = 0, notFound = 0;

  for (const row of rows) {
    const srcRef   = row.source_reference != null ? String(row.source_reference) : null;
    const yomKey   = `${row.value}+${row.reading_hiragana ?? ""}`;
    const csvHit   = srcRef ? csvMap.get(srcRef) : undefined;
    const yomHit   = yomitanMap.get(yomKey);
    const csvVal   = csvByValue.get(row.value);
    const yomVal   = yomitanByVal.get(row.value);

    console.log(`\n--- ${row.value} ---`);
    console.log(`  DB:        reading=${row.reading_hiragana ?? "(null)"}, source_ref=${srcRef ?? "(null)"}, jlpt=${row.jlpt_level}`);
    console.log(`  CSV key:   source_ref=${srcRef} → ${csvHit ? `FOUND in ${csvHit.level}` : "NOT FOUND"}`);
    console.log(`  Yomitan key: value+reading = ${yomKey} → ${yomHit ? `FOUND in ${yomHit.level}` : "NOT FOUND"}`);
    if (!csvHit && csvVal) {
      console.log(`  → CSV by value alone: FOUND as "${csvVal.kanji || csvVal.kana}" (ref=${csvVal.source_ref}, level=${csvVal.level}) — source_ref mismatch!`);
      csvByValOnly++;
    }
    if (!yomHit && yomVal) {
      console.log(`  → Yomitan by value alone: FOUND as "${yomVal.level}" with reading="${yomVal.reading}" — reading mismatch!`);
      yomitanByValOnly++;
    }
    if (!csvHit && !yomHit && !csvVal && !yomVal) {
      notFound++;
    }
    if (csvHit) csvDirect++;
    if (yomHit) yomitanDirect++;
  }

  console.log("\n═══════════════════════════════════════");
  console.log("SUMMARY");
  console.log(`  Direct CSV match (by source_ref):     ${csvDirect}`);
  console.log(`  Direct Yomitan match (by val+read):   ${yomitanDirect}`);
  console.log(`  Found in CSV (by value, not ref):     ${csvByValOnly}`);
  console.log(`  Found in Yomitan (by value, bad read):${yomitanByValOnly}`);
  console.log(`  Genuinely absent from both sources:   ${notFound}`);
  console.log(`  Total sampled:                        ${rows.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
