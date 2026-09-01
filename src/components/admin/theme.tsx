import { useCallback, useEffect, useRef, useState } from "react";

export type AdminTheme = "dark" | "light";

const STORAGE_KEY = "dbn_admin_theme";

function read(): AdminTheme {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    // No stored choice — follow the OS, the way people expect.
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    // Private mode / blocked storage: dark is the design's home state.
    return "dark";
  }
}

/**
 * Light/dark for the admin shell.
 *
 * The class is applied to the DOM node in a layout effect rather than through
 * React's `className`. Server rendering can't know the preference, so putting
 * it in the markup would either flash the wrong theme or trip a hydration
 * mismatch; a layout effect runs before paint and does neither.
 */
export function useAdminTheme() {
  const [theme, setTheme] = useState<AdminTheme>("dark");
  // A callback ref held in state, NOT useRef.
  //
  // The layout renders a "checking session" screen before the real shell, so
  // with a plain ref the element doesn't exist yet when the theme is first
  // read — and because the effect only depended on `theme`, it never re-ran
  // once the real element mounted, leaving light mode stuck on dark. Storing
  // the node in state re-runs the effect the moment it attaches.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const hydrated = useRef(false);

  // First client render: adopt the real preference.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    setTheme(read());
  }, []);

  useEffect(() => {
    if (!node) return;
    node.classList.toggle("admin-light", theme === "light");
    // Let the browser paint form controls and scrollbars to match.
    node.style.colorScheme = theme;

    /*
      Also mark <html>, which is what actually makes light mode reach
      everything.

      Several elements re-declare `admin-theme` on themselves — the mobile
      drawer, the slide-over detail panel, and every modal. Those re-declared
      blocks reset the palette to its dark defaults, and the modals are
      portalled to <body> so they sit outside this element completely. A class
      here alone therefore left the drawer and every overlay stuck dark.
      Pairing this with the `:root.admin-light .admin-theme` rules in
      styles.css covers every one of them, wherever they render.
    */
    const root = node.ownerDocument.documentElement;
    root.classList.toggle("admin-light", theme === "light");

    // `body` still carries the storefront's dark background. The admin shell
    // covers it, but overscroll bounce reveals whatever is behind — which in
    // light mode is a band of near-black. Match it while the admin is
    // mounted, and hand it back on the way out so the marketing site is
    // untouched.
    const body = node.ownerDocument.body;
    const previousBackground = body.style.backgroundColor;
    body.style.backgroundColor = getComputedStyle(node).backgroundColor;

    return () => {
      body.style.backgroundColor = previousBackground;
      // Leaving the admin must not tint the marketing site.
      root.classList.remove("admin-light");
    };
  }, [theme, node]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: AdminTheme = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not being able to remember it shouldn't stop it from switching.
      }
      return next;
    });
  }, []);

  return { theme, toggle, themeRef: setNode };
}
