// Deterministic MinHash + LSH banding (Broder 1997; Indyk & Motwani 1998).
// All hash constants come from a fixed-seed PRNG at module load, so
// signatures are identical across runs, platforms, and engines.

const K = 32 // signature length
const BANDS = 16 // 16 bands × 2 rows: ~78% candidate recall at Jaccard 0.3, ~100% at 0.6+
const ROWS = K / BANDS

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HASH_A: number[] = []
const HASH_B: number[] = []
{
  const rnd = mulberry32(0x3777aaa1)
  for (let i = 0; i < K; i++) {
    HASH_A.push((Math.floor(rnd() * 0xffffffff) | 1) >>> 0) // odd multiplier
    HASH_B.push(Math.floor(rnd() * 0xffffffff) >>> 0)
  }
}

export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function minhashSignature(tokens: Iterable<string>): Uint32Array {
  const sig = new Uint32Array(K).fill(0xffffffff)
  for (const t of tokens) {
    const h = fnv1a(t)
    for (let i = 0; i < K; i++) {
      const v = (Math.imul(HASH_A[i]!, h) + HASH_B[i]!) >>> 0
      if (v < sig[i]!) sig[i] = v
    }
  }
  return sig
}

export function estimateJaccard(a: Uint32Array, b: Uint32Array): number {
  let eq = 0
  for (let i = 0; i < K; i++) if (a[i] === b[i]) eq++
  return eq / K
}

// Buckets larger than this cap stop generating pairs beyond their first
// members — pathological identical-signature groups (e.g. hundreds of
// empty-token zettels) would otherwise reintroduce the O(n²) blowup
const BUCKET_PAIR_CAP = 64

/**
 * Candidate pairs [i, j] (i < j) whose signatures share at least one LSH
 * band. Expected ~O(n) for realistic similarity distributions. Callers must
 * verify candidates with an exact similarity measure.
 */
export function lshCandidatePairs(signatures: Uint32Array[]): Array<[number, number]> {
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i]!
    for (let b = 0; b < BANDS; b++) {
      let key = String(b)
      for (let r = 0; r < ROWS; r++) key += ':' + sig[b * ROWS + r]!
      const bucket = buckets.get(key)
      if (bucket) bucket.push(i)
      else buckets.set(key, [i])
    }
  }

  const seen = new Set<number>()
  const pairs: Array<[number, number]> = []
  const n = signatures.length
  for (const bucket of buckets.values()) {
    const members = bucket.length > BUCKET_PAIR_CAP ? bucket.slice(0, BUCKET_PAIR_CAP) : bucket
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const i = members[x]!
        const j = members[y]!
        const key = i * n + j
        if (seen.has(key)) continue
        seen.add(key)
        pairs.push([i, j])
      }
    }
  }
  // bucket iteration order is insertion order — stable, but sort anyway so
  // downstream tie-breaking never depends on Map internals
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return pairs
}

export function exactJaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union > 0 ? inter / union : 0
}
