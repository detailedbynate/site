import { createFileRoute } from "@tanstack/react-router";

import { PlannedSection } from "@/components/admin/PlannedSection";

export const Route = createFileRoute("/admin/assets")({
  component: Page,
});

function Page() {
  return (
    <PlannedSection
      title={"Assets"}
      subtitle={"Equipment and consumables."}
      what={[
        "Track machines and whether they're free for a given job.",
        "Log product usage per detail and flag low stock.",
        "Block bookings that need equipment already in use."
      ]}
    />
  );
}
