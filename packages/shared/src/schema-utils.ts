import { z } from 'zod';

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
