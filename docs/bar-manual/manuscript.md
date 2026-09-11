# Tsa Bonno Bar Customer Manual

Documented version: **1.5.7**  
Review date: **10 September 2026**  
Operating mode: **Bar**  
Example outlet: **Main Bar**  
Example currency: **P**

This editable manuscript is the customer-facing content source for the ReportLab layout in `build/build_manual.py`. It is intended for owners, managers, cashiers, bartenders, stock controllers and finance users.

## Using this guide

Each procedure states its purpose, what is needed first, where to go, the numbered actions, the result to check, and the safest recovery action. A shared Till still requires each operator to use a private PIN. A missing option usually means the role, outlet or package does not allow it; ask a manager or Tsa Bonno support to check access.

Money safety rule: **Preserve the original attempt. Open Sales or My sales to check the original receipt status, and use Retry original in Sell only when the original-attempt banner shows it. Confirm the result before initiating another transaction.**

## Find what you need

- Owner: setup acceptance, cash-up, reports, packages, backup and support.
- Manager: staff, permissions, approvals, corrections, stock, cash-up and close blockers.
- Cashier or bartender: shift opening, Till unlock, selling, payment, tabs, receipts and handover.
- Stock controller: products, deliveries, counts, breakage, availability and movement history.
- Finance user: cash-up review, expenses, supplier bills, ledger, reconciliation, payroll and statements.

## Part A — Welcome

The Bar workspace exposes Sell, Open tabs, Products, Stock, Cash & close, Sales and Manage. Essential terms are Till, outlet, shift, basket, tab, tender, pending and unavailable. The first-sale path is: confirm setup, open the shift, unlock the Till when asked, build the basket, choose the tender, confirm the completed sale and keep its receipt reference.

## Part B — Install and configure

Use a verified Tsa Bonno installer and a supported Windows computer. Sign in with the business account supplied to the customer, choose the approved business and outlet, confirm Bar mode, review currency/date/receipt details in Manage > Settings, create products and packs, set opening stock, create staff in Manage > Staff accounts, and test the printer, drawer, scanner and customer display where supported.

The setup acceptance check is complete when a demonstration operator can open a shift, make a demonstration sale, find it in Sales, print a readable receipt, find an open tab and explain the closing path.

## Part C — Run a shift

Open the shift by typing the Opening cash float explicitly — type 0.00 when starting with no cash — and choose Start my shift. An empty float never starts a shift. If the Till asks, choose Unlock Till, select the operator in Who is taking this order?, enter Staff PIN and choose Unlock Till. On Sell, build and correct the unpaid basket before payment. My Shift shows a handover for the open shift: completed sales count, open tabs, waste since the shift started, and cash-up state — counts and names only, never takings.

Pin fast sellers with the star on a product card; pinned items gather under the ★ Favourites filter and measured best sellers gather under Top sellers. Change a basket line with −, +, or by typing the quantity directly. A removed line can be restored with Undo. Clearing the whole basket asks for confirmation first.

For Cash, choose a quick amount (Exact, P50, P100, P200) or type the amount received. The Till shows the change due: the sale itself always records exactly the amount due, and the extra is change, never extra revenue. Cash received and change print on the receipt. Card and Mobile money are recorded after collection through the approved external provider; the Bar controls record the tender and reference rather than initiating that provider charge. A missing printed receipt is not a reason to collect again: use the completed-sale POS Receipt overlay and choose Print receipt when it is open, or choose Reprint last receipt from an empty Sell basket to reprint this terminal's most recent receipt without charging again.

## Part D — Tabs and corrections

Create and name a tab from Sell, reopen it through Open tabs > Resume tab → to keep selling, or choose Settle to reopen it with payment already open. Resume and Settle are different actions: resuming never charges. Confirm the owner and outlet; a resumed tab shows Ready to continue, or Tab changed — refresh required when it must be reopened from Open tabs. Split uses Split, Number of checks and Split checks. Transfer uses Transfer waiter, Active waiter for this outlet, Choose waiter and Transfer waiter. Final settlement uses Record payment & close tab.

If a split is uncertain, use Open tabs > Unresolved operations > Check status, then use Retry original only when that split record says it is safe. If a transfer is uncertain, check its transfer record in the same view. Settlement uncertainty is separate: check Sales or My sales for the original settlement and use Retry original in Sell only when the original-attempt banner shows it. Do not repeat an action from memory.

An unpaid basket edit, a recorded-sale correction/void, a stock return and a money refund are different events with different records and approvals. The operator requests a correction from My shift > Request sale correction, completes Reason and detail, and asks an authorised approver to enter the Authorised approver PIN and choose Ask approver to confirm. The request does not itself return money.

## Part E — Products and stock

Add a product and its stock in one flow from Products > Add product or Stock > Add stock item: name, shared category, selling price and optional barcode first then the counted stock behind it (create matching stock, or link existing stock), the counted unit, outlet, opening quantity and low-stock threshold, then optional 6/12/24 packs with their own barcodes. A new product sells at the Till only after its catalog publication completes: Products keeps pending saves with Retry this save, and a Till sale blocked by a stale menu says to refresh explicitly — nothing is charged for the blocked attempt. The review line states the depletion plainly, for example one sale removes one bottle and a 6-pack removes six bottles. Saving twice or after an interruption never duplicates the product: an interrupted save can be retried from Products, where waiting saves show Retry this save. A product or stock name can only be used once: if a save is refused because the name already exists, use the existing product instead of saving a second one. Deleting a product removes it from the Till; when nothing else sells or uses its stock, the stock item is delisted from Stock automatically while its movement history is preserved for audit, and the freed name can be used again. Editing reuses the same flow but never replays opening stock; use Receive or Count for quantity changes. Items counted but not sold directly use the Stock only choice. Recipe-linked items show their stock setup as read-only and keep their ingredients management in Stock & Purchasing Pro.

Use Stock > Receive delivery for stock that physically arrived, or choose Receive on a product card to jump straight to receiving its linked stock. Use Count for one item or Count All for a full list. Type 0 when the physical quantity is zero; an empty field is not zero. Record breakage or wastage as the supported stock event. Mark a product unavailable only when it should not be sold. Use the Waste action on a stock row for burnt or spoilt food, breakage, spillage or expired items: enter the wasted quantity with a reason and note, and the removal is recorded as one auditable movement.

Simple food can consume weighed ingredients without the recipes package: count Potatoes in kilograms with an opening quantity such as 10, then set the Fries product to consume 0.3 stock units per sale so each sale removes 0.3 kg. Sizes and extras (Small/Large, fillings) are modifier groups: the product wizard shows which groups cover the chosen category, and Till offers them at sale time instead of needing duplicate products. A 6-pack works for portions as well as bottles: a 6-pack of fatcakes removes 6 portions. Pack sizes stay 6, 12 and 24.

Food cooked in-house by the tray, such as hundreds of fatcakes a day, can skip stock entirely: choose No stock tracking when adding the product. Sales record revenue only and deplete nothing, so mark the product unavailable yourself when the tray runs out. This choice is not available for recipe-forced sections.

Worked example: 48 opening bottles + 24 received − 19 sold − 2 broken = 51 expected. A physical count of 50 gives a variance of −1 bottle.

## Part F — Cash-up and reports

Cash & close is part of the base Bar workflow; the Accounting add-on is not required for Bar cash-up. The operator opens My Cash-up, enters Physical cash counted (P), and chooses Submit cash-up for review. A manager opens Cash & close, chooses Refresh, reviews Expected cash, Counted cash, Variance and Cash-up evidence, then chooses Return for correction or enters the Manager PIN and chooses Approve & close shift. Unavailable evidence is not zero activity.

Sales supports From and To dates, receipt/tab/operator/tender search, completed and exception review, receipt detail and supported exports. The Sales report also carries a Waste card: quantities wasted per item with the top reason for the selected period, taken from the Waste actions only. A Slow movers card flags stocked items with no sale in the last 14 days, quantities only. Costed waste stays in Stock & Purchasing Pro. The Excel export adds Waste Summary and Waste Detail sheets and the PDF adds a waste section with the same quantities; the JSON companion carries the same waste dataset. Cashier cash-up and Accounting close are separate records.

## Part G — Optional packages

Stock & Purchasing Pro adds supplier, purchasing, detailed receiving, lots/expiry, recipes, preparation and variance work. Accounting & Workforce adds expenses, workforce, payroll, tips, supplier bills, ledger, bank reconciliation and financial reporting. Growth & Multi-outlet adds customers, loyalty, vouchers, promotions, multiple outlets and advanced reporting.

Daily workflows include Manage > Bar expenses > Record expense, Manage > Supplier bills, Manage > Accounting, General ledger, Bank reconciliation, Financial statements, Payroll, Workforce, Customers & loyalty, Vouchers, Multi-outlet control and Growth analytics. Package access, staff permission, outlet scope and the visible task screen are separate requirements.

## Part H — Offline, maintenance and support

Only the offline path shown by the app is available for counter sales. Open-tab changes, setup, complete reports, final cash-up and Accounting tasks require a connection. If Sell shows **Stock status unavailable — selling is paused**, restore the connection in Manage > System Health and choose **Refresh** in the Sell warning. If Sell shows an earlier verified time instead, it is selling on last verified stock data: refresh when online. The Till checks the server again; wait for product status to return before adding or charging an item. If the warning remains, keep sales paused and give the manager the time and outlet. Pending local work, cloud records, exports and recoverable backups are different things. Reconnect, wait for a final status, check the original record and never create a second payment because a first attempt timed out.

Use Manage > Data & backup for supported exports/backups, Manage > System Health for connectivity, pending work and failed operations (Retry re-queues the original operation; Clear stops its retries and records the item for manager review), and Manage > Audit trail for traceable events. Support needs only version, time, outlet, operator role, sanitized error, safe reference and the supported diagnostic bundle. Never send PINs, passwords, card numbers, payroll details or private customer information.

## Printable cards

Opening: confirm business/outlet, connectivity, equipment, float, operator, open tabs, pending work and stock.

Closing: stop or hand over sales, review tabs and uncertain payments, compare expected and counted cash, enter variance reason, submit cash-up and leave a handover note.

Emergency: preserve the original attempt, do not pay twice, open status/recovery, use Check status or Retry original when shown, confirm the record and escalate with a safe reference.
