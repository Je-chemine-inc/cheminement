"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * "I bought this but lost the email."
 *
 * Always shows the same neutral confirmation, whether or not a purchase was
 * found — matching the endpoint, which answers 200 either way. Reporting "no
 * purchase for that address" would turn this into a way to test whether a
 * given person bought a given mental-health resource.
 */
export default function ResendAccessLinkDialog({ slug }: { slug: string }) {
  const t = useTranslations("ResourceCheckout");
  const tBook = useTranslations("BookResource");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await fetch(`/api/resources/${slug}/resend-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Swallowed on purpose: the confirmation must look identical whatever
      // happened, including a network failure.
    } finally {
      setSending(false);
      setDone(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-primary hover:underline"
      >
        {tBook("resendLink")}
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDone(false);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-serif font-light">
              {t("resendTitle")}
            </DialogTitle>
            <DialogDescription>{t("resendBody")}</DialogDescription>
          </DialogHeader>

          {done ? (
            <p className="py-4 text-sm text-muted-foreground">{t("resendDone")}</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="w-full rounded-lg border border-border/60 bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button type="submit" disabled={sending} className="w-full">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("resendSubmit")}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
