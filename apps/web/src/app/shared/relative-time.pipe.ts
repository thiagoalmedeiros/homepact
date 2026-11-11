import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "3 days ago", in the app's locale (`LOCALE_ID`). */
@Pipe({ name: 'ago' })
export class RelativeTimePipe implements PipeTransform {
  private readonly rtf = new Intl.RelativeTimeFormat(inject(LOCALE_ID), { numeric: 'auto' });

  transform(iso: string | null | undefined): string {
    if (!iso) return '';
    const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
    for (const [unit, size] of UNITS) {
      if (Math.abs(seconds) >= size) return this.rtf.format(Math.round(seconds / size), unit);
    }
    return $localize`:@@time.justNow:just now`;
  }
}
