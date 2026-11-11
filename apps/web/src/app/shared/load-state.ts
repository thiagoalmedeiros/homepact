import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Resource } from '@angular/core';

/** Loading skeleton or error-with-retry for a resource; renders nothing once it has a value. */
@Component({
  selector: 'hc-load-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './load-state.html',
  styleUrl: './load-state.scss',
})
export class LoadState {
  readonly resource = input.required<Resource<unknown> & { reload?: () => boolean }>();
  readonly height = input(56);
  protected reload(): void {
    this.resource().reload?.();
  }
}
