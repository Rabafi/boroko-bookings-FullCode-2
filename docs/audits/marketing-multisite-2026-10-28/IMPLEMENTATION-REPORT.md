# Marketing multisite split — implementation report

Date: 2026-10-28
Scope: `marketing-site/`, `scripts/build-marketing-sites.mjs`, `tests/marketing-site-contract.test.mjs`, `tests/public-domain-contract.test.mjs`
Status: implemented and verified locally. Nothing committed, pushed, deployed, or provisioned in DNS/Netlify.

## What changed

The single marketing site is now six sites built from one source tree:

| Site | Origin | Role |
| --- | --- | --- |
| hub | `https://tsabonno.com` | light ecosystem landing, blog, contact, brochure, enterprise, privacy, terms, admin |
| lodge | `https://lodge.tsabonno.com` | LodgingOS (features, packages, why-switch, download, manager app, booking site, control center) |
| restaurant | `https://restaurant.tsabonno.com` | Restaurant POS storefront (download) |
| bar | `https://bar.tsabonno.com` | Bar POS storefront (download) |
| hotel | `https://hotel.tsabonno.com` | HotelOS — coming soon, interest only |
| property | `https://property.tsabonno.com` | PropertyOS — coming soon, interest only, no pricing |

### Architecture (Phase 1, carried green)

- `marketing-site/src/sites.mjs` is the single registry: origins, per-site nav/mobile/footer, page ownership (`SITE_PAGES`/`OWNERS`/`SHARED_PAGES`/`MULTI_PAGES`), product homes, `siteConfig()` and the `HUB_MOVED` 301 map (now exported and shared with the build and tests).
- `scripts/build-marketing-sites.mjs` composes every page from `src/partials/{head,topbar,mobile-overlay,footer,cookie-banner}.html`, rewrites same-site links to relative and cross-site links to absolute subdomain URLs (pretty form for canonical/JSON-LD/sitemap), stamps `data-site` (and the site default `data-product`) on each body, generates per-site `site-config.js`, `robots.txt`, `sitemap.xml`, `_redirects`, `netlify.toml`, and validates every href/src/srcset/`url()`/quoted URL and in-page anchor across all six outputs in a second pass.
- Output goes to git-ignored `output/marketing/{hub,lodge,restaurant,bar,hotel,property}/` via `npm run marketing:sites`. Sources remain the canonical, reviewable tree.
- `window.TSA_SITE` (generated `site-config.js`, loaded with `defer` before `script.js`) routes product/interest CTAs to the right subdomain; without it, the original relative fallbacks keep single-source/test behaviour.
- Hub `_redirects` 301 every moved URL (`/lodge-app`, `/features`, `/packages`, `/why-switch`, `/download`, `/manager-app`, `/booking-site`, `/control-center`, `/restaurant-pos`, `/bar-pos`, `/hotel` and `.html` variants) to their subdomain homes; legacy borokobookings 301s are preserved. `/property` is new and is not redirected.

### Phase 2 content (this change)

- `marketing-site/index.html` rewritten as the light hub (1119 → ~490 lines): brand hero, four-product family section (LodgingOS, Restaurant & Bar POS, HotelOS, PropertyOS — all coming-soon products interest-gated), per-product pricing overview (LodgingOS from P8,999/year; Restaurant POS P8,999–P18,999/year; Bar POS Base P4,500/year; HotelOS Hotel Core from P37,998 coming soon; PropertyOS honest "pricing and launch dates are not decided yet"), blog/brochure/packages/contact resources, demo form (PropertyOS option added) and FAQ (PropertyOS question added; JSON-LD kept in sync). All hidden `home-redundant` lodge-depth sections and the lodge ecosystem showcase were removed from the hub — that depth lives on the product sites.
- Per-site theming fixed: the previously dead `html[data-product]` palette blocks became `body[data-site]` overrides, which the build stamps on every composed body, so restaurant/bar render coral, hotel copper, property slate on every page (including shared thank-you/404); the hub keeps the ecosystem green. Added `property-card` family accent (#34556b), 2×2 product-family grid, and a compact `pricing-overview-grid`.
- Property page reviewed against `docs/engineering/propertyos/01-PRODUCT.md`: copy already meets the no-pricing, honest-coming-soon standard; no changes needed.

### Tests rewritten

- `tests/marketing-site-contract.test.mjs`: the universal "every source page links four products" loop is replaced by a per-site registry contract — every site's footer links all five product landings; every nav/mobile/footer item resolves through `itemHref`; every product home routes to a subdomain origin via `siteConfig`; per-site nav in-page anchors exist in that site's home source; product sites carry their default `data-product` on the home body. Home pins now assert the four-product hub (including `Tsa Bonno PropertyOS`, `./bar-pos.html`, `./property.html`) and the PropertyOS pricing-honesty phrase. The retired-brand leak check is kept for every non-admin source page.
- `tests/public-domains-contract` (`tests/public-domain-contract.test.mjs`): new tests assert the exact six marketing origins and the `HUB_MOVED` 301 contract (every moved page targets a non-hub subdomain; `property` and `index` must never appear in the map).

## Verification

- `npm run marketing:sites` — OK, all links/assets/anchors resolve (hub 16 pages/94 assets/641 refs; lodge 10/132/507; restaurant 4/69/194; bar 4/34/146; hotel 3/36/118; property 3/25/106).
- `npm run test:marketing-site` — 5/5. `npm run test:public-domains` — 11/11. `node --test tests/product-extraction.test.mjs` — 15/15. `node --test tests/enterprise-foundation.test.mjs` — 181/181.
- Scripted browser QA against the generated six sites (Playwright route fulfilment for all `*.tsabonno.com` hosts, every external host stubbed, no real leads/analytics): **0 problems, 17 check groups** — per-page load/overflow on all 40 pages (1440/390), mobile menu toggle, cookie banner, hub 4-product chooser, trial modals on lodge/restaurant/bar, coming-soon interest flows on hotel/property, cross-site navigation hub→lodge and hub→property, screenshots captured.

## Not done here (explicitly)

- No DNS records, no Netlify site creation for the five subdomains, no deploy. `marketing-site/.netlify/state.json` still points at the current single hub site; each subdomain needs its own Netlify site bound to `output/marketing/<site>/` plus DNS before this goes live.
- PropertyOS application is not started; the page is a documented coming-soon placeholder with no prices, trial or download claims.

## Bar manual-impact assessment

No manual update required — this change is marketing-site presentation and build/test infrastructure only. No Bar operator workflow, control, permission, financial or stock behaviour, supported equipment, or guide applicability changed; `bar.tsabonno.com` serves the existing Bar POS storefront content with a themed shell.
