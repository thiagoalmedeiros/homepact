import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Sheet } from './sheet';

@Component({
  selector: 'hc-reason-sheet',
  imports: [FormsModule, Sheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reason-sheet.html',
})
export class ReasonSheet {
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly busy = input(false);
  readonly confirmed = output<string>();
  readonly closed = output<void>();
  protected reason = '';

  protected submit(): void {
    if (this.reason.trim().length >= 3) this.confirmed.emit(this.reason.trim());
  }
}
