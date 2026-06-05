"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import LegalDocumentEditor from "@/components/admin/LegalDocumentEditor";
import {
  parseSections,
  serializeSections,
  type LegalSection,
} from "@/lib/legal-sections";

interface SectionState {
  id: string;
  title: string;
  body: string;
}

let _seq = 0;
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  _seq += 1;
  return `s_${_seq}`;
}

/**
 * Section-cards editor for legal documents (client spec): add / edit / reorder /
 * delete sections instead of one big text block. Each section = an <h2> title +
 * a rich-text body (H3 subsections allowed). An optional intro sits before the
 * first section. Parses the incoming contentHtml ONCE on mount and emits the
 * re-serialized contentHtml on every edit, so storage + public rendering + the
 * TOC are unchanged (the TOC auto-syncs from the H2/H3 — see LegalPage).
 */
export default function LegalSectionsEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const t = useTranslations("AdminLegalDocuments");
  // Parse the stored HTML once; thereafter this component owns the structure and
  // pushes serialized HTML up via onChange (so we never re-parse our own output).
  const [intro, setIntro] = useState(() => parseSections(value).intro);
  const [sections, setSections] = useState<SectionState[]>(() =>
    parseSections(value).sections.map((s) => ({
      id: newId(),
      title: s.title,
      body: s.bodyHtml,
    })),
  );

  const emit = (nextIntro: string, nextSections: SectionState[]) => {
    onChange(
      serializeSections(
        nextIntro,
        nextSections.map<LegalSection>((s) => ({
          title: s.title,
          bodyHtml: s.body,
        })),
      ),
    );
  };

  const updateIntro = (html: string) => {
    setIntro(html);
    emit(html, sections);
  };
  const updateTitle = (id: string, title: string) => {
    const next = sections.map((s) => (s.id === id ? { ...s, title } : s));
    setSections(next);
    emit(intro, next);
  };
  const updateBody = (id: string, body: string) => {
    const next = sections.map((s) => (s.id === id ? { ...s, body } : s));
    setSections(next);
    emit(intro, next);
  };
  const addSection = () => {
    const next = [...sections, { id: newId(), title: "", body: "" }];
    setSections(next);
    emit(intro, next);
  };
  const removeSection = (id: string) => {
    const next = sections.filter((s) => s.id !== id);
    setSections(next);
    emit(intro, next);
  };
  const move = (id: string, dir: -1 | 1) => {
    const idx = sections.findIndex((s) => s.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= sections.length) return;
    const next = sections.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setSections(next);
    emit(intro, next);
  };

  const inputClass =
    "w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div className="space-y-5">
      {/* Intro (optional, no heading) */}
      <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-4">
        <label className="text-sm font-medium text-foreground">
          {t("introLabel")}
        </label>
        <p className="text-xs text-muted-foreground">{t("introHint")}</p>
        <LegalDocumentEditor
          value={intro}
          onChange={updateIntro}
          headingLevels={[3]}
        />
      </div>

      {/* Sections */}
      {sections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
          {t("emptySections")}
        </p>
      ) : (
        sections.map((s, i) => (
          <div
            key={s.id}
            className="space-y-3 rounded-lg border border-border/60 bg-card p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("sectionLabel", { n: i + 1 })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(s.id, -1)}
                  disabled={i === 0}
                  aria-label={t("moveUp")}
                  title={t("moveUp")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(s.id, 1)}
                  disabled={i === sections.length - 1}
                  aria-label={t("moveDown")}
                  title={t("moveDown")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removeSection(s.id)}
                  aria-label={t("deleteSection")}
                  title={t("deleteSection")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                {t("sectionTitleLabel")}
              </label>
              <input
                type="text"
                value={s.title}
                onChange={(e) => updateTitle(s.id, e.target.value)}
                placeholder={t("sectionTitlePlaceholder")}
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                {t("sectionBodyLabel")}
              </label>
              <LegalDocumentEditor
                value={s.body}
                onChange={(html) => updateBody(s.id, html)}
                headingLevels={[3]}
              />
            </div>
          </div>
        ))
      )}

      <button
        type="button"
        onClick={addSection}
        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-primary/50 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
      >
        <Plus className="h-4 w-4" />
        {t("addSection")}
      </button>
    </div>
  );
}
