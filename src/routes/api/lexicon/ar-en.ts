import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lexicon/ar-en")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { ensureLexicons, lookupArabic } = await import("@/lib/lexicon.server");
        const url = new URL(request.url);
        await ensureLexicons(url.origin);
        return Response.json(lookupArabic(url.searchParams.get("word") || ""));
      },
    },
  },
});
