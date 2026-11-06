# Legacy POS quick-start — company sign-in

This guide applies to the separate lightweight Legacy POS application. The login uses the neutral Tsa Bonno HospitalityOS logo and the title **Tsa Bonno POS Legacy**.

1. Enter your account email and password and choose **Sign In**.
2. If the account belongs to several businesses, **Which company are you working in?** appears. Choose the company name and check the business type and your role. The same account can have lodge, hotel, restaurant or Bar memberships; choosing one does not grant additional permissions or open a different application.
3. Check the company name in the terminal header before selling. If it is wrong, sign out and choose again. Resolve pending work in **Sync** before changing companies. Pending sales are retained, not discarded to make switching possible.
4. To work without internet using an existing saved session, enter your password and choose **Offline Unlock**. If several saved companies match, choose one. A company must previously have been signed into on that terminal; offline unlock cannot add a new membership or verify changed permissions with the server.

If sign-in cannot load the company list, retry when connected or contact your administrator. Do not create another sale or clear the terminal cache to solve a sign-in problem. A suspended staff account still requires an administrator to restore access.

For a development preview on the provider's computer, run `npm run legacy:open` from either the workspace root or `legacy-pos`. It builds and opens Legacy directly, without the LodgingOS product entry or development server. The company-login preview uses a separate profile, so an older open window cannot intercept it; you may need to sign in again. Older profiles and their pending work remain on disk. Close obsolete preview windows when safe. The terminal may be closed after launch; runtime output goes to `legacy-pos/.tmp/legacy-preview.log`. This is provider guidance, not a customer installation command.
