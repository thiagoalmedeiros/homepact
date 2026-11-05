import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

export type ApiStatus = 'ok' | 'degraded' | 'unreachable';

type HealthResponse = { status: 'ok' | 'degraded' };

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  status(): Observable<ApiStatus> {
    return this.http.get<HealthResponse>('/api/health').pipe(
      map((body) => body.status),
      catchError((err: { status?: number; error?: HealthResponse }) =>
        of<ApiStatus>(
          err.status === 503 && err.error?.status === 'degraded' ? 'degraded' : 'unreachable',
        ),
      ),
    );
  }
}
