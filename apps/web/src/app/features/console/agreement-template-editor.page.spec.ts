import { Role } from '@homepact/shared/enums';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { STARTER_AGREEMENT_TEMPLATE } from '@homepact/shared/agreement-fields';
import { settle, setup, signInAs } from '../../testing';
import { TEMPLATES } from '../../testing-fixtures';
import { AgreementTemplateEditorPage } from './agreement-template-editor.page';

const byTestId = <T extends HTMLElement = HTMLElement>(root: ParentNode, id: string) =>
  root.querySelector<T>(`[data-testid="${id}"]`);

describe('AgreementTemplateEditorPage', () => {
  it('an administrator starts from the example text; a misspelled field blocks saving', async () => {
    const http = setup();
    await signInAs(http, Role.CompanyAdmin, 'Morgan Reyes');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(AgreementTemplateEditorPage);
    await settle(fixture);
    await fixture.whenStable();
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;

    expect(byTestId<HTMLInputElement>(el, 'template-name')!.value).toBe(
      STARTER_AGREEMENT_TEMPLATE.name,
    );
    expect(el.querySelectorAll('[data-testid^="clause-body-"]')).toHaveLength(
      STARTER_AGREEMENT_TEMPLATE.sections.length,
    );
    const save = byTestId<HTMLButtonElement>(el, 'save-template')!;
    expect(save.disabled).toBe(false);

    const body = byTestId<HTMLTextAreaElement>(el, 'clause-body-0')!;
    body.value = 'Made between {{seller.name}} and {{buyer.nmae}}.';
    body.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(byTestId(el, 'field-error')?.textContent).toContain('Unknown field {{buyer.nmae}}');
    expect(save.disabled).toBe(true);

    body.value = 'Made between {{seller.name}} and ';
    body.dispatchEvent(new Event('input'));
    body.focus();
    body.setSelectionRange(body.value.length, body.value.length);
    [...el.querySelectorAll<HTMLButtonElement>('.field-btn')]
      .find((b) => b.textContent?.includes('{{buyer.name}}'))!
      .click();
    await settle(fixture);
    expect(body.value).toBe('Made between {{seller.name}} and {{buyer.name}}');
    expect(byTestId(el, 'field-error')).toBeNull();
    expect(save.disabled).toBe(false);

    save.click();
    await settle(fixture);
    const req = http.expectOne('/api/agreement-templates');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: STARTER_AGREEMENT_TEMPLATE.name,
      title: STARTER_AGREEMENT_TEMPLATE.title,
      isDefault: false,
      sections: [
        { heading: 'Parties', body: 'Made between {{seller.name}} and {{buyer.name}}' },
        ...STARTER_AGREEMENT_TEMPLATE.sections.slice(1),
      ],
    });
    req.flush({ ...TEMPLATES[1]!, id: 't9' });
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith('/console/agreements/templates');
  });

  it('sales staff can read a template but not change it', async () => {
    const http = setup();
    await signInAs(http, Role.CompanyStaff);
    const fixture = TestBed.createComponent(AgreementTemplateEditorPage);
    fixture.componentRef.setInput('id', 't2');
    await settle(fixture);
    http.expectOne('/api/agreement-templates/t2').flush(TEMPLATES[1]!);
    await settle(fixture);
    await fixture.whenStable();
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Only administrators can change templates');
    expect(byTestId(el, 'save-template')).toBeNull();
    expect(byTestId<HTMLInputElement>(el, 'template-name')!.value).toBe('Standard');
    expect(el.querySelector('fieldset')!.disabled).toBe(true);
  });
});
