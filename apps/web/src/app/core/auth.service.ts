import { Role, isStaffRole } from '@homepact/shared/enums';
import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  AccessSession,
  AuthResponse,
  AuthUser,
  ClaimResult,
  LoginRequest,
  RegisterRequest,
  TokenPair,
} from '@homepact/shared';
import { firstValueFrom } from 'rxjs';
import { API } from './api-endpoints';
import { ApiService } from './api.service';
import { RuntimeConfigService } from './runtime-config';
import { safeStorage } from './storage';

const USER_KEY = 'hc.session';
const GUEST_KEY = 'hc.guest';
const PENDING_KEY = 'hc.pendingKey';

interface StoredSession {
  tokens: TokenPair;
  user: AuthUser;
}

/** The signed-in user (localStorage) and a guest session opened with an access key
 * (sessionStorage). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly runtime = inject(RuntimeConfigService);
  private readonly raw = new HttpClient(inject(HttpBackend));
  private readonly local = safeStorage('local');
  private readonly session = safeStorage('session');

  private readonly stored = signal<StoredSession | null>(this.local.read<StoredSession>(USER_KEY));
  readonly guest = signal<AccessSession | null>(this.session.read<AccessSession>(GUEST_KEY));
  readonly user = computed(() => this.stored()?.user ?? null);
  readonly isStaff = computed(() => isStaffRole(this.user()?.role));
  readonly isAdmin = computed(() => this.user()?.role === Role.CompanyAdmin);
  readonly isBuyer = computed(() => this.user()?.role === Role.Buyer);
  readonly isSuperAdmin = computed(() => this.user()?.role === Role.SuperAdmin);
  private refreshing: Promise<string | null> | null = null;

  accessToken(): string | null {
    return this.stored()?.tokens.accessToken ?? this.guest()?.accessToken ?? null;
  }

  async login(input: LoginRequest): Promise<AuthUser> {
    return this.store(await this.api.post<AuthResponse>(API.auth.login, input));
  }

  async register(input: RegisterRequest): Promise<AuthUser> {
    return this.store(await this.api.post<AuthResponse>(API.auth.register, input));
  }

  async logout(): Promise<void> {
    const refreshToken = this.stored()?.tokens.refreshToken;
    this.clear();
    this.clearGuest();
    this.session.write(PENDING_KEY, null);
    if (refreshToken) await this.api.post(API.auth.logout, { refreshToken }).catch(() => undefined);
  }

  /** Exchanges an access key (and a signing link's `code`) for a guest session on one resource. */
  async openWithKey(key: string, code?: string): Promise<AccessSession> {
    const s = await this.api.post<AccessSession>(API.access.session, {
      key,
      ...(code && { code }),
    });
    this.guest.set(s);
    this.session.write(GUEST_KEY, s);
    this.session.write(PENDING_KEY, key);
    return s;
  }

  pendingKey(): string | null {
    return this.session.read<string>(PENDING_KEY);
  }

  /** Links a key's proposal to the signed-in buyer; the key stops working. */
  async claim(key: string): Promise<ClaimResult> {
    const res = await this.api.post<ClaimResult>(API.access.claim, { key });
    if (this.pendingKey() === key) this.session.write(PENDING_KEY, null);
    this.clearGuest();
    return res;
  }

  clearGuest(): void {
    this.guest.set(null);
    this.session.write(GUEST_KEY, null);
  }

  /** Single-flight refresh; resolves to the new access token or null (signed out). */
  refresh(): Promise<string | null> {
    const current = this.stored();
    if (!current) return Promise.resolve(null);
    this.refreshing ??= firstValueFrom(
      this.raw.post<AuthResponse>(this.runtime.apiUrl(API.auth.refresh), {
        refreshToken: current.tokens.refreshToken,
      }),
    )
      .then((res) => {
        this.store(res);
        return res.accessToken;
      })
      .catch(() => {
        this.clear();
        return null;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  hasRefreshToken(): boolean {
    return !!this.stored()?.tokens.refreshToken;
  }

  private store(res: AuthResponse): AuthUser {
    const { user, ...tokens } = res;
    const s: StoredSession = { user, tokens };
    this.stored.set(s);
    this.local.write(USER_KEY, s);
    return user;
  }

  private clear(): void {
    this.stored.set(null);
    this.local.write(USER_KEY, null);
  }
}
