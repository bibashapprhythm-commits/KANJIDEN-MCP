#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// seed_canonical.js — Phase A + B seeder
// Downloads KANJIDIC2 + JMdict XML, inserts N5-N2 curriculum data.
// No Claude API calls — run enrich_items.js separately for Phase C.
//
// Usage: node src/scripts/seed_canonical.js
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import fs           from "fs";
import path         from "path";
import https        from "https";
import http         from "http";
import zlib         from "zlib";
import { fileURLToPath } from "url";
import { parseStringPromise } from "xml2js";
import { createClient }      from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, "../data");

const KANJIDIC2_URL  = "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz";
const JMDICT_URL     = "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz";
const KANJIDIC2_PATH = path.join(DATA_DIR, "kanjidic2.xml.gz");
const JMDICT_PATH    = path.join(DATA_DIR, "jmdict_e.gz");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── JLPT old 4-level → N-level ────────────────────────────────────────────────
const JLPT_MAP = { "4": "N5", "3": "N4", "2": "N3", "1": "N2" };

// ── Kangxi radical number → character ────────────────────────────────────────
// Only the 20 radicals seeded in our radicals table
const KANGXI_TO_CHAR = {
  9:   "亻",
  30:  "口",
  32:  "土",
  38:  "女",
  39:  "子",
  46:  "山",
  61:  "心",
  64:  "扌",
  72:  "日",
  74:  "月",
  75:  "木",
  85:  "氵",
  86:  "火",
  109: "目",
  128: "耳",
  149: "言",
  157: "足",
  167: "金",
};

// ── JMdict entity → replacement value ────────────────────────────────────────
const JMDICT_ENTITIES = {
  // JLPT (old 4-level → N-level string)
  "jlpt-4": "N5", "jlpt-3": "N4", "jlpt-2": "N3", "jlpt-1": "N2",
  // Part of speech → grammar tag values
  "n": "noun", "n-adv": "adverb", "n-suf": "suffix", "n-pref": "prefix",
  "n-t": "noun",
  "v1": "verb_ru", "v1-s": "verb_ru",
  "v5r": "verb_u", "v5k": "verb_u", "v5g": "verb_u", "v5s": "verb_u",
  "v5t": "verb_u", "v5n": "verb_u", "v5b": "verb_u", "v5m": "verb_u",
  "v5aru": "verb_u", "v5r-i": "verb_u", "v5u": "verb_u", "v5u-s": "verb_u",
  "v5k-s": "verb_u",
  "vk": "verb_irregular", "vs-i": "verb_irregular",
  "vs-s": "verb_u", "vs": "verb_u",
  "adj-i": "i_adjective", "adj-ix": "i_adjective",
  "adj-na": "na_adjective",
  "adv": "adverb", "adv-to": "adverb",
  "prt": "particle",
  "conj": "conjunction",
  "pref": "prefix",
  "suf": "suffix",
  "ctr": "counter",
  "int": "", "exp": "",
  // Misc / field tags — strip
  "P": "", "uk": "", "ek": "", "ik": "", "oK": "", "io": "", "iK": "",
  "ok": "", "oik": "", "arch": "", "col": "", "fam": "", "fem": "",
  "hon": "", "hum": "", "pol": "", "sl": "", "vulg": "", "id": "",
  "proverb": "", "quote": "", "rare": "", "obsc": "", "dated": "", "obs": "",
  "sens": "", "derog": "", "joc": "",
  "MA": "", "comp": "", "food": "", "mus": "", "math": "", "med": "",
  "biol": "", "chem": "", "physics": "", "law": "", "ling": "", "mil": "",
};

// ── N5 Kanji — Phase B curated tag map ───────────────────────────────────────
// Tags: semantic + visual_group + cognitive + frequency (within N5)
// Priority: 1 = first to teach within N5
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

  // Katakana → hiragana (offset 0x60)
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
    if (s[i] === "っ") {
      const nextRomaji = MAP[s[i + 1]] || "";
      result += nextRomaji[0] || "";
      i++;
      continue;
    }
    result += MAP[s[i]] || s[i];
    i++;
  }
  return result;
}

// ── Download with redirect support ────────────────────────────────────────────
async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) {
    console.log(`  [cached] ${path.basename(destPath)}`);
    return;
  }
  console.log(`  [download] ${url}`);

  const download = (u) =>
    new Promise((resolve, reject) => {
      const proto = u.startsWith("https") ? https : http;
      const file  = fs.createWriteStream(destPath);

      proto.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.destroy();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          download(res.headers.location).then(resolve, reject);
          return;
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      }).on("error", (err) => {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
    });

  await download(url);
  console.log(`  [done] ${path.basename(destPath)}`);
}

// ── Parse KANJIDIC2 ───────────────────────────────────────────────────────────
async function parseKanjidic2(gzipPath) {
  console.log("  Decompressing KANJIDIC2...");
  const compressed = fs.readFileSync(gzipPath);
  const xml        = zlib.gunzipSync(compressed).toString("utf8");

  console.log("  Parsing XML...");
  const parsed = await parseStringPromise(xml, { explicitArray: true });

  const rows = [];
  for (const char of parsed.kanjidic2.character) {
    const literal = char.literal[0];
    const misc    = char.misc?.[0] ?? {};

    const jlptOld   = misc.jlpt?.[0];
    const jlptLevel = jlptOld ? JLPT_MAP[jlptOld] : null;
    if (!jlptLevel) continue;

    const rmgroup  = char.reading_meaning?.[0]?.rmgroup?.[0] ?? {};
    const readings = rmgroup.reading ?? [];
    const rawMeans = rmgroup.meaning ?? [];

    const onyomi = readings
      .filter(r => r.$?.r_type === "ja_on")
      .map(r => (typeof r === "string" ? r : r._))
      .filter(Boolean);

    const kunyomi = readings
      .filter(r => r.$?.r_type === "ja_kun")
      .map(r => (typeof r === "string" ? r : r._)
        .replace(/\..*$/, "")
        .replace(/^-|-$/g, ""))
      .filter(Boolean);

    const englishMeanings = rawMeans
      .filter(m => !m.$ || !m.$.m_lang || m.$.m_lang === "en")
      .map(m => (typeof m === "string" ? m : m._))
      .filter(Boolean);

    const strokeCount = parseInt(misc.stroke_count?.[0]) || null;
    const freq        = parseInt(misc.freq?.[0])          || null;

    // Kangxi radical number → character
    const radVals      = char.radical?.[0]?.rad_value ?? [];
    const classicalRad = radVals.find(rv => rv.$?.rad_type === "classical");
    const radNum       = classicalRad
      ? parseInt(typeof classicalRad === "string" ? classicalRad : classicalRad._)
      : null;
    const radChar = KANGXI_TO_CHAR[radNum] || null;

    const romaji_on  = onyomi.map(kanaToRomaji);
    const romaji_kun = kunyomi.map(kanaToRomaji);

    // Phase B: merge curated tags + auto-generated tags
    const curation = N5_CURATION[literal] ?? null;
    const autoTags = [jlptLevel];
    if (freq !== null) {
      autoTags.push(
        freq <= 500  ? "very_high" :
        freq <= 1500 ? "high"      :
        freq <= 3000 ? "medium"    : "low"
      );
    }
    const tags = curation
      ? [...new Set([...curation.tags, ...autoTags])]
      : autoTags;

    rows.push({
      item_type:        "kanji",
      value:            literal,
      jlpt_level:       jlptLevel,
      onyomi:           onyomi.length   ? onyomi   : null,
      kunyomi:          kunyomi.length  ? kunyomi  : null,
      romaji_on:        romaji_on.length  ? romaji_on  : null,
      romaji_kun:       romaji_kun.length ? romaji_kun : null,
      stroke_count:     strokeCount,
      frequency_rank:   freq,
      radical:          radChar,
      primary_radical:  radChar,
      core_meaning:     englishMeanings[0] ?? "",
      reading_hiragana: kunyomi[0] ?? null,
      reading_katakana: onyomi[0]  ?? null,
      romaji:           romaji_kun[0] ?? romaji_on[0] ?? null,
      tags,
      is_core:          jlptLevel === "N5",
      priority:         curation?.priority ?? null,
      source_dataset:   "kanjidic2",
      source_version:   "2024",
      source_reference: "https://www.edrdg.org/kanjidic/kanjidic2.html",
      curation_status:  "auto_accepted",
      seeded_by:        "seed_canonical_v1",
      // temp field for kanji_radicals step — stripped before DB insert
      _radical_num:     radNum,
    });
  }

  return rows;
}

// ── JMdict entity replacement ─────────────────────────────────────────────────
function applyEntities(xml) {
  let s = xml;
  for (const [entity, val] of Object.entries(JMDICT_ENTITIES)) {
    s = s.replaceAll(`&${entity};`, val);
  }
  // Preserve standard XML entities (&amp; &lt; etc.), strip remaining custom ones
  s = s.replace(/&(?!(amp|lt|gt|apos|quot);)[a-zA-Z0-9_-]+;/g, "");
  return s;
}

function extractFirst(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}

function extractAll(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g"))]
    .map(m => m[1].trim());
}

const GRAMMAR_TAG_SET = new Set([
  "noun","verb_u","verb_ru","verb_irregular",
  "i_adjective","na_adjective","adverb","particle",
  "conjunction","prefix","suffix","counter",
]);

function parseJMdictEntry(rawXml) {
  const xml   = applyEntities(rawXml);
  const keb   = extractFirst(xml, "keb");
  const reb   = extractFirst(xml, "reb");
  const value = keb || reb;
  if (!value) return null;

  const allMisc   = extractAll(xml, "misc");
  const jlptLevel = allMisc.find(m => /^N[1-5]$/.test(m));
  if (!jlptLevel) return null;

  const altForms = [
    ...extractAll(xml, "keb").slice(1),
    ...extractAll(xml, "reb").slice(1),
  ].filter(f => f !== value);

  const allPos     = extractAll(xml, "pos");
  const glosses    = extractAll(xml, "gloss");
  const priorities = extractAll(xml, "ke_pri").concat(extractAll(xml, "re_pri"));
  const isHighPri  = priorities.some(p => ["ichi1","news1","spec1"].includes(p));

  const grammarTags = [...new Set(allPos.filter(p => GRAMMAR_TAG_SET.has(p)))];
  const verbType    = allPos.includes("verb_irregular") ? "irregular"
    : allPos.includes("verb_ru") ? "verb_ru"
    : allPos.includes("verb_u")  ? "verb_u"
    : null;

  return {
    value,
    reading:      reb || "",
    altForms,
    jlptLevel,
    grammarTags,
    verbType,
    partOfSpeech: allPos[0] || null,
    coreMeaning:  glosses[0] || "",
    isHighPri,
  };
}

// ── Stream JMdict entries ─────────────────────────────────────────────────────
async function parseJMdict(gzipPath) {
  console.log("  Streaming JMdict (this takes ~1 min on Raspberry Pi)...");

  return new Promise((resolve, reject) => {
    const entries = [];
    let buffer    = "";
    let inEntry   = false;
    let entryBuf  = "";
    let count     = 0;

    const fileStream = fs.createReadStream(gzipPath);
    const gunzip     = zlib.createGunzip();
    fileStream.pipe(gunzip);

    gunzip.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      while (true) {
        if (!inEntry) {
          const start = buffer.indexOf("<entry>");
          if (start === -1) {
            buffer = buffer.slice(-20); // keep tail in case tag spans chunk boundary
            break;
          }
          inEntry  = true;
          entryBuf = buffer.slice(start);
          buffer   = "";
        } else {
          const combined = entryBuf + buffer;
          const end      = combined.indexOf("</entry>");
          if (end === -1) {
            entryBuf = combined;
            buffer   = "";
            break;
          }

          const entryXml = combined.slice(0, end + 8);
          buffer   = combined.slice(end + 8);
          entryBuf = "";
          inEntry  = false;

          if (entryXml.includes("&jlpt-")) {
            const parsed = parseJMdictEntry(entryXml);
            if (parsed) {
              entries.push(parsed);
              count++;
              if (count % 500 === 0) process.stdout.write(`\r  ${count} vocab found...`);
            }
          }
        }
      }
    });

    gunzip.on("end", () => {
      process.stdout.write(`\r  ${count} vocab entries found      \n`);
      resolve(entries);
    });
    gunzip.on("error", reject);
    fileStream.on("error", reject);
  });
}

// ── Batch upsert ──────────────────────────────────────────────────────────────
async function upsertBatch(rows) {
  if (!rows.length) return;
  const { error } = await supabase
    .from("curriculum_items")
    .upsert(rows, { onConflict: "item_type,value", ignoreDuplicates: false });
  if (error) throw new Error(`upsert error: ${error.message}`);
}

// ── Link kanji → radicals ─────────────────────────────────────────────────────
async function insertKanjiRadicals(kanjiRows) {
  const { data: radRows } = await supabase.from("radicals").select("id, radical");
  const radMap = new Map((radRows ?? []).map(r => [r.radical, r.id]));

  const chars = kanjiRows.map(k => k.value);
  const { data: inserted, error } = await supabase
    .from("curriculum_items")
    .select("id, value, radical")
    .eq("item_type", "kanji")
    .in("value", chars);
  if (error) { console.warn("  kanji_radicals fetch failed:", error.message); return; }

  const relRows = [];
  for (const kanji of inserted ?? []) {
    if (!kanji.radical || !radMap.has(kanji.radical)) continue;
    relRows.push({
      kanji_id:   kanji.id,
      radical_id: radMap.get(kanji.radical),
      is_primary: true,
      role_type:  "primary",
    });
  }

  if (!relRows.length) { console.log("  No radical links to insert"); return; }

  // Idempotent: delete existing then insert fresh
  const kanjiIds = relRows.map(r => r.kanji_id);
  await supabase.from("kanji_radicals").delete().in("kanji_id", kanjiIds);

  const { error: insertErr } = await supabase.from("kanji_radicals").insert(relRows);
  if (insertErr) console.warn("  kanji_radicals insert warning:", insertErr.message);
  else console.log(`  Linked ${relRows.length} kanji ↔ radical relationships`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log(" KanjiDen Canonical Seeder — Phase A + B");
  console.log("═══════════════════════════════════════════════════\n");

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 1. Download
  console.log("[1/5] Downloading source data...");
  await downloadFile(KANJIDIC2_URL, KANJIDIC2_PATH);
  await downloadFile(JMDICT_URL, JMDICT_PATH);

  // 2. Parse kanji
  console.log("\n[2/5] Parsing KANJIDIC2...");
  const kanjiRows = await parseKanjidic2(KANJIDIC2_PATH);
  console.log(`  Total JLPT kanji: ${kanjiRows.length}`);
  for (const l of ["N5","N4","N3","N2"]) {
    console.log(`    ${l}: ${kanjiRows.filter(k => k.jlpt_level === l).length}`);
  }

  // 3. Parse vocab
  console.log("\n[3/5] Parsing JMdict...");
  const jmdictEntries = await parseJMdict(JMDICT_PATH);
  for (const l of ["N5","N4","N3","N2"]) {
    console.log(`    ${l}: ${jmdictEntries.filter(e => e.jlptLevel === l).length} vocab`);
  }

  // Build kotoba rows
  const kotobaRows = jmdictEntries.map(e => ({
    item_type:        "kotoba",
    value:            e.value,
    jlpt_level:       e.jlptLevel,
    reading_hiragana: e.reading || null,
    romaji:           e.reading ? kanaToRomaji(e.reading) : null,
    alt_forms:        e.altForms.length ? e.altForms : null,
    core_meaning:     e.coreMeaning,
    tags:             [...new Set([e.jlptLevel, ...e.grammarTags, e.isHighPri ? "very_high" : "high"])],
    is_core:          e.jlptLevel === "N5" && e.isHighPri,
    part_of_speech:   e.partOfSpeech,
    verb_type:        e.verbType,
    source_dataset:   "jmdict",
    source_version:   "2024",
    source_reference: "https://www.edrdg.org/jmdict/j_jmdict.html",
    curation_status:  "auto_accepted",
    seeded_by:        "seed_canonical_v1",
  }));

  // 4. Insert
  console.log("\n[4/5] Inserting curriculum items...");
  const BATCH = 100;

  // Strip temp _radical_num field before DB insert
  const kanjiInsert = kanjiRows.map(({ _radical_num, ...rest }) => rest);

  console.log(`  Kanji: ${kanjiInsert.length} items`);
  for (let i = 0; i < kanjiInsert.length; i += BATCH) {
    await upsertBatch(kanjiInsert.slice(i, i + BATCH));
    process.stdout.write(`\r  ${Math.min(i + BATCH, kanjiInsert.length)}/${kanjiInsert.length} kanji`);
  }
  console.log("");

  console.log(`  Kotoba: ${kotobaRows.length} items`);
  for (let i = 0; i < kotobaRows.length; i += BATCH) {
    await upsertBatch(kotobaRows.slice(i, i + BATCH));
    process.stdout.write(`\r  ${Math.min(i + BATCH, kotobaRows.length)}/${kotobaRows.length} kotoba`);
  }
  console.log("");

  // 5. Radical links
  console.log("\n[5/5] Linking kanji ↔ radicals...");
  await insertKanjiRadicals(kanjiRows);

  // Summary
  const { count } = await supabase
    .from("curriculum_items")
    .select("*", { count: "exact", head: true });

  console.log("\n═══════════════════════════════════════════════════");
  console.log(` ✅ Done! ${count} total items in curriculum_items`);
  console.log(`    ${kanjiInsert.length} kanji  |  ${kotobaRows.length} kotoba`);
  console.log("    Next step: node src/scripts/enrich_items.js");
  console.log("═══════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("\n[FATAL]", err.message);
  process.exit(1);
});
