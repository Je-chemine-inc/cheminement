"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

interface FaqItem {
  id: string;
  questionFr: string;
  questionEn: string;
  answerFr: string;
  answerEn: string;
  audience: "all" | "client" | "professional";
  order: number;
}

interface FaqListProps {
  audience: "client" | "professional";
  /** Static fallback rendered when the API returns 0 entries. */
  fallback?: React.ReactNode;
}

export default function FaqList({ audience, fallback }: FaqListProps) {
  const locale = useLocale();
  const t = useTranslations("Dashboard.helpCenter");
  const [faqs, setFaqs] = useState<FaqItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/faqs?audience=${audience}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { faqs: FaqItem[] };
        if (!cancelled) setFaqs(data.faqs);
      } catch {
        if (!cancelled) setFaqs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audience]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!faqs || faqs.length === 0) {
    return <>{fallback ?? <p className="text-sm text-muted-foreground italic">{t("noFaqs")}</p>}</>;
  }

  return (
    <ul className="space-y-4">
      {faqs.map((faq) => {
        const question = locale === "en" ? faq.questionEn : faq.questionFr;
        const answer = locale === "en" ? faq.answerEn : faq.answerFr;
        return (
          <li
            key={faq.id}
            className="rounded-2xl border border-border/20 bg-card/60 p-5"
          >
            <h3 className="font-medium text-foreground mb-2">{question}</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-line">
              {answer}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
