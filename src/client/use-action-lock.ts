'use client';
import { useRef, useState } from 'react';

/** The ref rejects reentry synchronously, before React commits disabled buttons. */
export function useActionLock() {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  function start() {
    if (active.current) return false;
    active.current = true;
    setBusy(true);
    return true;
  }
  function finish() {
    active.current = false;
    setBusy(false);
  }
  return { busy, active, start, finish };
}
