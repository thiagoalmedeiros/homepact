import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ApiError } from '@homepact/shared';
import { firstValueFrom } from 'rxjs';
import { RuntimeConfigService } from './runtime-config';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

const toError = (err: unknown): ApiRequestError => {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as Partial<ApiError> | null;
    const message =
      body?.error ??
      (err.status === 0
        ? $localize`:@@errors.unreachable:Cannot reach the server. Check your connection.`
        : err.statusText);
    return new ApiRequestError(
      err.status,
      message || $localize`:@@errors.generic:Something went wrong`,
      body?.details,
    );
  }
  return new ApiRequestError(
    0,
    err instanceof Error ? err.message : $localize`:@@errors.generic:Something went wrong`,
  );
};

/** The JSON error body of a blob request (it arrives as a blob), or null when it is not JSON. */
const blobErrorBody = async (body: Blob): Promise<unknown> => {
  try {
    return JSON.parse(await body.text());
  } catch {
    return null;
  }
};

/** Promise-based client for the tenant API; paths are relative to `/api`. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly runtime = inject(RuntimeConfigService);

  private async run<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (err) {
      throw toError(err);
    }
  }

  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.run(() =>
      firstValueFrom(
        this.http.get<T>(this.runtime.apiUrl(path), {
          ...(params && { params: new HttpParams({ fromObject: params }) }),
        }),
      ),
    );
  }

  /** Downloads a file through the API client, so the request carries the Origin and the token. */
  getBlob(path: string): Promise<Blob> {
    return this.run(async () => {
      try {
        return await firstValueFrom(
          this.http.get(this.runtime.apiUrl(path), { responseType: 'blob' }),
        );
      } catch (err) {
        if (err instanceof HttpErrorResponse && err.error instanceof Blob) {
          throw new HttpErrorResponse({
            error: await blobErrorBody(err.error),
            status: err.status,
            statusText: err.statusText,
            url: err.url ?? undefined,
          });
        }
        throw err;
      }
    });
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.run(() => firstValueFrom(this.http.post<T>(this.runtime.apiUrl(path), body)));
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.run(() => firstValueFrom(this.http.patch<T>(this.runtime.apiUrl(path), body)));
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.run(() => firstValueFrom(this.http.put<T>(this.runtime.apiUrl(path), body)));
  }

  delete(path: string): Promise<void> {
    return this.run(() => firstValueFrom(this.http.delete<void>(this.runtime.apiUrl(path))));
  }
}
