import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { AgreementTemplate } from '@homepact/shared';
import {
  AGREEMENT_FIELDS,
  STARTER_AGREEMENT_TEMPLATE,
  unknownFields,
  type AgreementFieldKey,
  type AgreementSectionText,
} from '@homepact/shared/agreement-fields';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { copyText } from '../../shared/copy';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';

interface Draft {
  name: string;
  title: string;
  sections: AgreementSectionText[];
  isDefault: boolean;
}

const FIELD_LABELS = {
  'agreement.reference': $localize`:@@fields.agreement.reference:Agreement number`,
  'agreement.date': $localize`:@@fields.agreement.date:Date the agreement was prepared`,
  'seller.name': $localize`:@@fields.seller.name:Your company name`,
  'seller.address': $localize`:@@fields.seller.address:Your company address`,
  'seller.phone': $localize`:@@fields.seller.phone:Your company phone`,
  'seller.email': $localize`:@@fields.seller.email:Your company email`,
  'buyer.name': $localize`:@@fields.buyer.name:Purchaser names (all of them)`,
  'buyer.email': $localize`:@@fields.buyer.email:Purchaser email (first purchaser)`,
  'buyer.phone': $localize`:@@fields.buyer.phone:Purchaser phone (first purchaser)`,
  'home.model': $localize`:@@fields.home.model:Floor plan name`,
  'home.address': $localize`:@@fields.home.address:Civic address (pre-existing homes)`,
  'home.community': $localize`:@@fields.home.community:Community`,
  'home.description': $localize`:@@fields.home.description:One-line description of the home`,
  'proposal.reference': $localize`:@@fields.proposal.reference:Signed proposal number`,
  'proposal.revision': $localize`:@@fields.proposal.revision:Revision the buyer signed`,
  'proposal.signedBy': $localize`:@@fields.proposal.signedBy:Name the buyer signed the proposal with`,
  'proposal.signedOn': $localize`:@@fields.proposal.signedOn:Date the proposal was signed`,
  'price.base': $localize`:@@fields.price.base:Base price of the plan`,
  'price.options': $localize`:@@fields.price.options:Total of packages and options`,
  'price.adjustments': $localize`:@@fields.price.adjustments:Total of price adjustments`,
  'price.beforeTax': $localize`:@@fields.price.beforeTax:Purchase price before tax`,
  'price.tax': $localize`:@@fields.price.tax:Sales tax`,
  'price.taxDetails': $localize`:@@fields.price.taxDetails:Sales tax rates and province, e.g. "HST 13%, Ontario"`,
  'price.total': $localize`:@@fields.price.total:Purchase price, sales tax included`,
  'referral.program': $localize`:@@fields.referral.program:Referral program`,
  'referral.referrer': $localize`:@@fields.referral.referrer:Who referred the buyer`,
  'referral.credit': $localize`:@@fields.referral.credit:Referral credit to the buyer`,
  'referral.summary': $localize`:@@fields.referral.summary:The referral and its credit, in one sentence`,
  'purchasers.list': $localize`:@@fields.purchasers.list:Purchasers, one per line`,
  'deposit.amount': $localize`:@@fields.deposit.amount:Deposit (total of the schedule)`,
  'deposit.schedule': $localize`:@@fields.deposit.schedule:Deposit schedule, one instalment per line`,
  'balance.amount': $localize`:@@fields.balance.amount:Balance due on closing`,
  'conditions.list': $localize`:@@fields.conditions.list:Conditions, one per line`,
  'closing.date': $localize`:@@fields.closing.date:Closing and possession date`,
  'special.terms': $localize`:@@fields.special.terms:Special terms of this agreement`,
  'rep.name': $localize`:@@fields.rep.name:Sales representative`,
} satisfies Record<AgreementFieldKey, string>;

const starter = (): Draft => ({
  ...structuredClone(STARTER_AGREEMENT_TEMPLATE),
  isDefault: false,
});

/** Edits the wording of a purchase agreement template; `{{fields}}` are filled per agreement. */
@Component({
  selector: 'hc-console-agreement-template',
  imports: [FormsModule, RouterLink, LoadState, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreement-template-editor.page.html',
  styleUrl: './agreement-template-editor.page.scss',
})
export class AgreementTemplateEditorPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly paths = PATHS;
  readonly id = input<string>();
  protected readonly fields: AgreementFieldKey[] = AGREEMENT_FIELDS.map((f) => f.key);

  protected readonly existing = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.get<AgreementTemplate>(API.agreementTemplates.one(params)),
  });
  protected draft: Draft = starter();
  private readonly edits = signal(0);
  protected readonly busy = signal(false);
  protected readonly ready = computed(() => !this.id() || this.existing.hasValue());
  protected readonly invalid = computed(() => {
    this.edits();
    const d = this.draft;
    return (
      !d.name.trim() ||
      !d.title.trim() ||
      d.sections.some((s) => !s.heading.trim() || !s.body.trim()) ||
      [d.title, ...d.sections.flatMap((s) => [s.heading, s.body])].some(
        (t) => unknownFields(t).length > 0,
      )
    );
  });
  private lastFocused: HTMLInputElement | HTMLTextAreaElement | null = null;

  constructor() {
    effect(() => {
      const t = this.existing.hasValue() ? this.existing.value() : undefined;
      untracked(() => {
        if (!t) return;
        this.draft = {
          name: t.name,
          title: t.title,
          sections: t.sections.map((s) => ({ ...s })),
          isDefault: t.isDefault,
        };
        this.touch();
      });
    });
  }

  protected isAdmin(): boolean {
    return this.auth.isAdmin();
  }

  protected token(key: string): string {
    return `{{${key}}}`;
  }

  protected unknownIn(text: string): string[] {
    return unknownFields(text);
  }

  protected readonly fieldLabels = FIELD_LABELS;

  protected touch(): void {
    this.edits.update((n) => n + 1);
  }

  protected track(event: FocusEvent): void {
    const el = event.target;
    if (
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.hasAttribute('data-merge')
    ) {
      this.lastFocused = el;
    }
  }

  /** Inserts a field at the cursor of the last focused text, or copies it. */
  protected async insert(key: string): Promise<void> {
    const text = this.token(key);
    const el = this.lastFocused;
    if (!el?.isConnected) {
      this.toast.show(
        (await copyText(text))
          ? $localize`:@@console.templateEditor.copied:Copied ${text}:field:`
          : text,
      );
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    el.setRangeText(text, start, el.selectionEnd ?? start, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  }

  protected addSection(): void {
    this.draft.sections = [...this.draft.sections, { heading: '', body: '' }];
    this.touch();
  }

  protected removeSection(i: number): void {
    this.draft.sections = this.draft.sections.filter((_, j) => j !== i);
    this.touch();
  }

  protected move(i: number, by: -1 | 1): void {
    const list = [...this.draft.sections];
    [list[i], list[i + by]] = [list[i + by]!, list[i]!];
    this.draft.sections = list;
    this.touch();
  }

  protected async save(): Promise<void> {
    if (this.busy() || this.invalid() || !this.isAdmin()) return;
    this.busy.set(true);
    const id = this.id();
    try {
      if (id) await this.api.put(API.agreementTemplates.one(id), this.draft);
      else await this.api.post(API.agreementTemplates.list, this.draft);
      this.toast.success($localize`:@@console.templateEditor.saved:${this.draft.name}:name: saved`);
      void this.router.navigateByUrl(PATHS.console.templates);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const id = this.id();
    if (!id) return;
    const ok = await this.confirm.ask({
      title: $localize`:@@console.templateEditor.confirmDelete.title:Delete ${this.draft.name}:name:?`,
      message: $localize`:@@console.templateEditor.confirmDelete.message:Agreements already prepared from it are not affected. Drafts that use it need another template when they are edited.`,
      confirmLabel: $localize`:@@console.templateEditor.confirmDelete.confirm:Delete template`,
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(API.agreementTemplates.one(id));
      this.toast.success($localize`:@@console.templateEditor.deleted:Template deleted`);
      void this.router.navigateByUrl(PATHS.console.templates);
    } catch (err) {
      this.toast.error(err);
    }
  }
}
