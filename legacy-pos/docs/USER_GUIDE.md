# Legacy POS: company access and recovery

Legacy POS is a separate lightweight till application. Its neutral Tsa Bonno logo is shared across supported business types; it does not indicate a Restaurant-only installation. See [Quick-start](QUICK_START.md) for the sign-in steps.

## Choosing a business

Company choices come from the server after password authentication. There is no company-ID input or automatic preference for a previously used company when several memberships exist. A single membership proceeds directly. The company chosen is resolved again by the server before the terminal becomes active. Existing role, outlet, subscription and operation permissions continue to apply.

Lodge and hotel memberships use the POS functions available to that company. Choosing them does not turn Legacy into the full LodgingOS or HotelOS application. Use the appropriate separate application for accommodation management.

Changing the email or password clears the choice list. **Cancel selection** returns to the credential form. Incorrect credentials, unavailable company lookup, revoked access or a suspended account do not activate the terminal. Do not use another staff account to bypass an access refusal.

## Saved access and company separation

Offline unlock checks the password against saved sessions and offers only matching, unexpired saved companies. Saved credentials expire after the supported offline period. Sign in online again when required. Automatic startup restoration remains pinned to the previously selected company; it does not silently pick a different business.

Reference caches are separated by company. Financial cache updates preserve records belonging to other companies, while reads show only the active company. Unresolved work for another company blocks changing companies. Return to that company and resolve its Sync queue; do not delete pending work or invent new retry identifiers.

Company selection is not a database authority switch. It does not enable the proposed local Bar service, replication or failover. Those features require their own completed setup and qualification.
