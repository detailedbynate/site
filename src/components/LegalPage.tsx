import { Container, SiteFooter, SiteNav } from "@/components/site/SiteChrome";

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
    <div className="site min-h-screen">
      <SiteNav />
      <Container className="pb-24 pt-40 md:pt-48">
        <article className="max-w-[68ch]">
          <h1 className="text-[clamp(2rem,4.6vw,3.4rem)] font-extrabold leading-none">{title}</h1>
          <div className="mt-10">{format(body)}</div>
        </article>
      </Container>
      <SiteFooter />
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
        <h2 key={i} className="mt-12 text-[21px] font-bold leading-tight first:mt-0">
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
        <ul key={i} className="mt-4 space-y-2.5">
          {items.map((item, j) => (
            <li key={j} className="flex gap-3 text-[16px] leading-[1.7] text-[var(--text-muted)]">
              <span aria-hidden className="mt-[0.7em] h-1.5 w-1.5 shrink-0 rounded-[1px] bg-[var(--sky)]" />
              <span>{inline(item)}</span>
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p key={i} className="mt-4 text-[16px] leading-[1.7] text-[var(--text-muted)]">
        {inline(block.replace(/\n/g, " "))}
      </p>
    );
  });
}

/** **bold** only. Split on the markers so the text itself is never parsed. */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-[var(--text)]">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}
