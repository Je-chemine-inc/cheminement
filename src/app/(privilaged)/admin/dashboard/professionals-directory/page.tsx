"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowDown, ArrowUp, Check, Eye, EyeOff, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminPermissions } from "@/components/admin/AdminPermissionsProvider";
import { AdminAccessRequired } from "@/components/admin/AdminAccessRequired";
import type { DirectoryAdminRow } from "@/lib/professionals-directory";

const ERROR_CODES = ["CHANGED", "SETTINGS_MISSING", "INVALID"] as const;
const errorKey = (code: unknown) =>
  typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code) ? code : "generic";

type View = { rows: DirectoryAdminRow[]; updatedAt: string | null };

const STATUS_STYLES: Record<"listed" | NonNullable<DirectoryAdminRow["excludedBy"]>, string> = {
  listed: "bg-emerald-100 text-emerald-800",
  hiddenByTeam: "bg-muted text-muted-foreground",
  hiddenByProfessional: "bg-amber-100 text-amber-800",
  incomplete: "bg-sky-100 text-sky-800",
};

/** « Nos professionnels (site) » — who shows on www /professionnels, and in what order. */
export default function AdminProfessionalsDirectoryPage() {
  const t = useTranslations("ProfessionalsDirectoryAdmin");
  const tTitles = useTranslations("Showcase.titles");
  const { manageProfessionals } = useAdminPermissions();
  const [view, setView] = useState<View | null>(null);
  const [rows, setRows] = useState<DirectoryAdminRow[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [orderTouched, setOrderTouched] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const adopt = useCallback((next: View) => {
    setView(next);
    setRows(next.rows);
    setHidden(new Set(next.rows.filter((row) => row.hiddenByTeam).map((row) => row.id)));
    setOrderTouched(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/professionals-directory", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as View | null;
      if (!res.ok || !Array.isArray(body?.rows)) {
        setError(t("errors.generic"));
        return;
      }
      adopt(body);
    } catch {
      setError(t("errors.network"));
    }
  }, [adopt, t]);

  useEffect(() => {
    if (manageProfessionals) void load();
  }, [load, manageProfessionals]);

  const dirty = useMemo(() => {
    if (!view) return false;
    const savedHidden = view.rows.filter((row) => row.hiddenByTeam).map((row) => row.id);
    return orderTouched || savedHidden.length !== hidden.size || savedHidden.some((id) => !hidden.has(id));
  }, [view, orderTouched, hidden]);

  if (!manageProfessionals || denied) {
    return <AdminAccessRequired title={t("access.title")} body={t("access.body")} />;
  }

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setRows(next);
    setOrderTouched(true);
    setDone(null);
  };

  const toggleHidden = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    setDone(null);
  };

  const save = async (order: string[]) => {
    if (!view) return;
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/admin/professionals-directory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order, hidden: [...hidden], expectedUpdatedAt: view.updatedAt }),
      });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as (View & { error?: unknown }) | null;
      if (!res.ok || !Array.isArray(body?.rows)) {
        setError(t(`errors.${errorKey(body?.error)}`));
        if (body?.error === "CHANGED") await load();
        return;
      }
      adopt(body);
      setDone(t("done"));
    } catch {
      setError(t("errors.network"));
    } finally {
      setSaving(false);
    }
  };

  const statusOf = (row: DirectoryAdminRow) => {
    if (row.excludedBy === "hiddenByProfessional") return "hiddenByProfessional" as const;
    if (hidden.has(row.id)) return "hiddenByTeam" as const;
    if (row.excludedBy === "incomplete") return "incomplete" as const;
    return "listed" as const;
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-light text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-3xl font-light text-muted-foreground">{t("subtitle")}</p>
          <a
            href="/professionnels"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t("viewPublic")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} aria-label={t("refresh")} disabled={saving}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="flex items-center gap-2 text-sm text-emerald-700">
          <Check className="h-4 w-4 shrink-0" />
          {done}
        </p>
      ) : null}

      {!view ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!dirty || saving} onClick={() => void save(rows.map((row) => row.id))}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("save")}
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => void save([])}>
              {t("resetOrder")}
            </Button>
            {dirty ? <span className="text-sm text-amber-700">{t("unsaved")}</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("orderHint")}</p>

          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-24 px-3 py-3 font-normal">{t("columns.position")}</th>
                  <th className="px-3 py-3 font-normal">{t("columns.professional")}</th>
                  <th className="px-3 py-3 font-normal">{t("columns.status")}</th>
                  <th className="px-3 py-3 text-right font-normal">{t("columns.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((row, index) => {
                  const status = statusOf(row);
                  const title = row.title.key ? tTitles(row.title.key) : row.title.label;
                  return (
                    <tr key={row.id} data-directory-row={row.id}>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center gap-1">
                          <span className="w-6 text-muted-foreground">{index + 1}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={saving || index === 0}
                            onClick={() => move(index, -1)}
                            aria-label={t("actions.up", { name: row.displayName })}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={saving || index === rows.length - 1}
                            onClick={() => move(index, 1)}
                            aria-label={t("actions.down", { name: row.displayName })}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <p className="text-foreground">{row.displayName}</p>
                        {title ? <p className="text-xs text-muted-foreground">{title}</p> : null}
                        {row.showcasePath ? (
                          <a
                            href={row.showcasePath}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            {t("hasPage")}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </td>
                      <td className="max-w-xs px-3 py-3 align-top">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
                          {t(`statuses.${status}`)}
                        </span>
                        {status === "hiddenByProfessional" || status === "incomplete" ? (
                          <p className="mt-1 text-xs text-muted-foreground">{t(`notes.${status}`)}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right align-top">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={saving}
                          onClick={() => toggleHidden(row.id)}
                          aria-pressed={hidden.has(row.id)}
                        >
                          {hidden.has(row.id) ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          {hidden.has(row.id) ? t("actions.show") : t("actions.hide")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
