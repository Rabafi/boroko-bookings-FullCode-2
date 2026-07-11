export const ENTERPRISE_WORKFLOW_STATUS = {
  foundation: 'foundation',
  operational: 'operational',
  controlled: 'controlled'
}

export const ENTERPRISE_WORKFLOWS = [
  {
    key: 'custom_website',
    title: 'Custom Website',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Manage branded website setup, domain readiness, content sections, quote forms, and booking-engine launch checks.',
    sections: ['Branding', 'Domain', 'Room type pages', 'Offer/package pages', 'Inquiry forms', 'Quote forms', 'Launch checklist'],
    launchGates: [
      {
        key: 'deployment_automation',
        label: 'Website deployment automation',
        status: 'missing_external_proof',
        detail: 'No released custom website deployment automation is proven for this branch yet.'
      },
      {
        key: 'public_surface_smoke',
        label: 'Published website smoke test',
        status: 'missing_external_proof',
        detail: 'A built, deployed, and smoke-tested client website is required before this add-on is operational.'
      }
    ],
    defaultTasks: [
      'Confirm property logo, brand colours, and hero images',
      'Define room type pages and public package pages',
      'Set domain/DNS status and launch owner',
      'Enable quote request forms before payment links'
    ]
  },
  {
    key: 'payment_gateway',
    title: 'Payment Links',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Prepare property-owned manual payment links and future gateway readiness without marking payment as settled from the client side.',
    sections: ['Provider', 'Payment links', 'Proof of payment', 'Webhook readiness', 'Reconciliation'],
    launchGates: [
      {
        key: 'hosted_checkout',
        label: 'Provider-hosted checkout',
        status: 'missing_external_proof',
        detail: 'Desktop renderer code cannot create provider checkout intents; real checkout must come from server-side provider infrastructure.'
      },
      {
        key: 'server_webhooks',
        label: 'Server-side webhook settlement',
        status: 'service_role_only',
        detail: 'Webhook recording is restricted to service-role infrastructure and still needs real provider endpoint proof.'
      },
      {
        key: 'reconciliation',
        label: 'Provider reconciliation',
        status: 'missing_external_proof',
        detail: 'Provider settlement/reconciliation has not been smoke-tested against a live merchant account.'
      }
    ],
    defaultTasks: [
      'Capture property-owned merchant/provider details',
      'Set manual payment instructions for pro-formas and balances',
      'Require proof-of-payment review before activation',
      'Keep webhook verification disabled until provider keys are configured server-side'
    ]
  },
  {
    key: 'channel_manager',
    title: 'Channel Manager',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Prepare channel/source mappings, room/rate mappings, sync queues, conflict rules, and manual review readiness.',
    sections: ['Channels', 'Source mapping', 'Room mappings', 'Rate mappings', 'Sync queue', 'Manual review'],
    launchGates: [
      {
        key: 'live_provider_adapter',
        label: 'Live OTA provider adapter',
        status: 'missing_external_proof',
        detail: 'The local adapter fails closed until a real OTA provider adapter is connected and verified.'
      },
      {
        key: 'provider_confirmation',
        label: 'Provider confirmation before success',
        status: 'manual_review_until_connected',
        detail: 'Queued channel sync items must stay in manual review rather than completed when no provider confirms delivery.'
      }
    ],
    defaultTasks: [
      'Map room types to external channel room codes',
      'Map rate plans to external rate codes',
      'Keep live sync disabled until provider confirmation',
      'Route uncertain imports to manual review'
    ]
  },
  {
    key: 'guest_messaging',
    title: 'Guest Messaging',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Configure message templates and trigger readiness for pre-arrival, balances, cancellation, no-show, and post-stay communication.',
    sections: ['Templates', 'Triggers', 'Channels', 'Opt-in', 'Delivery status'],
    defaultTasks: [
      'Draft pre-arrival and check-in instruction templates',
      'Draft balance reminder and payment-link templates',
      'Record guest opt-in requirements',
      'Keep delivery provider configurable'
    ]
  },
  {
    key: 'guest_portal',
    title: 'Guest Portal',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Plan guest self-service actions such as viewing bookings, uploading details, requesting changes, messaging, and viewing documents.',
    sections: ['Portal branding', 'Visible actions', 'Required uploads', 'Requests', 'Documents'],
    defaultTasks: [
      'Choose which guest actions are visible',
      'Define required upload fields and terms copy',
      'Route guest change requests to property approval',
      'Keep payment-link action disabled until payment provider is configured'
    ]
  },
  {
    key: 'multi_property',
    title: 'Multi-Property',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Prepare central-office property switching, cross-property permissions, consolidated reports, and group-level controls.',
    sections: ['Property group', 'Switcher', 'Central roles', 'Consolidated reports', 'Shared accounts'],
    defaultTasks: [
      'Define group name and member properties',
      'Assign central office roles',
      'Keep per-property isolation visible',
      'Choose which reports can consolidate'
    ]
  },
  {
    key: 'revenue_manager',
    addonKeys: ['advanced_rates'],
    title: 'Revenue Manager',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Track demand notes, pickup/pace observations, competitor notes, and rate-change approval readiness.',
    sections: ['Demand calendar', 'Pickup', 'Pace', 'Competitor notes', 'Recommendations', 'Approvals'],
    defaultTasks: [
      'Record local demand events and dates',
      'Capture competitor rate notes manually',
      'Draft rate recommendations before approval',
      'Audit approved rate changes'
    ]
  },
  {
    key: 'advanced_reporting',
    title: 'Advanced Reporting',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Group Enterprise reporting requirements across occupancy, ADR/RevPAR, source/channel, debtor aging, groups, housekeeping, and maintenance.',
    sections: ['Occupancy', 'ADR/RevPAR', 'Pickup/pace', 'Channel/source', 'Debtors', 'Housekeeping', 'Maintenance'],
    defaultTasks: [
      'Define report date basis and columns',
      'Separate estimates from authoritative financial RPCs',
      'List export formats and scheduled report needs',
      'Keep debtor and payment reports tied to approved ledgers'
    ]
  },
  {
    key: 'guest_crm',
    title: 'Guest CRM',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Configure guest preferences, VIP/watchlist labels, company affiliation, incident links, consent fields, and document history needs.',
    sections: ['Preferences', 'VIP/watchlist', 'Company affiliation', 'Consent', 'Document history'],
    defaultTasks: [
      'Define VIP and preference labels',
      'Set blacklist/watchlist visibility rules',
      'Capture consent and privacy copy',
      'Link company affiliation to corporate accounts'
    ]
  },
  {
    key: 'operations_compliance',
    title: 'Operations Compliance',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Control linen/laundry, lost and found, incidents, visitors, emergency lists, shift handover, exports, privacy, and retention.',
    sections: ['Linen/laundry', 'Lost and found', 'Incidents', 'Visitors', 'Emergency list', 'Shift handover', 'Retention'],
    defaultTasks: [
      'Define manager-only visibility for sensitive incidents',
      'Set retention rules for visitor and incident records',
      'Prepare shift handover categories',
      'Export operational compliance lists when needed'
    ]
  },
  {
    key: 'multi_outlet_pos',
    title: 'Multi-Outlet POS Pro',
    status: ENTERPRISE_WORKFLOW_STATUS.foundation,
    summary: 'Prepare cross-outlet stock, transfer controls, outlet profitability, and cash-up separation for larger properties.',
    sections: ['Outlets', 'Transfers', 'Stock', 'Profitability', 'Cash-up'],
    defaultTasks: [
      'Confirm each outlet has assigned inventory items',
      'Define transfer approval rules',
      'Keep outlet cash-up boundaries separate',
      'Review outlet profitability before activation'
    ]
  }
]

export function getEnterpriseWorkflow(key) {
  return ENTERPRISE_WORKFLOWS.find((workflow) => workflow.key === key) || null
}
