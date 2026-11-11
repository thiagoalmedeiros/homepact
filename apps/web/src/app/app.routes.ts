import { Routes } from '@angular/router';
import {
  buyerGuard,
  isCompanyOrigin,
  isPlatformOrigin,
  staffGuard,
  superAdminGuard,
} from './core/guards';

export const routes: Routes = [
  {
    path: '',
    canMatch: [isPlatformOrigin],
    children: [
      {
        path: 'login',
        loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
      },
      {
        path: '',
        canActivate: [superAdminGuard],
        loadComponent: () =>
          import('./features/platform/platform.page').then((m) => m.PlatformPage),
      },
      { path: '**', redirectTo: '' },
    ],
  },
  {
    path: '',
    canMatch: [isCompanyOrigin],
    children: [
      {
        path: '',
        loadComponent: () => import('./features/buyer/landing.page').then((m) => m.LandingPage),
      },
      {
        path: 'proposals',
        canActivate: [buyerGuard],
        loadComponent: () =>
          import('./features/buyer/my-proposals.page').then((m) => m.MyProposalsPage),
      },
      {
        path: 'proposals/:id',
        loadComponent: () =>
          import('./features/buyer/proposal-room.page').then((m) => m.ProposalRoomPage),
      },
      {
        path: 'agreements/:id',
        loadComponent: () =>
          import('./features/buyer/agreement-room.page').then((m) => m.AgreementRoomPage),
      },
      {
        path: 'k',
        loadComponent: () =>
          import('./features/key-access/key-access.page').then((m) => m.KeyAccessPage),
      },
      {
        path: 'login',
        loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
      },
      {
        path: 'register',
        loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage),
      },
      {
        path: 'console',
        canActivate: [staffGuard],
        loadChildren: () =>
          import('./features/console/console.routes').then((m) => m.CONSOLE_ROUTES),
      },
      {
        path: '**',
        loadComponent: () => import('./features/home/not-found.page').then((m) => m.NotFoundPage),
      },
    ],
  },
];
