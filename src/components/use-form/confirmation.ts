'use client';
import { useEffect, useRef, type KeyboardEvent } from 'react';

/** Inline confirmations keep the rest of the page available; they are not modals. */
export function useInlineConfirmation(open: boolean, close: () => void, busy = false) {
  const trigger = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) region.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    else if (wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return {
    trigger,
    dialog: {
      ref: region,
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          close();
        }
      },
    },
  };
}
