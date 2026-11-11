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
import { Router } from '@angular/router';
import type {
  Company,
  CompanyInput,
  TaxComponent,
  TaxPreset,
  TaxPresetInput,
} from '@homepact/shared';
import { CURRENCIES, formatPercent } from '@homepact/shared/format';
import { API } from '../../core/api-endpoints';
import { ApiService } from '../../core/api.service';
import { PATHS } from '../../core/app-paths';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { LoadState } from '../../shared/load-state';
import { Sheet } from '../../shared/sheet';
import {
  TaxComponentsEditor,
  toComponents,
  validComponents,
  type TaxComponentDraft,
} from '../../shared/tax-components-editor';

interface PresetDraft {
  id?: string;
  code: string;
  name: string;
  note: string;
}

interface CompanyDraft {
  id?: string;
  name: string;
  slug: string;
  logoUrl: string;
  origins: string;
  currency: 'CAD' | 'USD';
  tagline: string;
  heroImageUrl: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  active: boolean;
}

const blank = (): CompanyDraft => ({
  name: '',
  slug: '',
  logoUrl: '',
  origins: '',
  currency: 'CAD',
  tagline: '',
  heroImageUrl: '',
  phone: '',
  email: '',
  address: '',
  website: '',
  active: true,
});

/** Super-admin console: companies, their origins, and the sales tax suggestions. */
@Component({
  selector: 'hc-platform',
  imports: [LoadState, FormsModule, Sheet, Icon, TaxComponentsEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform.page.html',
  styleUrl: './platform.page.scss',
})
export class PlatformPage {
  protected activeLabel(name: string): string {
    return $localize`:@@platform.activeLabel:Active ${name}:name:`;
  }
  protected adminSheetTitle(company: string): string {
    return $localize`:@@platform.adminSheet:Add an administrator to ${company}:company:`;
  }

  protected readonly text = {
    sheetEdit: $localize`:@@platform.sheetEdit:Edit company`,
    sheetNew: $localize`:@@platform.sheetNew:New company`,
    presetEdit: $localize`:@@platform.taxes.sheetEdit:Edit sales tax suggestion`,
    presetNew: $localize`:@@platform.taxes.sheetNew:New sales tax suggestion`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly currencies = CURRENCIES;
  protected readonly companies = resource({
    loader: () => this.api.get<Company[]>(API.platform.companies),
  });
  protected readonly presets = resource({
    loader: () => this.api.get<TaxPreset[]>(API.platform.taxPresets),
  });
  private readonly locale = inject(LOCALE_ID);
  protected readonly sheet = signal<'company' | 'admin' | 'preset' | null>(null);
  protected presetDraft: PresetDraft = { code: '', name: '', note: '' };
  protected readonly presetComponents = signal<TaxComponentDraft[]>([]);
  private readonly presetEdits = signal(0);
  protected readonly presetValid = computed(() => {
    this.presetEdits();
    const d = this.presetDraft;
    return (
      /^[A-Za-z0-9]{2,6}$/.test(d.code.trim()) &&
      !!d.name.trim() &&
      validComponents(this.presetComponents())
    );
  });
  protected readonly busy = signal(false);
  protected draft: CompanyDraft = blank();
  protected admin = { companyId: '', companyName: '', name: '', email: '', password: '' };

  protected create(): void {
    this.draft = blank();
    this.sheet.set('company');
  }

  protected edit(c: Company): void {
    this.draft = {
      id: c.id,
      name: c.name,
      slug: c.slug,
      logoUrl: c.logoUrl,
      origins: c.origins.join('\n'),
      currency: c.currency,
      tagline: c.tagline ?? '',
      heroImageUrl: c.heroImageUrl ?? '',
      phone: c.contact?.phone ?? '',
      email: c.contact?.email ?? '',
      address: c.contact?.address ?? '',
      website: c.contact?.website ?? '',
      active: c.active,
    };
    this.sheet.set('company');
  }

  protected addAdmin(c: Company): void {
    this.admin = { companyId: c.id, companyName: c.name, name: '', email: '', password: '' };
    this.sheet.set('admin');
  }

  protected async save(): Promise<void> {
    const d = this.draft;
    const opt = (v: string) => v.trim() || undefined;
    const contact = Object.fromEntries(
      Object.entries({
        phone: d.phone,
        email: d.email,
        address: d.address,
        website: d.website,
      }).filter(([, v]) => v.trim()),
    );
    const body: CompanyInput = {
      name: d.name,
      slug: d.slug,
      logoUrl: d.logoUrl,
      origins: d.origins.split(/[\s,]+/).filter(Boolean),
      currency: d.currency,
      active: d.active,
      ...(opt(d.tagline) && { tagline: opt(d.tagline) }),
      ...(opt(d.heroImageUrl) && { heroImageUrl: opt(d.heroImageUrl) }),
      ...(Object.keys(contact).length && { contact }),
    };
    this.busy.set(true);
    try {
      if (d.id) await this.api.patch(API.platform.company(d.id), body);
      else await this.api.post(API.platform.companies, body);
      this.toast.success(
        d.id
          ? $localize`:@@platform.toasts.updated:Company updated`
          : $localize`:@@platform.toasts.created:Company created`,
      );
      this.sheet.set(null);
      this.companies.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveAdmin(): Promise<void> {
    const a = this.admin;
    this.busy.set(true);
    try {
      await this.api.post(API.platform.admins(a.companyId), {
        name: a.name,
        email: a.email,
        password: a.password,
      });
      this.toast.success(
        $localize`:@@platform.toasts.adminCreated:${a.name}:name: can now sign in at ${a.companyName}:company:`,
      );
      this.sheet.set(null);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleActive(c: Company): Promise<void> {
    if (this.busy()) return;
    if (
      c.active &&
      !(await this.confirm.ask({
        title: $localize`:@@platform.confirmDeactivate.title:Deactivate ${c.name}:name:?`,
        message: $localize`:@@platform.confirmDeactivate.message:Its sites stop working for buyers and staff until you reactivate it.`,
        confirmLabel: $localize`:@@platform.confirmDeactivate.confirm:Deactivate`,
        destructive: true,
      }))
    ) {
      this.companies.reload();
      return;
    }
    this.busy.set(true);
    try {
      await this.api.patch(API.platform.company(c.id), { active: !c.active });
      this.companies.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  /** "GST 5% + QST 9.975%". */
  protected summary(components: TaxComponent[]): string {
    return components
      .map((c) => `${c.label} ${formatPercent(c.ratePercent, this.locale)}`)
      .join(' + ');
  }

  protected touchPreset(): void {
    this.presetEdits.update((n) => n + 1);
  }

  protected newPreset(): void {
    this.presetDraft = { code: '', name: '', note: '' };
    this.presetComponents.set([{ label: '', ratePercent: null }]);
    this.sheet.set('preset');
  }

  protected editPreset(p: TaxPreset): void {
    this.presetDraft = { id: p.id, code: p.code, name: p.name, note: p.note ?? '' };
    this.presetComponents.set(p.components.map((c) => ({ ...c })));
    this.sheet.set('preset');
  }

  protected async savePreset(): Promise<void> {
    if (!this.presetValid() || this.busy()) return;
    const d = this.presetDraft;
    const body: TaxPresetInput = {
      code: d.code.trim().toUpperCase(),
      name: d.name.trim(),
      components: toComponents(this.presetComponents()),
      ...(d.note.trim() && { note: d.note.trim() }),
    };
    this.busy.set(true);
    try {
      if (d.id) await this.api.put(API.platform.taxPreset(d.id), body);
      else await this.api.post(API.platform.taxPresets, body);
      this.toast.success($localize`:@@platform.taxes.saved:${body.name}:province: saved`);
      this.sheet.set(null);
      this.presets.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async removePreset(p: TaxPreset): Promise<void> {
    const ok = await this.confirm.ask({
      title: $localize`:@@platform.taxes.confirmRemove.title:Remove the suggestion for ${p.name}:province:?`,
      message: $localize`:@@platform.taxes.confirmRemove.message:Companies that already adopted it keep their copy.`,
      confirmLabel: $localize`:@@platform.taxes.confirmRemove.confirm:Remove`,
      destructive: true,
    });
    if (!ok || this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.delete(API.platform.taxPreset(p.id));
      this.presets.reload();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  /** Adds the Canadian provinces and territories that are missing from the suggestions. */
  protected async addStarter(): Promise<void> {
    if (this.busy()) return;
    const before = this.presets.hasValue() ? this.presets.value().length : 0;
    this.busy.set(true);
    try {
      const list = await this.api.post<TaxPreset[]>(API.platform.starterTaxPresets);
      const added = list.length - before;
      this.toast.success(
        added > 0
          ? $localize`:@@platform.taxes.starterAdded:Added ${added}:count: Canadian suggestions`
          : $localize`:@@platform.taxes.starterNone:Every Canadian province and territory is already suggested`,
      );
      this.presets.set(list);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    void this.router.navigateByUrl(PATHS.login);
  }
}
