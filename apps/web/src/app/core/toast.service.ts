import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  private readonly timers = new Map<
    number,
    { handle: ReturnType<typeof setTimeout>; ms: number }
  >();

  show(text: string, tone: Toast['tone'] = 'info', ms = 4500): void {
    const id = ++this.seq;
    this.toasts.update((t) => [...t, { id, text, tone }]);
    this.schedule(id, ms);
  }

  /** Pause auto-dismiss while the pointer or focus is on a toast. */
  hold(id: number): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t.handle);
  }

  release(id: number): void {
    const t = this.timers.get(id);
    if (t) this.schedule(id, t.ms);
  }

  private schedule(id: number, ms: number): void {
    this.timers.set(id, { handle: setTimeout(() => this.dismiss(id), ms), ms });
  }

  success(text: string): void {
    this.show(text, 'success');
  }

  error(err: unknown): void {
    this.show(err instanceof Error ? err.message : String(err), 'error', 8000);
  }

  dismiss(id: number): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t.handle);
    this.timers.delete(id);
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
