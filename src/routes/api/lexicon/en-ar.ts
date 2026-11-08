import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lexicon/en-ar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { ensureLexicons, lookupEnglish } = await import("@/lib/lexicon.server");
        const url = new URL(request.url);
        await ensureLexicons(url.origin);
        return Response.json(lookupEnglish(url.searchParams.get("word") || ""));
      },
    },
  },
});
