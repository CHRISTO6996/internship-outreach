import { z } from 'zod';
import { ValidationError } from './errors.js';

export function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ValidationError(issues[0]?.message || 'Invalid request body', issues);
  }
  return result.data;
}

export function parseQuery(schema, query) {
  const result = schema.safeParse(query ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ValidationError(issues[0]?.message || 'Invalid query', issues);
  }
  return result.data;
}

const websiteSchema = z
  .string()
  .trim()
  .max(300)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))
  .refine(
    (value) =>
      value === null ||
      /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,24}(\/[^\s]*)?$/i.test(value),
    'Website must look like example.com or https://example.com',
  );

export const companyNameSchema = z
  .string()
  .trim()
  .min(2, 'Company name must be at least 2 characters')
  .max(200, 'Company name is too long');

export const createCompanySchema = z.object({
  name: companyNameSchema,
  website: websiteSchema,
  notes: z.string().max(2000).optional().default(''),
});

export const bulkCompanySchema = z.object({
  companies: z
    .array(
      z.object({
        name: companyNameSchema,
        website: websiteSchema.optional().default(null),
        notes: z.string().max(2000).optional().default(''),
      }),
    )
    .min(1, 'Provide at least one company')
    .max(500, 'Maximum 500 companies per import'),
});

export const updateCompanySchema = z.object({
  name: companyNameSchema.optional(),
  website: websiteSchema.optional(),
  notes: z.string().max(2000).optional(),
});

export const manualEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  sourceUrl: z.string().trim().max(1000).optional().nullable(),
});

export const startJobSchema = z.object({
  companyIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one company'),
  onlyMissing: z.boolean().optional().default(false),
});
