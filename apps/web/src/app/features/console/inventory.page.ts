import { InventoryStatus } from '@homepact/shared/enums';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  type House,
  type HouseDetail,
  type InventoryHome,
  type Selections,
} from '@homepact/shared';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe, toCents } from '../../shared/money.pipe';
import { SelectionEditor } from '../../shared/selection-editor';
import { Sheet } from '../../shared/sheet';
import { INVENTORY_LABEL } from '../../shared/status';

interface Draft {
  id?: string;
  houseId: string;
  address: string;
  community: string;
  possession: string;
  price: number | null;
  features: string;
  lockedByDefault: boolean;
  status: InventoryStatus;
}

const blank = (): Draft => ({
  houseId: '',
  address: '',
  community: '',
  possession: '',
  price: null,
  features: '',
  lockedByDefault: true,
  status: InventoryStatus.Available,
});

@Component({
  selector: 'hc-console-inventory',
  imports: [FormsModule, RouterLink, LoadState, MoneyPipe, SelectionEditor, Sheet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory.page.html',
  styleUrl: './inventory.page.scss',
})
export class InventoryPage {
  protected readonly InventoryStatus = InventoryStatus;
  protected editLabel(address: string): string {
    return $localize`:@@console.inventory.editHome:Edit ${address}:address:`;
  }

  protected readonly editTitle = $localize`:@@console.inventory.sheetEdit:Edit home`;
  protected readonly newTitle = $localize`:@@console.inventory.sheetNew:Add a pre-existing home`;

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly labels = INVENTORY_LABEL;
  protected readonly statuses = Object.values(InventoryStatus);
  protected readonly paths = PATHS;
  protected readonly homes = resource({
    loader: () => this.api.get<InventoryHome[]>(API.inventory.list),
  });
  protected readonly houses = resource({ loader: () => this.api.get<House[]>(API.houses.list) });
  protected readonly list = computed(
    () => (this.homes.hasValue() ? this.homes.value() : undefined) ?? [],
  );
  protected readonly models = computed(
    () => (this.houses.hasValue() ? this.houses.value() : undefined) ?? [],
  );
  protected readonly draft = signal<Draft | null>(null);
  protected readonly model = signal<string | null>(null);
  protected readonly selections = signal<Selections>({});
  protected readonly busy = signal(false);
  protected readonly detail = resource({
    params: () => this.model() ?? undefined,
    loader: ({ params }) => this.api.get<HouseDetail>(API.houses.detail(params)),
  });
  protected readonly configuredCount = computed(() => Object.keys(this.selections()).length);

  protected edit(h?: InventoryHome): void {
    this.draft.set(
      h
        ? {
            id: h.id,
            houseId: h.houseId,
            address: h.address,
            community: h.community,
            possession: h.possession,
            price: h.priceCents === undefined ? null : h.priceCents / 100,
            features: h.features.join(', '),
            lockedByDefault: h.lockedByDefault,
            status: h.status,
          }
        : blank(),
    );
    this.selections.set(structuredClone(h?.selections ?? {}));
    this.model.set(h?.houseId ?? null);
  }

  protected pickModel(id: string): void {
    this.model.set(id);
    this.selections.set({});
  }

  protected async save(f: Draft): Promise<void> {
    this.busy.set(true);
    const body = {
      ...(f.id ? {} : { houseId: f.houseId }),
      address: f.address.trim(),
      community: f.community.trim(),
      possession: f.possession.trim(),
      ...(f.price !== null && f.price !== undefined && `${f.price}` !== ''
        ? { priceCents: toCents(f.price) }
        : {}),
      features: f.features
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      lockedByDefault: f.lockedByDefault,
      status: f.status,
      selections: this.selections(),
    };
    try {
      if (f.id) await this.api.patch(API.inventory.one(f.id), body);
      else await this.api.post(API.inventory.list, body);
      this.toast.success(
        f.id
          ? $localize`:@@console.inventory.updated:Home updated`
          : $localize`:@@console.inventory.added:Home added`,
      );
      this.draft.set(null);
      this.homes.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(f: Draft): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`:@@console.inventory.confirmDelete.title:Delete this home?`,
      message: $localize`:@@console.inventory.confirmDelete.message:${f.address}:address: will be removed. Homes that already have proposals can't be deleted; mark them sold instead.`,
      confirmLabel: $localize`:@@common.actions.delete:Delete`,
      destructive: true,
    });
    if (!ok || !f.id) return;
    try {
      await this.api.delete(API.inventory.one(f.id));
      this.draft.set(null);
      this.homes.reload();
    } catch (err) {
      this.toast.error(err);
    }
  }
}
