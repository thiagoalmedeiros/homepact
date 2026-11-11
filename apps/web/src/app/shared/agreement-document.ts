import { SignerStatus } from '@homepact/shared/enums';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Agreement, AgreementParty, AgreementSignature } from '@homepact/shared';
import { LocalDatePipe } from './dates';
import { MoneyPipe } from './money.pipe';
import { QuoteBreakdown } from './quote-breakdown';

interface PartyBlock {
  role: string;
  party: AgreementParty;
}
interface SignatureBlock {
  key: string;
  role: string;
  name: string;
  signed: AgreementSignature | undefined;
  invalidated: boolean;
}

/** The agreement as every party reads it; a signing purchaser initials the key clauses here. */
@Component({
  selector: 'hc-agreement-document',
  imports: [MoneyPipe, QuoteBreakdown, LocalDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agreement-document.html',
  styleUrl: './agreement-document.scss',
})
export class AgreementDocument {
  readonly agreement = input.required<Agreement>();
  readonly initials = input<number[]>([]);
  readonly initialling = input(false);
  readonly initialled = output<number>();

  protected readonly sellerLine = computed(() => {
    const s = this.agreement().seller;
    return [s.name, s.address, s.phone, s.email].filter(Boolean).join(' · ');
  });
  protected readonly parties = computed((): PartyBlock[] => [
    { role: $localize`:@@agreementDoc.seller:Seller`, party: this.agreement().seller },
    { role: $localize`:@@agreementDoc.buyer:Buyer`, party: this.agreement().buyer },
  ]);
  protected readonly signatures = computed((): SignatureBlock[] => {
    const a = this.agreement();
    const count = a.purchasers.length;
    return [
      ...a.purchasers.map((p, i) => ({
        key: p.id,
        role:
          count > 1
            ? $localize`:@@agreementDoc.purchaserN:Purchaser ${i + 1}:index: of ${count}:count:`
            : $localize`:@@agreementDoc.purchaser:Purchaser`,
        name: p.name,
        signed: p.status === SignerStatus.Signed ? p.signature : undefined,
        invalidated: p.status === SignerStatus.Invalidated,
      })),
      {
        key: 'seller',
        role: $localize`:@@agreementDoc.forTheSeller:For the seller`,
        name: a.seller.name,
        signed: a.counterSignature,
        invalidated: false,
      },
    ];
  });

  protected paragraphs(body: string): string[] {
    return body.split(/\n\s*\n/).map((p) => p.trim());
  }

  /** Key clauses are numbered from 1, the way they read in the document and the PDF. */
  protected hasInitialled(clause: number): boolean {
    return this.initials().includes(clause);
  }
}
