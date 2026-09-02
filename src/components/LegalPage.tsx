import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/**
 * Shared shell for the Privacy and Terms pages.
 *
 * The body is plain text, not HTML or Markdown, and is rendered by a tiny
 * formatter below rather than a Markdown library. Two reasons: the owner
 * edits this in a plain textarea, so anything they can type must render
 * sensibly; and rendering owner-authored text as HTML would be an injection
 * route into the public site for no benefit.
 */
export function LegalPage({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to site
        </Link>

        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>

        <div className="mt-8">{format(body)}</div>
      </div>
    </div>
  );
}

/**
 * Plain text to elements.
 *
 * Supports exactly three things, because that is all the owner needs and all
 * they can reliably type: a "## " line is a heading, a "- " line is a bullet,
 * and a blank line separates paragraphs. **bold** is honoured inside a
 * paragraph. Everything else is text.
 */
function format(body: string) {
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return blocks.map((block, i) => {
    if (block.startsWith("## ")) {
      return (
        <h2
          key={i}
          className="mt-10 text-lg font-semibold tracking-tight text-foreground first:mt-0"
        >
          {block.slice(3).trim()}
        </h2>
      );
    }

    const lines = block.split("\n");
    if (lines[0]?.trimStart().startsWith("- ")) {
      /*
        Fold wrapped lines back into the item above them.

        A bullet whose text runs onto a second line does not itself start
        with "- ", so requiring EVERY line to start with it turned a list
        with one wrapped bullet back into a paragraph — which is what
        happened to the "who else sees it" list.
      */
      const items: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("- ")) items.push(trimmed.slice(2));
        else if (items.length) items[items.length - 1] += ` ${trimmed}`;
      }

      return (
        <ul key={i} className="mt-4 space-y-2">
          {items.map((item, j) => (
            <li
              key={j}
              className="flex gap-2.5 text-[14.5px] leading-relaxed text-muted-foreground"
            >
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
              <span>{inline(item)}</span>
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p key={i} className="mt-4 text-[14.5px] leading-relaxed text-muted-foreground">
        {inline(block.replace(/\n/g, " "))}
      </p>
    );
  });
}

/** **bold** only. Split on the markers so the text itself is never parsed. */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}
