import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { AgreementTemplate, AgreementUpdate } from '@homepact/shared';
import { CONDITION_PRESETS } from '@homepact/shared/agreement-fields';
import type { Currency } from '@homepact/shared/format';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe, toCents } from '../../shared/money.pipe';
import { Sheet } from '../../shared/sheet';

interface DepositRow {
  label: string;
  amount: number | null;
  dueDate: string;
}
interface ConditionRow {
  label: string;
  details: string;
  dueDate: string;
}
interface PurchaserRow {
  name: string;
  email: string;
  phone: string;
}

const purchaserRow = (): PurchaserRow => ({ name: '', email: '', phone: '' });

/** What the seller decides for an agreement: template, purchasers, deposits, conditions, closing
 * and special terms. Prices come from the signed revision. */
@Component({
  selector: 'hc-agreement-terms-sheet',
  imports: [FormsModule, RouterLink, Sheet, LoadState, MoneyPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreement-terms-sheet.html',
  styleUrl: './agreement-terms-sheet.scss',
})
export class AgreementTermsSheet {
  protected readonly defaultTitle = $localize`:@@console.terms.prepareTitle:Prepare the purchase agreement`;
  protected readonly depositOnSigning = $localize`:@@console.terms.onSigning:on signing`;
  protected readonly removeLabel = $localize`:@@common.actions.remove:Remove`;
  protected readonly amountLabel = $localize`:@@console.terms.amount:Amount`;
  protected readonly dueLabel = $localize`:@@console.terms.due:Due date`;
  protected readonly byLabel = $localize`:@@console.terms.by:By date`;
  protected readonly detailsLabel = $localize`:@@console.terms.details:Details`;

  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly paths = PATHS;
  protected readonly presets = CONDITION_PRESETS;
  readonly title = input<string>();
  readonly submitLabel = input<string>();
  readonly totalCents = input.required<number>();
  readonly currency = input.required<Currency>();
  readonly initial = input<Partial<AgreementUpdate>>({});
  readonly busy = input(false);
  readonly submitted = output<AgreementUpdate>();
  readonly closed = output<void>();

  protected readonly templates = resource({
    loader: () => this.api.get<AgreementTemplate[]>(API.agreementTemplates.list),
  });
  protected readonly templateId = signal('');
  protected readonly purchasers = signal<PurchaserRow[]>([purchaserRow()]);
  protected readonly deposits = signal<DepositRow[]>([
    { label: this.depositOnSigning, amount: null, dueDate: '' },
  ]);
  protected readonly conditions = signal<ConditionRow[]>([]);
  protected closingDate = '';
  protected specialTerms = '';

  private readonly edits = signal(0);
  protected readonly depositCents = computed(() => {
    this.edits();
    return this.deposits().reduce((total, d) => total + toCents(d.amount), 0);
  });
  protected readonly valid = computed(() => {
    this.edits();
    return (
      this.purchasers().every((p) => p.name.trim().length >= 2) &&
      this.deposits().length > 0 &&
      this.deposits().every((d) => d.label.trim() && toCents(d.amount) > 0) &&
      this.depositCents() <= this.totalCents() &&
      this.conditions().every((c) => c.label.trim())
    );
  });

  protected touch(): void {
    this.edits.update((n) => n + 1);
  }

  private formSeeded = false;

  constructor() {
    effect(() => this.seedFormOnce());
    effect(() => this.preselectDefaultTemplate());
  }

  private seedFormOnce(): void {
    const init = this.initial();
    if (this.formSeeded) return;
    this.formSeeded = true;
    untracked(() => {
      this.purchasers.set(
        init.purchasers?.length
          ? init.purchasers.map((p) => ({
              name: p.name,
              email: p.email ?? '',
              phone: p.phone ?? '',
            }))
          : [purchaserRow()],
      );
      this.deposits.set(
        init.deposits?.length
          ? init.deposits.map((d) => ({
              label: d.label,
              amount: d.amountCents / 100,
              dueDate: d.dueDate ?? '',
            }))
          : [{ label: this.depositOnSigning, amount: null, dueDate: '' }],
      );
      this.conditions.set(
        (init.conditions ?? []).map((c) => ({
          label: c.label,
          details: c.details ?? '',
          dueDate: c.dueDate ?? '',
        })),
      );
      this.closingDate = init.closingDate ?? '';
      this.specialTerms = init.specialTerms ?? '';
      this.templateId.set(init.templateId ?? '');
    });
  }

  private preselectDefaultTemplate(): void {
    const list = this.templates.hasValue() ? this.templates.value() : [];
    untracked(() => {
      if (list.length && !list.some((t) => t.id === this.templateId())) {
        this.templateId.set((list.find((t) => t.isDefault) ?? list[0]!).id);
      }
    });
  }

  protected addPurchaser(): void {
    this.purchasers.update((list) => [...list, purchaserRow()]);
  }
  protected removePurchaser(i: number): void {
    this.purchasers.update((list) => list.filter((_, j) => j !== i));
  }
  protected addDeposit(): void {
    this.deposits.update((list) => [...list, { label: '', amount: null, dueDate: '' }]);
  }
  protected removeDeposit(i: number): void {
    this.deposits.update((list) => list.filter((_, j) => j !== i));
  }
  protected addCondition(preset?: { label: string; details: string }): void {
    this.conditions.update((list) => [
      ...list,
      { label: preset?.label ?? '', details: preset?.details ?? '', dueDate: '' },
    ]);
  }
  protected removeCondition(i: number): void {
    this.conditions.update((list) => list.filter((_, j) => j !== i));
  }
  protected used(preset: { label: string }): boolean {
    return this.conditions().some((c) => c.label === preset.label);
  }

  protected submit(): void {
    this.submitted.emit({
      templateId: this.templateId(),
      purchasers: this.purchasers().map((p) => ({
        name: p.name.trim(),
        ...(p.email.trim() && { email: p.email.trim() }),
        ...(p.phone.trim() && { phone: p.phone.trim() }),
      })),
      deposits: this.deposits().map((d) => ({
        label: d.label.trim(),
        amountCents: toCents(d.amount),
        ...(d.dueDate && { dueDate: d.dueDate }),
      })),
      conditions: this.conditions().map((c) => ({
        label: c.label.trim(),
        ...(c.details.trim() && { details: c.details.trim() }),
        ...(c.dueDate && { dueDate: c.dueDate }),
      })),
      ...(this.closingDate && { closingDate: this.closingDate }),
      ...(this.specialTerms.trim() && { specialTerms: this.specialTerms.trim() }),
    });
  }
}
