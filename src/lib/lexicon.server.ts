import arEnAsset from '@/assets/ar_en_lexicon.json.asset.json';
import enArAsset from '@/assets/en_ar_lexicon.json.asset.json';
// Lexicon lookup + contextual alignment engine (ported from the original Express server).
let arEnLexicon: Record<string, string[]> = {};
let enArLexicon: Record<string, string[]> = {};
let metadata: Record<string, any> = {};
let loading: Promise<void> | null = null;

export function ensureLexicons(origin: string): Promise<void> {
  if (Object.keys(arEnLexicon).length && Object.keys(enArLexicon).length) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      const get = async (f: string) => {
        const url = f === 'ar_en_lexicon.json' ? arEnAsset.url : f === 'en_ar_lexicon.json' ? enArAsset.url : `/dictionary/${f}`;
        const r = await fetch(new URL(url, origin));
        if (!r.ok) throw new Error(`Failed to load ${f}: ${r.status}`);
        return r.json();
      };
      const [a, e, m] = await Promise.all([get('ar_en_lexicon.json'), get('en_ar_lexicon.json'), get('dataset_metadata.json').catch(() => ({}))]);
      arEnLexicon = a; enArLexicon = e; metadata = m;
    })().catch((err) => { loading = null; throw err; });
  }
  return loading;
}

export function getMetadata() {
  return { ...metadata, loadedArabicEntries: Object.keys(arEnLexicon).length, loadedEnglishEntries: Object.keys(enArLexicon).length, status: 'healthy' };
}


const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'in', 'on', 'at', 'to', 'of', 'for', 'with', 
  'by', 'from', 'as', 'is', 'was', 'were', 'be', 'been', 'it', 'its', 'his', 
  'her', 'their', 'my', 'your', 'our', 'that', 'this', 'who', 'whom', 'which', 
  'unto', 'into', 'he', 'she', 'they', 'we', 'i', 'you'
]);

function normalizeArabic(str: string): string {
  if (!str) return '';
  return str
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/ی/g, 'ي')
    .trim();
}

function normalizeEnglish(str: string): string {
  if (!str) return '';
  return str
    .replace(/^[\s\p{P}«»“”"''`()\[\]{}،.:؛!؟\-_—–]+/gu, '')
    .replace(/[\s\p{P}«»“”"''`()\[\]{}،.:؛!؟\-_—–]+$/gu, '')
    .toLowerCase()
    .trim();
}

function tryArabicDirect(query: string): string[] | null {
  if (!query) return null;
  if (arEnLexicon[query] && arEnLexicon[query].length > 0) return arEnLexicon[query];
  const norm = normalizeArabic(query);
  if (arEnLexicon[norm] && arEnLexicon[norm].length > 0) return arEnLexicon[norm];
  
  // Taa marbuta swap
  if (norm.endsWith('ه')) {
    const withTeh = norm.slice(0, -1) + 'ة';
    if (arEnLexicon[withTeh]) return arEnLexicon[withTeh];
  } else if (norm.endsWith('ة')) {
    const withHeh = norm.slice(0, -1) + 'ه';
    if (arEnLexicon[withHeh]) return arEnLexicon[withHeh];
  }
  return null;
}

// Advanced Arabic Morphological Deconstruction & Stemmer Engine
function lookupArabic(rawWord: string): { word: string; normalized: string; meanings: string[]; root?: string; details?: string } {
  if (!rawWord) return { word: '', normalized: '', meanings: [] };
  const clean = rawWord
    .replace(/^[\s\p{P}«»“”()\[\]{}،.:؛!؟-]+/gu, '')
    .replace(/[\s\p{P}«»“”()\[\]{}،.:؛!؟-]+$/gu, '')
    .trim();
  const norm = normalizeArabic(clean);

  // 1. Direct dictionary match
  const direct = tryArabicDirect(clean) || tryArabicDirect(norm);
  if (direct) {
    return { word: clean, normalized: norm, meanings: direct.slice(0, 2), root: norm };
  }

  // 2. High-Order Multi-Clitic Deconstruction Engine (For complex words like "أفأسقيناكموها", "أفنلزمكموها", "فسيكفيكهم")
  const complexRes = deconstructComplexArabicWord(norm) || deconstructComplexArabicWord(clean);
  if (complexRes) {
    return {
      word: clean,
      normalized: norm,
      meanings: complexRes.meanings.slice(0, 2),
      root: complexRes.rootLemma,
      details: complexRes.details
    };
  }

  // Helper to evaluate candidate stems and handle Taa Marbuta / weak vowels
  const evaluateBase = (stem: string): { meanings: string[]; matchedLemma: string } | null => {
    if (!stem || stem.length < 2) return null;

    // Direct check
    const hit = tryArabicDirect(stem);
    if (hit) return { meanings: hit.slice(0, 2), matchedLemma: stem };

    // In Arabic, feminine 'ة' becomes 'ت' before attached pronouns (e.g. سفينة + ه = سفينته)
    if (stem.endsWith('ت') && stem.length >= 2) {
      const withMarbuta = stem.slice(0, -1) + 'ة';
      const hitMarbuta = tryArabicDirect(withMarbuta);
      if (hitMarbuta) return { meanings: hitMarbuta.slice(0, 2), matchedLemma: withMarbuta };
    }

    // Add Taa Marbuta
    const withAddedTeh = tryArabicDirect(stem + 'ة');
    if (withAddedTeh) return { meanings: withAddedTeh.slice(0, 2), matchedLemma: stem + 'ة' };

    // Five nouns weak vowels (أخو/أخي/أخا -> أخ, أبو/أبي/أبا -> أب)
    if (['اخو', 'اخي', 'اخا'].includes(stem)) {
      const hitAkh = tryArabicDirect('اخ') || tryArabicDirect('اخو');
      if (hitAkh) return { meanings: hitAkh.slice(0, 2), matchedLemma: 'اخ' };
    }
    if (['ابو', 'ابي', 'ابا'].includes(stem)) {
      const hitAb = tryArabicDirect('اب') || tryArabicDirect('ابو');
      if (hitAb) return { meanings: hitAb.slice(0, 2), matchedLemma: 'اب' };
    }

    return null;
  };

  // Arabic Attached Pronouns (Ordered from longest to shortest)
  const ARABIC_ATTACHED_PRONOUNS = [
    'تكما', 'تكم', 'تكن', 'تهما', 'تهم', 'تهن', 'تها', 'تنا', 'تك', 'ته', 'تي',
    'كما', 'هما', 'كم', 'كن', 'هم', 'هن', 'ها', 'نا', 'ك', 'ه', 'ي', 'ني'
  ];

  // Arabic Dual & Plural Suffixes
  const ARABIC_SUFFIXES = [
    'تان', 'تين', 'ان', 'ين', 'ون', 'ات', 'وا'
  ];

  // Arabic Prefixes (Conjunctions, Prepositions, Future Particles, Definite Articles)
  const ARABIC_PREFIXES = [
    'فبال', 'وبال', 'فكال', 'وكال', 'فلل', 'ولل',
    'بال', 'فال', 'وال', 'كال', 'لل', 'ال',
    'وس', 'فس',
    'وب', 'فب', 'ول', 'فل', 'وك', 'فك',
    'و', 'ف', 'ب', 'ل', 'ك', 'س'
  ];

  // 3. Pass 1: Attached Pronouns Stripping
  for (const pron of ARABIC_ATTACHED_PRONOUNS) {
    if (norm.endsWith(pron) && norm.length - pron.length >= 2) {
      const base = norm.slice(0, -pron.length);
      const res = evaluateBase(base);
      if (res) {
        return { word: clean, normalized: norm, meanings: res.meanings.slice(0, 2), root: res.matchedLemma };
      }
    }
  }

  // 4. Pass 2: Dual & Plural Suffixes Stripping
  for (const suf of ARABIC_SUFFIXES) {
    if (norm.endsWith(suf) && norm.length - suf.length >= 2) {
      const base = norm.slice(0, -suf.length);
      const res = evaluateBase(base);
      if (res) {
        return { word: clean, normalized: norm, meanings: res.meanings.slice(0, 2), root: res.matchedLemma };
      }
    }
  }

  // 5. Pass 3: Prefixes Stripping
  for (const pref of ARABIC_PREFIXES) {
    if (norm.startsWith(pref) && norm.length - pref.length >= 2) {
      const stripped = norm.slice(pref.length);
      const res = evaluateBase(stripped);
      if (res) {
        return { word: clean, normalized: norm, meanings: res.meanings.slice(0, 2), root: res.matchedLemma };
      }

      // Pass 3b: Prefix + Pronouns Stripping (e.g. فابنكما -> فـ + ابن + كما -> ابن)
      for (const pron of ARABIC_ATTACHED_PRONOUNS) {
        if (stripped.endsWith(pron) && stripped.length - pron.length >= 2) {
          const subBase = stripped.slice(0, -pron.length);
          const subRes = evaluateBase(subBase);
          if (subRes) {
            return { word: clean, normalized: norm, meanings: subRes.meanings.slice(0, 2), root: subRes.matchedLemma };
          }
        }
      }

      // Pass 3c: Prefix + Suffixes Stripping (e.g. والمسافرون -> و + ال + مسافر + ون -> مسافر)
      for (const suf of ARABIC_SUFFIXES) {
        if (stripped.endsWith(suf) && stripped.length - suf.length >= 2) {
          const subBase = stripped.slice(0, -suf.length);
          const subRes = evaluateBase(subBase);
          if (subRes) {
            return { word: clean, normalized: norm, meanings: subRes.meanings.slice(0, 2), root: subRes.matchedLemma };
          }
        }
      }
    }
  }

  return { word: clean, normalized: norm, meanings: [] };
}

// Multi-pass Deconstruction Algorithm for Complex Arabic Words ("أفأسقيناكموها")
function deconstructComplexArabicWord(normWord: string): { meanings: string[]; rootLemma: string; details?: string } | null {
  if (!normWord || normWord.length < 4) return null;

  let norm = normalizeArabic(normWord);

  // Compound Multi-Object Clitics
  const COMPOUND_CLITICS = [
    'ناكموها', 'ناكموه', 'تكموها', 'تكموه', 'كموها', 'كموه', 'تموها', 'تموه',
    'ناهموها', 'ناهموه', 'هموها', 'هموه', 'نيها', 'نيه', 'كها', 'كه',
    'ناكم', 'ناهم', 'تكم', 'تهم', 'تموني', 'تمونا', 'تموهم', 'تموهن',
    'وها', 'وه', 'وهما', 'وهم', 'وهن', 'نا', 'كم', 'هم', 'هن', 'ها', 'ك', 'ه', 'ي', 'ني'
  ];

  // Compound Interrogative & Conjunction Prefixes
  const COMPOUND_PREFIXES = [
    'أفأس', 'أفأ', 'أوا', 'أفس', 'أوس', 'فسي', 'فسأ', 'فسن', 'فست',
    'أف', 'أو', 'فلي', 'ولت', 'ولن', 'فلن', 'أبال', 'أفبال', 'أوبال',
    'فبال', 'وبال', 'فكال', 'وكال', 'فلل', 'ولل',
    'بال', 'فال', 'وال', 'كال', 'لل', 'ال',
    'وس', 'فس', 'وب', 'فب', 'ول', 'فل', 'وك', 'فك',
    'و', 'ف', 'ب', 'ل', 'ك', 'س', 'أ'
  ];

  // Test Prefixes + Clitics
  for (const pref of COMPOUND_PREFIXES) {
    if (norm.startsWith(pref) && norm.length - pref.length >= 3) {
      const afterPref = norm.slice(pref.length);

      // Try direct after prefix
      const directHit = tryArabicDirect(afterPref);
      if (directHit) return { meanings: directHit, rootLemma: afterPref, details: `سابق: ${pref}` };

      for (const clitic of COMPOUND_CLITICS) {
        if (afterPref.endsWith(clitic) && afterPref.length - clitic.length >= 2) {
          let candidate = afterPref.slice(0, -clitic.length);

          const candidatesToTry = [
            candidate,
            candidate + 'ى',
            candidate + 'ا',
            candidate.replace(/ي$/, 'ى'),
            candidate.replace(/ي$/, 'ا'),
            candidate.startsWith('أ') ? candidate.slice(1) : candidate,
            candidate.startsWith('ا') ? candidate.slice(1) : candidate
          ];

          for (const cand of candidatesToTry) {
            if (cand.length >= 2) {
              const hit = tryArabicDirect(cand);
              if (hit) {
                return {
                  meanings: hit,
                  rootLemma: cand,
                  details: `سابق: ${pref} + لاحق: ${clitic}`
                };
              }
            }
          }
        }
      }
    }
  }

  // Test Clitics alone
  for (const clitic of COMPOUND_CLITICS) {
    if (norm.endsWith(clitic) && norm.length - clitic.length >= 3) {
      let candidate = norm.slice(0, -clitic.length);
      const candidatesToTry = [
        candidate,
        candidate + 'ى',
        candidate + 'ا',
        candidate.replace(/ي$/, 'ى'),
        candidate.replace(/ي$/, 'ا')
      ];

      for (const cand of candidatesToTry) {
        if (cand.length >= 2) {
          const hit = tryArabicDirect(cand);
          if (hit) {
            return {
              meanings: hit,
              rootLemma: cand,
              details: `لاحق: ${clitic}`
            };
          }
        }
      }
    }
  }

  return null;
}

function lookupEnglish(rawWord: string): { word: string; normalized: string; meanings: string[] } {
  if (!rawWord) return { word: '', normalized: '', meanings: [] };
  const norm = normalizeEnglish(rawWord);
  if (!norm) return { word: rawWord, normalized: '', meanings: [] };

  if (enArLexicon[norm]) {
    return { word: rawWord, normalized: norm, meanings: enArLexicon[norm].slice(0, 2) };
  }

  // Stems
  if (norm.endsWith('s') && norm.length > 3 && enArLexicon[norm.slice(0, -1)]) {
    return { word: rawWord, normalized: norm.slice(0, -1), meanings: enArLexicon[norm.slice(0, -1)].slice(0, 2) };
  }
  if (norm.endsWith('es') && norm.length > 4 && enArLexicon[norm.slice(0, -2)]) {
    return { word: rawWord, normalized: norm.slice(0, -2), meanings: enArLexicon[norm.slice(0, -2)].slice(0, 2) };
  }
  if (norm.endsWith('ed') && norm.length > 4) {
    if (enArLexicon[norm.slice(0, -2)]) {
      return { word: rawWord, normalized: norm.slice(0, -2), meanings: enArLexicon[norm.slice(0, -2)].slice(0, 2) };
    }
    if (enArLexicon[norm.slice(0, -1)]) {
      return { word: rawWord, normalized: norm.slice(0, -1), meanings: enArLexicon[norm.slice(0, -1)].slice(0, 2) };
    }
  }
  if (norm.endsWith('ing') && norm.length > 5) {
    if (enArLexicon[norm.slice(0, -3)]) {
      return { word: rawWord, normalized: norm.slice(0, -3), meanings: enArLexicon[norm.slice(0, -3)].slice(0, 2) };
    }
    if (enArLexicon[norm.slice(0, -3) + 'e']) {
      return { word: rawWord, normalized: norm.slice(0, -3) + 'e', meanings: enArLexicon[norm.slice(0, -3) + 'e'].slice(0, 2) };
    }
  }

  return { word: rawWord, normalized: norm, meanings: [] };
}

// --- API Endpoints ---
app.get('/api/lexicon/ar-en', (req, res) => {
  const word = (req.query.word as string) || '';
  if (Object.keys(arEnLexicon).length === 0) {
    loadLexicons();
  }
  const result = lookupArabic(word);
  res.json(result);
});

app.get('/api/lexicon/en-ar', (req, res) => {
  const word = (req.query.word as string) || '';
  if (Object.keys(enArLexicon).length === 0) {
    loadLexicons();
  }
  const result = lookupEnglish(word);
  res.json(result);
});

app.get('/api/metadata', (_req, res) => {
  if (Object.keys(arEnLexicon).length === 0) {
    loadLexicons();
  }
  res.json({
    ...metadata,
    loadedArabicEntries: Object.keys(arEnLexicon).length,
    loadedEnglishEntries: Object.keys(enArLexicon).length,
    status: 'healthy'
  });
});

// Phonetic & Transliteration Helper
function arabicToPhonetic(ar: string): string {
  if (!ar) return '';
  let s = normalizeArabic(ar);
  if (s.startsWith('ال') && s.length > 3) s = s.slice(2);
  s = s
    .replace(/[أإآء]/g, '')
    .replace(/ب/g, 'b')
    .replace(/ت/g, 't')
    .replace(/ث/g, 'th')
    .replace(/ج/g, 'j')
    .replace(/ح/g, 'h')
    .replace(/خ/g, 'kh')
    .replace(/د/g, 'd')
    .replace(/ذ/g, 'dh')
    .replace(/ر/g, 'r')
    .replace(/ز/g, 'z')
    .replace(/س/g, 's')
    .replace(/ش/g, 'sh')
    .replace(/ص/g, 's')
    .replace(/ض/g, 'd')
    .replace(/ط/g, 't')
    .replace(/ظ/g, 'z')
    .replace(/ع/g, '')
    .replace(/غ/g, 'gh')
    .replace(/ف/g, 'f')
    .replace(/ق/g, 'q')
    .replace(/ك/g, 'k')
    .replace(/ل/g, 'l')
    .replace(/م/g, 'm')
    .replace(/ن/g, 'n')
    .replace(/ه/g, 'h')
    .replace(/و/g, 'w')
    .replace(/ي/g, 'y')
    .replace(/ة/g, 'a')
    .replace(/ى/g, 'a');
  return s.toLowerCase().trim();
}

function englishToPhonetic(en: string): string {
  if (!en) return '';
  let s = normalizeEnglish(en);
  if (s.startsWith('al-')) s = s.slice(3);
  else if (s.startsWith('al') && s.length > 4) s = s.slice(2);
  s = s
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/ou/g, 'u')
    .replace(/ea/g, 'i');
  return s.toLowerCase().trim();
}

function phoneticSimilarity(arWord: string, enWord: string): number {
  const normAr = normalizeArabic(arWord);
  const cleanEn = normalizeEnglish(enWord);
  if (!normAr || !cleanEn) return 0;
  // Strict length check: do NOT match short 1-2 letter words phonetically
  if (cleanEn.length < 3 || normAr.length < 3) return 0;
  if (ENGLISH_STOPWORDS.has(cleanEn)) return 0;

  const arPhon = arabicToPhonetic(normAr);
  const enPhon = englishToPhonetic(cleanEn);

  if (arPhon.length >= 3 && enPhon.length >= 3) {
    if (arPhon === enPhon) return 1.0;
    if (cleanEn === 'almustafa' && normAr.includes('مصطفي')) return 1.0;
    if (cleanEn === 'mustafa' && normAr.includes('مصطفي')) return 1.0;
    if (cleanEn.includes('orphalese') && normAr.includes('اورفليس')) return 1.0;
    if (cleanEn.includes('gibran') && normAr.includes('جبران')) return 1.0;
    if (cleanEn.includes('khalil') && normAr.includes('خليل')) return 1.0;

    const arConsonants = arPhon.replace(/[aeiouwy]/g, '');
    const enConsonants = enPhon.replace(/[aeiouwy]/g, '');
    if (arConsonants.length >= 3 && enConsonants.length >= 3) {
      if (arConsonants === enConsonants) return 0.95;
    }
  }

  return 0;
}

// Advanced Disambiguated Contextual Alignment in Target Sentence (N-Grams + Morphological Stemming + Confidence Metric)
function findContextualMatchInTarget(
  word: string, 
  direction: 'ar-en' | 'en-ar', 
  sourceSentence: string,
  targetSentence: string,
  lexiconMeanings: string[]
): { exactMatchedWord: string; contextualMeaning: string; explanation: string; confidenceScore: number; confidenceLabel: string } {
  if (!targetSentence || !targetSentence.trim()) {
    const fallback = lexiconMeanings[0] || word;
    return {
      exactMatchedWord: fallback,
      contextualMeaning: fallback,
      explanation: 'الترجمة المعجمية العامة.',
      confidenceScore: lexiconMeanings.length > 0 ? 70 : 50,
      confidenceLabel: lexiconMeanings.length > 0 ? 'مطابقة معجمية تقريبية' : 'توقع تقريبي'
    };
  }

  type Candidate = {
    token: string;
    meaning: string;
    score: number;
    confidence: number;
    reason: string;
  };

  const candidates: Candidate[] = [];

  // --- A. N-Gram Compound Phrase Extraction ---
  if (sourceSentence) {
    const sourceTokens = sourceSentence.split(/[\s\p{P}«»“”()\[\]{}،.:؛!؟\-_—–]+/u).filter(Boolean);
    const cleanTargetText = targetSentence.toLowerCase();

    const srcIdx = sourceTokens.findIndex(t => 
      direction === 'ar-en' 
        ? normalizeArabic(t) === normalizeArabic(word) || normalizeArabic(t).includes(normalizeArabic(word))
        : normalizeEnglish(t) === normalizeEnglish(word)
    );

    if (srcIdx >= 0) {
      const nGrams: string[] = [];
      for (let len = 4; len >= 2; len--) {
        for (let start = Math.max(0, srcIdx - len + 1); start <= Math.min(srcIdx, sourceTokens.length - len); start++) {
          const phrase = sourceTokens.slice(start, start + len).join(' ');
          if (phrase) nGrams.push(phrase);
        }
      }

      for (const phrase of nGrams) {
        const dictRes = direction === 'ar-en' ? lookupArabic(phrase) : lookupEnglish(phrase);
        if (dictRes && dictRes.meanings.length > 0) {
          for (const meaning of dictRes.meanings) {
            const cleanMeaning = direction === 'ar-en' ? normalizeEnglish(meaning) : normalizeArabic(meaning);
            if (cleanMeaning && cleanTargetText.includes(cleanMeaning)) {
              const regex = new RegExp(cleanMeaning.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
              const match = targetSentence.match(regex);
              const matchedStr = match ? match[0] : meaning;

              candidates.push({
                token: matchedStr,
                meaning: meaning,
                score: 400,
                confidence: 96,
                reason: `مطابقة تعبير اصطلاحي مركب: "${phrase}" -> "${matchedStr}".`
              });
              break;
            }
          }
        }
      }
    }
  }

  if (direction === 'ar-en') {
    const enTokens = targetSentence.split(/[\s\p{P}«»“”()\[\]{}،.:؛!؟\-_—–]+/u).filter(Boolean);
    const arTokens = sourceSentence ? sourceSentence.split(/[\s\p{P}«»“”()\[\]{}،.:؛!؟\-_—–]+/u).filter(Boolean) : [];
    const cleanWord = normalizeArabic(word);
    const wordIdx = arTokens.findIndex(t => normalizeArabic(t).includes(cleanWord) || cleanWord.includes(normalizeArabic(t)));
    const relPosSource = wordIdx >= 0 && arTokens.length > 0 ? wordIdx / arTokens.length : 0.5;

    for (let j = 0; j < enTokens.length; j++) {
      const token = enTokens[j];
      const cleanTok = normalizeEnglish(token);
      if (!cleanTok) continue;

      const isStopword = ENGLISH_STOPWORDS.has(cleanTok);
      const relPosTarget = j / enTokens.length;
      const posDistance = Math.abs(relPosSource - relPosTarget);
      const posPenalty = 1.0 - posDistance * 0.35;

      // 1. Phonetic Match
      if (!isStopword) {
        const phonSim = phoneticSimilarity(word, token);
        if (phonSim > 0.85) {
          const conf = Math.round(92 * phonSim * posPenalty);
          candidates.push({
            token,
            meaning: token,
            score: 300 * phonSim * posPenalty,
            confidence: conf,
            reason: 'مطابقة اسم علم / مصطلح معرب مباشر في النص المقابل.'
          });
        }
      }

      // 2. Lexical & Morphological Match
      const tokLookup = lookupEnglish(token);
      const stemmedTok = tokLookup.normalized || cleanTok;

      for (let mIdx = 0; mIdx < lexiconMeanings.length; mIdx++) {
        const meaning = lexiconMeanings[mIdx];
        const cleanMeaning = normalizeEnglish(meaning);
        if (!cleanMeaning) continue;

        if (isStopword && cleanMeaning !== cleanTok) continue;

        if (cleanTok === cleanMeaning || stemmedTok === cleanMeaning) {
          const rankScore = mIdx === 0 ? 250 : 190;
          const conf = Math.round((mIdx === 0 ? 95 : 88) * posPenalty);
          candidates.push({
            token,
            meaning,
            score: rankScore * posPenalty,
            confidence: conf,
            reason: 'مطابقة معجمية وصرفية دقيقة مع الكلمة الموجودة في النص المقابل.'
          });
        } else if (cleanTok.length >= 3 && cleanMeaning.length >= 3) {
          if (cleanTok.startsWith(cleanMeaning) || cleanMeaning.startsWith(cleanTok) || stemmedTok.startsWith(cleanMeaning)) {
            const rankScore = mIdx === 0 ? 170 : 130;
            const conf = Math.round((mIdx === 0 ? 82 : 75) * posPenalty);
            candidates.push({
              token,
              meaning,
              score: rankScore * posPenalty,
              confidence: conf,
              reason: 'مطابقة جذر لغوي مع تصريف الكلمة في النص المقابل.'
            });
          }
        }
      }

      // 3. Positional Fallback
      if (!isStopword && cleanTok.length >= 3) {
        const positionScore = 80 * (1.0 - posDistance);
        const conf = Math.round(68 * (1.0 - posDistance * 0.5));
        candidates.push({
          token,
          meaning: token,
          score: positionScore,
          confidence: conf,
          reason: 'مطابقة موقعية سياقية داخل النص المقابل.'
        });
      }
    }
  } else {
    // English -> Arabic direction
    const arTokens = targetSentence.split(/[\s\p{P}«»“”()\[\]{}،.:؛!؟\-_—–]+/u).filter(Boolean);
    const enTokens = sourceSentence ? sourceSentence.split(/[\s\p{P}«»“”()\[\]{}،.:؛!؟\-_—–]+/u).filter(Boolean) : [];
    const cleanWord = normalizeEnglish(word);
    const wordIdx = enTokens.findIndex(t => normalizeEnglish(t) === cleanWord);
    const relPosSource = wordIdx >= 0 && enTokens.length > 0 ? wordIdx / enTokens.length : 0.5;

    for (let j = 0; j < arTokens.length; j++) {
      const token = arTokens[j];
      const normTok = normalizeArabic(token);
      if (!normTok || normTok.length < 2) continue;

      const relPosTarget = j / arTokens.length;
      const posDistance = Math.abs(relPosSource - relPosTarget);
      const posPenalty = 1.0 - posDistance * 0.35;

      // Phonetic Match
      const phonSim = phoneticSimilarity(token, word);
      if (phonSim > 0.85) {
        const conf = Math.round(92 * phonSim * posPenalty);
        candidates.push({
          token,
          meaning: token,
          score: 300 * phonSim * posPenalty,
          confidence: conf,
          reason: 'مطابقة اسم علم / مصطلح معرب مباشر في النص المقابل.'
        });
      }

      // Lexical & Morphological Match
      const tokArLookup = lookupArabic(token);
      const stemmedArTok = tokArLookup.root || tokArLookup.normalized || normTok;

      for (let mIdx = 0; mIdx < lexiconMeanings.length; mIdx++) {
        const meaning = lexiconMeanings[mIdx];
        const normMeaning = normalizeArabic(meaning);
        if (!normMeaning) continue;

        if (normTok === normMeaning || stemmedArTok === normMeaning || normalizeArabic(tokArLookup.word) === normMeaning) {
          const rankScore = mIdx === 0 ? 250 : 190;
          const conf = Math.round((mIdx === 0 ? 95 : 88) * posPenalty);
          candidates.push({
            token,
            meaning,
            score: rankScore * posPenalty,
            confidence: conf,
            reason: 'مطابقة معجمية وصرفية دقيقة مع الكلمة الموجودة في النص المقابل.'
          });
        } else if (normTok.length >= 3 && (normTok.includes(normMeaning) || normMeaning.includes(normTok) || stemmedArTok.includes(normMeaning))) {
          const rankScore = mIdx === 0 ? 170 : 130;
          const conf = Math.round((mIdx === 0 ? 82 : 75) * posPenalty);
          candidates.push({
            token,
            meaning,
            score: rankScore * posPenalty,
            confidence: conf,
            reason: 'مطابقة لغوية مع تصريف أو زوائد الكلمة في النص المقابل.'
          });
        }
      }

      // Positional Fallback
      if (normTok.length >= 3) {
        const positionScore = 80 * (1.0 - posDistance);
        const conf = Math.round(68 * (1.0 - posDistance * 0.5));
        candidates.push({
          token,
          meaning: token,
          score: positionScore,
          confidence: conf,
          reason: 'مطابقة موقعية سياقية داخل النص المقابل.'
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    const top = candidates[0];
    const confScore = Math.min(99, Math.max(50, Math.round(top.confidence)));
    let confLabel = 'مطابقة سياقية جيدة';
    if (confScore >= 88) confLabel = 'مطابقة فائقة الدقة ✦';
    else if (confScore < 68) confLabel = 'مطابقة تقريبية معجمية';

    return {
      exactMatchedWord: top.token,
      contextualMeaning: top.meaning,
      explanation: top.reason,
      confidenceScore: confScore,
      confidenceLabel: confLabel
    };
  }

  const fallbackChoice = lexiconMeanings[0] || word;
  return {
    exactMatchedWord: fallbackChoice,
    contextualMeaning: fallbackChoice,
    explanation: 'مطابقة موقعية تقريبية داخل النص المقابل.',
    confidenceScore: 60,
    confidenceLabel: 'مطابقة تقريبية معجمية'
  };
}
export { lookupArabic, lookupEnglish, findContextualMatchInTarget };
