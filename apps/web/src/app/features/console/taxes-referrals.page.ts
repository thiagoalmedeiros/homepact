import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  ReferralProgram,
  ReferralProgramInput,
  TaxComponent,
  TaxPreset,
  TaxRate,
  TaxRateInput,
} from '@homepact/shared';
import { formatPercent } from '@homepact/shared/format';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe, toCents } from '../../shared/money.pipe';
import { Sheet } from '../../shared/sheet';
import {
  TaxComponentsEditor,
  toComponents,
  validComponents,
  type TaxComponentDraft,
} from '../../shared/tax-components-editor';

interface RateDraft {
  id?: string;
  code: string;
  name: string;
  isDefault: boolean;
}

interface ProgramDraft {
  id?: string;
  name: string;
  description: string;
  credit: number | null;
  active: boolean;
}

const blankRate = (): RateDraft => ({ code: '', name: '', isDefault: false });

const blankProgram = (): ProgramDraft => ({
  name: '',
  description: '',
  credit: null,
  active: true,
});

/** The company's sales tax by province and referral programs: administrators manage them, sales
 * staff view them. Quotes keep the rates they were priced with. */
@Component({
  selector: 'hc-console-taxes-referrals',
  imports: [FormsModule, LoadState, Sheet, Icon, MoneyPipe, TaxComponentsEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './taxes-referrals.page.html',
  styleUrl: './taxes-referrals.page.scss',
})
export class TaxesReferralsPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly locale = inject(LOCALE_ID);
  protected readonly auth = inject(AuthService);

  protected readonly rates = resource({
    loader: () => this.api.get<TaxRate[]>(API.taxRates.list),
  });
  protected readonly programs = resource({
    loader: () => this.api.get<ReferralProgram[]>(API.referralPrograms.list),
  });
  protected readonly presets = resource({
    params: () => (this.sheet() === 'suggestions' ? true : undefined),
    loader: () => this.api.get<TaxPreset[]>(API.taxPresets),
  });

  protected readonly sheet = signal<'suggestions' | 'rate' | 'program' | null>(null);
  protected readonly busy = signal(false);
  protected rateDraft: RateDraft = blankRate();
  protected programDraft: ProgramDraft = blankProgram();
  private readonly edits = signal(0);
  protected readonly rateComponents = signal<TaxComponentDraft[]>([]);

  protected readonly adoptedCodes = computed(
    () => new Set((this.rates.hasValue() ? this.rates.value() : []).map((r) => r.code)),
  );
  protected readonly rateValid = computed(() => {
    this.edits();
    const d = this.rateDraft;
    return (
      /^[A-Za-z0-9]{2,6}$/.test(d.code.trim()) &&
      !!d.name.trim() &&
      validComponents(this.rateComponents())
    );
  });
  protected readonly programValid = computed(() => {
    this.edits();
    const d = this.programDraft;
    return !!d.name.trim() && d.credit !== null && d.credit >= 0;
  });

  protected readonly text = {
    newRate: $localize`:@@console.taxes.rateSheet.new:Add a province`,
    editRate: $localize`:@@console.taxes.rateSheet.edit:Edit a province`,
    newProgram: $localize`:@@console.taxes.programSheet.new:New referral program`,
    editProgram: $localize`:@@console.taxes.programSheet.edit:Edit referral program`,
    suggestions: $localize`:@@console.taxes.suggestions.title:Sales tax suggestions`,
  };

  protected isAdmin(): boolean {
    return this.auth.isAdmin();
  }

  /** "GST 5% + QST 9.975%". */
  protected summary(components: TaxComponent[]): string {
    return components
      .map((c) => `${c.label} ${formatPercent(c.ratePercent, this.locale)}`)
      .join(' + ');
  }

  protected activeLabel(name: string): string {
    return $localize`:@@console.taxes.programs.activeLabel:Active ${name}:name:`;
  }

  protected touch(): void {
    this.edits.update((n) => n + 1);
  }

  protected openSuggestions(): void {
    this.sheet.set('suggestions');
  }

  protected async adopt(preset: TaxPreset): Promise<void> {
    await this.run(
      () => this.api.post(API.taxRates.adopt, { presetId: preset.id }),
      $localize`:@@console.taxes.adopted:${preset.name}:province: added`,
      () => this.rates.reload(),
      false,
    );
  }

  protected newRate(): void {
    this.rateDraft = blankRate();
    this.rateComponents.set([{ label: '', ratePercent: null }]);
    this.sheet.set('rate');
  }

  protected editRate(r: TaxRate): void {
    this.rateDraft = { id: r.id, code: r.code, name: r.name, isDefault: r.isDefault };
    this.rateComponents.set(r.components.map((c) => ({ ...c })));
    this.sheet.set('rate');
  }

  protected async saveRate(): Promise<void> {
    if (!this.rateValid()) return;
    const d = this.rateDraft;
    const body: TaxRateInput = {
      code: d.code.trim().toUpperCase(),
      name: d.name.trim(),
      components: toComponents(this.rateComponents()),
      isDefault: d.isDefault,
    };
    await this.run(
      () =>
        d.id ? this.api.put(API.taxRates.one(d.id), body) : this.api.post(API.taxRates.list, body),
      $localize`:@@console.taxes.rateSaved:${body.name}:province: saved`,
      () => this.rates.reload(),
    );
  }

  protected async makeDefault(r: TaxRate): Promise<void> {
    const body: TaxRateInput = {
      code: r.code,
      name: r.name,
      components: r.components,
      isDefault: true,
    };
    await this.run(
      () => this.api.put(API.taxRates.one(r.id), body),
      $localize`:@@console.taxes.defaultSet:New proposals start in ${r.name}:province:`,
      () => this.rates.reload(),
      false,
    );
  }

  protected async removeRate(r: TaxRate): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`:@@console.taxes.confirmRemove.title:Remove ${r.name}:province:?`,
      message: $localize`:@@console.taxes.confirmRemove.message:New proposals can no longer be priced in this province. Proposals and agreements already priced in it keep their sales tax.`,
      confirmLabel: $localize`:@@console.taxes.confirmRemove.confirm:Remove`,
      destructive: true,
    });
    if (!ok) return;
    await this.run(
      () => this.api.delete(API.taxRates.one(r.id)),
      $localize`:@@console.taxes.removed:${r.name}:province: removed`,
      () => this.rates.reload(),
      false,
    );
  }

  protected newProgram(): void {
    this.programDraft = blankProgram();
    this.sheet.set('program');
  }

  protected editProgram(p: ReferralProgram): void {
    this.programDraft = {
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      credit: p.creditCents / 100,
      active: p.active,
    };
    this.sheet.set('program');
  }

  protected async saveProgram(): Promise<void> {
    if (!this.programValid()) return;
    const d = this.programDraft;
    const body: ReferralProgramInput = {
      name: d.name.trim(),
      description: d.description.trim(),
      creditCents: toCents(d.credit),
      active: d.active,
    };
    await this.run(
      () =>
        d.id
          ? this.api.patch(API.referralPrograms.one(d.id), body)
          : this.api.post(API.referralPrograms.list, body),
      $localize`:@@console.taxes.programSaved:${body.name}:program: saved`,
      () => this.programs.reload(),
    );
  }

  protected async toggleProgram(p: ReferralProgram): Promise<void> {
    await this.run(
      () => this.api.patch(API.referralPrograms.one(p.id), { active: !p.active }),
      p.active
        ? $localize`:@@console.taxes.programEnded:${p.name}:program: can no longer be applied to new proposals`
        : $localize`:@@console.taxes.programResumed:${p.name}:program: can be applied again`,
      () => this.programs.reload(),
      false,
    );
  }

  protected async removeProgram(p: ReferralProgram): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`:@@console.taxes.confirmRemoveProgram.title:Delete ${p.name}:program:?`,
      message: $localize`:@@console.taxes.confirmRemoveProgram.message:Proposals that already use it keep their referral and its credit.`,
      confirmLabel: $localize`:@@console.taxes.confirmRemoveProgram.confirm:Delete`,
      destructive: true,
    });
    if (!ok) return;
    await this.run(
      () => this.api.delete(API.referralPrograms.one(p.id)),
      $localize`:@@console.taxes.programRemoved:${p.name}:program: deleted`,
      () => this.programs.reload(),
    );
  }

  private async run(
    request: () => Promise<unknown>,
    success: string,
    reload: () => void,
    closeSheet = true,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await request();
      this.toast.success(success);
      if (closeSheet) this.sheet.set(null);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
      reload();
    }
  }
}
