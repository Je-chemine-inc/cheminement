"use client";

import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { useInactivityLogout } from "@/hooks/useInactivityLogout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { signOut } from "next-auth/react";

export function InactivityGuard() {
  const t = useTranslations("InactivityGuard");
  const { showWarning, countdown, stayLoggedIn } = useInactivityLogout();

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const timeStr =
    minutes > 0
      ? `${minutes}:${String(seconds).padStart(2, "0")}`
      : `${seconds}s`;

  return (
    <Dialog open={showWarning}>
      <DialogContent
        className="max-w-sm"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="pt-1">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center py-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-amber-400 bg-amber-50 text-2xl font-bold tabular-nums text-amber-700">
            {timeStr}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={stayLoggedIn}>
            {t("stayLoggedIn")}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => void signOut({ callbackUrl: "/login" })}
          >
            {t("logOutNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
