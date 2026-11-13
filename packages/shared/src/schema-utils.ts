import { z } from 'zod';
import { VALIDATION } from './messages.js';

const isCalendarDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, VALIDATION.isoDate)
  .refine(isCalendarDate, VALIDATION.calendarDate);

/** The UTC calendar date of an instant, "YYYY-MM-DD". */
export const isoDay = (at: Date): string => at.toISOString().slice(0, 10);

/** Like `schema.partial()` but without defaults, so a PATCH never resets omitted fields. */
export const patchSchema = <S extends z.ZodObject>(schema: S) =>
  z.object(
    Object.fromEntries(
      Object.entries(schema.shape).map(([key, field]) => [
        key,
        z.optional((field instanceof z.ZodDefault ? field.unwrap() : field) as z.ZodType),
      ]),
    ),
  ) as unknown as z.ZodType<Partial<z.output<S>>, Partial<z.input<S>>>;
