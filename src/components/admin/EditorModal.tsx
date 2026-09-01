import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

import { Button, Portal } from "./ui";

/**
 * Centered create/edit dialog. Lifted out of CatalogEditor so Agents,
 * Locations, Assets and Expenses share one dialog rather than four
 * near-identical copies that drift apart.
 *
 * Portalled to <body> deliberately: `position: fixed` resolves against the
 * nearest ancestor with a transform/filter/backdrop-filter, and the admin
 * shell has several — without the portal this lands hundreds of pixels down
 * the page instead of over the viewport.
 */
export function EditorModal({
  open,
  onClose,
  title,
  width = "md",
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  width?: "md" | "lg";
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="admin-theme fixed inset-0 z-[60] flex items-center justify-center p-4"
            style={{ backgroundColor: "rgb(0 0 0 / 0.6)", backdropFilter: "blur(3px)" }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.97, y: 10 }}
              transition={{ type: "spring", stiffness: 240, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              className={`max-h-[88vh] w-full overflow-y-auto overscroll-contain rounded-2xl border border-[var(--line-2)] bg-[var(--card)] p-6 ${
                width === "lg" ? "max-w-2xl" : "max-w-md"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
                <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-5 space-y-4">{children}</div>

              {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}

/** Two-column field row that collapses on narrow screens. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
