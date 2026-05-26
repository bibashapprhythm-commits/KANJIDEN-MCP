import { supabase } from "../db.js";

const VALID_TAGS = [
  // Semantic themes
  'directions','time','numbers','nature','body','people',
  'family','school','actions','food','weather','places',
  'work','emotion','shopping','transport','health',
  'government','culture','counter','building','money',
  // Learning flags
  'irregular_reading','similar_kanji','hard_reading',
  'easy_shape','simple_shape','high_confusion_risk',
  // Curriculum
  'dates','calendar','honorific','formal','prefix','suffix',
]

function hasReadingDuplicates(row) {
  const on  = row.romaji_on  ?? []
  const kun = row.romaji_kun ?? []
  return new Set(on).size !== on.length || new Set(kun).size !== kun.length
}

const QUALITY_THRESHOLDS = {
  meaning_extended:  (v) => typeof v === 'string' && v.length > 40,
  mnemonic:          (v) => typeof v === 'string' && v.length > 40,
  teaching_notes:    (v) => typeof v === 'string' && v.length > 60,
  compounds:         (v) => Array.isArray(v) && v.length >= 3,
  example_sentences: (v) => Array.isArray(v) && v.length >= 1,
  suggested_tags:    (v) => Array.isArray(v) && v.length >= 1,
}

function getNeeds(row) {
  const needs = []

  if (hasReadingDuplicates(row)) needs.push('readings_clean')

  for (const [field, isQuality] of Object.entries(QUALITY_THRESHOLDS)) {
    if (!isQuality(row[field])) needs.push(field)
  }

  return needs
}

function getStatus(row, needs) {
  if (!row) return 'not_found'
  if (needs.length === 0) return 'complete'

  const hasAnything =
    row.compounds?.length > 0 ||
    row.example_sentences?.length > 0 ||
    !!row.mnemonic ||
    !!row.teaching_notes ||
    !!row.meaning_extended ||
    row.suggested_tags?.length > 0

  return hasAnything ? 'partial' : 'empty'
}

export async function checkBulk({ items } = {}) {
  if (!items?.length) throw new Error("items required")

  const tuples = items.map(i => [i.value, i.jlpt_level])

  const { data: rows, error } = await supabase.rpc('get_items_by_value_jlpt', { pairs: tuples })

  // Fallback: if RPC not available, use individual .or() query
  let dbRows = rows
  if (error || !rows) {
    // Build OR filter manually
    const orFilters = items.map(i =>
      `and(value.eq.${i.value},jlpt_level.eq.${i.jlpt_level})`
    ).join(',')

    const { data: fallbackRows, error: fallbackErr } = await supabase
      .from('curriculum_items')
      .select('id, value, jlpt_level, onyomi, kunyomi, romaji_on, romaji_kun, meaning_extended, mnemonic, teaching_notes, compounds, example_sentences, suggested_tags')
      .eq('item_type', 'kanji')
      .not('onyomi', 'is', null)
      .or(orFilters)

    if (fallbackErr) throw new Error(`checkBulk failed: ${fallbackErr.message}`)
    dbRows = fallbackRows ?? []
  }

  // Key by value+jlpt for lookup
  const rowMap = {}
  for (const r of dbRows) {
    rowMap[`${r.value}|${r.jlpt_level}`] = r
  }

  const results = items.map(req => {
    const key = `${req.value}|${req.jlpt_level}`
    const row = rowMap[key] ?? null

    if (!row) {
      return { value: req.value, jlpt_level: req.jlpt_level, status: 'not_found', has: [], needs: [] }
    }

    const needs  = getNeeds(row)
    const status = getStatus(row, needs)

    return {
      id:         row.id,
      value:      row.value,
      jlpt_level: row.jlpt_level,
      status,
      has: Object.keys(QUALITY_THRESHOLDS).filter(field => QUALITY_THRESHOLDS[field](row[field])),
      needs,
      current_readings: {
        onyomi:     row.onyomi    ?? [],
        kunyomi:    row.kunyomi   ?? [],
        romaji_on:  row.romaji_on  ?? [],
        romaji_kun: row.romaji_kun ?? [],
      },
    }
  })

  return { checked: items.length, results }
}

function validateItem(item) {
  const { data } = item
  const errors = []

  if (data.onyomi_clean && data.romaji_on_clean) {
    if (data.onyomi_clean.length !== data.romaji_on_clean.length)
      errors.push('onyomi_clean and romaji_on_clean must be same length')
  }
  if (data.kunyomi_clean && data.romaji_kun_clean) {
    if (data.kunyomi_clean.length !== data.romaji_kun_clean.length)
      errors.push('kunyomi_clean and romaji_kun_clean must be same length')
  }

  if (data.compounds) {
    data.compounds.forEach((c, i) => {
      if (!c.value)   errors.push(`compounds[${i}] missing: value`)
      if (!c.reading) errors.push(`compounds[${i}] missing: reading`)
      if (!c.romaji)  errors.push(`compounds[${i}] missing: romaji`)
      if (!c.meaning) errors.push(`compounds[${i}] missing: meaning`)
      if (!c.jlpt)    errors.push(`compounds[${i}] missing: jlpt`)
    })
  }

  if (data.example_sentences) {
    data.example_sentences.forEach((s, i) => {
      if (!s.jp)      errors.push(`example_sentences[${i}] missing: jp`)
      if (!s.reading) errors.push(`example_sentences[${i}] missing: reading`)
      if (!s.romaji)  errors.push(`example_sentences[${i}] missing: romaji`)
      if (!s.en)      errors.push(`example_sentences[${i}] missing: en`)
    })
  }

  if (data.suggested_tags) {
    data.suggested_tags.forEach(tag => {
      if (!VALID_TAGS.includes(tag))
        errors.push(`suggested_tags: unknown tag "${tag}"`)
    })
  }

  const arrayFields = ['onyomi_clean','kunyomi_clean','romaji_on_clean','romaji_kun_clean','suggested_tags']
  arrayFields.forEach(field => {
    if (data[field]) {
      data[field].forEach((v, idx) => {
        if (v === '') errors.push(`${field}[${idx}] is empty string`)
      })
    }
  })

  return errors
}

export async function writeBulk({ items } = {}) {
  if (!items?.length) throw new Error("items required")

  // Validate all first — fail fast, write nothing
  const failures = []
  for (const item of items) {
    const errors = validateItem(item)
    if (errors.length) failures.push({ value: item.value, errors })
  }

  if (failures.length) {
    return {
      success: false,
      error: 'Validation failed — nothing written',
      failures,
    }
  }

  const results = []
  let written = 0
  let skipped = 0

  for (const item of items) {
    const { id, value, data } = item

    if (!id) {
      results.push({ value, status: 'skipped', reason: 'missing id' })
      skipped++
      continue
    }

    // Build update object — only include fields present in data
    const update = {}
    const fields_updated = []

    if (data.onyomi_clean)    { update.onyomi    = data.onyomi_clean;    fields_updated.push('onyomi') }
    if (data.kunyomi_clean)   { update.kunyomi   = data.kunyomi_clean;   fields_updated.push('kunyomi') }
    if (data.romaji_on_clean) { update.romaji_on  = data.romaji_on_clean;  fields_updated.push('romaji_on') }
    if (data.romaji_kun_clean){ update.romaji_kun = data.romaji_kun_clean; fields_updated.push('romaji_kun') }
    if (data.meaning_extended){ update.meaning_extended = data.meaning_extended; fields_updated.push('meaning_extended') }
    if (data.mnemonic)        { update.mnemonic        = data.mnemonic;         fields_updated.push('mnemonic') }
    if (data.teaching_notes)  { update.teaching_notes  = data.teaching_notes;   fields_updated.push('teaching_notes') }
    if (data.compounds)       { update.compounds        = data.compounds;        fields_updated.push('compounds') }
    if (data.example_sentences){ update.example_sentences = data.example_sentences; fields_updated.push('example_sentences') }

    // suggested_tags merges via SQL to avoid read-modify-write race
    // Handle separately after main update

    if (Object.keys(update).length === 0 && !data.suggested_tags) {
      results.push({ value, status: 'skipped', reason: 'complete' })
      skipped++
      continue
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from('curriculum_items')
        .update(update)
        .eq('id', id)
        .eq('item_type', 'kanji')

      if (error) throw new Error(`writeBulk update ${value}: ${error.message}`)
    }

    // Merge suggested_tags via SQL dedup
    if (data.suggested_tags?.length) {
      const { error: tagErr } = await supabase.rpc('merge_suggested_tags', {
        item_id:  id,
        new_tags: data.suggested_tags,
      })

      if (tagErr) {
        // RPC may not exist yet — fallback: read current, merge, write
        const { data: current, error: readErr } = await supabase
          .from('curriculum_items')
          .select('suggested_tags')
          .eq('id', id)
          .single()

        if (readErr) throw new Error(`writeBulk read tags ${value}: ${readErr.message}`)

        const existing = current?.suggested_tags ?? []
        const merged   = [...new Set([...existing, ...data.suggested_tags])]

        const { error: writeErr } = await supabase
          .from('curriculum_items')
          .update({ suggested_tags: merged })
          .eq('id', id)

        if (writeErr) throw new Error(`writeBulk write tags ${value}: ${writeErr.message}`)
      }

      fields_updated.push('suggested_tags')
    }

    results.push({ value, status: 'written', fields_updated })
    written++
  }

  return { success: true, written, skipped, results }
}
