import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { settle, setup } from '../../testing';
import { KeyAccessPage } from './key-access.page';

describe('KeyAccessPage', () => {
  it('/k?key= exchanges key then strips it from URL', async () => {
    const http = setup([
      { path: 'k', component: KeyAccessPage },
      { path: 'proposals/:id', children: [] },
    ]);
    const router = TestBed.inject(Router);
    const replace = vi.spyOn(history, 'replaceState');
    await router.navigateByUrl('/k?key=abcdefghijklmnopqrstuvwxyz');
    const fixture = TestBed.createComponent(KeyAccessPage);
    await settle(fixture);
    expect(replace.mock.calls.at(-1)?.[2]).toBe('/k');
    const req = http.expectOne('/api/access/session');
    expect(req.request.body).toEqual({ key: 'abcdefghijklmnopqrstuvwxyz' });
    req.flush({
      accessToken: 'guest-token',
      expiresIn: 7200,
      resourceType: 'proposal',
      resourceId: 'n42',
    });
    await settle(fixture);
    expect(TestBed.inject(AuthService).accessToken()).toBe('guest-token');
    expect(router.url).toBe('/proposals/n42');
  });

  it('explains a revoked link', async () => {
    const http = setup([{ path: 'k', component: KeyAccessPage }]);
    await TestBed.inject(Router).navigateByUrl('/k?key=revoked-key-xxxxxxxxxx');
    const fixture = TestBed.createComponent(KeyAccessPage);
    await settle(fixture);
    http
      .expectOne('/api/access/session')
      .flush({ error: 'Invalid or revoked access key' }, { status: 404, statusText: 'x' });
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("This link doesn't work");
  });
});
