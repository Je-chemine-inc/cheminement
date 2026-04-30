import { useCallback, useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";

const INACTIVITY_MS = 20 * 60 * 1000; // 20 minutes
const WARNING_MS   =  2 * 60 * 1000; // warn 2 minutes before logout
const WARNING_SECS = WARNING_MS / 1000;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

// Minimum ms between timer resets — avoids thrashing on mousemove.
const RESET_THROTTLE = 5_000;

interface UseInactivityLogoutReturn {
  showWarning: boolean;
  countdown: number; // seconds remaining before logout
  stayLoggedIn: () => void;
}

export function useInactivityLogout(): UseInactivityLogoutReturn {
  const { data: session } = useSession();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARNING_SECS);

  const warningTimerRef   = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const logoutTimerRef    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const countdownRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastResetRef      = useRef<number>(Date.now());

  const isProtected =
    session?.user?.role === "client" || session?.user?.role === "professional";

  const clearAll = useCallback(() => {
    if (warningTimerRef.current)  clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current)   clearTimeout(logoutTimerRef.current);
    if (countdownRef.current)     clearInterval(countdownRef.current);
    warningTimerRef.current  = null;
    logoutTimerRef.current   = null;
    countdownRef.current     = null;
  }, []);

  const startTimers = useCallback(() => {
    clearAll();
    setShowWarning(false);
    setCountdown(WARNING_SECS);

    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setCountdown(WARNING_SECS);

      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1_000);
    }, INACTIVITY_MS - WARNING_MS);

    logoutTimerRef.current = setTimeout(() => {
      void signOut({ callbackUrl: "/login?reason=inactivity" });
    }, INACTIVITY_MS);
  }, [clearAll]);

  const resetTimers = useCallback(() => {
    const now = Date.now();
    if (now - lastResetRef.current < RESET_THROTTLE) return;
    lastResetRef.current = now;
    startTimers();
  }, [startTimers]);

  const stayLoggedIn = useCallback(() => {
    lastResetRef.current = 0; // force immediate reset
    startTimers();
  }, [startTimers]);

  useEffect(() => {
    if (!isProtected) return;

    startTimers();

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, resetTimers, { passive: true }),
    );

    return () => {
      clearAll();
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, resetTimers),
      );
    };
  }, [isProtected, startTimers, resetTimers, clearAll]);

  return { showWarning, countdown, stayLoggedIn };
}
