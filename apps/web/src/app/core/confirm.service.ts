import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
}

/** Promise-based confirmation sheet for destructive or irreversible actions. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly pending = signal<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);

  ask(request: ConfirmRequest): Promise<boolean> {
    this.pending()?.resolve(false);
    return new Promise((resolve) => this.pending.set({ ...request, resolve }));
  }

  answer(ok: boolean): void {
    const p = this.pending();
    this.pending.set(null);
    p?.resolve(ok);
  }
}
