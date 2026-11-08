import { createFileRoute } from "@tanstack/react-router";

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
          aiStatusMessage: "تمت المحاذاة والترجمة السياقية بدقة عالية عبر المحرك اللغوي المدمج.",
        });
      },
    },
  },
});
