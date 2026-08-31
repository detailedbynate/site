import { createFileRoute } from "@tanstack/react-router";

import { PlannedSection } from "@/components/admin/PlannedSection";

export const Route = createFileRoute("/admin/form-fields")({
  component: Page,
});

function Page() {
  return (
    <PlannedSection
      title={"Form Fields"}
      subtitle={"Customise what the booking form asks."}
      what={[
        "Add your own questions to the booking wizard without touching code.",
        "Mark fields required or optional, and reorder them.",
        "Show a field only for certain packages \u2014 e.g. ask about pets only for interior jobs."
      ]}
      insteadLabel={"See the live booking form"}
      insteadTo={"/book"}
    />
  );
}
