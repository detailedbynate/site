import { createFileRoute } from "@tanstack/react-router";

import { PlannedSection } from "@/components/admin/PlannedSection";

export const Route = createFileRoute("/admin/agents")({
  component: Page,
});

function Page() {
  return (
    <PlannedSection
      title={"Agents"}
      subtitle={"Staff members and who is assigned to each job."}
      what={[
        "Add detailers, each with their own working hours.",
        "Assign a job to a specific person and compute availability per agent rather than shop-wide.",
        "Give staff their own login with a restricted view."
      ]}
      insteadLabel={"Manage your account"}
      insteadTo={"/admin/settings"}
    />
  );
}
