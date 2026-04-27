import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { LegalDocumentDTO } from "@/lib/legal-content";
import LegalBackButton from "./LegalBackButton";

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Add id attributes to <h2> tags based on their text content (for TOC anchors)
 * and return the list of headings found.
 */
function processContentHtml(html: string) {
  const headings: { id: string; text: string }[] = [];
  const seen = new Set<string>();

  const processed = html.replace(
    /<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi,
    (_match, attrs: string | undefined, inner: string) => {
      const plain = inner.replace(/<[^>]+>/g, "").trim();
      let id = slugify(plain) || `section-${headings.length + 1}`;
      let n = 2;
      while (seen.has(id)) {
        id = `${id}-${n}`;
        n += 1;
      }
      seen.add(id);
      headings.push({ id, text: plain });

      const hasIdAttr = attrs && /\bid\s*=/.test(attrs);
      const attrString = hasIdAttr ? attrs : `${attrs || ""} id="${id}"`;
      return `<h2${attrString} class="scroll-mt-24">${inner}</h2>`;
    },
  );

  return { processed, headings };
}

export default async function LegalPage({
  doc,
}: {
  doc: LegalDocumentDTO;
}) {
  const tUi = await getTranslations("Legal.ui");
  const { processed, headings } = processContentHtml(doc.contentHtml);

  return (
    <article className="bg-background">
      <Suspense>
        <LegalBackButton />
      </Suspense>
      {/* Header */}
      <header className="border-b border-border/60 bg-accent/30">
        <div className="container mx-auto px-6 py-16 md:py-20">
          <div className="mx-auto max-w-4xl space-y-4">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              {tUi("lastUpdated")} · {doc.lastUpdated}
            </p>
            <h1 className="font-serif text-3xl font-light leading-tight text-foreground md:text-4xl lg:text-5xl">
              {doc.title}
            </h1>
            {doc.subtitle ? (
              <p className="text-base text-muted-foreground md:text-lg">
                {doc.subtitle}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="container mx-auto px-6 py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[240px_1fr]">
          {/* Table of contents */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {tUi("tableOfContents")}
              </p>
              <nav>
                <ol className="space-y-2 text-sm">
                  {headings.map((heading) => (
                    <li key={heading.id}>
                      <a
                        href={`#${heading.id}`}
                        className="block text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {heading.text}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </div>
          </aside>

          {/* Content */}
          <div
            className="mx-auto w-full max-w-3xl legal-prose"
            dangerouslySetInnerHTML={{ __html: processed }}
          />
        </div>
      </div>
    </article>
  );
}
