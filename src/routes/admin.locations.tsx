import { createFileRoute } from "@tanstack/react-router";

import { PlannedSection } from "@/components/admin/PlannedSection";

export const Route = createFileRoute("/admin/locations")({
  component: Page,
});

function Page() {
  return (
    <PlannedSection
      title={"Locations"}
      subtitle={"Multiple shops or service zones."}
      what={[
        "Define more than one bay or unit, each with its own hours.",
        "Set service-area boundaries and per-zone travel fees.",
        "Let customers pick a location during booking."
      ]}
      insteadLabel={"Set your service area"}
      insteadTo={"/admin/settings"}
    />
  );
}
