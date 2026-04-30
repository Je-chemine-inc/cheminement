"use client";

import { useState } from "react";
import { Loader2, Smartphone, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

type Step = "init" | "code" | "done";

export function PhoneVerificationModal({ open, onSuccess, onClose }: Props) {
  const [step, setStep] = useState<Step>("init");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [phoneStepToken, setPhoneStepToken] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");
  const [code, setCode] = useState("");

  const initiate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/account/initiate-phone-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json() as {
        alreadyVerified?: boolean;
        userId?: string;
        phoneStepToken?: string;
        phoneMasked?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to initiate verification");
        return;
      }
      if (data.alreadyVerified) {
        setStep("done");
        return;
      }
      setUserId(data.userId ?? "");
      setPhoneStepToken(data.phoneStepToken ?? "");
      setPhoneMasked(data.phoneMasked ?? "");
      await sendSms(data.userId ?? "", data.phoneStepToken ?? "");
    } finally {
      setBusy(false);
    }
  };

  const sendSms = async (uid: string, token: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/account/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, phoneStepToken: token }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to send SMS");
        return;
      }
      setInfo("Code sent — check your phone.");
      setStep("code");
    } finally {
      setBusy(false);
    }
  };

  const resendSms = () => sendSms(userId, phoneStepToken);

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/account/verify-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, phoneStepToken, code }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Invalid code");
        return;
      }
      setStep("done");
      setTimeout(() => onSuccess(), 800);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            Verify your phone
          </DialogTitle>
          <DialogDescription>
            We need to confirm your phone number before your first booking.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {info}
          </div>
        )}

        {step === "init" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We will send a verification code to the phone number on your account.
            </p>
            <Button className="w-full" disabled={busy} onClick={initiate}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send verification code
            </Button>
          </div>
        )}

        {step === "code" && (
          <form onSubmit={verifyCode} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Code sent to <span className="font-medium">{phoneMasked}</span>. Enter it below.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="phone-code">Verification code</Label>
              <Input
                id="phone-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="tracking-widest text-center text-lg"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={busy}
              onClick={resendSms}
            >
              Resend code
            </Button>
          </form>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="text-sm font-medium">Phone verified!</p>
            <p className="text-xs text-muted-foreground">Continuing your booking…</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
