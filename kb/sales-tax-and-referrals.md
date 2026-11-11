# Sales tax and referrals: setting up your company

Every quote, proposal, purchase agreement and agreement PDF shows three amounts: the **price before
tax**, the **sales tax of the province** the home is priced in (one line per tax, for example
GST 5% and QST 9.975%), and the **total**, sales tax included. Referral programs let you record
who referred a buyer and give the buyer a credit.

None of this works until your company sets it up. Until you add at least one province, your
quotes show **no sales tax**.

> The rates the platform suggests are for the sale of a new home and were current in 2025. They
> are a starting point, not tax advice: confirm them with your accountant. They do not include
> new housing rebates, which depend on the buyer and the price.

## What your company needs to do

| #   | Step                                                          | Who                    | When                               |
| --- | ------------------------------------------------------------- | ---------------------- | ---------------------------------- |
| 1   | Add the provinces you sell in, and pick a default             | Company administrator  | Once, before quoting               |
| 2   | Check the rates with your accountant                          | Company administrator  | Once, then whenever a rate changes |
| 3   | Create your referral programs (optional)                      | Company administrator  | Once, then as programs change      |
| 4   | Review your agreement templates                               | Company administrator  | Once                               |
| 5   | Brief your sales team                                         | Company administrator  | Once                               |
| 6   | Decide what to do with proposals that are already in progress | Administrator and reps | Once                               |
| 7   | Keep rates and programs up to date                            | Company administrator  | When they change                   |

Only **company administrators** can change sales tax and referral programs. Sales staff can see
them and use them on proposals.

---

## 1. Add the provinces you sell in

Open the console and go to **Sales tax & referrals**. Under **Sales tax by province** you have
two ways to add a province.

**Use a suggestion from the platform (recommended).**

1. Click **Add from suggestions**.
2. Find the province and click **Use**. It is copied to your company right away. Provinces you
   already have show **Added**.

The suggestions cover every Canadian province and territory. Some carry a note (for example,
that PST is not charged on a new home in British Columbia). Read the notes before you use them.

**Or enter your own rates.**

1. Click **Add your own**.
2. Fill in the **Province** (for example _Ontario_) and a short **Code** (2 to 6 letters or
   digits, for example _ON_). The code is how proposals refer to the province, so it must be
   unique in your company.
3. Under **Taxes charged**, add each tax with its name and rate in percent, for example _GST 5_
   and, with **Add a tax**, _QST 9.975_. You can add up to 4 taxes per province, each with up to
   3 decimals.
4. Click **Save**.

**Pick your default province.** New proposals start in the default province; your reps can pick
another one on each proposal. The first province you add becomes the default. To change it,
click **Make default** next to another province.

Your copies are yours. If the platform later changes a suggestion, your rates do not change. You
can **Edit** your copy at any time.

## 2. Check the rates with your accountant

Compare every rate on **Sales tax by province** with what your accountant or lawyer confirms for
your sales, in particular:

- the provincial sales tax in Saskatchewan: the suggestion leaves it out, so add it if your
  contracts charge it to the buyer;
- any province where you sell in a way the suggestions do not cover.

Tax is calculated on the price before tax, after any referral credit. Each tax is rounded to the
cent on its own.

## 3. Create your referral programs (optional)

A referral program describes what you offer when someone refers a buyer, for example a homeowner
who sends you a friend.

1. Under **Referral programs**, click **New program**.
2. Give it a **Name** (for example _Homeowner referral_).
3. Enter the **Credit to the buyer, before tax ($)**. The credit comes off the buyer's price
   before sales tax is calculated. Enter **0** if you only want to record who referred the buyer,
   for example for a realtor whose commission you pay separately.
4. Optionally add a **Description**, for example the thank-you the referrer receives. Your team
   sees it; the referrer's reward is not part of the buyer's price.
5. Keep **Active** ticked so reps can use it, and click **Save**.

To stop offering a program, turn off its **Active** switch. Proposals that already use it keep
their credit; reps just can't add it to new proposals. Deleting a program works the same way for
existing proposals.

## 4. Review your agreement templates

Go to **Agreements → Templates**.

- `{{price.total}}` is now the purchase price **with sales tax included**. Wording such as _"The
  purchase price is {{price.total}}"_ stays correct, but check that your templates don't say
  the price excludes taxes.
- Schedule A of every agreement always lists the referral credit, the price before tax, each tax
  and the total, whatever your template says.
- You can add these fields to your clauses:

| Field                   | Example                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `{{price.beforeTax}}`   | $503,000                                                                                                                                       |
| `{{price.tax}}`         | $65,390                                                                                                                                        |
| `{{price.taxDetails}}`  | HST 13%, Ontario                                                                                                                               |
| `{{price.total}}`       | $568,390                                                                                                                                       |
| `{{referral.program}}`  | Homeowner referral                                                                                                                             |
| `{{referral.referrer}}` | Dana Whitfield                                                                                                                                 |
| `{{referral.credit}}`   | $2,000                                                                                                                                         |
| `{{referral.summary}}`  | The Buyer was referred by Dana Whitfield under the Homeowner referral program and receives a credit of $2,000, included in the purchase price. |

When there is no tax or no referral, these fields read sensibly (_"no sales tax applies"_,
_"No referral credit applies."_). A new template starts from wording that already uses them.
Have your lawyer review any change to a template.

## 5. Brief your sales team

Share these points with your reps.

**Creating a proposal.** In **New proposal**, the price on the right already includes the sales
tax of your default province. On the last step, under **Sales tax and referral**:

- **Province (sales tax)**: pick where the home is. Choose **No sales tax** only when you are sure
  none applies.
- **Referred by someone**: turn it on, choose the **Referral program**, and type who **Referred
  by** (and **Their email** if you have it). You cannot create the proposal until both the
  program and the name are filled in, or the switch is off again.

**Revising a proposal.** **Revise** keeps the province and the referral of the current revision.
The rep can change either one, or remove the referral, before sending. The total shown under the
revision spells out the price before tax and the sales tax.

**Answering a buyer's change request.** The new revision keeps the province and the referral, at
your current rate for that province. Changes the buyer asks for are shown before tax, like the
option prices; the new total includes tax. If you decline every change, the price stays exactly
as it was.

**What the buyer sees.** The buyer's page shows the total with _"Sales tax included (province)"_
and the full breakdown: options, adjustments, referral credit, price before tax, each tax and
the total. When the buyer signs, they accept the total with sales tax included.

**Agreements.** The deposit can't be more than the total, sales tax included. The balance due on
closing is the total, sales tax included, minus the deposit.

## 6. Proposals already in progress

Proposals created before your company set up sales tax keep their prices and show no tax. Nothing
changes for the buyer unless you act. For each open proposal, decide with the rep:

- **Leave it as is** if its price was agreed with tax included or tax does not apply.
- **Revise it** and pick the province to add the sales tax. The buyer sees the new revision and
  its new total, like any other revision.

Agreements that were already prepared or signed never change. Their fingerprint stays the same,
so no one needs to sign again.

## 7. Keep rates and programs up to date

**When a rate changes** (for example Nova Scotia's HST went from 15% to 14% on April 1, 2025):

1. **Edit** the province and save the new rate.
2. New proposals, new revisions and answers to buyers' requests use the new rate from then on.
3. Proposals already sent keep the rate they were priced with until they are revised.
4. Prepared and signed agreements keep the rate they were signed at. To apply the new rate to
   one that is not executed yet, send a new revision of its proposal. This voids the agreement and
   returns the proposal to negotiation, as any price change does. An executed agreement can no
   longer be re-priced.

**When you stop selling in a province**, remove it with the trash button. New proposals can no
longer use it; proposals and agreements already priced in it keep their tax. If it was your
default, another province becomes the default.

**When a program changes**, edit it. Proposals that already use the program keep the credit they
were given.

## Questions

**Our quotes show "No sales tax". Why?**
Your company has no province yet, or the rep chose **No sales tax**. Add a province (step 1) and
make sure a default is set.

**A rep can't pick our province.**
Only provinces your company added are available. An administrator adds it under **Sales tax &
referrals**.

**A rep can't find a referral program.**
Only **Active** programs can be added to new proposals. Turn the program back on, or create it.

**Can the platform change our rates?**
No. The platform only offers suggestions; what you adopted is your own copy.

**Can a buyer change the province or the referral?**
No. Only your team sets them. A buyer can ask for changes to options, as before.

**Does another company see our rates or programs?**
No. They belong to your company only, like your proposals and agreements.
