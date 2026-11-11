import { z } from 'zod';
import { AccessKeyStatus, AccessResourceType } from './enums.js';

export const accessKeyRequestSchema = z.object({
  key: z.string().min(16).max(200),
  code: z.string().trim().toUpperCase().min(4).max(16).optional(),
});
export type AccessKeyRequest = z.input<typeof accessKeyRequestSchema>;

export interface AccessSession {
  accessToken: string;
  expiresIn: number;
  resourceType: AccessResourceType;
  resourceId: string;
  signerId?: string;
}

export interface AccessKeyInfo {
  id: string;
  needsCode?: boolean;
  signerId?: string;
  resourceType: AccessResourceType;
  resourceId: string;
  status: AccessKeyStatus;
  createdAt: string;
  lastUsedAt?: string;
}

export interface AccessKeyRotated {
  accessKey: string;
  code?: string;
  key: AccessKeyInfo;
}

export interface ClaimResult {
  resourceType: AccessResourceType;
  resourceId: string;
}

export const accessKeyListQuerySchema = z.object({
  resourceType: z.enum(AccessResourceType),
  resourceId: z.string().min(1),
});
export type AccessKeyListQuery = z.infer<typeof accessKeyListQuerySchema>;
