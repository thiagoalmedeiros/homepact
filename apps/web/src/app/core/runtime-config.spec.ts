import { TestBed } from '@angular/core/testing';
import { setup } from '../testing';
import { RuntimeConfigService } from './runtime-config';

describe('RuntimeConfigService', () => {
  it('config loader reads apiBaseUrl from config.json before bootstrap', async () => {
    const http = setup();
    const runtime = TestBed.inject(RuntimeConfigService);
    const loading = runtime.load();
    http.expectOne('/config.json').flush({ apiBaseUrl: 'https://api.example.com/' });
    await loading;
    expect(runtime.config.apiBaseUrl).toBe('https://api.example.com');
    expect(runtime.apiUrl('/tenant')).toBe('https://api.example.com/api/tenant');
    expect(runtime.isApiUrl('https://api.example.com/api/houses')).toBe(true);
    expect(runtime.isApiUrl('https://cdn.example.com/logo.png')).toBe(false);
  });
});
