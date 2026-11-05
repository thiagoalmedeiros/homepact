import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HealthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reports ok when the API is healthy', async () => {
    const result = firstValueFrom(service.status());
    http.expectOne('/api/health').flush({ status: 'ok' });
    expect(await result).toBe('ok');
  });

  it('reports degraded when the API answers 503 degraded', async () => {
    const result = firstValueFrom(service.status());
    http
      .expectOne('/api/health')
      .flush({ status: 'degraded' }, { status: 503, statusText: 'Service Unavailable' });
    expect(await result).toBe('degraded');
  });

  it('reports unreachable on a network error', async () => {
    const result = firstValueFrom(service.status());
    http.expectOne('/api/health').error(new ProgressEvent('error'));
    expect(await result).toBe('unreachable');
  });
});
