import {
  AmendmentStatus,
  isOpenAmendment,
  isUnsignedAmendment,
  SignerStatus,
} from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Agreement, Amendment, AmendmentIssued, SignerInvitation } from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { AmendmentView } from '../../shared/amendment-view';
import { copyText } from '../../shared/copy';
import { downloadAmendment } from '../../shared/download';
import { Icon } from '../../shared/icon';
import { ReasonSheet } from '../../shared/reason-sheet';
import { Sheet } from '../../shared/sheet';
import { AmendmentDraftSheet } from './amendment-draft-sheet';

interface Handout extends SignerInvitation {
  link: string;
}

/** An executed agreement's change orders, for the company: sales drafts, declines and sends them
 * (signing for the company), an administrator other than whoever priced or sent one approves or
 * rejects it; finance reads. */
@Component({
  selector: 'hc-agreement-amendments',
  imports: [FormsModule, AmendmentView, AmendmentDraftSheet, ReasonSheet, Sheet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreement-amendments.html',
})
export class AgreementAmendments {
  protected readonly AmendmentStatus = AmendmentStatus;
  protected readonly SignerStatus = SignerStatus;
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  readonly agreement = input.required<Agreement>();
  /** A change order took effect: the agreement's price and schedule changed. */
  readonly executed = output<void>();

  protected readonly orders = resource({
    params: () => this.agreement().id,
    loader: ({ params }) => this.api.get<Amendment[]>(API.amendments.list(params)),
  });
  protected readonly list = computed(() =>
    this.orders.hasValue() ? [...this.orders.value()].reverse() : [],
  );
  protected readonly hasOpen = computed(() => this.list().some((o) => isOpenAmendment(o.status)));
  protected readonly isUnsigned = isUnsignedAmendment;

  protected readonly drafting = signal<Amendment | null>(null);
  protected readonly sending = signal<Amendment | null>(null);
  protected readonly approving = signal<Amendment | null>(null);
  protected readonly rejecting = signal<Amendment | null>(null);
  protected readonly declining = signal<Amendment | null>(null);
  protected readonly opening = signal(false);
  protected readonly handouts = signal<Handout[]>([]);
  protected readonly busy = signal(false);
  protected signName = '';
  protected signAgree = false;
  protected newNote = '';

  protected readonly text = {
    rejectTitle: $localize`:@@console.amendments.rejectTitle:Refuse this change order?`,
    rejectMessage: $localize`:@@console.amendments.rejectMessage:Nothing changes on the agreement; the buyer sees your reason.`,
    rejectConfirm: $localize`:@@console.amendments.rejectConfirm:Refuse it`,
    declineTitle: $localize`:@@console.amendments.declineTitle:Decline this change order?`,
    declineMessage: $localize`:@@console.amendments.declineMessage:Nothing changes on the agreement; the buyer sees your reason and can ask again.`,
    declineConfirm: $localize`:@@console.amendments.declineConfirm:Decline it`,
  };

  /** An administrator approves, but never a change order they priced or sent. */
  protected mayApprove(o: Amendment): boolean {
    const me = this.auth.user()?.id;
    return (
      this.auth.isAdmin() &&
      o.status === AmendmentStatus.AwaitingApproval &&
      o.pricedBy?.id !== me &&
      o.issuedBy?.id !== me
    );
  }

  protected openSend(o: Amendment): void {
    this.signName = this.auth.user()?.name ?? '';
    this.signAgree = false;
    this.sending.set(o);
  }

  protected openApprove(o: Amendment): void {
    this.signName = this.auth.user()?.name ?? '';
    this.signAgree = false;
    this.approving.set(o);
  }

  protected drafted(): void {
    this.drafting.set(null);
    this.orders.reload();
  }

  protected async send(o: Amendment): Promise<void> {
    const issued = await this.act(() =>
      this.api.post<AmendmentIssued>(API.amendments.issue(o.agreementId, o.id), {
        contentHash: o.contentHash,
        fullName: this.signName.trim(),
        agree: true,
      }),
    );
    if (!issued) return;
    this.sending.set(null);
    this.handouts.set(issued.invitations.map((i) => this.handout(i)));
    this.toast.success($localize`:@@console.amendments.sent:Sent for signature`);
  }

  protected async reinvite(o: Amendment, purchaserId: string): Promise<void> {
    const invitation = await this.act(() =>
      this.api.post<SignerInvitation>(API.amendments.invite(o.agreementId, o.id, purchaserId), {}),
    );
    if (invitation) this.handouts.set([this.handout(invitation)]);
  }

  protected async approve(o: Amendment): Promise<void> {
    const done = await this.act(() =>
      this.api.post<Amendment>(API.amendments.approve(o.agreementId, o.id), {
        contentHash: o.contentHash,
        fullName: this.signName.trim(),
        agree: true,
      }),
    );
    if (!done) return;
    this.approving.set(null);
    if (done.status === AmendmentStatus.Executed) this.executed.emit();
    this.toast.success(
      $localize`:@@console.amendments.approved:Approved: the change order is executed`,
    );
  }

  protected async reject(o: Amendment, reason: string): Promise<void> {
    if (
      await this.act(() =>
        this.api.post<Amendment>(API.amendments.reject(o.agreementId, o.id), { reason }),
      )
    ) {
      this.rejecting.set(null);
    }
  }

  protected async decline(o: Amendment, reason: string): Promise<void> {
    if (
      await this.act(() =>
        this.api.post<Amendment>(API.amendments.decline(o.agreementId, o.id), { reason }),
      )
    ) {
      this.declining.set(null);
    }
  }

  /** Sales opens a change order for the buyer, e.g. asked by phone, then drafts it. */
  protected async openForBuyer(): Promise<void> {
    const note = this.newNote.trim();
    if (!note) return;
    const created = await this.act(() =>
      this.api.post<Amendment>(API.amendments.list(this.agreement().id), { changes: [], note }),
    );
    if (!created) return;
    this.opening.set(false);
    this.newNote = '';
    this.drafting.set(created);
  }

  protected async download(o: Amendment): Promise<void> {
    try {
      await downloadAmendment(this.api, o);
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected async copy(h: Handout): Promise<void> {
    const text = $localize`:@@console.agreement.handoutText:${h.link}:link: — code ${h.code}:code:`;
    this.toast.show(
      (await copyText(text)) ? $localize`:@@console.agreement.copied:Link and code copied` : text,
    );
  }

  private handout(invitation: SignerInvitation): Handout {
    return {
      ...invitation,
      link: `${location.origin}${PATHS.invite}?key=${encodeURIComponent(invitation.key)}`,
    };
  }

  /** One request at a time; the change orders are reloaded afterwards, whatever happened. */
  private async act<T>(request: () => Promise<T>): Promise<T | undefined> {
    if (this.busy()) return undefined;
    this.busy.set(true);
    try {
      return await request();
    } catch (err) {
      this.toast.error(err);
      return undefined;
    } finally {
      this.busy.set(false);
      this.orders.reload();
    }
  }
}
