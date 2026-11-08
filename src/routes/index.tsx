import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const BookshelfApp = lazy(() => import("@/components/app/BookshelfApp"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "محراب القراءة المتوازية والمعجم الشامل" },
      { name: "description", content: "منصة قراءة متوازية عربية-إنجليزية مع معجم لغوي فوري موسع ومحرك محاذاة للنصوص." },
      { property: "og:title", content: "محراب القراءة المتوازية والمعجم الشامل" },
      { property: "og:description", content: "واجهة قراءة متوازية عصرية مع معجم عربي-إنجليزي مدقق لغوياً ومحرك محاذاة للنصوص." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly fallback={<div className="min-h-screen" />}>
      <Suspense fallback={<div className="min-h-screen" />}>
        <BookshelfApp />
      </Suspense>
    </ClientOnly>
  );
}
