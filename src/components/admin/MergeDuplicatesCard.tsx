"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Users, GitMerge, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Candidate = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  createdAt: string;
  completedSessions: number;
  totalAppointments: number;
};

/**
 * Admin "merge duplicate accounts" card for a patient detail page. The current
 * patient ([id]) is the SURVIVOR; the admin picks a candidate to absorb into it
 * (the loser is deleted). Client accounts only.
 */
export function MergeDuplicatesCard({
  userId,
  userName,
  onMerged,
}: {
  userId: string;
  userName: string;
  onMerged?: () => void;
}) {
  const t = useTranslations("AdminDashboard.patientDetail.merge");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = async () => {
    setOpen(true);
    setError(null);
    setSelected("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/patients/${userId}/duplicates`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setCandidates(json.candidates ?? []);
    } catch {
      setError(t("error"));
    } finally {
      setLoading(false);
    }
  };

  const doMerge = async () => {
    if (!selected) return;
    setMerging(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/patients/${userId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loserId: selected }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.details || body?.error || t("error"));
      }
      setOpen(false);
      onMerged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="bg-amber-50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900 rounded-xl p-6">
      <h2 className="text-lg font-serif font-light mb-2 text-amber-700 dark:text-amber-400 flex items-center gap-2">
        <GitMerge className="h-5 w-5" /> {t("title")}
      </h2>
      <p className="text-sm font-light mb-4 text-amber-800/80 dark:text-amber-200/80">
        {t("desc")}
      </p>
      <Button
        variant="outline"
        className="w-full gap-2 border-amber-300 text-amber-800 hover:bg-amber-100 dark:text-amber-300"
        onClick={openDialog}
      >
        <Users className="h-4 w-4" />
        {t("findButton")}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !merging && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("dialogIntro", { name: userName })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-[55vh] overflow-y-auto py-1">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {t("noneFound")}
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("selectPrompt")}
                </p>
                {candidates.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      selected === c.id
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="merge-candidate"
                      className="mt-1"
                      checked={selected === c.id}
                      onChange={() => setSelected(c.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">
                          {c.name || "—"}
                        </span>
                        <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                          {c.role}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.email}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t("candidateSessions", { count: c.completedSessions })}
                        {" · "}
                        {new Date(c.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </label>
                ))}
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{t("absorbWarning", { name: userName })}</span>
                </div>
              </>
            )}
          </div>

          {/* Kept outside the scrollable list so a merge error is always visible. */}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={merging}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              className="gap-2"
              onClick={doMerge}
              disabled={!selected || merging || loading}
            >
              {merging ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GitMerge className="h-4 w-4" />
              )}
              {merging ? t("merging") : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
