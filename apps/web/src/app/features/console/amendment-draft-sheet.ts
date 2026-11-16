import { AmendmentStatus, ChangeDecision } from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  Adjustment,
  Amendment,
  AmendmentDraftPreview,
  AmendmentPricing,
  Change,
  HouseDetail,
  Selections,
} from '@homepact/shared';
import { applyChanges, diffSelections } from '@homepact/shared/changes';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { AdjustmentsEditor, cleanAdjustments } from '../../shared/adjustments-editor';
import { ChangeLines } from '../../shared/change-lines';
import { Icon } from '../../shared/icon';
import { livePrice } from '../../shared/live-price';
import { LocalDatePipe } from '../../shared/dates';
import { MoneyPipe, toCents } from '../../shared/money.pipe';
import { SelectionEditor } from '../../shared/selection-editor';
import { Sheet } from '../../shared/sheet';
import { APPROVAL_REASON_LABEL } from '../../shared/status';

interface Decision {
  approved: boolean;
  note: string;
}

interface InstalmentRow {
  label: string;
  dollars: number | null;
  dueDate: string;
}

/** Applies changes, or gives back the selections unchanged when they no longer apply. */
const safely = (
  selections: Selections,
  changes: Change[],
  contents: (packageId: string) => string[] | undefined,
): Selections => {
  try {
    return applyChanges(selections, changes, contents);
  } catch {
    return selections;
  }
};

/** Sales turns a request into a draft change order: decides each requested change, adds catalog
 * options (a request in words becomes priced items), fees, credits and instalments, and sees it
 * priced with tax, and whether an administrator will have to approve it, before saving. */
@Component({
  selector: 'hc-amendment-draft-sheet',
  imports: [
    FormsModule,
    Sheet,
    SelectionEditor,
    AdjustmentsEditor,
    ChangeLines,
    MoneyPipe,
    LocalDatePipe,
    Icon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './amendment-draft-sheet.html',
  styleUrl: './amendment-draft-sheet.scss',
})
export class AmendmentDraftSheet implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly amendment = input.required<Amendment>();
  readonly saved = output<Amendment>();
  readonly closed = output<void>();
  protected readonly AmendmentStatus = AmendmentStatus;
  protected readonly draftTitle = $localize`:@@amendmentDraft.title:Prepare the change order`;
  protected readonly editTitle = $localize`:@@amendmentDraft.editTitle:Edit the change order`;
  protected readonly noClosing = $localize`:@@amendmentDraft.noClosing:the date the company will confirm`;

  protected readonly catalog = resource({
    params: () => this.amendment().agreementId,
    loader: ({ params }) =>
      this.api.get<{ options: HouseDetail; selections: Selections }>(
        API.amendments.options(params),
      ),
  });
  protected readonly options = computed(() =>
    this.catalog.hasValue() ? this.catalog.value()?.options : undefined,
  );
  private readonly contents = computed(() => {
    const map = new Map(
      (this.options()?.areas ?? []).flatMap((a) =>
        a.packages.map((p) => [p.id, p.itemIds] as const),
      ),
    );
    return (id: string) => map.get(id);
  });

  /** What the buyer asked for, as opposed to what sales adds. */
  protected readonly requested = computed(() =>
    this.amendment().changes.filter((c) => !c.addedBySeller),
  );
  protected readonly decisions = signal<Record<string, Decision>>({});
  protected readonly added = signal<Change[]>([]);
  protected readonly adjustments = signal<Adjustment[]>([]);
  protected readonly instalments = signal<InstalmentRow[]>([]);
  protected readonly pricingNote = signal('');
  protected readonly closingDate = signal('');
  protected readonly busy = signal(false);

  /** The home with the requested changes sales keeps: what sales adds options to. */
  protected readonly base = computed(() =>
    safely(
      this.amendment().before.selections,
      this.requested()
        .filter((c) => this.decisions()[c.id]?.approved)
        .map((c) => c.change),
      this.contents(),
    ),
  );
  protected readonly selections = computed(() =>
    safely(this.base(), this.added(), this.contents()),
  );

  protected readonly body = computed((): AmendmentPricing => {
    const decisions = this.decisions();
    const note = this.pricingNote().trim();
    return {
      decisions: this.requested().map((c) => ({
        changeId: c.id,
        approved: decisions[c.id]?.approved ?? true,
        ...(decisions[c.id]?.note.trim() && { note: decisions[c.id]!.note.trim() }),
      })),
      added: this.added(),
      adjustments: cleanAdjustments(this.adjustments()),
      deposits: this.instalments()
        .filter((d) => d.label.trim() && toCents(d.dollars) > 0)
        .map((d) => ({
          label: d.label.trim(),
          amountCents: toCents(d.dollars),
          ...(d.dueDate && { dueDate: d.dueDate }),
        })),
      ...(this.closingDate() && { closingDate: this.closingDate() }),
      ...(note && { note }),
    };
  });
  protected readonly empty = computed(() => {
    const b = this.body();
    return (
      !b.decisions?.some((d) => d.approved) &&
      !b.added?.length &&
      !b.adjustments?.length &&
      !b.deposits?.length &&
      !b.closingDate
    );
  });
  protected readonly preview = livePrice(
    () => (this.options() && !this.empty() ? this.body() : null),
    (body) =>
      this.api.post<AmendmentDraftPreview>(
        API.amendments.pricePreview(this.amendment().agreementId, this.amendment().id),
        body,
      ),
  );
  protected readonly reasons = computed(() =>
    (this.preview.value()?.approval.reasons ?? []).map((r) => APPROVAL_REASON_LABEL[r]).join(' · '),
  );
  protected readonly changeInPrice = computed(() => {
    const after = this.preview.value()?.after.quote.totalCents;
    return after === undefined ? 0 : after - this.amendment().before.quote.totalCents;
  });

  /** Starts from the saved draft, or from every requested change kept. */
  ngOnInit(): void {
    const a = this.amendment();
    this.decisions.set(
      Object.fromEntries(
        a.changes
          .filter((c) => !c.addedBySeller)
          .map((c) => [
            c.id,
            { approved: c.decision !== ChangeDecision.Declined, note: c.decisionNote ?? '' },
          ]),
      ),
    );
    this.added.set(a.changes.filter((c) => c.addedBySeller).map((c) => c.change));
    this.adjustments.set(structuredClone(a.adjustments));
    this.instalments.set(
      a.deposits.map((d) => ({
        label: d.label,
        dollars: d.amountCents / 100,
        dueDate: d.dueDate ?? '',
      })),
    );
    this.pricingNote.set(a.pricingNote ?? '');
    this.closingDate.set(a.closingDate ?? '');
  }

  protected decide(id: string, patch: Partial<Decision>): void {
    this.decisions.update((all) => ({
      ...all,
      [id]: { ...(all[id] ?? { approved: true, note: '' }), ...patch },
    }));
  }

  /** Whatever the editor shows beyond the kept requests is what sales adds. */
  protected pick(selections: Selections): void {
    this.added.set(diffSelections(this.base(), selections, this.contents()));
  }

  protected addInstalment(): void {
    this.instalments.update((rows) => [...rows, { label: '', dollars: null, dueDate: '' }]);
  }

  protected setInstalment(i: number, patch: Partial<InstalmentRow>): void {
    this.instalments.update((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  protected removeInstalment(i: number): void {
    this.instalments.update((rows) => rows.filter((_, j) => j !== i));
  }

  protected async save(): Promise<void> {
    if (this.busy() || this.empty()) return;
    const a = this.amendment();
    this.busy.set(true);
    try {
      const saved = await this.api.put<Amendment>(
        API.amendments.one(a.agreementId, a.id),
        this.body(),
      );
      this.toast.success($localize`:@@amendmentDraft.saved:Draft saved`);
      this.saved.emit(saved);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }
}
