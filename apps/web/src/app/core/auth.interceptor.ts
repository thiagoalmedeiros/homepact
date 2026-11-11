import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { API } from './api-endpoints';
import { AuthService } from './auth.service';
import { RuntimeConfigService } from './runtime-config';

const withBearer = (req: HttpRequest<unknown>, token: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

const CREDENTIAL_PATHS = [API.auth.login, API.auth.register, API.auth.refresh, API.access.session];

/** Adds the bearer to API calls and transparently refreshes once on 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const runtime = inject(RuntimeConfigService);
  const auth = inject(AuthService);
  if (!runtime.isApiUrl(req.url)) return next(req);
  if (CREDENTIAL_PATHS.some((p) => req.url.endsWith(p))) return next(req);

  return next(withBearer(req, auth.accessToken())).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || !auth.hasRefreshToken()) {
        return throwError(() => err);
      }
      return from(auth.refresh()).pipe(
        switchMap((token) => (token ? next(withBearer(req, token)) : throwError(() => err))),
      );
    }),
  );
};
