import type { Agreement } from '@homepact/shared';
import { agreementFileName } from '@homepact/shared/agreement-fields';
import { API } from '../core/api-endpoints';
import type { ApiService } from '../core/api.service';

const DOWNLOAD_START_GRACE_MS = 10_000;

/** Hands a downloaded file to the browser as a file save. */
export const saveFile = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_START_GRACE_MS);
};

/** Downloads an agreement's PDF through the API (which checks the origin and the session). */
export const downloadAgreement = async (
  api: ApiService,
  a: Pick<Agreement, 'id' | 'reference' | 'status'>,
): Promise<void> =>
  saveFile(await api.getBlob(API.agreements.pdf(a.id)), agreementFileName(a.reference, a.status));
