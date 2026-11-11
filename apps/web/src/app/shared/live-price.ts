import { DestroyRef, effect, inject, signal } from '@angular/core';

/** Debounced server pricing that follows an input; stale responses are dropped and null clears.
 * Call in an injection context. */
export const livePrice = <T, R>(
  source: () => T | null,
  fetch: (input: T) => Promise<R>,
  delayMs = 200,
) => {
  const value = signal<R | null>(null);
  const error = signal<string | null>(null);
  const pending = signal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  effect(() => {
    const input = source();
    clearTimeout(timer);
    const mine = ++seq;
    if (input === null) {
      value.set(null);
      error.set(null);
      pending.set(false);
      return;
    }
    pending.set(true);
    timer = setTimeout(async () => {
      try {
        const result = await fetch(input);
        if (mine !== seq) return;
        value.set(result);
        error.set(null);
      } catch (err) {
        if (mine !== seq) return;
        error.set(
          err instanceof Error ? err.message : $localize`:@@errors.pricingFailed:Pricing failed`,
        );
      } finally {
        if (mine === seq) pending.set(false);
      }
    }, delayMs);
  });
  return { value: value.asReadonly(), error: error.asReadonly(), pending: pending.asReadonly() };
};
