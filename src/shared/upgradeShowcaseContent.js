const freezeCopy = (copy) => Object.freeze({
  ...copy,
  benefits: Object.freeze([...(copy.benefits || [])])
})

/**
 * Customer-facing copy for plan-locked workspaces.
 *
 * Keep this separate from entitlement rules: these words explain the value of
 * a workspace, while the server and commercial catalog remain authoritative
 * for whether it is included. Copy must describe shipped behaviour only.
 */
export const UPGRADE_SHOWCASE_FEATURE_COPY = Object.freeze({
  basic_reports: freezeCopy({
    title: 'Daily Summary',
    description: 'See the day clearly with a certified view of occupancy, booking activity, and collections.',
    benefits: ['Review today, the last 7 days, or the last 30 days.', 'Keep collections tied to server-confirmed figures.', 'Give the front desk a fast operating snapshot.']
  }),
  starter_backup: freezeCopy({
    title: 'Core Data Backup',
    description: 'Keep a customer-owned copy of core property records ready for verification and support-led recovery.',
    benefits: ['Create a verifiable .tbbackup package.', 'Protect the backup with an optional passphrase.', 'See exactly which records and categories are included.']
  }),
  staff_basic: freezeCopy({
    title: 'Users & Access',
    description: 'Invite the right people, use safe role templates, and keep account access under control.',
    benefits: ['Invite and manage staff accounts.', 'Reset, suspend, or reactivate access safely.', 'Use fixed roles that keep permissions predictable.']
  }),
  reports: freezeCopy({
    title: 'Reports & Analytics',
    description: 'Turn bookings, occupancy, collections, and costs into a clearer view of how the business is performing.',
    benefits: ['See operating and financial performance together.', 'Spot trends, gaps, and changes across reporting periods.', 'Export clear reports for owners and advisers.']
  }),
  expenses: freezeCopy({
    title: 'Expense Control',
    description: 'Capture operating costs in one place so spending stays visible before it erodes your margin.',
    benefits: ['Record and categorise day-to-day expenses.', 'Filter costs by date, category, and outlet.', 'See manual expenses alongside wider operating costs.']
  }),
  staff: freezeCopy({
    title: 'Staff Management',
    description: 'Give every team member the right access with custom roles, permissions, and stronger account controls.',
    benefits: ['Manage the full employee roster.', 'Shape access with custom roles and permissions.', 'Keep responsibility clear as the team grows.']
  }),
  audit: freezeCopy({
    title: 'Night Audit',
    description: 'Close each operating day with a structured review of stays, collections, and exceptions that need attention.',
    benefits: ['Review arrivals, departures, and in-house activity.', 'Find unsettled balances and operational exceptions.', 'Create a consistent end-of-day routine.']
  }),
  conference: freezeCopy({
    title: 'Events & Venues',
    description: 'Run conferences, weddings, and venue bookings from the first reservation through extras, payment, and settlement.',
    benefits: ['Reserve spaces without losing sight of availability.', 'Keep event details, charges, and payments together.', 'Track each event from enquiry to completion.']
  }),
  pool: freezeCopy({
    title: 'Day Use',
    description: 'Turn pool visits, braais, workspace use, and walk-ins into organised bookings with clear pricing and revenue.',
    benefits: ['Schedule visitors against available spaces and times.', 'Price adults, children, packages, and extras clearly.', 'Track deposits, payment, and completion in one flow.']
  }),
  import: freezeCopy({
    title: 'Data Management',
    description: 'Move property data safely, create useful exports, and keep an off-device copy ready when the business needs it.',
    benefits: ['Bring approved records in through controlled imports.', 'Create focused Excel workbooks for operations or finance.', 'Schedule managed exports to a synced folder.']
  }),
  pwa: freezeCopy({
    title: 'Manager Mobile App',
    description: 'Keep owners and managers informed away from the desk with a focused mobile view of daily operations.',
    benefits: ['Check key activity from a phone or tablet.', 'See alerts and follow-up work without opening the desktop app.', 'Keep high-risk actions capability-gated and server-controlled.']
  }),
  pos: freezeCopy({
    title: 'Point of Sale',
    description: 'Sell food, drinks, and guest extras with receipts, tender records, and revenue kept inside the same operation.',
    benefits: ['Build and settle counter or outlet orders.', 'Keep sales tied to shifts, operators, and payment methods.', 'Carry eligible work safely through offline replay.']
  }),
  inventory: freezeCopy({
    title: 'Inventory',
    description: 'Know what is on hand, what is moving, and what needs attention before a shortage disrupts service.',
    benefits: ['Record purchases, adjustments, and stock movement.', 'Count stock with auditable stocktake sessions.', 'Surface low-stock items before they become urgent.']
  }),
  supplies: freezeCopy({
    title: 'Room Supplies',
    description: 'Follow amenities and consumables from the storeroom into rooms so replenishment reflects real usage.',
    benefits: ['Track store and room-level quantities.', 'Record allocations, moves, usage, and adjustments.', 'Reconcile physical counts with room-supply stocktakes.']
  }),
  front_desk_dashboard: freezeCopy({
    title: 'Front Desk Dashboard',
    description: 'Give the front desk one live board for arrivals, departures, and guests currently in house.',
    benefits: ['See today\'s guest movement at a glance.', 'Bring room readiness and stay status into one view.', 'Focus the team on the next front-desk action.']
  }),
  checkin_workflow: freezeCopy({
    title: 'Check-in / Check-out Workflow',
    description: 'Guide arrivals and departures through consistent steps while keeping folios and room status aligned.',
    benefits: ['Use clear arrival and departure checklists.', 'Keep required guest and room steps visible.', 'Reduce missed hand-offs between front desk and housekeeping.']
  }),
  night_audit_enterprise: freezeCopy({
    title: 'Transactional Night Audit',
    description: 'Close the hotel day with controlled checks, visible exceptions, and a governed path to correct and reopen.',
    benefits: ['Validate the day before committing the close.', 'Keep exceptions visible instead of hiding them.', 'Reopen through an explicit, auditable workflow.']
  }),
  folios: freezeCopy({
    title: 'Hotel Folios',
    description: 'Keep room charges, payments, and guest balances together in a hotel-style billing record.',
    benefits: ['Post eligible room and outlet charges.', 'Follow the balance throughout the stay.', 'Keep billing activity attached to the guest folio.']
  }),
  corporate_accounts: freezeCopy({
    title: 'Corporate Accounts',
    description: 'Manage company billing with structured profiles, settlement tracking, invoices, and outstanding balances.',
    benefits: ['Keep company terms and billing details together.', 'Track charges and settlements against the account.', 'See outstanding corporate balances clearly.']
  }),
  rate_plans: freezeCopy({
    title: 'Rate Plans',
    description: 'Shape hotel pricing with seasonal, corporate, package, and restriction rules tied to room inventory.',
    benefits: ['Create reusable pricing structures.', 'Apply the right rate to the right selling period.', 'Keep restrictions visible alongside pricing.']
  }),
  room_moves: freezeCopy({
    title: 'Room Moves',
    description: 'Move an in-house guest cleanly between rooms while preserving the stay, billing, and audit trail.',
    benefits: ['Check the destination room before the move.', 'Keep the active stay connected through reassignment.', 'Record who moved the guest and why.']
  }),
  channel_manager: freezeCopy({
    title: 'Channel Manager',
    description: 'Keep room availability aligned across connected booking channels from one control point.',
    benefits: ['Map property inventory to connected channels.', 'Review sync status and channel exceptions.', 'Reduce avoidable availability mismatches.']
  }),
  guest_messaging: freezeCopy({
    title: 'Guest Messaging',
    description: 'Send timely guest communication with reusable templates and operational triggers.',
    benefits: ['Prepare consistent message templates.', 'Link communication to moments in the guest journey.', 'Keep delivery activity visible to the team.']
  }),
  guest_portal: freezeCopy({
    title: 'Guest Portal',
    description: 'Give guests a self-service place for online check-in, requests, preferences, and stay follow-up.',
    benefits: ['Collect useful details before arrival.', 'Receive guest requests without scattered messages.', 'Keep preferences connected to the stay.']
  }),
  multi_property: freezeCopy({
    title: 'Multi-Property Dashboard',
    description: 'Compare and move between properties without losing the operational context of each business.',
    benefits: ['See group-level signals in one place.', 'Switch property context deliberately and safely.', 'Keep each property\'s records and permissions isolated.']
  }),
  guest_crm: freezeCopy({
    title: 'Guest CRM',
    description: 'Build a useful guest history with preferences, VIP context, consent, and repeat-stay information.',
    benefits: ['Recognise returning guests and their preferences.', 'Keep VIP and service context visible.', 'Record consent and relationship details together.']
  }),
  operations_compliance: freezeCopy({
    title: 'Operations Compliance',
    description: 'Bring incidents, visitors, emergency readiness, and linen controls into one accountable workspace.',
    benefits: ['Keep operational registers easy to review.', 'Give managers a clearer compliance picture.', 'Preserve follow-up evidence for important events.']
  }),
  group_operations: freezeCopy({
    title: 'Group Operations',
    description: 'Coordinate rooming lists, group arrivals, departures, pickup, and unsold-room release from one workflow.',
    benefits: ['Turn rooming lists into organised stays.', 'Handle group check-in and check-out consistently.', 'Track pickup and release decisions clearly.']
  }),
  workforce_management: freezeCopy({
    title: 'Workforce Management',
    description: 'Plan shifts, attendance, handovers, and assigned work so staffing follows the operation.',
    benefits: ['Build and review staff schedules.', 'Keep attendance and handovers visible.', 'Connect assigned work to accountable team members.']
  }),
  asset_management: freezeCopy({
    title: 'Asset Management',
    description: 'Keep equipment history, warranties, vendors, and preventive work attached to the assets they protect.',
    benefits: ['Maintain a practical property asset register.', 'Plan preventive work before equipment fails.', 'Keep service history and supplier context together.']
  }),
  venue_management: freezeCopy({
    title: 'Venue Management',
    description: 'Run venue packages from planning and supplier coordination through deposit milestones and settlement.',
    benefits: ['Build clear venue packages and plans.', 'Coordinate suppliers and the event run sheet.', 'Keep deposit milestones and settlement visible.']
  }),
  restaurant_accounting: freezeCopy({
    title: 'Restaurant & Bar Accounting',
    description: 'Bring supplier finance, banking, tax, budgets, statements, and payroll into a controlled accounting workspace.',
    benefits: ['Prepare finance work from operational records.', 'Separate preparation from approval-sensitive actions.', 'Export governed accounting and payroll reports.']
  }),
  tables: freezeCopy({
    title: 'Floor & Table Service',
    description: 'Organise the floor, seat guests, and keep every table\'s service flow visible during a busy shift.',
    benefits: ['See table status and active service at a glance.', 'Move from seating to an open check without losing context.', 'Keep reservations and walk-ins in the same service view.']
  }),
  kitchen_tickets: freezeCopy({
    title: 'Kitchen Workflow',
    description: 'Turn orders into clear kitchen tickets so stations can prepare, coordinate, and complete work in sequence.',
    benefits: ['See new, active, and completed tickets.', 'Keep item notes and modifiers with the order.', 'Give service staff a shared view of preparation progress.']
  }),
  recipes: freezeCopy({
    title: 'Recipes & Costing',
    description: 'Connect menu items to ingredients so portions, theoretical usage, and food cost are easier to control.',
    benefits: ['Build ingredient-level recipe definitions.', 'Calculate expected cost from current stock inputs.', 'Compare production assumptions with actual usage.']
  }),
  purchasing: freezeCopy({
    title: 'Purchasing',
    description: 'Turn stock needs into organised supplier purchases with clearer quantities, costs, and receiving.',
    benefits: ['Prepare purchase orders from real stock needs.', 'Keep supplier and cost details together.', 'Receive purchases into the stock trail.']
  }),
  variance: freezeCopy({
    title: 'Recipe Variance',
    description: 'Compare expected ingredient use with recorded movement to find waste, over-portioning, and counting gaps.',
    benefits: ['See theoretical and actual usage side by side.', 'Trace meaningful variances back to ingredients.', 'Focus investigation where margin is leaking.']
  }),
  performance: freezeCopy({
    title: 'Performance Insights',
    description: 'See the operational signals behind service speed, output, and team performance.',
    benefits: ['Review useful performance measures by period.', 'Find recurring delays and workload pressure.', 'Give managers evidence for focused follow-up.']
  }),
  prep: freezeCopy({
    title: 'Prep Batches',
    description: 'Plan and record batch preparation so ingredients, yield, and ready-to-sell quantity stay connected.',
    benefits: ['Record what was prepared and in what quantity.', 'Tie ingredient usage to the batch.', 'Keep expected and actual yield visible.']
  }),
  stock_control: freezeCopy({
    title: 'Purchase Suggestions',
    description: 'Use current stock pressure to focus purchasing on what the operation is likely to need next.',
    benefits: ['Surface items approaching reorder levels.', 'Turn suggestions into a deliberate buying decision.', 'Reduce emergency purchases and avoidable stockouts.']
  }),
  customer_accounts: freezeCopy({
    title: 'Customers & Loyalty',
    description: 'Recognise repeat customers and keep loyalty, vouchers, and account activity connected to their history.',
    benefits: ['Maintain useful customer profiles.', 'See loyalty and voucher activity together.', 'Keep account movements traceable.']
  }),
  checklists: freezeCopy({
    title: 'Operating Checklists',
    description: 'Make opening, closing, cleaning, and exception follow-up consistent across every shift.',
    benefits: ['Give each shift a clear list of required work.', 'Make incomplete and exceptional items visible.', 'Create a reliable handover for the next team.']
  }),
  owner_digest: freezeCopy({
    title: 'Owner Digest',
    description: 'Give owners a concise view of sales, cash, stock, and exceptions without making them assemble it manually.',
    benefits: ['Bring the day\'s strongest signals together.', 'Call out exceptions that deserve attention.', 'Keep the summary focused on decisions, not raw screens.']
  }),
  advanced_reports: freezeCopy({
    title: 'Business Control',
    description: 'See sales, run-rate, stock, labour, alerts, and operating exceptions in one management view.',
    benefits: ['Review the business beyond a single shift.', 'Bring commercial and operational signals together.', 'Focus managers on the exceptions that need action.']
  }),
  multi_outlet_controls: freezeCopy({
    title: 'Multi-Outlet Control',
    description: 'Compare outlets and govern shared operations without blurring each location\'s stock, sales, or responsibility.',
    benefits: ['Review outlet performance side by side.', 'Keep outlet scope explicit during management work.', 'See where stock and operating pressure differ.']
  }),
  inventory_advanced: freezeCopy({
    title: 'Stock & Purchasing Pro',
    description: 'Strengthen stock control with deeper purchasing, costing, movement, and multi-outlet visibility.',
    benefits: ['Follow stock from supplier receipt to usage.', 'Use cost and movement detail to investigate variance.', 'Coordinate stock work across eligible outlets.']
  }),
  lots_expiry: freezeCopy({
    title: 'Lots & Expiry',
    description: 'Track dated stock in batches so teams can use the right items first and act before expiry becomes waste.',
    benefits: ['Record lot and expiry details at stock level.', 'Surface items approaching their use-by date.', 'Support safer rotation and waste follow-up.']
  }),
  vouchers: freezeCopy({
    title: 'Growth Tools',
    description: 'Bring vouchers, offers, and repeat-customer incentives into a controlled sales workflow.',
    benefits: ['Create offers staff can apply consistently.', 'Keep voucher activity visible and traceable.', 'Connect promotions to customer and sales outcomes.']
  })
})

export const UPGRADE_SHOWCASE_ROUTE_COPY = Object.freeze({
  '/food-beverage/kitchen': freezeCopy({
    title: 'Food & Beverage',
    description: 'Run menus, orders, kitchen work, cash-up, purchasing, and food-cost control as one connected outlet operation.',
    benefits: ['Move orders cleanly from service to preparation.', 'Keep menu production and ingredient cost visible.', 'Close the outlet with sales and cash evidence together.']
  }),
  '/restaurant/floor-workspace': freezeCopy({
    title: 'Floor & Service',
    description: 'Keep tables, reservations, waitlists, and active service visible in one floor-led workspace.',
    benefits: ['Read table status without opening each check.', 'Coordinate bookings, walk-ins, and seating.', 'Carry service context from arrival through payment.']
  }),
  '/restaurant/kitchen-workspace': UPGRADE_SHOWCASE_FEATURE_COPY.kitchen_tickets,
  '/restaurant/outlet-control': UPGRADE_SHOWCASE_FEATURE_COPY.multi_outlet_controls,
  '/restaurant/menu-production': freezeCopy({
    title: 'Menu & Production',
    description: 'Keep products, modifiers, recipes, prep work, and food cost connected from setup through service.',
    benefits: ['Build a menu that reflects how the kitchen works.', 'Keep recipes and modifiers tied to sellable items.', 'See the cost implications behind production.']
  }),
  '/restaurant/team-workspace': freezeCopy({
    title: 'Team Workspace',
    description: 'Coordinate shifts, attendance, handovers, and responsibility from one restaurant-focused team view.',
    benefits: ['See who is working and where.', 'Keep shift handovers clear.', 'Link assigned work to accountable staff.']
  }),
  '/restaurant/finance-close': freezeCopy({
    title: 'Finance & Close',
    description: 'Bring sales, tenders, shifts, cash movement, and close exceptions together before the day is signed off.',
    benefits: ['Review the numbers behind the shift.', 'Surface cash and tender differences clearly.', 'Give managers a consistent close pack.']
  }),
  '/restaurant/control-workspace': UPGRADE_SHOWCASE_FEATURE_COPY.checklists,
  '/restaurant/reservations': freezeCopy({
    title: 'Reservations & Waitlist',
    description: 'Plan arrivals, manage walk-ins, and turn waiting guests into seated tables without losing the queue.',
    benefits: ['Keep reservations and live table capacity together.', 'Track wait time and party details.', 'Seat guests directly into the service flow.']
  }),
  '/restaurant/combos': freezeCopy({
    title: 'Combos & Offers',
    description: 'Bundle products into easy-to-sell offers while keeping the order and underlying items clear.',
    benefits: ['Create repeatable product combinations.', 'Make offers quick for cashiers to sell.', 'Keep component items visible to production.']
  }),
  '/restaurant/staff-performance': freezeCopy({
    title: 'Staff Performance',
    description: 'Use shift and sales activity to see where the team is performing well and where coaching is needed.',
    benefits: ['Review contribution by staff member and period.', 'Connect performance to real operating activity.', 'Support fair, evidence-based follow-up.']
  }),
  '/restaurant/kitchen-analytics': freezeCopy({
    title: 'Kitchen Analytics',
    description: 'See ticket volume and preparation timing clearly enough to find kitchen bottlenecks.',
    benefits: ['Track how work moves through preparation.', 'Find recurring slowdowns by period or station.', 'Use service evidence to improve the pass.']
  }),
  '/restaurant/stations': freezeCopy({
    title: 'Kitchen Stations',
    description: 'Route preparation work to the right station so each team sees the tickets it owns.',
    benefits: ['Separate work by preparation area.', 'Keep station responsibility obvious.', 'Coordinate completion across multi-station orders.']
  }),
  '/restaurant/inventory': UPGRADE_SHOWCASE_FEATURE_COPY.inventory_advanced,
  '/restaurant/lots-expiry': UPGRADE_SHOWCASE_FEATURE_COPY.lots_expiry,
  '/hpos/floor': UPGRADE_SHOWCASE_FEATURE_COPY.tables,
  '/hpos/service': freezeCopy({
    title: 'Reservations & Service',
    description: 'Keep bookings, walk-ins, seating, and active table service connected from arrival to settlement.',
    benefits: ['See upcoming reservations beside live capacity.', 'Manage waitlisted guests in order.', 'Move a party into service without re-entering details.']
  }),
  '/hpos/kitchen': UPGRADE_SHOWCASE_FEATURE_COPY.kitchen_tickets,
  '/hpos/reports': freezeCopy({
    title: 'POS Reports',
    description: 'Turn recorded orders and tenders into a useful view of sales, payment mix, and outlet performance.',
    benefits: ['Review sales by useful operating periods.', 'See how customers paid.', 'Give managers a clearer outlet summary.']
  }),
  '/hpos/expenses': freezeCopy({
    title: 'Outlet Expenses',
    description: 'Capture restaurant and bar costs where they happen so outlet spending stays visible and attributable.',
    benefits: ['Record day-to-day outlet expenses.', 'Separate costs by category and outlet.', 'See spending in the wider operating picture.']
  }),
  '/hpos/control': UPGRADE_SHOWCASE_FEATURE_COPY.checklists,
  '/hpos/growth-tools': UPGRADE_SHOWCASE_FEATURE_COPY.vouchers,
  '/hpos/business-control': UPGRADE_SHOWCASE_FEATURE_COPY.advanced_reports,
  '/pos/customer-display': freezeCopy({
    title: 'Customer Display',
    description: 'Give customers a clear live view of their order while the cashier builds and settles it.',
    benefits: ['Show ordered items and quantities as they change.', 'Make the running total easy to verify.', 'Keep the customer screen separate from cashier controls.']
  }),
  '/pos/kitchen-display': freezeCopy({
    title: 'Kitchen Display',
    description: 'Put active preparation tickets on a dedicated kitchen board built for fast, shared visibility.',
    benefits: ['See new work without crowding the till.', 'Keep item notes with each ticket.', 'Mark preparation progress from a shared screen.']
  }),
  '/pos/bar-display': freezeCopy({
    title: 'Bar Board',
    description: 'Give the bar a dedicated preparation queue so drink orders stay visible away from the till.',
    benefits: ['See active drink tickets in sequence.', 'Keep modifiers and notes with the order.', 'Share preparation progress with service staff.']
  })
})

function normalizeRoutePath(routePath) {
  const raw = String(routePath || '').trim()
    .replace(/^#/, '')
    .split('?')[0]
  if (!raw) return ''
  const prefixed = raw.startsWith('/') ? raw : `/${raw}`
  return prefixed.length > 1 ? prefixed.replace(/\/+$/, '') : prefixed
}

export function getUpgradeShowcaseCopy({ feature, routePath, module = null } = {}) {
  const routeCopy = UPGRADE_SHOWCASE_ROUTE_COPY[normalizeRoutePath(routePath)] || null
  const featureCopy = UPGRADE_SHOWCASE_FEATURE_COPY[String(feature || '').trim()] || null
  const selected = routeCopy || featureCopy
  const fallbackDescription = module?.description || ''

  return {
    title: selected?.title || module?.label || null,
    description: selected?.description || fallbackDescription,
    benefits: selected?.benefits?.length
      ? [...selected.benefits]
      : (fallbackDescription ? [fallbackDescription] : [])
  }
}
