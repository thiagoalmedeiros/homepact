import { Routes } from '@angular/router';
import { sellSideGuard } from '../../core/guards';
import { ConsoleShell } from './console-shell';

export const CONSOLE_ROUTES: Routes = [
  {
    path: '',
    component: ConsoleShell,
    children: [
      {
        path: '',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./overview.page').then((m) => m.OverviewPage),
        title: $localize`:@@titles.overview:Overview`,
      },
      {
        path: 'proposals',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./proposals.page').then((m) => m.ProposalsPage),
        title: $localize`:@@titles.proposals:Proposals`,
      },
      {
        path: 'proposals/new',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./proposal-builder.page').then((m) => m.ProposalBuilderPage),
        title: $localize`:@@titles.newProposal:New proposal`,
      },
      {
        path: 'proposals/:id',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./proposal-detail.page').then((m) => m.ProposalDetailPage),
        title: $localize`:@@titles.proposal:Proposal`,
      },
      {
        path: 'agreements',
        loadComponent: () => import('./agreements.page').then((m) => m.AgreementsPage),
        title: $localize`:@@titles.agreements:Purchase agreements`,
      },
      {
        path: 'agreements/templates',
        canActivate: [sellSideGuard],
        loadComponent: () =>
          import('./agreement-templates.page').then((m) => m.AgreementTemplatesPage),
        title: $localize`:@@titles.agreementTemplates:Agreement templates`,
      },
      {
        path: 'agreements/templates/new',
        canActivate: [sellSideGuard],
        loadComponent: () =>
          import('./agreement-template-editor.page').then((m) => m.AgreementTemplateEditorPage),
        title: $localize`:@@titles.newAgreementTemplate:New agreement template`,
      },
      {
        path: 'agreements/templates/:id',
        canActivate: [sellSideGuard],
        loadComponent: () =>
          import('./agreement-template-editor.page').then((m) => m.AgreementTemplateEditorPage),
        title: $localize`:@@titles.agreementTemplate:Agreement template`,
      },
      {
        path: 'agreements/:id',
        loadComponent: () => import('./agreement.page').then((m) => m.AgreementPage),
        title: $localize`:@@titles.agreement:Purchase agreement`,
      },
      {
        path: 'payments',
        loadComponent: () => import('./payments.page').then((m) => m.PaymentsPage),
        title: $localize`:@@titles.payments:Payments`,
      },
      {
        path: 'inventory',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./inventory.page').then((m) => m.InventoryPage),
        title: $localize`:@@titles.inventory:Pre-existing homes`,
      },
      {
        path: 'homes',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./homes.page').then((m) => m.HomesPage),
        title: $localize`:@@titles.homes:Floor plans`,
      },
      {
        path: 'homes/new',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./house-editor.page').then((m) => m.HouseEditorPage),
        title: $localize`:@@titles.newHome:New floor plan`,
      },
      {
        path: 'homes/:id',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./house-editor.page').then((m) => m.HouseEditorPage),
        title: $localize`:@@titles.editHome:Edit floor plan`,
      },
      {
        path: 'catalog',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./catalog.page').then((m) => m.CatalogPage),
        title: $localize`:@@titles.catalog:Catalog`,
      },
      {
        path: 'taxes-referrals',
        canActivate: [sellSideGuard],
        loadComponent: () => import('./taxes-referrals.page').then((m) => m.TaxesReferralsPage),
        title: $localize`:@@titles.taxesReferrals:Sales tax & referrals`,
      },
      {
        path: 'team',
        loadComponent: () => import('./team.page').then((m) => m.TeamPage),
        title: $localize`:@@titles.team:Team`,
      },
    ],
  },
];
