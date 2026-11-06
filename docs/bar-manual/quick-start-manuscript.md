# Tsa Bonno Bar Quick Start

Version: **1.5.7**  
Candidate revision: **bar-quick-start-2026.10.06-candidate.3**  
Review date: **06 October 2026**  
Length: **5 pages**

This candidate quick-start is built by the candidate-only layout inputs in `build/build_manual_candidate_v3.py` over the shared ReportLab layout engine. The manuscript and rendered Result/recovery flowables use the same saved-record printing steps.

## Page 1 — opening

Use this five-page card at the Till. Keep your PIN private. Stop if the business, outlet, operator or payment result is not clear.

When creating a new local Bar, confirm the saved owner email and choose a 4–12 digit approval PIN and a 12–128 character owner password. If asked to resume, use the same saved owner identity and password; do not start setup again or reset the database. Ask support if the saved identity or original password is unknown.

After setup, the app reopens. Sign in with the owner email and password you chose. In the Bar counter workspace, select Menu to add the first product, then select Stock to receive and verify its opening stock. Trading stays paused until the product menu and setup checks are ready. If the menu cannot be checked, refresh it; do not assume it is empty.

## Page 2 — saved receipt printing

Never collect payment again because paper did not print. Open My sales (cashier's own history) or Manage > Sales (authorized manager/finance access), find the saved record and choose Print receipt. In the overlay, verify the saved receipt number and total, then choose Print receipt. If printing fails, check the selected printer and paper and print the same saved receipt again. Ask a manager or support only if the record is missing, Print receipt is unavailable, or printing keeps failing.

## Page 4 — urgent recovery

Preserve the original attempt and check its named status before starting another transaction. For a timeout or missing receipt, never collect payment again. Open My sales (cashier's own history) or Manage > Sales (authorized manager/finance access), find the saved record and choose Print receipt. In the overlay, verify its saved receipt number and total, then choose Print receipt. If printing fails, check printer and paper and print that same saved receipt again. Ask a manager or support only if the record is missing, Print receipt is unavailable, or printing keeps failing. For a signed-till identity conflict, follow the separate Two tills disagree? steps on page 5.

## Page 5 — identity conflict

The incoming signed-peer operation is quarantined. The original local operation remains under Waiting for confirmation. This identity-conflict path does not automatically pause its normal sync/replay, create a Failed operations row, or provide quarantine Retry/Clear controls. Keep the original visible; do not repeat the sale or stock action, change the key or clear pending work. An ordinary replay failure is separate and appears in Failed operations; manager Retry preserves the original operation ID and payload, while Clear stops retries and records manager review. Read the persistent Network note under Manage > System Health > Sync & queue > Other tills on this network. App issues > Send problem to support sends a device status summary; share outlet, time and safe reference details only if requested.



## New cloud Bar opening check

If the Till says **Add your first product**, an authorized manager chooses **Add products**, creates products and records opening stock for stock-tracked items. **Products could not load** is a failed read: retry; for access denied, sign out and sign in to the intended business, then contact support if needed. Manage uses a personal PIN, separate from the sign-in password. Use **No PIN yet? Set up My Staff PIN** to create your own PIN while signed in, then return to unlock Manage.

When you switch business or sign in again while data is loading, an earlier load may be stopped. If the app says **The business or signed-in session changed while data was loading**, refresh the workspace and check the business and operator before continuing. A stopped load is not evidence of missing products or missing stock.
