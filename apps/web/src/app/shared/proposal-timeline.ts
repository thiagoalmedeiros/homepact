import { ChangeRequestStatus } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ChangeRequest, ProposalDetail, Revision } from '@homepact/shared';
import { ChangeLines } from './change-lines';
import { Icon } from './icon';
import { MoneyPipe } from './money.pipe';
import { RelativeTimePipe } from './relative-time.pipe';

type Entry =
  | { kind: 'revision'; at: string; revision: Revision }
  | { kind: 'request'; at: string; request: ChangeRequest }
  | { kind: 'signed'; at: string; name: string; revision: number; totalCents: number };

/** Revisions, change requests and the signature, newest first. */
@Component({
  selector: 'hc-proposal-timeline',
  imports: [MoneyPipe, RelativeTimePipe, ChangeLines, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './proposal-timeline.html',
  styleUrl: './proposal-timeline.scss',
})
export class ProposalTimeline {
  protected readonly ChangeRequestStatus = ChangeRequestStatus;
  readonly detail = input.required<ProposalDetail>();
  readonly view = output<number>();
  protected readonly entries = computed<Entry[]>(() => {
    const d = this.detail();
    const out: Entry[] = [
      ...d.revisions.map((revision) => ({
        kind: 'revision' as const,
        at: revision.createdAt,
        revision,
      })),
      ...d.changeRequests.map((request) => ({
        kind: 'request' as const,
        at: request.createdAt,
        request,
      })),
    ];
    const s = d.proposal.signature;
    if (s)
      out.push({
        kind: 'signed',
        at: s.signedAt,
        name: s.fullName,
        revision: s.revision,
        totalCents: s.totalCents,
      });
    return out.sort((a, b) => b.at.localeCompare(a.at));
  });
}
