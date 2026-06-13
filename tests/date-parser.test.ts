import { describe, it, expect } from 'vitest'
import { compress, recall } from '../src/index.js'

// ── Unit: date extraction via compress() ──────────────────────────────────────

describe('date resolution — absolute dates', () => {
  it('resolves "8 May 2023" format', () => {
    const r = compress('We met on 8 May 2023 to discuss the project.')
    expect(r.zettels[0]?.resolvedDate).toBe('2023-05-08')
  })

  it('resolves "May 8, 2023" format', () => {
    const r = compress('The meeting was on May 8, 2023.')
    expect(r.zettels[0]?.resolvedDate).toBe('2023-05-08')
  })

  it('resolves "2023-06-10" ISO format', () => {
    const r = compress('Deployed on 2023-06-10.')
    expect(r.zettels[0]?.resolvedDate).toBe('2023-06-10')
  })

  it('resolves month+year only: "June 2023"', () => {
    const r = compress('The event happened in June 2023.')
    expect(r.zettels[0]?.resolvedDate).toBe('2023-06')
  })

  it('resolves bare year with preposition: "in 2022"', () => {
    const r = compress('She started working here in 2022.')
    expect(r.zettels[0]?.resolvedDate).toBe('2022')
  })

  it('resolves parenthesized LoCoMo-style timestamps', () => {
    const r = compress('(1:56 pm on 8 May, 2023) Alice: Good morning.')
    expect(r.zettels[0]?.resolvedDate).toBe('2023-05-08')
  })

  it('prefers more specific date (day) over less specific (month) in same chunk', () => {
    const r = compress('In June 2023, specifically on 15 June 2023, we decided.')
    expect(r.zettels[0]?.resolvedDate).toBe('2023-06-15')
  })
})

describe('date resolution — relative expressions with session date', () => {
  const sessionDate = '2023-06-10'

  it('resolves "yesterday" against session date', () => {
    const r = compress('I went to the market yesterday.', { date: sessionDate })
    expect(r.zettels[0]?.resolvedDate).toBe('2023-06-09')
  })

  it('resolves "tomorrow" against session date', () => {
    const r = compress('The meeting is tomorrow.', { date: sessionDate })
    expect(r.zettels[0]?.resolvedDate).toBe('2023-06-11')
  })

  it('resolves "last week" against session date', () => {
    const r = compress('We shipped it last week.', { date: sessionDate })
    expect(r.zettels[0]?.resolvedDate).toBe('2023-06-03')
  })

  it('resolves "next month" against session date', () => {
    const r = compress('Planning to launch next month.', { date: sessionDate })
    // addMonths preserves day from anchor: 2023-06-10 → 2023-07-10
    expect(r.zettels[0]?.resolvedDate).toBe('2023-07-10')
  })

  it('resolves "3 days ago" against session date', () => {
    const r = compress('The outage started 3 days ago.', { date: sessionDate })
    expect(r.zettels[0]?.resolvedDate).toBe('2023-06-07')
  })

  it('resolves "in 2 weeks" against session date', () => {
    const r = compress('Deadline is in 2 weeks.', { date: sessionDate })
    expect(r.zettels[0]?.resolvedDate).toBe('2023-06-24')
  })

  it('resolves "last Monday" against session date (Saturday)', () => {
    // 2023-06-10 is a Saturday; last Monday = 2023-06-05
    const r = compress('We discussed this last Monday.', { date: '2023-06-10' })
    expect(r.zettels[0]?.resolvedDate).toBe('2023-06-05')
  })
})

describe('date resolution — cascade: absolute in text beats session date', () => {
  it('uses in-text absolute date over session date', () => {
    const r = compress(
      'On 15 March 2022 we launched the new product.',
      { date: '2023-06-10' },
    )
    expect(r.zettels[0]?.resolvedDate).toBe('2022-03-15')
  })

  it('uses preceding chunk absolute date as anchor for relative in later chunk', () => {
    const text = [
      'The event was on 8 May 2023.',
      'We followed up yesterday with the results.',
    ].join('\n\n')
    const r = compress(text, { chunkSize: 60, chunkOverlap: 0 })
    // second chunk ("yesterday") should anchor to 2023-05-08 → 2023-05-07
    const second = r.zettels[1]
    expect(second?.resolvedDate).toBe('2023-05-07')
  })

  it('returns undefined when no date signal exists and no session date given', () => {
    const r = compress('The system had a performance issue with caching.')
    // no date in text, no session date → undefined
    // most zettels should have no resolvedDate
    expect(r.zettels.every(z => z.resolvedDate === undefined)).toBe(true)
  })
})

describe('recall() date filters', () => {
  // Each line is padded so the chunker splits them into separate zettels
  const pad = (s: string) => s + ' '.repeat(Math.max(0, 120 - s.length))
  const text = [
    pad('(1:56 pm on 8 May, 2023) Alice: We decided to use Redis for caching sessions and scaling our auth layer.'),
    pad('(2:30 pm on 25 June, 2023) Alice: We rolled back the Redis change due to connection pool exhaustion issues.'),
    pad('(9:00 am on 10 October, 2023) Alice: We re-enabled Redis after fixing the connection pool and load testing.'),
  ].join('\n\n')

  it('after filter returns only zettels on or after the date', () => {
    const r = compress(text, { chunkSize: 150 })
    const hits = recall(r, 'Redis', { topK: 10, after: '2023-06-01' })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    hits.forEach(z => {
      expect(z.resolvedDate).toBeDefined()
      expect(z.resolvedDate! >= '2023-06').toBe(true)
    })
  })

  it('before filter returns only zettels on or before the date', () => {
    const r = compress(text, { chunkSize: 150 })
    const hits = recall(r, 'Redis', { topK: 10, before: '2023-05-31' })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    hits.forEach(z => {
      expect(z.resolvedDate).toBeDefined()
      expect(z.resolvedDate! <= '2023-05-31').toBe(true)
    })
  })

  it('after+before window returns only zettels inside the range', () => {
    const r = compress(text, { chunkSize: 150 })
    const hits = recall(r, 'Redis', { topK: 10, after: '2023-06-01', before: '2023-07-31' })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    hits.forEach(z => {
      expect(z.resolvedDate).toBeDefined()
      expect(z.resolvedDate! >= '2023-06').toBe(true)
      expect(z.resolvedDate! <= '2023-07-31').toBe(true)
    })
  })

  it('date filter with no matches returns empty array', () => {
    const r = compress(text, { chunkSize: 150 })
    const hits = recall(r, 'Redis', { topK: 10, after: '2025-01-01' })
    expect(hits).toEqual([])
  })
})
