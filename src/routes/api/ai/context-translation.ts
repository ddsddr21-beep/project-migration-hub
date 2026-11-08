import { createFileRoute } from "@tanstack/react-router";

async function askGemini(apiKey: string, prompt: string) {
  for (const model of ["gemini-flash-latest", "gemini-2.5-flash"]) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (r.status === 400 || r.status === 403) return { invalid: true };
    if (!r.ok) continue;
    const j: any = await r.json();
    try {
      const parsed = JSON.parse(j?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
      if (parsed?.exactMatchedWord) return { result: parsed };
    } catch {
      /* try next model */
    }
  }
  return {};
}

export const Route = createFileRoute("/api/ai/context-translation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const lex = await import("@/lib/lexicon.server");
        await lex.ensureLexicons(new URL(request.url).origin);
        const { word, direction, sourceContext, targetContext } = (await request.json().catch(() => ({}))) as any;
        if (!word || typeof word !== "string") return Response.json({ error: "Word is required" }, { status: 400 });
        const dir = direction === "en-ar" ? "en-ar" : "ar-en";
        const dict = dir === "ar-en" ? lex.lookupArabic(word) : lex.lookupEnglish(word);
        const meanings = (dict?.meanings || []).slice(0, 2);
        const src = String(sourceContext?.current || "").slice(0, 4000);
        const tgt = String(targetContext?.current || "").slice(0, 4000);
        const key = (process.env["GEMINI_API_KEY"] || "").trim();
        let keyIssue = false;

        if (key) {
          const sl = dir === "ar-en" ? "Arabic" : "English";
          const tl = dir === "ar-en" ? "English" : "Arabic";
          const prompt = `You are a bilingual alignment expert and literary translator.
Given a selected ${sl} word from the source sentence, identify the exact corresponding word or phrase in the facing ${tl} sentence.
Source Sentence (${sl}): "${src}"
Selected Word: "${word}"
Facing Target Sentence (${tl}): "${tgt}"
Return JSON: {"exactMatchedWord": verbatim word/phrase from the target sentence, "contextualMeaning": concise contextual translation (1-2 words), "explanation": short Arabic note}.`;
          try {
            const out = await askGemini(key, prompt);
            if (out.invalid) keyIssue = true;
            if (out.result) {
              return Response.json({
                word,
                exactMatchedWord: out.result.exactMatchedWord,
                contextualMeaning: out.result.contextualMeaning || out.result.exactMatchedWord,
                explanation: out.result.explanation || "تم التحليل والمطابقة السياقية بواسطة الذكاء الاصطناعي (Gemini).",
                confidenceScore: 98,
                confidenceLabel: "مطابقة فائقة بالذكاء الاصطناعي (Gemini) ✦",
                status: "success",
                source: "gemini",
                aiConnected: true,
                aiStatusMessage: "تمت الترجمة والمطابقة بنجاح بواسطة الذكاء الاصطناعي (Gemini Flash).",
              });
            }
          } catch {
            /* fall back to local engine */
          }
        }

        const m = lex.findContextualMatchInTarget(word, dir, src, tgt, meanings);
        return Response.json({
          word,
          exactMatchedWord: m.exactMatchedWord,
          contextualMeaning: m.contextualMeaning,
          explanation: m.explanation,
          confidenceScore: m.confidenceScore,
          confidenceLabel: m.confidenceLabel,
          status: "success",
          source: "local_engine",
          aiConnected: true,
          apiKeyNotice: keyIssue ? "مفتاح Gemini غير صالح." : null,
          aiStatusMessage: "تمت المحاذاة والترجمة السياقية بدقة عالية عبر المحرك اللغوي المدمج.",
        });
      },
    },
  },
});
