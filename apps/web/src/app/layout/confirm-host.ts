import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmService } from '../core/confirm.service';
import { Sheet } from '../shared/sheet';

@Component({
  selector: 'hc-confirm-host',
  imports: [Sheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-host.html',
  styleUrl: './confirm-host.scss',
})
export class ConfirmHost {
  protected readonly confirm = inject(ConfirmService);
}
