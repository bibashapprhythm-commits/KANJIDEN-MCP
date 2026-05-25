#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// seed_canonical.js — v2
// Source: jmdict-simplified 3.6.2 (JSON, no XML, no downloads)
// Usage:  node src/scripts/seed_canonical.js
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient }  from "@supabase/supabase-js";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES  = path.join(__dirname, "../../resources");
const VERSION    = "3.6.2";

const FILE = {
  kanjidic2: path.join(RESOURCES, `kanjidic2-en-${VERSION}.json`),
  jmdict:    path.join(RESOURCES, `jmdict-eng-${VERSION}.json`),
  examples:  path.join(RESOURCES, `jmdict-examples-eng-${VERSION}.json`),
  kradfile:  path.join(RESOURCES, `kradfile-${VERSION}.json`),
};

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── Constants ─────────────────────────────────────────────────────────────────

// kanjidic2 jlptLevel is integer: 4=N5 3=N4 2=N3 1=N2
const JLPT_INT_MAP = { 4: "N5", 3: "N4", 2: "N3", 1: "N2" };

const KANGXI_TO_CHAR = {
  9:   "亻", 30:  "口", 32:  "土", 38:  "女", 39:  "子",
  46:  "山", 61:  "心", 64:  "扌", 72:  "日", 74:  "月",
  75:  "木", 85:  "氵", 86:  "火", 109: "目", 128: "耳",
  149: "言", 157: "足", 167: "金",
};

const POS_MAP = {
  "n":      "noun",             "n-adv":  "adverb",
  "n-suf":  "suffix",          "n-pref": "prefix",   "n-t": "noun",
  "v1":     "verb_ru",         "v1-s":   "verb_ru",
  "v5r":    "verb_u",          "v5k":    "verb_u",   "v5g":   "verb_u",
  "v5s":    "verb_u",          "v5t":    "verb_u",   "v5n":   "verb_u",
  "v5b":    "verb_u",          "v5m":    "verb_u",   "v5aru": "verb_u",
  "v5r-i":  "verb_u",          "v5u":    "verb_u",   "v5u-s": "verb_u",
  "v5k-s":  "verb_u",          "vs-s":   "verb_u",   "vs":    "verb_u",
  "vk":     "verb_irregular",  "vs-i":   "verb_irregular",
  "adj-i":  "i_adjective",     "adj-ix": "i_adjective",
  "adj-na": "na_adjective",
  "adv":    "adverb",          "adv-to": "adverb",
  "prt":    "particle",        "conj":   "conjunction",
  "pref":   "prefix",          "suf":    "suffix",   "ctr": "counter",
};

const GRAMMAR_TAG_SET = new Set(Object.values(POS_MAP).filter(Boolean));

// ── N5 Kanji — hand-curated tags + priority ───────────────────────────────────
const N5_CURATION = {
  "一": { tags: ["numbers","simple_shape","easy_shape","very_high"],              priority: 1  },
  "二": { tags: ["numbers","simple_shape","easy_shape","very_high"],              priority: 2  },
  "三": { tags: ["numbers","simple_shape","easy_shape","very_high"],              priority: 3  },
  "四": { tags: ["numbers","high"],                                               priority: 4  },
  "五": { tags: ["numbers","high"],                                               priority: 5  },
  "六": { tags: ["numbers","simple_shape","high"],                                priority: 6  },
  "七": { tags: ["numbers","simple_shape","high"],                                priority: 7  },
  "八": { tags: ["numbers","simple_shape","easy_shape","high"],                   priority: 8  },
  "九": { tags: ["numbers","simple_shape","high"],                                priority: 9  },
  "十": { tags: ["numbers","simple_shape","easy_shape","very_high"],              priority: 10 },
  "百": { tags: ["numbers","high"],                                               priority: 11 },
  "千": { tags: ["numbers","simple_shape","high"],                                priority: 12 },
  "万": { tags: ["numbers","simple_shape","high"],                                priority: 13 },
  "円": { tags: ["shopping","numbers","very_high"],                               priority: 14 },
  "年": { tags: ["time","very_high"],                                             priority: 15 },
  "月": { tags: ["time","nature","moon_月","very_high"],                           priority: 16 },
  "日": { tags: ["time","nature","sun_日","sun_radical","very_high"],              priority: 17 },
  "時": { tags: ["time","high"],                                                  priority: 18 },
  "分": { tags: ["time","high"],                                                  priority: 19 },
  "半": { tags: ["time","simple_shape","high"],                                   priority: 20 },
  "今": { tags: ["time","simple_shape","high"],                                   priority: 21 },
  "週": { tags: ["time","medium"],                                                priority: 22 },
  "人": { tags: ["people","simple_shape","easy_shape","person_亻","very_high"],   priority: 23 },
  "男": { tags: ["people","high"],                                                priority: 24 },
  "女": { tags: ["people","simple_shape","easy_shape","very_high"],               priority: 25 },
  "子": { tags: ["family","people","simple_shape","easy_shape","high"],           priority: 26 },
  "父": { tags: ["family","high"],                                                priority: 27 },
  "母": { tags: ["family","high"],                                                priority: 28 },
  "友": { tags: ["people","medium"],                                              priority: 29 },
  "山": { tags: ["nature","simple_shape","easy_shape","very_high"],               priority: 30 },
  "川": { tags: ["nature","simple_shape","easy_shape","high"],                    priority: 31 },
  "木": { tags: ["nature","tree_木","tree_radical","easy_shape","very_high"],      priority: 32 },
  "水": { tags: ["nature","water_氵","water_radical","easy_shape","very_high"],    priority: 33 },
  "火": { tags: ["nature","simple_shape","easy_shape","high"],                    priority: 34 },
  "金": { tags: ["nature","shopping","gold_金","very_high"],                       priority: 35 },
  "土": { tags: ["nature","time","similar_土士","high"],                           priority: 36 },
  "空": { tags: ["nature","weather","high"],                                      priority: 37 },
  "天": { tags: ["nature","weather","simple_shape","high"],                       priority: 38 },
  "雨": { tags: ["weather","nature","high"],                                      priority: 39 },
  "花": { tags: ["nature","high"],                                                priority: 40 },
  "学": { tags: ["school","very_high"],                                           priority: 41 },
  "校": { tags: ["school","high"],                                                priority: 42 },
  "先": { tags: ["school","time","high"],                                         priority: 43 },
  "生": { tags: ["school","people","very_high"],                                  priority: 44 },
  "語": { tags: ["school","speech_言","high"],                                     priority: 45 },
  "書": { tags: ["school","actions","high"],                                      priority: 46 },
  "読": { tags: ["school","actions","speech_言","high"],                           priority: 47 },
  "文": { tags: ["school","simple_shape","medium"],                               priority: 48 },
  "字": { tags: ["school","medium"],                                              priority: 49 },
  "聞": { tags: ["school","actions","mouth_口","high"],                            priority: 50 },
  "上": { tags: ["directions","simple_shape","easy_shape","very_high"],           priority: 51 },
  "下": { tags: ["directions","simple_shape","easy_shape","very_high"],           priority: 52 },
  "右": { tags: ["directions","mouth_radical","high"],                            priority: 53 },
  "左": { tags: ["directions","high","high_confusion_risk"],                      priority: 54 },
  "中": { tags: ["directions","simple_shape","very_high"],                        priority: 55 },
  "外": { tags: ["directions","high"],                                            priority: 56 },
  "前": { tags: ["directions","time","high"],                                     priority: 57 },
  "後": { tags: ["directions","time","high","hard_reading"],                      priority: 58 },
  "東": { tags: ["directions","places","tree_radical","high"],                    priority: 59 },
  "西": { tags: ["directions","places","high"],                                   priority: 60 },
  "南": { tags: ["directions","places","high"],                                   priority: 61 },
  "北": { tags: ["directions","places","high","high_confusion_risk"],             priority: 62 },
  "国": { tags: ["places","government","high"],                                   priority: 63 },
  "行": { tags: ["actions","very_high"],                                          priority: 64 },
  "来": { tags: ["actions","very_high"],                                          priority: 65 },
  "見": { tags: ["actions","body","very_high"],                                   priority: 66 },
  "食": { tags: ["food","actions","very_high"],                                   priority: 67 },
  "飲": { tags: ["food","actions","high"],                                        priority: 68 },
  "話": { tags: ["actions","speech_言","high"],                                    priority: 69 },
  "出": { tags: ["actions","simple_shape","high"],                                priority: 70 },
  "入": { tags: ["actions","simple_shape","high"],                                priority: 71 },
  "帰": { tags: ["actions","home","high"],                                        priority: 72 },
  "買": { tags: ["shopping","actions","high"],                                    priority: 73 },
  "手": { tags: ["body","hand_扌","easy_shape","very_high"],                       priority: 74 },
  "目": { tags: ["body","sun_radical","easy_shape","very_high"],                  priority: 75 },
  "耳": { tags: ["body","medium"],                                                priority: 76 },
  "口": { tags: ["body","mouth_口","mouth_radical","easy_shape","very_high"],      priority: 77 },
  "足": { tags: ["body","high"],                                                  priority: 78 },
  "大": { tags: ["simple_shape","similar_犬大","very_high"],                       priority: 79 },
  "小": { tags: ["simple_shape","easy_shape","very_high"],                        priority: 80 },
  "高": { tags: ["shopping","very_high"],                                         priority: 81 },
  "安": { tags: ["shopping","emotion","high"],                                    priority: 82 },
  "新": { tags: ["time","high"],                                                  priority: 83 },
  "古": { tags: ["time","medium"],                                                priority: 84 },
  "長": { tags: ["high"],                                                         priority: 85 },
  "本": { tags: ["culture","school","very_high"],                                 priority: 86 },
  "何": { tags: ["very_high"],                                                    priority: 87 },
  "気": { tags: ["emotion","health","very_high"],                                 priority: 88 },
  "白": { tags: ["simple_shape","high"],                                          priority: 89 },
  "黒": { tags: ["high"],                                                         priority: 90 },
  "赤": { tags: ["high"],                                                         priority: 91 },
  "青": { tags: ["nature","high"],                                                priority: 92 },
};

// ── Kana → Hepburn romaji ─────────────────────────────────────────────────────
function kanaToRomaji(text) {
  if (!text) return "";
  let s = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    s += c >= 0x30A1 && c <= 0x30F6 ? String.fromCharCode(c - 0x60) : ch;
  }
  const MAP = {
    "きゃ":"kya","きゅ":"kyu","きょ":"kyo","しゃ":"sha","しゅ":"shu","しょ":"sho",
    "ちゃ":"cha","ちゅ":"chu","ちょ":"cho","にゃ":"nya","にゅ":"nyu","にょ":"nyo",
    "ひゃ":"hya","ひゅ":"hyu","ひょ":"hyo","みゃ":"mya","みゅ":"myu","みょ":"myo",
    "りゃ":"rya","りゅ":"ryu","りょ":"ryo","ぎゃ":"gya","ぎゅ":"gyu","ぎょ":"gyo",
    "じゃ":"ja", "じゅ":"ju", "じょ":"jo", "びゃ":"bya","びゅ":"byu","びょ":"byo",
    "ぴゃ":"pya","ぴゅ":"pyu","ぴょ":"pyo","ふぁ":"fa", "ふぃ":"fi", "ふぇ":"fe","ふぉ":"fo",
    "あ":"a","い":"i","う":"u","え":"e","お":"o",
    "か":"ka","き":"ki","く":"ku","け":"ke","こ":"ko",
    "さ":"sa","し":"shi","す":"su","せ":"se","そ":"so",
    "た":"ta","ち":"chi","つ":"tsu","て":"te","と":"to",
    "な":"na","に":"ni","ぬ":"nu","ね":"ne","の":"no",
    "は":"ha","ひ":"hi","ふ":"fu","へ":"he","ほ":"ho",
    "ま":"ma","み":"mi","む":"mu","め":"me","も":"mo",
    "や":"ya","ゆ":"yu","よ":"yo",
    "ら":"ra","り":"ri","る":"ru","れ":"re","ろ":"ro",
    "わ":"wa","を":"wo","ん":"n",
    "が":"ga","ぎ":"gi","ぐ":"gu","げ":"ge","ご":"go",
    "ざ":"za","じ":"ji","ず":"zu","ぜ":"ze","ぞ":"zo",
    "だ":"da","ぢ":"ji","づ":"zu","で":"de","ど":"do",
    "ば":"ba","び":"bi","ぶ":"bu","べ":"be","ぼ":"bo",
    "ぱ":"pa","ぴ":"pi","ぷ":"pu","ぺ":"pe","ぽ":"po",
  };
  let result = "";
  let i = 0;
  while (i < s.length) {
    const two = s[i] + (s[i + 1] || "");
    if (MAP[two]) { result += MAP[two]; i += 2; continue; }
    if (s[i] === "っ") { result += (MAP[s[i + 1]] || "")[0] || ""; i++; continue; }
    result += MAP[s[i]] || s[i];
    i++;
  }
  return result;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function upsertItems(rows) {
  if (!rows.length) return;
  const { error } = await supabase
    .from("curriculum_items")
    .upsert(rows, { onConflict: "item_type,value", ignoreDuplicates: false });
  if (error) throw new Error(`upsert curriculum_items: ${error.message}`);
}

async function insertBatch(table, rows) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw new Error(`insert ${table}: ${error.message}`);
}

// ── Parse: kanjidic2 + kradfile ───────────────────────────────────────────────
function parseKanjidic2() {
  console.log("  Reading kanjidic2-en + kradfile...");
  const data = JSON.parse(fs.readFileSync(FILE.kanjidic2, "utf8"));
  const krad = JSON.parse(fs.readFileSync(FILE.kradfile, "utf8")).kanji;
  const rows = [];

  for (const char of data.characters) {
    const literal    = char.literal;
    const misc       = char.misc || {};
    const jlptLevel  = JLPT_INT_MAP[misc.jlptLevel];
    if (!jlptLevel) continue;

    const groups      = char.readingMeaning?.groups || [];
    const allReadings = groups.flatMap(g => g.readings || []);
    const allMeanings = groups.flatMap(g => g.meanings || []);
    const nanori      = char.readingMeaning?.nanori || [];

    const onyomi  = allReadings.filter(r => r.type === "ja_on").map(r => r.value).filter(Boolean);
    const kunyomi = allReadings
      .filter(r => r.type === "ja_kun")
      .map(r => r.value.replace(/\..*$/, "").replace(/^-|-$/g, ""))
      .filter(Boolean);

    const englishMeanings = allMeanings.filter(m => m.lang === "en").map(m => m.value).filter(Boolean);
    const strokeCount     = misc.strokeCounts?.[0] || null;
    const freq            = misc.frequency    || null;
    const grade           = misc.grade        || null;

    const classicalRad    = (char.radicals || []).find(r => r.type === "classical");
    const radNum          = classicalRad?.value || null;
    const radChar         = KANGXI_TO_CHAR[radNum] || null;
    const visualComponents = krad[literal] || null;

    const romaji_on  = onyomi.map(kanaToRomaji);
    const romaji_kun = kunyomi.map(kanaToRomaji);

    const curation = N5_CURATION[literal] || null;
    const autoTags = [jlptLevel];
    if (freq) autoTags.push(freq <= 500 ? "very_high" : freq <= 1500 ? "high" : freq <= 3000 ? "medium" : "low");
    const tags = curation ? [...new Set([...curation.tags, ...autoTags])] : autoTags;

    rows.push({
      item_type:         "kanji",
      value:             literal,
      jlpt_level:        jlptLevel,
      onyomi:            onyomi.length    ? onyomi    : null,
      kunyomi:           kunyomi.length   ? kunyomi   : null,
      nanori:            nanori.length    ? nanori    : null,
      romaji_on:         romaji_on.length  ? romaji_on  : null,
      romaji_kun:        romaji_kun.length ? romaji_kun : null,
      stroke_count:      strokeCount,
      frequency_rank:    freq,
      school_grade:      grade,
      radical:           radChar,
      primary_radical:   radChar,
      visual_components: visualComponents,
      core_meaning:      englishMeanings[0] || "",
      meaning_extended:  englishMeanings.slice(1).join("; ") || null,
      reading_hiragana:  kunyomi[0] || null,
      reading_katakana:  onyomi[0]  || null,
      romaji:            romaji_kun[0] || romaji_on[0] || null,
      tags,
      is_core:           jlptLevel === "N5",
      priority:          curation?.priority || null,
      source_dataset:    "kanjidic2",
      source_version:    VERSION,
      source_reference:  "scriptin/jmdict-simplified",
      curation_status:   "auto_accepted",
      seeded_by:         "seed_canonical_v2",
      // temp fields stripped before upsert
      _radical_num:      radNum,
      _visual_components: visualComponents,
    });
  }

  return rows;
}

// ── Parse: jmdict common vocab ────────────────────────────────────────────────
function parseJmdict() {
  console.log("  Reading jmdict-eng (common words only)...");
  const data = JSON.parse(fs.readFileSync(FILE.jmdict, "utf8"));
  const rows = [];

  for (const word of data.words) {
    const isCommon = (word.kanji || []).some(k => k.common) || (word.kana || []).some(k => k.common);
    if (!isCommon) continue;

    const primaryKanji = (word.kanji || []).find(k => k.common);
    const primaryKana  = (word.kana  || []).find(k => k.common);
    const value        = primaryKanji?.text || primaryKana?.text;
    if (!value) continue;

    const reading  = primaryKana?.text || null;
    const altForms = [
      ...(word.kanji || []).filter(k => k.text !== value).map(k => k.text),
      ...(word.kana  || []).filter(k => k.text !== reading && k.text !== value).map(k => k.text),
    ].filter(Boolean);

    const firstSense  = word.sense?.[0] || {};
    const posCodes    = firstSense.partOfSpeech || [];
    const grammarTags = [...new Set(posCodes.map(p => POS_MAP[p]).filter(t => t && GRAMMAR_TAG_SET.has(t)))];

    const verbType = posCodes.some(p => ["vk","vs-i"].includes(p))       ? "irregular"
      : posCodes.some(p => p === "v1" || p === "v1-s")                   ? "verb_ru"
      : posCodes.some(p => p.startsWith("v5") || ["vs-s","vs"].includes(p)) ? "verb_u"
      : null;

    const allGlosses = (word.sense || [])
      .flatMap(s => (s.gloss || []).filter(g => g.lang === "eng").map(g => g.text));

    rows.push({
      item_type:        "kotoba",
      value,
      jlpt_level:       null,   // enrichment pass will add JLPT once list is sourced
      reading_hiragana: reading,
      romaji:           reading ? kanaToRomaji(reading) : null,
      alt_forms:        altForms.length ? altForms : null,
      core_meaning:     allGlosses[0] || "",
      meaning_extended: allGlosses.slice(1, 5).join("; ") || null,
      part_of_speech:   POS_MAP[posCodes[0]] || posCodes[0] || null,
      verb_type:        verbType,
      tags:             grammarTags.length ? [...grammarTags, "high"] : ["high"],
      is_core:          false,
      source_dataset:   "jmdict",
      source_version:   VERSION,
      source_reference: word.id,   // jmdict word ID — used to link examples
      curation_status:  "auto_accepted",
      seeded_by:        "seed_canonical_v2",
    });
  }

  // Deduplicate by value — jmdict can have multiple entries mapping to same primary form
  const seen = new Set();
  return rows.filter(r => {
    if (seen.has(r.value)) return false;
    seen.add(r.value);
    return true;
  });
}

// ── Step: seed kanji_components ───────────────────────────────────────────────
async function seedKanjiComponents(kanjiRows) {
  const chars = kanjiRows.map(k => k.value);

  // Batch .in() to avoid URL-length 400s (PostgREST limit ~8KB)
  const IN_BATCH = 300;
  const allDbKanji = [];
  for (let i = 0; i < chars.length; i += IN_BATCH) {
    const { data: batch, error } = await supabase
      .from("curriculum_items")
      .select("id, value")
      .eq("item_type", "kanji")
      .in("value", chars.slice(i, i + IN_BATCH));
    if (error) throw new Error(`fetch kanji ids: ${error.message}`);
    allDbKanji.push(...(batch || []));
  }

  const valueToId     = new Map(allDbKanji.map(k => [k.value, k.id]));
  const componentRows = [];

  for (const kanji of kanjiRows) {
    const kanjiId = valueToId.get(kanji.value);
    if (!kanjiId || !kanji._visual_components) continue;
    kanji._visual_components.forEach((component, idx) => {
      componentRows.push({ kanji_id: kanjiId, component, position: idx, component_type: "radical" });
    });
  }

  if (!componentRows.length) return 0;

  const kanjiIds = [...new Set(componentRows.map(r => r.kanji_id))];
  await supabase.from("kanji_components").delete().in("kanji_id", kanjiIds);

  const BATCH = 200;
  for (let i = 0; i < componentRows.length; i += BATCH) {
    await insertBatch("kanji_components", componentRows.slice(i, i + BATCH));
  }
  return componentRows.length;
}

// ── Step: link kanji ↔ radicals ───────────────────────────────────────────────
async function insertKanjiRadicals(kanjiRows) {
  const { data: radRows } = await supabase.from("radicals").select("id, radical");
  const radMap = new Map((radRows || []).map(r => [r.radical, r.id]));

  const chars = kanjiRows.map(k => k.value);
  const IN_BATCH = 300;
  const inserted = [];
  for (let i = 0; i < chars.length; i += IN_BATCH) {
    const { data: batch } = await supabase
      .from("curriculum_items")
      .select("id, value, radical")
      .eq("item_type", "kanji")
      .in("value", chars.slice(i, i + IN_BATCH));
    inserted.push(...(batch || []));
  }

  const relRows = [];
  for (const kanji of inserted) {
    if (!kanji.radical || !radMap.has(kanji.radical)) continue;
    relRows.push({ kanji_id: kanji.id, radical_id: radMap.get(kanji.radical), is_primary: true, role_type: "primary" });
  }

  if (!relRows.length) { console.log("  No radical links"); return; }
  const kanjiIds = [...new Set(relRows.map(r => r.kanji_id))];
  // Batch delete to avoid URL-length 400 (UUIDs are long)
  const DEL_BATCH = 100;
  for (let i = 0; i < kanjiIds.length; i += DEL_BATCH) {
    await supabase.from("kanji_radicals").delete().in("kanji_id", kanjiIds.slice(i, i + DEL_BATCH));
  }
  const { error } = await supabase.from("kanji_radicals").insert(relRows);
  if (error) console.warn("  kanji_radicals warning:", error.message);
  else console.log(`  Linked ${relRows.length} kanji ↔ radicals`);
}

// ── Step: seed Tatoeba sentences ──────────────────────────────────────────────
async function seedExamples() {
  console.log("  Reading jmdict-examples-eng...");
  const data = JSON.parse(fs.readFileSync(FILE.examples, "utf8"));

  // Build map: jmdict word ID → curriculum_item UUID (paginate — default limit 1000)
  const PAGE = 1000;
  let from = 0;
  const kotobaItems = [];
  while (true) {
    const { data, error: fetchErr } = await supabase
      .from("curriculum_items")
      .select("id, source_reference")
      .eq("item_type", "kotoba")
      .eq("source_dataset", "jmdict")
      .range(from, from + PAGE - 1);
    if (fetchErr) throw new Error(`fetch kotoba ids: ${fetchErr.message}`);
    if (!data || data.length === 0) break;
    kotobaItems.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const refToId = new Map((kotobaItems || []).map(k => [k.source_reference, k.id]));
  console.log(`  Matching examples against ${refToId.size} seeded kotoba...`);

  const sentenceRows = [];
  for (const word of data.words) {
    const itemId = refToId.get(word.id);
    if (!itemId) continue;
    for (const sense of word.sense || []) {
      for (const ex of sense.examples || []) {
        const jpText = ex.sentences?.find(s => s.lang === "jpn")?.text;
        const enText = ex.sentences?.find(s => s.lang === "eng")?.text;
        if (!jpText || !enText) continue; // english is NOT NULL in schema
        sentenceRows.push({
          curriculum_item_id: itemId,
          japanese:           jpText,
          english:            enText,
          sentence_type:      "imported",
          generated_by:       "tatoeba",
          prompt_version:     ex.source?.value || null, // Tatoeba sentence ID
          validated:          false,
          curation_status:    "auto_accepted",
        });
      }
    }
  }

  if (!sentenceRows.length) return 0;

  // Clean existing imported sentences before re-seed (no unique constraint)
  console.log("  Clearing existing imported sentences...");
  await supabase.from("generated_sentences").delete().eq("sentence_type", "imported");

  const BATCH = 200;
  for (let i = 0; i < sentenceRows.length; i += BATCH) {
    await insertBatch("generated_sentences", sentenceRows.slice(i, i + BATCH));
    process.stdout.write(`\r  ${Math.min(i + BATCH, sentenceRows.length)}/${sentenceRows.length} sentences`);
  }
  console.log("");
  return sentenceRows.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log(" KanjiDen Canonical Seeder v2");
  console.log(` Source: jmdict-simplified ${VERSION}`);
  console.log("═══════════════════════════════════════════════════\n");

  // Verify all files present
  for (const [name, fp] of Object.entries(FILE)) {
    if (!fs.existsSync(fp)) {
      console.error(`[FATAL] Missing file: ${fp}`);
      console.error(`  Download from: github.com/scriptin/jmdict-simplified/releases`);
      process.exit(1);
    }
  }
  console.log("All source files found.\n");

  const BATCH = 200;

  // ── [1/5] Parse kanji ────────────────────────────────────────
  console.log("[1/5] Parsing kanjidic2...");
  const kanjiRows = parseKanjidic2();
  console.log(`  ${kanjiRows.length} JLPT kanji`);
  for (const l of ["N5","N4","N3","N2"])
    console.log(`    ${l}: ${kanjiRows.filter(k => k.jlpt_level === l).length}`);

  // ── [2/5] Upsert kanji ───────────────────────────────────────
  console.log("\n[2/5] Upserting kanji...");
  const kanjiInsert = kanjiRows.map(({ _radical_num, _visual_components, ...rest }) => rest);
  for (let i = 0; i < kanjiInsert.length; i += BATCH) {
    await upsertItems(kanjiInsert.slice(i, i + BATCH));
    process.stdout.write(`\r  ${Math.min(i + BATCH, kanjiInsert.length)}/${kanjiInsert.length} kanji`);
  }
  console.log("");

  // ── [3/5] Kanji components + radical links ───────────────────
  console.log("\n[3/5] Seeding kanji_components + radical links...");
  const compCount = await seedKanjiComponents(kanjiRows);
  console.log(`  ${compCount} component rows`);
  await insertKanjiRadicals(kanjiRows);

  // ── [4/5] Parse + upsert kotoba ──────────────────────────────
  console.log("\n[4/5] Parsing + upserting kotoba (common=true)...");
  const kotobaRows = parseJmdict();
  console.log(`  ${kotobaRows.length} common words`);
  for (let i = 0; i < kotobaRows.length; i += BATCH) {
    await upsertItems(kotobaRows.slice(i, i + BATCH));
    process.stdout.write(`\r  ${Math.min(i + BATCH, kotobaRows.length)}/${kotobaRows.length} kotoba`);
  }
  console.log("");

  // ── [5/5] Tatoeba sentences ──────────────────────────────────
  console.log("\n[5/5] Seeding Tatoeba examples...");
  const sentCount = await seedExamples();
  console.log(`  ${sentCount} sentences`);

  // ── Summary ──────────────────────────────────────────────────
  const { count: totalItems } = await supabase
    .from("curriculum_items")
    .select("*", { count: "exact", head: true });
  const { count: totalSents } = await supabase
    .from("generated_sentences")
    .select("*", { count: "exact", head: true });

  console.log("\n═══════════════════════════════════════════════════");
  console.log(` Done!`);
  console.log(`   ${totalItems} items  (${kanjiInsert.length} kanji + ${kotobaRows.length} kotoba)`);
  console.log(`   ${totalSents} sentences in generated_sentences`);
  console.log("   Next: node src/scripts/enrich_items.js");
  console.log("═══════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("\n[FATAL]", err.message);
  process.exit(1);
});
