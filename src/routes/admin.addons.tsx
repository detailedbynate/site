import { createFileRoute } from "@tanstack/react-router";

import { removeAddOn, saveAddOn } from "@/lib/api/admin.functions";
import { CatalogEditor } from "@/components/admin/CatalogEditor";
import { PageHeader } from "@/components/admin/ui";

export const Route = createFileRoute("/admin/addons")({
  component: AddOns,
});

function AddOns() {
  return (
    <>
      <PageHeader
        title="Add-ons"
        subtitle="Optional extras customers can stack onto any package. Their minutes extend the job, so availability adjusts automatically."
      />
      <CatalogEditor
        kind="addon"
        labels={{
          titleField: "Add-on name",
          detailField: "Description",
          detailHint: "One short line, e.g. \"Heavy shedding, seats and carpet\".",
          addButton: "New add-on",
          emptyTitle: "No add-ons",
          emptyBody: "Add-ons are optional — the booking form simply skips the step if there are none.",
        }}
        onSave={(item) =>
          saveAddOn({
            data: {
              id: item.id,
              name: item.title,
              detail: item.detail,
              price: item.price,
              durationMinutes: item.durationMinutes,
              active: item.active,
              sortOrder: item.sortOrder,
            },
          })
        }
        onDelete={(id) => removeAddOn({ data: { id } })}
      />
    </>
  );
}
