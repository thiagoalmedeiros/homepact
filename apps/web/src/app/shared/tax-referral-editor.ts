import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type {
  QuoteSnapshot,
  ReferralInput,
  ReferralProgram,
  TaxComponent,
  TaxRate,
} from '@homepact/shared';
import { formatPercent, type Currency } from '@homepact/shared/format';
import { PATHS } from '../core/app-paths';
import { AuthService } from '../core/auth.service';
import { MoneyPipe } from './money.pipe';

export interface ReferralDraft {
  programId: string;
  referrerName: string;
  referrerEmail: string;
}

export const emptyReferral = (programId = ''): ReferralDraft => ({
  programId,
  referrerName: '',
  referrerEmail: '',
});

/** The referral to price and send, or null when unset or incomplete. Live quotes leave out the
 * contact, which does not change the price. */
export const referralOf = (
  draft: ReferralDraft | null,
  { withContact = true } = {},
): ReferralInput | null => {
  const name = draft?.referrerName.trim() ?? '';
  if (!draft?.programId || name.length < 2) return null;
  const email = draft.referrerEmail.trim();
  return {
    programId: draft.programId,
    referrerName: name,
    ...(withContact && email && { referrerEmail: email }),
  };
};

/** A referral was started but is missing its program or the referrer's name. */
export const referralIncomplete = (draft: ReferralDraft | null): boolean =>
  !!draft && !referralOf(draft);

/** The draft of a referral already on a quote, for editing it. */
export const referralDraftOf = (q: QuoteSnapshot | null | undefined): ReferralDraft | null =>
  q?.referral
    ? {
        programId: q.referral.programId,
        referrerName: q.referral.referrerName,
        referrerEmail: q.referral.referrerEmail ?? '',
      }
    : null;

interface RegionOption {
  code: string;
  name: string;
  rates: string;
}
interface ProgramOption {
  id: string;
  name: string;
  creditCents: number;
}

/** Province and referral of a proposal or a revision. `base` keeps its province and program
 * selectable even if the company removed them. */
@Component({
  selector: 'hc-tax-referral-editor',
  imports: [FormsModule, RouterLink, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tax-referral-editor.html',
  styleUrl: './tax-referral-editor.scss',
})
export class TaxReferralEditor {
  private readonly locale = inject(LOCALE_ID);
  protected readonly auth = inject(AuthService);
  protected readonly paths = PATHS;
  readonly rates = input.required<TaxRate[]>();
  readonly programs = input.required<ReferralProgram[]>();
  readonly currency = input<Currency>('CAD');
  readonly base = input<QuoteSnapshot | null | undefined>(null);
  readonly taxRegion = model.required<string | null>();
  readonly referral = model.required<ReferralDraft | null>();

  private readonly summary = (components: Pick<TaxComponent, 'label' | 'ratePercent'>[]) =>
    components.map((c) => `${c.label} ${formatPercent(c.ratePercent, this.locale)}`).join(' + ');

  protected readonly regions = computed((): RegionOption[] => {
    const list = this.rates().map((r) => ({
      code: r.code,
      name: r.name,
      rates: this.summary(r.components),
    }));
    const kept = this.base()?.tax;
    if (kept && !list.some((r) => r.code === kept.regionCode)) {
      list.push({ code: kept.regionCode, name: kept.regionName, rates: this.summary(kept.lines) });
    }
    return list;
  });

  protected readonly programOptions = computed((): ProgramOption[] => {
    const list = this.programs()
      .filter((p) => p.active)
      .map((p) => ({ id: p.id, name: p.name, creditCents: p.creditCents }));
    const kept = this.base()?.referral;
    if (kept && !list.some((p) => p.id === kept.programId)) {
      list.push({ id: kept.programId, name: kept.programName, creditCents: kept.creditCents });
    }
    return list;
  });

  protected setRegion(code: string): void {
    this.taxRegion.set(code || null);
  }

  protected toggleReferral(on: boolean): void {
    this.referral.set(on ? emptyReferral(this.programOptions()[0]?.id ?? '') : null);
  }

  protected patchReferral(patch: Partial<ReferralDraft>): void {
    this.referral.update((r) => (r ? { ...r, ...patch } : r));
  }
}
