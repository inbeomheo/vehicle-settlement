'use client';
import { useRef, useState } from 'react';

// The synchronous ref also blocks a second submit before React commits disabled.
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  function begin() {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    return true;
  }
  function end() {
    pending.current = false;
    setBusy(false);
  }
  return { busy, begin, end };
}
