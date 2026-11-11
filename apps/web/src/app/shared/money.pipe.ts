import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';
import { formatMoney, type Currency } from '@homepact/shared/format';
import { TenantService } from '../core/tenant.service';

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  private readonly tenant = inject(TenantService);
  private readonly locale = inject(LOCALE_ID);

  transform(cents: number | null | undefined, currency?: Currency, signed = false): string {
    currency ??= this.tenant.company()?.currency ?? 'CAD';
    if (cents === null || cents === undefined) return '—';
    const text = formatMoney(Math.abs(cents), currency, this.locale);
    if (cents < 0) return `−${text}`;
    return signed && cents > 0 ? `+${text}` : text;
  }
}

/** Dollars typed by a person → integer cents. */
export const toCents = (dollars: number | string | null | undefined): number =>
  Math.round(Number(dollars || 0) * 100);
