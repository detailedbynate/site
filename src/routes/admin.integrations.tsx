import { createFileRoute } from "@tanstack/react-router";

import { PlannedSection } from "@/components/admin/PlannedSection";

export const Route = createFileRoute("/admin/integrations")({
  component: Page,
});

function Page() {
  return (
    <PlannedSection
      title={"Integrations"}
      subtitle={"Third-party connections."}
      what={[
        "Google Calendar \u2014 already wired up; see the README for credentials.",
        "Stripe or Square for deposits.",
        "An email provider (Resend, Postmark) so confirmations actually send.",
        "Zapier or webhooks for anything else."
      ]}
    />
  );
}
