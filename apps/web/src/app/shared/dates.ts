import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';

export type DateFormat = 'dateTime' | 'date' | 'calendar' | 'weekday';

const FORMATS: Record<DateFormat, Intl.DateTimeFormatOptions> = {
  dateTime: { dateStyle: 'long', timeStyle: 'short' },
  date: { dateStyle: 'long' },
  calendar: { dateStyle: 'long', timeZone: 'UTC' },
  weekday: { weekday: 'long', month: 'long', day: 'numeric' },
};

export const formatDate = (value: string | Date, format: DateFormat, locale: string): string => {
  const date =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`)
      : new Date(value);
  return new Intl.DateTimeFormat(locale, FORMATS[format]).format(date);
};

/** `{{ signedAt | localDate: 'dateTime' }}`, in the app's locale (`LOCALE_ID`). */
@Pipe({ name: 'localDate' })
export class LocalDatePipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(value: string | Date | null | undefined, format: DateFormat = 'date'): string {
    return value ? formatDate(value, format, this.locale) : '';
  }
}

/** Today on the user's calendar, "YYYY-MM-DD". */
export const localDay = (at = new Date()): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
