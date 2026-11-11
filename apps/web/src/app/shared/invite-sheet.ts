import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { PATHS } from '../core/app-paths';
import { TenantService } from '../core/tenant.service';
import { ToastService } from '../core/toast.service';
import { copyText } from './copy';
import { Icon } from './icon';
import { Sheet } from './sheet';
import { COMMON_TEXT } from './text';

export const inviteLink = (key: string): string =>
  `${location.origin}${PATHS.invite}?key=${encodeURIComponent(key)}`;

/** Shows a buyer's private invite link exactly once, with ways to hand it over. */
@Component({
  selector: 'hc-invite-sheet',
  imports: [Sheet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invite-sheet.html',
})
export class InviteSheet {
  private readonly toast = inject(ToastService);
  private readonly tenant = inject(TenantService);
  readonly accessKey = input.required<string>();
  readonly title = input<string>();
  readonly buyerName = input<string | undefined>();
  readonly buyerEmail = input<string | undefined>();
  readonly done = output<void>();
  protected readonly defaultTitle = $localize`:@@invite.title:Share the proposal`;
  protected readonly theBuyer = COMMON_TEXT.theBuyer;
  protected readonly link = computed(() => inviteLink(this.accessKey()));
  protected readonly mailto = computed(() => {
    const company = this.tenant.company()?.name ?? $localize`:@@invite.us:us`;
    const subject = encodeURIComponent(
      $localize`:@@invite.mailSubject:Your home proposal from ${company}:company:`,
    );
    const body = encodeURIComponent(
      $localize`:@@invite.mailBody:Hi ${this.buyerName()?.split(' ')[0] ?? ''}:name:,

Here is your private link to review the proposal, request changes and sign:

${this.link()}:link:

Please keep it to yourself; anyone with the link can open the proposal.`,
    );
    return `mailto:${this.buyerEmail()}?subject=${subject}&body=${body}`;
  });

  protected async copy(): Promise<void> {
    if (await copyText(this.link())) this.toast.success($localize`:@@invite.copied:Link copied`);
    else this.toast.show($localize`:@@invite.copyManually:Select the link and copy it manually.`);
  }
}
