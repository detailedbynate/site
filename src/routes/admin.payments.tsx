import { createFileRoute } from "@tanstack/react-router";

import { PlannedSection } from "@/components/admin/PlannedSection";

export const Route = createFileRoute("/admin/payments")({
  component: Page,
});

function Page() {
  return (
    <PlannedSection
      title={"Payments"}
      subtitle={"Deposits, balances and refunds."}
      what={[
        "Take a deposit at booking time via Stripe or Square.",
        "Record cash and e-transfer payments against a booking.",
        "See what's outstanding, and refund a cancelled job in one click."
      ]}
      insteadLabel={"See appointments instead"}
      insteadTo={"/admin/appointments"}
    />
  );
}
