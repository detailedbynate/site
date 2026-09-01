import { createFileRoute } from "@tanstack/react-router";

import { removeService, saveService } from "@/lib/api/admin.functions";
import { CatalogEditor } from "@/components/admin/CatalogEditor";
import { PageHeader } from "@/components/admin/ui";

export const Route = createFileRoute("/admin/services")({
  component: Services,
});

function Services() {
  return (
    <>
      <PageHeader
        title="Services"
        subtitle="Your packages. Edits here change the booking form immediately — price and duration are re-read on every booking."
      />
      <CatalogEditor
        kind="service"
        labels={{
          titleField: "Package name",
          detailField: "Tagline",
          detailHint: "Shown under the name, e.g. \"Interior & Exterior\".",
          addButton: "New package",
          emptyTitle: "No packages",
          emptyBody: "Add at least one package so customers have something to book.",
        }}
        onSave={(item) =>
          saveService({
            data: {
              id: item.id,
              title: item.title,
              subtitle: item.detail,
              priceValue: item.price,
              durationMinutes: item.durationMinutes,
              features: (item.features ?? []).map((f) => f.trim()).filter(Boolean),
              description: item.description ?? "",
              active: item.active,
              sortOrder: item.sortOrder,
              materialCost: item.materialCost ?? 0,
            },
          })
        }
        onDelete={(id) => removeService({ data: { id } })}
      />
    </>
  );
}
