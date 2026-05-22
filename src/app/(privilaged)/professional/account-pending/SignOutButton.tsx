"use client";

import { signOut } from "next-auth/react";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SignOutButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      size="lg"
      className="gap-2"
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      <Home className="h-4 w-4" />
      {label}
    </Button>
  );
}
