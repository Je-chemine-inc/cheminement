"use client";

import { Lock } from "lucide-react";

/**
 * Shown in place of an admin screen to an admin without the right it needs —
 * when the menu hid it but the URL was typed, or the right was taken away
 * while the page was open. The same panel as BillingAccessRequired, with the
 * screen's own wording.
 */
export function AdminAccessRequired({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-xl border border-border/40 bg-card p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Lock className="h-6 w-6 text-muted-foreground" />
      </div>
      <h1 className="mb-2 font-serif text-xl font-light text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
