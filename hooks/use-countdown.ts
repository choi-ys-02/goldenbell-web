"use client";

import { useEffect, useState } from "react";

export function useCountdown(deadlineAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  const remainingMs = deadlineAt
    ? Math.max(0, new Date(deadlineAt).getTime() - now)
    : 0;

  return {
    expired: Boolean(deadlineAt) && remainingMs <= 0,
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}
