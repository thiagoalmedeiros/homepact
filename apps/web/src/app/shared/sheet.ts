import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Icon } from './icon';

let sheetSeq = 0;

/** Modal sheet on a native <dialog>; the backdrop never closes it, so long forms are never lost. */
@Component({
  selector: 'hc-sheet',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sheet.html',
  styleUrl: './sheet.scss',
})
export class Sheet implements AfterViewInit, OnDestroy {
  readonly title = input.required<string>();
  readonly dismissible = input(true);
  readonly closed = output<void>();
  protected readonly titleId = `sheet-title-${++sheetSeq}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly opener =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  ngAfterViewInit(): void {
    const el = this.dialog().nativeElement;
    const supportsModal = typeof el.showModal === 'function';
    if (supportsModal) el.showModal();
    else el.setAttribute('open', '');
    document.documentElement.classList.add('sheet-open');
  }

  ngOnDestroy(): void {
    const el = this.dialog().nativeElement;
    if (el.open && typeof el.close === 'function') el.close();
    if (!document.querySelector('dialog.sheet-dialog[open]')) {
      document.documentElement.classList.remove('sheet-open');
    }
    this.opener?.focus?.();
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    if (this.dismissible()) this.closed.emit();
  }
}
