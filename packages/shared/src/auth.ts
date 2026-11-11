import { z } from 'zod';
import { Role, STAFF_ROLES } from './enums.js';
import { VALIDATION } from './messages.js';

export const emailSchema = z.email().trim().toLowerCase();
export const passwordSchema = z.string().min(8, VALIDATION.password).max(200);

export const loginRequestSchema = z.object({ email: emailSchema, password: z.string().min(1) });
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const registerRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().max(40).optional(),
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const refreshRequestSchema = z.object({ refreshToken: z.string().min(1) });

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string | null;
  phone?: string;
  active: boolean;
  createdAt: string;
}

export interface AuthResponse extends TokenPair {
  user: AuthUser;
}

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(STAFF_ROLES),
  phone: z.string().max(40).optional(),
});
export type UserCreate = z.input<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(STAFF_ROLES).optional(),
  active: z.boolean().optional(),
});
export type UserUpdate = z.input<typeof userUpdateSchema>;

export const companyAdminCreateSchema = userCreateSchema.omit({ role: true });
