import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HealthService } from './health.service';

@Component({
  selector: 'app-root',
  template: `
    <main>
      <h1>Homepact</h1>
      <p>Proposal and contract negotiation for new-home sales.</p>
      <p class="status" [attr.data-status]="status() ?? 'checking'">
        API: {{ status() ?? 'checking…' }}
      </p>
    </main>
  `,
  styles: `
    main {
      max-width: 40rem;
      margin: 4rem auto;
      padding: 0 1rem;
    }
    .status[data-status='ok'] {
      color: #1a7f37;
    }
    .status[data-status='degraded'],
    .status[data-status='unreachable'] {
      color: #b42318;
    }
  `,
})
export class App {
  protected readonly status = toSignal(inject(HealthService).status());
}
