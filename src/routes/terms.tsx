import { createFileRoute } from "@tanstack/react-router";

import { getLegalPage } from "@/lib/api/content.functions";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/terms")({
  loader: () => getLegalPage({ data: { page: "terms" } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: `Terms of Service — ${loaderData?.businessName ?? "Detailed by Nate"}` },
      {
        name: "description",
        content:
          "Booking, deposits, cancellations and what to expect from a detail. The terms your booking is made under.",
      },
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  component: () => {
    const data = Route.useLoaderData();
    return <LegalPage title={data.title} body={data.body} />;
  },
});
