import { createFileRoute } from "@tanstack/react-router";

import { getLegalPage } from "@/lib/api/content.functions";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/privacy")({
  loader: () => getLegalPage({ data: { page: "privacy" } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: `Privacy Policy — ${loaderData?.businessName ?? "Detailed by Nate"}` },
      {
        name: "description",
        content:
          "What we collect when you book, why we collect it, who else sees it, and how to have it removed.",
      },
      // A legal page has no business competing in search results with the
      // pages that actually sell the work.
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  component: () => {
    const data = Route.useLoaderData();
    return <LegalPage title={data.title} body={data.body} />;
  },
});
