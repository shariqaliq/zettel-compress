// src/chunker.ts
var DEFAULT_CHUNK_SIZE = 800;
var DEFAULT_CHUNK_OVERLAP = 100;
function chunkText(text, options) {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = normalized.trim();
  if (trimmed.length === 0) return [];
  const paragraphs = trimmed.split(/\n\n+/);
  const chunks = [];
  let currentParagraphs = [];
  let currentLength = 0;
  let charCursor = 0;
  let chunkIndex = 0;
  const emitChunk = (paras, start) => {
    const chunkText2 = paras.join("\n\n");
    chunks.push({
      text: chunkText2,
      index: chunkIndex++,
      charStart: start,
      charEnd: start + chunkText2.length
    });
  };
  for (const para of paragraphs) {
    const paraLen = para.length + 2;
    if (currentLength > 0 && currentLength + paraLen > chunkSize) {
      const chunkStart = charCursor - currentLength;
      emitChunk(currentParagraphs, chunkStart);
      const combined = currentParagraphs.join("\n\n");
      const overlapText = combined.slice(-chunkOverlap);
      const boundaryIdx = overlapText.indexOf("\n\n");
      const overlapSeed = boundaryIdx !== -1 ? overlapText.slice(boundaryIdx + 2) : overlapText;
      currentParagraphs = overlapSeed.length > 0 ? [overlapSeed] : [];
      currentLength = overlapSeed.length;
    }
    currentParagraphs.push(para);
    currentLength += paraLen;
    charCursor += paraLen;
  }
  if (currentParagraphs.length > 0) {
    const chunkStart = Math.max(0, charCursor - currentLength);
    emitChunk(currentParagraphs, chunkStart);
  }
  return chunks;
}

// src/entity-detector.ts
var STOP_LIST = /* @__PURE__ */ new Set([
  "I",
  "The",
  "A",
  "An",
  "It",
  "He",
  "She",
  "They",
  "We",
  "You",
  "But",
  "And",
  "Or",
  "In",
  "On",
  "At",
  "To",
  "Of",
  "For",
  "With",
  "By",
  "From",
  "That",
  "This",
  "These",
  "Those",
  "When",
  "Where",
  "Which",
  "Who",
  "What",
  "How",
  "Then",
  "So",
  "If",
  "As",
  "Up",
  "About",
  "After",
  "Before",
  "Because",
  "While",
  "Although",
  "Though",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "Its",
  "My",
  "Our",
  "Their",
  "His",
  "Her",
  "Your",
  "Mr",
  "Mrs",
  "Dr",
  "Yes",
  "No",
  "Not",
  "Just",
  "Also",
  "Very",
  "All",
  "Any",
  "Some",
  "Now",
  "Here",
  "There",
  "Today",
  "Tomorrow",
  "Yesterday"
]);
function detectEntities(text, minFreq = 2) {
  const tokens = text.split(/\s+/);
  const freq = {};
  for (const raw of tokens) {
    const token = raw.replace(/^[^\w]+|[^\w]+$/g, "").replace(/'s$/, "");
    if (token.length < 2) continue;
    if (!/^[A-Z]/.test(token)) continue;
    if (STOP_LIST.has(token)) continue;
    freq[token] = (freq[token] ?? 0) + 1;
  }
  return Object.entries(freq).filter(([, count]) => count >= minFreq).map(([name]) => name).sort();
}
var VOWELS = /* @__PURE__ */ new Set(["a", "e", "i", "o", "u"]);
function toCode(name) {
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  if (letters.length === 0) return "UNK";
  const first = letters[0] ?? "X";
  const consonants = letters.slice(1).split("").filter((c) => !VOWELS.has(c.toLowerCase()));
  if (consonants.length >= 2) {
    return first + (consonants[0] ?? "X") + (consonants[1] ?? "X");
  }
  if (consonants.length === 1) {
    return first + (consonants[0] ?? "X") + (letters[letters.length - 1] ?? "X");
  }
  return (first + letters.slice(1, 3)).toUpperCase().padEnd(3, "X");
}
function buildEntityIndex(entities) {
  const nameToCode = {};
  const codeToName = {};
  const used = /* @__PURE__ */ new Set();
  for (const name of [...entities].sort()) {
    let base = toCode(name);
    let code = base;
    let suffix = 1;
    while (used.has(code)) {
      code = base.slice(0, 2) + String(suffix);
      suffix++;
    }
    used.add(code);
    nameToCode[name] = code;
    codeToName[code] = name;
  }
  return { nameToCode, codeToName };
}

// src/topic-extractor.ts
var BASE_STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "nor",
  "for",
  "yet",
  "so",
  "in",
  "on",
  "at",
  "to",
  "of",
  "for",
  "with",
  "by",
  "from",
  "about",
  "above",
  "below",
  "between",
  "into",
  "through",
  "during",
  "before",
  "after",
  "against",
  "among",
  "around",
  "along",
  "across",
  "behind",
  "beside",
  "besides",
  "beyond",
  "despite",
  "except",
  "following",
  "inside",
  "like",
  "near",
  "off",
  "onto",
  "out",
  "outside",
  "over",
  "past",
  "since",
  "throughout",
  "under",
  "until",
  "up",
  "upon",
  "within",
  "without",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "must",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "able",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "its",
  "our",
  "their",
  "this",
  "that",
  "these",
  "those",
  "who",
  "which",
  "what",
  "where",
  "when",
  "how",
  "why",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "not",
  "only",
  "same",
  "than",
  "too",
  "very",
  "just",
  "also",
  "however",
  "therefore",
  "thus",
  "hence",
  "moreover",
  "furthermore",
  "nevertheless",
  "otherwise",
  "indeed",
  "instead",
  "meanwhile",
  "already",
  "always",
  "often",
  "usually",
  "sometimes",
  "never",
  "here",
  "there",
  "then",
  "now",
  "well",
  "back",
  "still",
  "even",
  "new",
  "good",
  "first",
  "last",
  "own",
  "right",
  "great",
  "little",
  "small",
  "large",
  "big",
  "high",
  "long",
  "next",
  "early",
  "old",
  "young",
  "public",
  "private",
  "real",
  "best",
  "free",
  "different",
  "important",
  "possible",
  "sure",
  "true",
  "false",
  "yes",
  "no",
  "ok",
  "okay"
]);
var TECH_SUFFIXES = /(?:tion|ing|ment|ity|ness|ism|ist|ize|ise|ous|ful|less|able|ible)$/i;
function extractTopics(text, minFreq = 1, extraStopWords) {
  const stopWords = extraStopWords ? /* @__PURE__ */ new Set([...BASE_STOP_WORDS, ...extraStopWords.map((w) => w.toLowerCase())]) : BASE_STOP_WORDS;
  const tokens = text.split(/\s+/);
  const scores = {};
  for (const raw of tokens) {
    const stripped = raw.replace(/^[^\w-]+|[^\w-]+$/g, "").replace(/['".,!?;:()[\]{}]/g, "");
    if (stripped.length < 3) continue;
    const lower = stripped.toLowerCase();
    if (stopWords.has(lower)) continue;
    let boost = 1;
    if (/^[A-Z]{2,}$/.test(stripped)) boost *= 2;
    else if (/^[A-Z][a-z]+(?:[A-Z][a-z]*)+$/.test(stripped)) boost *= 2.5;
    else if (/-/.test(stripped) && stripped.split("-").every((p) => p.length > 1)) boost *= 1.8;
    else if (stripped.length > 6 && TECH_SUFFIXES.test(stripped)) boost *= 1.3;
    scores[lower] = (scores[lower] ?? 0) + boost;
  }
  return Object.entries(scores).filter(([, score]) => score >= minFreq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word]) => word);
}

// src/sentence-scorer.ts
var DECISION_WORDS = /* @__PURE__ */ new Set([
  "decided",
  "chose",
  "choose",
  "will",
  "must",
  "committed",
  "resolved",
  "determined",
  "agreed",
  "concluded",
  "going",
  "plan",
  "intend",
  "shall"
]);
function splitSentences(text) {
  const sentences = [];
  const cleaned = text.replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\./gi, (m) => m.replace(".", "\0")).replace(/\b([A-Z]{1,2})\./g, (m) => m.replace(".", "\0"));
  const parts = cleaned.split(/(?<=[.!?])\s+(?=[A-Z"'])/);
  for (const part of parts) {
    const restored = part.replace(/\x00/g, ".").trim();
    if (restored.length > 0) sentences.push(restored);
  }
  return sentences.length > 0 ? sentences : [text.trim()];
}
function selectKeySentence(text) {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 5) return trimmed.slice(0, 120);
  const sentences = splitSentences(trimmed);
  if (sentences.length === 0) return trimmed.slice(0, 120);
  let best = sentences[0] ?? trimmed;
  let bestScore = -Infinity;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i] ?? "";
    const sWords = s.split(/\s+/);
    const wordCount = sWords.length;
    const decisionCount = sWords.filter(
      (w) => DECISION_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ""))
    ).length;
    const decisionDensity = wordCount > 0 ? decisionCount / wordCount : 0;
    let lengthBonus = 0;
    if (wordCount >= 10 && wordCount <= 25) lengthBonus = 0.2;
    else if (wordCount < 5) lengthBonus = -0.3;
    else if (wordCount > 40) lengthBonus = -0.1;
    const uniqueRatio = wordCount > 0 ? new Set(sWords.map((w) => w.toLowerCase())).size / wordCount : 0;
    const positionBonus = i === 0 || i === sentences.length - 1 ? 0.1 : 0;
    const decisionAbsolute = decisionCount * 0.4;
    const score = decisionDensity * 3 + decisionAbsolute + lengthBonus + uniqueRatio * 0.3 + positionBonus;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best.trim();
}

// src/emotion-detector.ts
var EMOTION_KEYWORDS = {
  conviction: ["decided", "committed", "certain", "determined", "resolved", "firm", "unwavering", "absolutely"],
  grief: ["lost", "miss", "sad", "mourning", "grief", "heartbroken", "devastated", "loss"],
  joy: ["happy", "excited", "wonderful", "delighted", "elated", "thrilled", "joyful", "glad"],
  fear: ["afraid", "worried", "scared", "terrified", "dread", "panic", "fearful", "terror"],
  hope: ["hope", "optimistic", "looking forward", "aspire", "wish", "bright", "promise", "hopeful"],
  trust: ["trust", "rely", "depend", "confident", "faith", "assured", "secure", "reliable"],
  wonder: ["amazing", "incredible", "fascinating", "curious", "astonishing", "remarkable", "awe-inspiring"],
  rage: ["angry", "furious", "hate", "outraged", "enraged", "livid", "infuriated", "seething"],
  exhaustion: ["tired", "burnt out", "overwhelmed", "drained", "exhausted", "depleted", "weary", "burnout"],
  shame: ["ashamed", "embarrassed", "humiliated", "mortified", "disgraced", "shameful"],
  pride: ["proud", "accomplished", "achieved", "earned", "succeeded", "triumphant", "excellence"],
  nostalgia: ["remember", "used to", "back then", "childhood", "memories", "once upon", "years ago", "miss the"],
  anxiety: ["anxious", "nervous", "uneasy", "restless", "apprehensive", "on edge", "tense", "stress"],
  relief: ["relieved", "finally", "at last", "thankfully", "unburdened", "resolved", "cleared"],
  anticipation: ["soon", "upcoming", "looking forward", "preparing", "planning", "next", "expecting", "anticipate"],
  frustration: ["frustrated", "annoyed", "irritated", "stuck", "blocked", "can't", "impossible", "pointless"],
  gratitude: ["grateful", "thankful", "appreciate", "thanks", "blessed", "indebted", "gratitude"],
  loneliness: ["alone", "lonely", "isolated", "no one", "by myself", "disconnected", "abandoned", "solitude"],
  inspiration: ["inspired", "motivated", "energized", "sparked", "ignited", "driven", "passionate", "creative"],
  confusion: ["confused", "unclear", "unsure", "uncertain", "puzzled", "baffled", "don't understand", "lost"],
  clarity: ["clear", "understood", "realized", "now i see", "makes sense", "obvious", "enlightened", "clarity"],
  guilt: ["guilty", "regret", "should have", "shouldn't have", "my fault", "blame myself", "remorse"],
  awe: ["awe", "breathtaking", "profound", "transcendent", "majestic", "overwhelming beauty"],
  regret: ["wish i had", "if only", "missed opportunity", "looking back", "could've", "should have done"],
  determination: ["will not stop", "never give up", "keep going", "persist", "push through", "no matter what"],
  vulnerability: ["vulnerable", "exposed", "raw", "open up", "honest about", "sharing", "admit that"],
  acceptance: ["accepted", "at peace", "moved on", "let go", "embrace", "okay with", "come to terms"],
  resistance: ["resist", "refuse", "against", "oppose", "reject", "push back", "disagree", "won't"],
  love: ["love", "adore", "cherish", "devoted", "affection", "warmth", "care deeply", "deeply care"],
  loss: ["gone", "passed away", "ended", "over now", "no more", "finished", "goodbye", "farewell"]
};
var DECISION_WORDS2 = ["decided", "chose", "committed", "resolved", "must", "will", "determined", "going to"];
function detectEmotions(text) {
  const lower = text.toLowerCase();
  const result = [];
  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        result.push(emotion);
        break;
      }
    }
  }
  return result;
}
function computeWeight(emotions, flags, text) {
  const flagScore = Math.min(flags.length * 0.3, 0.9);
  const emotionScore = Math.min(emotions.length * 0.1, 0.4);
  const words = text.toLowerCase().split(/\s+/);
  const decisionCount = words.filter(
    (w) => DECISION_WORDS2.some((d) => w.replace(/[^a-z']/g, "") === d)
  ).length;
  const decisionDensity = words.length > 0 ? decisionCount / words.length : 0;
  const raw = flagScore + emotionScore + decisionDensity * 0.5;
  const clamped = Math.min(raw, 1);
  return Math.round(clamped * 100) / 100;
}

// src/flag-detector.ts
var FLAG_KEYWORDS = {
  DECISION: ["decided", "chose", "committed", "resolved", "agreed", "concluded", "going to", "will do", "must do"],
  ORIGIN: ["founded", "created", "started", "began", "originated", "established", "first time", "inception", "birth of"],
  CORE: ["fundamental", "essential", "always", "core", "central", "key principle", "foundation", "basis", "bedrock"],
  PIVOT: ["turning point", "realized", "breakthrough", "changed everything", "shift", "transformed", "pivotal", "game changer"],
  GENESIS: ["led to", "resulted in", "because of this", "caused", "triggered", "sparked", "gave rise to", "origin of"],
  TECHNICAL: ["architecture", "implement", "deploy", "config", "database", "api", "function", "class", "module", "infrastructure", "stack", "endpoint", "schema"]
};
var FLAG_ORDER = ["DECISION", "ORIGIN", "CORE", "PIVOT", "GENESIS", "TECHNICAL"];
function detectFlags(text) {
  const lower = text.toLowerCase();
  const result = [];
  for (const flag of FLAG_ORDER) {
    const keywords = FLAG_KEYWORDS[flag];
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        result.push(flag);
        break;
      }
    }
  }
  return result;
}

// src/tunnel-builder.ts
function intersection(a, b) {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}
function buildTunnels(zettels, entityIndex) {
  const tunnels = [];
  for (let i = 0; i < zettels.length; i++) {
    for (let j = i + 1; j < zettels.length; j++) {
      const a = zettels[i];
      const b = zettels[j];
      if (!a || !b) continue;
      const sharedEntities = intersection(a.entities, b.entities);
      const sharedTopics = intersection(a.topics, b.topics);
      if (sharedEntities.length >= 2 || sharedTopics.length >= 3) {
        let label;
        if (sharedEntities.length >= 2) {
          label = sharedEntities.slice(0, 3).map((name) => entityIndex.nameToCode[name] ?? name.slice(0, 3).toUpperCase()).join("+");
        } else {
          label = sharedTopics.slice(0, 2).join("_");
        }
        tunnels.push({ from: a.id, to: b.id, label });
      }
    }
  }
  return tunnels.sort((a, b) => a.from.localeCompare(b.from));
}

// src/encoder.ts
function zettelToLine(z, entityIndex) {
  const codes = z.entities.map((name) => entityIndex.nameToCode[name] ?? name.slice(0, 3).toUpperCase()).join("+");
  const topics = z.topics.join("_");
  const weight = z.weight.toFixed(2);
  const emotions = z.emotions.join("+");
  const flags = z.flags.join("+");
  return `${z.id}:${codes}|${topics}|"${z.quote}"|${weight}|${emotions}|${flags}`;
}
function tunnelToLine(t) {
  return `T:${t.from}<->${t.to}|${t.label}`;
}
function encode(result) {
  const count = String(result.zettels.length).padStart(3, "0");
  const seenEntities = [];
  for (const z of result.zettels) {
    for (const e of z.entities) {
      if (!seenEntities.includes(e)) seenEntities.push(e);
      if (seenEntities.length >= 3) break;
    }
    if (seenEntities.length >= 3) break;
  }
  const topCodes = seenEntities.map((name) => result.entityIndex.nameToCode[name] ?? name.slice(0, 3).toUpperCase()).join("+");
  const date = result.meta?.date ?? "";
  const title = result.meta?.title ?? "";
  const header = `FILE:${count}|${topCodes}|${date}|${title}`;
  const lines = [header];
  for (const z of result.zettels) lines.push(zettelToLine(z, result.entityIndex));
  for (const t of result.tunnels) lines.push(tunnelToLine(t));
  return lines.join("\n");
}
function parseZettelLine(line, entityIndex) {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const id = line.slice(0, colonIdx);
  if (!/^\d+$/.test(id)) return null;
  const rest = line.slice(colonIdx + 1);
  const quoteStart = rest.indexOf('"');
  const quoteEnd = rest.lastIndexOf('"');
  if (quoteStart === -1 || quoteStart === quoteEnd) return null;
  const quote = rest.slice(quoteStart + 1, quoteEnd);
  const before = rest.slice(0, quoteStart);
  const after = rest.slice(quoteEnd + 1);
  const beforeParts = before.split("|");
  const codes = beforeParts[0] ?? "";
  const topics = beforeParts[1] ?? "";
  const afterParts = after.split("|");
  const weightStr = afterParts[1] ?? "0";
  const emotionsStr = afterParts[2] ?? "";
  const flagsStr = afterParts[3] ?? "";
  const weight = parseFloat(weightStr);
  const emotions = emotionsStr ? emotionsStr.split("+").filter(Boolean) : [];
  const flagsList = flagsStr ? flagsStr.split("+").filter(Boolean) : [];
  const topicList = topics ? topics.split("_").filter(Boolean) : [];
  const entityNames = codes ? codes.split("+").filter(Boolean).map((code) => entityIndex.codeToName[code] ?? code) : [];
  if (codes) {
    for (const code of codes.split("+").filter(Boolean)) {
      if (!entityIndex.codeToName[code]) {
        entityIndex.codeToName[code] = code;
        entityIndex.nameToCode[code] = code;
      }
    }
  }
  return {
    id,
    entities: entityNames,
    topics: topicList,
    quote,
    weight: isNaN(weight) ? 0 : Math.round(weight * 100) / 100,
    emotions,
    flags: flagsList
  };
}
function decode(aaak) {
  const lines = aaak.split("\n").map((l) => l.trim()).filter(Boolean);
  const entityIndex = { nameToCode: {}, codeToName: {} };
  const zettels = [];
  const tunnels = [];
  let date;
  let title;
  let inputLength = 0;
  for (const line of lines) {
    if (line.startsWith("FILE:")) {
      const parts = line.slice(5).split("|");
      date = parts[2] || void 0;
      title = parts[3] || void 0;
      continue;
    }
    if (line.startsWith("T:")) {
      const body = line.slice(2);
      const pipeIdx = body.indexOf("|");
      const arrowIdx = body.indexOf("<->");
      if (arrowIdx === -1) continue;
      const from = body.slice(0, arrowIdx);
      const to = pipeIdx !== -1 ? body.slice(arrowIdx + 3, pipeIdx) : body.slice(arrowIdx + 3);
      const label = pipeIdx !== -1 ? body.slice(pipeIdx + 1) : "";
      tunnels.push({ from, to, label });
      continue;
    }
    const z = parseZettelLine(line, entityIndex);
    if (z) {
      zettels.push(z);
      inputLength += z.quote.length;
    }
  }
  for (const [code, name] of Object.entries(entityIndex.codeToName)) {
    entityIndex.nameToCode[name] = code;
  }
  const meta = { inputLength, chunkCount: zettels.length };
  if (date !== void 0) meta.date = date;
  if (title !== void 0) meta.title = title;
  return { zettels, tunnels, entityIndex, meta };
}

// src/layer1.ts
var WAKE_UP_THRESHOLD = 0.85;
var WAKE_UP_FLAGS = /* @__PURE__ */ new Set(["ORIGIN", "CORE", "GENESIS"]);
var FLAG_PREFIXES = {
  ORIGIN: "Origin: ",
  CORE: "Core: ",
  GENESIS: "Genesis: ",
  DECISION: "Decision: ",
  PIVOT: "Pivot: ",
  TECHNICAL: "Technical: "
};
function isHighImportance(z) {
  return z.weight >= WAKE_UP_THRESHOLD || z.flags.some((f) => WAKE_UP_FLAGS.has(f));
}
function wakeUp(result) {
  const candidates = result.zettels.filter(isHighImportance).sort((a, b) => b.weight - a.weight).slice(0, 5);
  if (candidates.length === 0) return "";
  const sentences = candidates.map((z) => {
    const prefix = z.flags.length > 0 ? FLAG_PREFIXES[z.flags[0] ?? ""] ?? "" : "";
    return `${prefix}${z.quote}`;
  });
  return sentences.join(". ").replace(/\.\./g, ".");
}
function topZettels(result, n) {
  return [...result.zettels].sort((a, b) => b.weight - a.weight).slice(0, n);
}

// src/index.ts
function compress(text, options) {
  const chunks = chunkText(text, options);
  if (chunks.length === 0) {
    return {
      zettels: [],
      tunnels: [],
      entityIndex: { nameToCode: {}, codeToName: {} },
      meta: { inputLength: text.length, chunkCount: 0 }
    };
  }
  const chunkEntities = chunks.map(
    (chunk) => detectEntities(chunk.text, options?.minEntityFrequency)
  );
  const allEntityNames = [...new Set(chunkEntities.flat())];
  const entityIndex = buildEntityIndex(allEntityNames);
  const zettels = chunks.map((chunk, i) => {
    const entities = chunkEntities[i] ?? [];
    const topics = extractTopics(chunk.text, options?.minTopicFrequency, options?.stopWords);
    const quote = selectKeySentence(chunk.text);
    const flags = detectFlags(chunk.text);
    const emotions = detectEmotions(chunk.text);
    const weight = computeWeight(emotions, flags, chunk.text);
    return {
      id: String(i + 1).padStart(3, "0"),
      entities,
      topics,
      quote,
      weight,
      emotions,
      flags
    };
  });
  const tunnels = buildTunnels(zettels, entityIndex);
  return {
    zettels,
    tunnels,
    entityIndex,
    meta: Object.assign(
      { inputLength: text.length, chunkCount: chunks.length },
      options?.date !== void 0 ? { date: options.date } : {},
      options?.title !== void 0 ? { title: options.title } : {}
    )
  };
}
function compressMany(texts, options) {
  return texts.map((text) => compress(text, options));
}
function mergeResults(results) {
  if (results.length === 0) {
    return {
      zettels: [],
      tunnels: [],
      entityIndex: { nameToCode: {}, codeToName: {} }
    };
  }
  const mergedIndex = { nameToCode: {}, codeToName: {} };
  const allEntityNames = [];
  for (const r of results) {
    for (const name of Object.keys(r.entityIndex.nameToCode)) {
      if (!allEntityNames.includes(name)) allEntityNames.push(name);
    }
  }
  const rebuiltIndex = buildEntityIndex(allEntityNames);
  mergedIndex.nameToCode = rebuiltIndex.nameToCode;
  mergedIndex.codeToName = rebuiltIndex.codeToName;
  let globalIndex = 1;
  const mergedZettels = results.flatMap(
    (r) => r.zettels.map((z) => ({ ...z, id: String(globalIndex++).padStart(3, "0") }))
  );
  const mergedTunnels = buildTunnels(mergedZettels, mergedIndex);
  const totalInput = results.reduce((sum, r) => sum + (r.meta?.inputLength ?? 0), 0);
  return {
    zettels: mergedZettels,
    tunnels: mergedTunnels,
    entityIndex: mergedIndex,
    meta: { inputLength: totalInput, chunkCount: mergedZettels.length }
  };
}
function injectContext(result, options) {
  let zettels = [...result.zettels];
  if (options?.minWeight !== void 0) {
    const min = options.minWeight;
    zettels = zettels.filter((z) => z.weight >= min);
  }
  if (options?.flags !== void 0 && options.flags.length > 0) {
    const flagSet = options.flags;
    zettels = zettels.filter((z) => flagSet.some((f) => z.flags.includes(f)));
  }
  if (options?.maxZettels !== void 0) {
    zettels = [...zettels].sort((a, b) => b.weight - a.weight).slice(0, options.maxZettels);
  }
  const format = options?.format ?? "aaak";
  if (format === "json") {
    return JSON.stringify({ zettels, tunnels: result.tunnels }, null, 2);
  }
  if (format === "markdown") {
    return zettels.map((z) => {
      const emotionStr = z.emotions.length > 0 ? z.emotions.join(", ") : "none";
      const flagStr = z.flags.length > 0 ? z.flags.join(", ") : "none";
      return `**[${z.id}]** ${z.quote} *(${emotionStr} | ${flagStr} | weight: ${z.weight})*`;
    }).join("\n\n");
  }
  return encode({ ...result, zettels });
}

export { compress, compressMany, decode, encode, injectContext, mergeResults, topZettels, wakeUp };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map