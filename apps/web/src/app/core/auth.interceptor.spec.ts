import { Role } from '@homepact/shared/enums';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { setup } from '../testing';
import { AuthService } from './auth.service';

const session = (accessToken: string, refreshToken: string) => ({
  accessToken,
  refreshToken,
  expiresIn: 900,
  user: {
    id: 'u1',
    email: 'b@x.test',
    name: 'B',
    role: Role.Buyer,
    companyId: 'c1',
    active: true,
    createdAt: '',
  },
});

describe('authInterceptor', () => {
  it('interceptor attaches bearer and refreshes once on 401', async () => {
    const http = setup();
    const auth = TestBed.inject(AuthService);
    const login = auth.login({ email: 'b@x.test', password: 'pw' });
    const loginReq = http.expectOne('/api/auth/login');
    expect(loginReq.request.headers.has('Authorization')).toBe(false);
    loginReq.flush(session('old-access', 'refresh-1'));
    await login;

    const client = TestBed.inject(HttpClient);
    const result = firstValueFrom(client.get<{ ok: boolean }>('/api/negotiations'));
    const first = http.expectOne('/api/negotiations');
    expect(first.request.headers.get('Authorization')).toBe('Bearer old-access');
    first.flush({ error: 'expired' }, { status: 401, statusText: 'Unauthorized' });

    const refresh = http.expectOne('/api/auth/refresh');
    expect(refresh.request.body).toEqual({ refreshToken: 'refresh-1' });
    refresh.flush(session('new-access', 'refresh-2'));
    await new Promise((r) => setTimeout(r, 0));

    const retry = http.expectOne('/api/negotiations');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-access');
    retry.flush({ ok: true });
    expect(await result).toEqual({ ok: true });
    http.verify();
  });

  it('signs out when the refresh token is rejected', async () => {
    const http = setup();
    const auth = TestBed.inject(AuthService);
    const login = auth.login({ email: 'b@x.test', password: 'pw' });
    http.expectOne('/api/auth/login').flush(session('a', 'r'));
    await login;
    const result = firstValueFrom(TestBed.inject(HttpClient).get('/api/auth/me')).catch(
      (e) => e.status,
    );
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await new Promise((r) => setTimeout(r, 0));
    http.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(await result).toBe(401);
    expect(auth.user()).toBeNull();
  });
});
