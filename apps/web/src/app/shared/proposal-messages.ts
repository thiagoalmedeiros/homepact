import { Party, type ProposalParty } from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ProposalMessage } from '@homepact/shared';
import { Icon } from './icon';
import { RelativeTimePipe } from './relative-time.pipe';

/** Conversation between buyer and seller, alongside the formal change requests. */
@Component({
  selector: 'hc-proposal-messages',
  imports: [FormsModule, RelativeTimePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './proposal-messages.html',
  styleUrl: './proposal-messages.scss',
})
export class ProposalMessages {
  readonly messages = input.required<ProposalMessage[]>();
  readonly viewer = input.required<ProposalParty>();
  protected readonly Party = Party;
  readonly canSend = input(true);
  readonly sending = input(false);
  readonly send = output<string>();
  protected draft = '';
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    effect(() => {
      this.messages();
      const el = this.scroller()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
  }

  protected submit(): void {
    const body = this.draft.trim();
    if (!body) return;
    this.send.emit(body);
    this.draft = '';
  }
}
