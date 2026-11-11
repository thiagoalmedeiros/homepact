import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICON_PATHS } from './icon-paths';

@Component({
  selector: 'hc-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', style: 'display:inline-flex;flex:none' },
  templateUrl: './icon.html',
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(20);
  readonly weight = input(1.8);
  protected readonly d = computed(() => ICON_PATHS[this.name()] ?? '');
}
