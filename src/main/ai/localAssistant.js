const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for',
  'from', 'get', 'give', 'go', 'help', 'how', 'i', 'in', 'is', 'it', 'me',
  'my', 'of', 'on', 'or', 'please', 'show', 'tell', 'the', 'this', 'to',
  'use', 'using', 'want', 'what', 'where', 'with', 'you'
])

const NEGATION_WORDS = /\b(don'?t|do not|not yet|cancel|undo|didn'?t|never|stop|wrong|instead)\b/

const SPELLING_REPLACEMENTS = [
  [/\bfunc+t?i?o?ns?\b/g, 'function'],
  [/\binst?r?u?c?t?u?r?e?s?\b/g, 'instructions'],
  [/\bsev?ic?e?s?\b/g, 'services'],
  [/\bloc+al+\b/g, 'local'],
  [/\bchek\b/g, 'check'],
  [/\bchekin\b/g, 'check in'],
  [/\bchekout\b/g, 'check out'],
  [/\brecie?ve\b/g, 'receive'],
  [/\bpaymant\b/g, 'payment'],
  [/\bpaymnt\b/g, 'payment'],
  [/\binvoce\b/g, 'invoice'],
  [/\binv?ent?o?ry\b/g, 'inventory'],
  [/\bstok\b/g, 'stock'],
  [/\bmaint[ae]nance\b/g, 'maintenance'],
  [/\bmaint\b/g, 'maintenance'],
  [/\bbookn?g?s?\b/g, 'booking'],
  [/\bbok+ing?s?\b/g, 'booking'],
  [/\breserv?e?tion\b/g, 'reservation'],
  [/\bqout(e|ation)?\b/g, 'quotation'],
  [/\bquotatoin\b/g, 'quotation'],
  [/\bguestt\b/g, 'guest'],
  [/\bguets?\b/g, 'guest'],
  [/\bcustmer\b/g, 'customer'],
  [/\broo?m\b/g, 'room'],
  [/\bmanagar?\b/g, 'manager'],
  [/\breport?\b/g, 'report'],
  [/\bsettin?gs?\b/g, 'settings'],
  [/\bdashbo?a?rd\b/g, 'dashboard'],
  [/\boccupa?n?cy\b/g, 'occupancy'],
  [/\brevenu?\b/g, 'revenue'],
  [/\bballan?ce\b/g, 'balance'],
  [/\bdepos?it\b/g, 'deposit'],
  [/\bexpens?\b/g, 'expense'],
  [/\bprofi?le\b/g, 'profile'],
  [/\bsubscri?pti?on\b/g, 'subscription'],
  [/\bsyn?c?h?\b/g, 'sync'],
  [/\brovndavel\b/g, 'rondavel'],
  [/\bchalet{2,}\b/g, 'chalet'],
  [/\blaun?dr?y\b/g, 'laundry'],
  [/\bameniti?e?s\b/g, 'amenities'],
  [/\bhouskeep\b/g, 'housekeeping'],
  [/\bminib?a?r\b/g, 'minibar'],
  [/\bforcast\b/g, 'forecast'],
  [/\boccupa?nc?y\b/g, 'occupancy'],
  [/\bpos\b/g, 'point sale'],
  [/\bpwa\b/g, 'mobile app'],
  [/\bai\b/g, 'assistant']
]

// ─── Synonym / keyword expansion ──────────────────────────────────────────
// Expands domain-specific synonyms so users can use their own vocabulary.
const SYNONYM_MAP = {
  'folio': 'invoice',
  'bill': 'invoice',
  'receipt': 'invoice',
  'tab': 'invoice',
  'lodge': 'property',
  'chalet': 'room',
  'rondavel': 'room',
  'banda': 'room',
  'cottage': 'room',
  'unit': 'room',
  'campsite': 'room',
  'tent': 'room',
  'walk in': 'booking',
  'walk-in': 'booking',
  'walkin': 'booking',
  'front desk': 'booking',
  'reservation': 'booking',
  'reserve': 'booking',
  'settle': 'payment',
  'pay': 'payment',
  'collecting': 'payment',
  'collect': 'payment',
  'refund': 'payment',
  'void payment': 'payment',
  'owing': 'unpaid',
  'owed': 'unpaid',
  'outstanding': 'unpaid',
  'debtors': 'unpaid',
  'arrival': 'check in',
  'arrivals': 'check in',
  'arriving': 'check in',
  'departure': 'check out',
  'departures': 'check out',
  'departing': 'check out',
  'leaving': 'check out',
  'amenities': 'supplies',
  'linen': 'supplies',
  'towels': 'supplies',
  'housekeeping': 'clean',
  'cleaning': 'clean',
  'dirty': 'clean',
  'cash register': 'pos',
  'restaurant': 'pos',
  'bar': 'pos',
  'food': 'pos',
  'order': 'pos',
  'sale': 'pos',
  'till': 'pos',
  'budget': 'expense',
  'spending': 'expense',
  'overheads': 'expense',
  'repair': 'maintenance',
  'broken': 'maintenance',
  'fault': 'maintenance',
  'ticket': 'maintenance',
  'occupancy': 'dashboard',
  'turnover': 'revenue',
  'takings': 'revenue',
  'overview': 'dashboard',
  'pulse': 'dashboard',
  'kpis': 'dashboard',
  'analytic': 'reports',
  'financial': 'reports',
  'performance': 'reports',
  'conference': 'event',
  'banquet': 'event',
  'meeting': 'event',
  'hall': 'conference',
  'venue': 'conference',
  'pool': 'day use',
  'cashup': 'night audit',
  'handover': 'night audit',
  'roster': 'staff',
  'laundry': 'supplies',
  'minibar': 'inventory',
  'day pass': 'day use',
  'swimming': 'day use',
  'excel': 'reports',
  'pdf': 'reports',
  'spreadsheet': 'data management',
  'backup': 'data management',
  'archive': 'data management',
  'error': 'system health',
  'offline': 'system health',
  'permission': 'staff',
  'ota': 'online booking',
  'channel': 'online booking',
  'role': 'staff',
  'user': 'staff',
  'employee': 'staff',
  'account': 'staff',
  'plan': 'subscription',
  'tier': 'subscription',
  'module': 'subscription',
  'unlock': 'subscription'
}

// ─── Bi-gram phrase list ───────────────────────────────────────────────────
// These are matched as complete phrases BEFORE individual token scoring.
// Order matters: more specific phrases first.
const KEY_PHRASES = [
  'check in',
  'check out',
  'add stock',
  'record payment',
  'create booking',
  'new booking',
  'room board',
  'daily briefing',
  'night audit',
  'system health',
  'failed sync',
  'payment anomaly',
  'online booking',
  'day use',
  'data management',
  'room supplies',
  'financial audit',
  'unpaid bookings',
  'overdue checkout',
  'overdue checkouts',
  'send invoice',
  'manager app',
  'mobile app'
]

export const LOCAL_ASSISTANT_SUGGESTIONS = [
  'How do I create a booking?',
  'Where do I record a payment?',
  'Show unpaid bookings.',
  'How do I fix failed sync?',
  'What needs my attention right now?',
  'How do I add stock?',
  'Which rooms are available tonight?',
  'Any online booking requests?'
]

const SCENARIO_PLAYBOOKS = [
  {
    id: 'start-of-shift',
    title: 'Start of shift checklist',
    summary: 'Use this at the start of a front-desk shift to get your bearings quickly.',
    match: (text) => /\b(start of shift|begin shift|opening shift|start shift|morning routine)\b/.test(text),
    steps: [
      'Ask for what needs attention right now.',
      'Review today arrivals, departures, and any overdue checkouts.',
      'Check unpaid bookings before new guest movement starts.',
      'Confirm sync and backup health if the shift begins with system warnings.'
    ],
    prompts: ['What needs my attention right now?', 'Give me the daily briefing.', 'Show unpaid bookings.', 'How do I fix failed sync?']
  },
  {
    id: 'end-of-shift',
    title: 'End of shift handover',
    summary: 'Use this before handing over to the next team or closing the desk.',
    match: (text) => /\b(end of shift|close shift|shift handover|handover|closing routine)\b/.test(text),
    steps: [
      'Generate the shift handover report.',
      'Review any overdue checkouts, unpaid balances, and sync failures still open.',
      'Confirm the next shift knows about tomorrow arrivals and dirty rooms.',
      'Check backup status before finishing the handover.'
    ],
    prompts: ['Show shift handover report.', 'Show overdue checkouts.', 'Show unpaid bookings.', 'When was the last backup?']
  },
  {
    id: 'internet-down',
    title: 'Internet down',
    summary: 'Use this when the connection is unstable or the lodge is temporarily offline.',
    match: (text) => /\b(internet( is)? down|no internet|offline mode|network( is)? down|cannot sync|sync offline)\b/.test(text),
    steps: [
      'Keep working locally, but treat remote totals as delayed until sync catches up.',
      'Check sync impact so you know which items are waiting or failing.',
      'Avoid assuming cloud-side reports are final until System Health clears.',
      'Handover the sync warning clearly if the issue continues into the next shift.'
    ],
    prompts: ['Show sync impact.', 'How do I fix failed sync?', 'What needs my attention right now?', 'Give me the daily briefing.']
  },
  {
    id: 'guest-refuses-payment',
    title: 'Guest refuses to pay',
    summary: 'Use this when a guest is checking out or disputing the balance.',
    match: (text) => /\b(refuses to pay|guest wont pay|guest won.t pay|payment dispute|disputing balance)\b/.test(text),
    steps: [
      'Look up the booking and confirm the current balance, charges, and payments already recorded.',
      'Review unpaid bookings or the booking payment history before discussing the bill.',
      'Use the invoice or booking screen to show the guest what has been charged.',
      'Only check out the guest once the booking is fully settled.'
    ],
    prompts: ['Balance for room 12.', 'Show unpaid bookings.', 'Where do I record a payment?', 'How do I check out a guest?']
  }
]

const FINANCIAL_FAQ = [
  {
    id: 'deposit-vs-payment',
    title: 'Deposit and payment rules',
    match: (text) => /\b(deposits?|amount paid|amount_paid|paid totals?|type over paid|payment status|balance due|outstanding)\b/.test(text),
    assistantText: [
      'Deposits and payments should be recorded through the payment flow, not by typing over paid totals.',
      'Never edit `amount_paid` directly. Use Record payment so Boroko applies the normal payment flow safely.',
      'Boroko calculates balance from total amount plus extra charges minus payments already recorded.',
      'If you need to collect more money, open the booking or invoice and use the payment action so the balance stays correct.'
    ].join('\n'),
    suggestions: ['Where do I record a payment?', 'Show unpaid bookings.', 'How do I send an invoice?']
  },
  {
    id: 'checkout-balance-rule',
    title: 'Checkout balance rule',
    match: (text) => /\b(can i check ?out|checkout blocked|check out blocked|80%|part paid|partially paid|not fully paid)\b/.test(text),
    assistantText: [
      'A guest should not be checked out while a balance is still outstanding.',
      'If checkout is blocked, review the booking balance first, confirm any missing payments, then use the check-out action after the booking is fully settled.'
    ].join('\n'),
    suggestions: ['Show unpaid bookings.', 'Where do I record a payment?', 'How do I check out a guest?']
  },
  {
    id: 'offline-sync-financials',
    title: 'Offline sync and financial safety',
    match: (text) => /\b(offline sync|internet down|no internet|failed sync|sync warning|sync financial|queue|pending sync)\b/.test(text),
    assistantText: [
      'When the internet is down, Boroko can still capture local work, but remote reporting may lag behind until sync catches up.',
      'If sync warnings involve financial records, treat totals carefully until System Health shows the queue is healthy again.',
      'Use System Health to review pending or failed items before trusting cloud-side figures.'
    ].join('\n'),
    suggestions: ['How do I fix failed sync?', 'What needs my attention right now?', 'Show sync impact.']
  },
  {
    id: 'refund-guidance',
    title: 'Refund guidance',
    match: (text) => /\b(refund|void payment|reverse payment|cancel payment)\b/.test(text),
    assistantText: [
      'Refunds and reversals should be reviewed carefully from the booking or invoice context.',
      'Use the booking and payment history to confirm what was charged, what was paid, and whether the guest is still checked in before changing anything.'
    ].join('\n'),
    suggestions: ['How do I review or correct a payment?', 'Where do I record a payment?', 'Show unpaid bookings.']
  },
  {
    id: 'role-permissions',
    title: 'Roles and permissions',
    match: (text) => /\b(role|permission|who can|access|staff rights|user rights)\b/.test(text),
    assistantText: [
      'User access is controlled from Staff and role settings.',
      'If you are checking whether someone can perform an action, open Staff, review the user role, and confirm the required module access before testing the workflow.'
    ].join('\n'),
    suggestions: ['What can I do on Staff?', 'How do I use the manager mobile app?', 'How do I fix failed sync?']
  }
]

const APP_WORKFLOWS = [
  {
    id: 'assistant-overview',
    title: 'Use the local assistant',
    category: 'Help',
    screen: 'Assistant',
    route: '/ai',
    summary: 'Ask Boroko Assistant for steps, feature locations, live summaries, and safe next actions without using a cloud AI service.',
    steps: [
      'Open Assistant from the sidebar or the top Ask button.',
      'Type the task in your own words, even with spelling mistakes.',
      'Use the help card to open the right screen or follow the checklist.',
      'For live summaries, ask for attention, revenue, unpaid bookings, overdue checkouts, or daily briefing.'
    ],
    tips: [
      'Good prompts are short: "add stock", "check in guest", "failed sync", "send invoice".',
      'The assistant matches intent locally, so it keeps working when internet is unavailable.'
    ],
    keywords: ['assistant', 'ai', 'local assistant', 'app guide', 'offline guide', 'typo help']
  },
  {
    id: 'dashboard-overview',
    title: 'Read the dashboard',
    category: 'Daily Operations',
    screen: 'Dashboard',
    route: '/',
    summary: 'Use Dashboard for the lodge pulse: occupancy, expected arrivals, revenue signals, usage limits, and operational attention.',
    steps: [
      'Open Dashboard.',
      'Review the attention strip at the top for sync, collection, backup, and online booking alerts.',
      'Check the main cards for occupancy, arrivals, departures, and money collected.',
      'Use the daily briefing card for a plain-language operations summary.'
    ],
    tips: [
      'If the top bar shows failed sync, open System Health before trusting financial totals.',
      'Dashboard is the fastest place to start a handover.'
    ],
    keywords: ['dashboard', 'home', 'overview', 'occupancy', 'today', 'handover', 'attention', 'kpi', 'daily']
  },
  {
    id: 'create-booking',
    title: 'Create a booking',
    category: 'Front Desk',
    screen: 'Bookings',
    route: '/bookings',
    summary: 'Create room reservations from Bookings using the guest, room, date, and payment details.',
    steps: [
      'Open Bookings.',
      'Choose the new booking action.',
      'Select or enter the guest details.',
      'Choose the room and check-in/check-out dates.',
      'Enter the total amount, deposit, payment method, and notes if needed.',
      'Save, then confirm the booking appears in the list and room board.'
    ],
    tips: [
      'Use Room Board first when you need to visually check availability.',
      'Deposits should be recorded through the payment flow, not by editing paid totals manually.'
    ],
    keywords: ['booking', 'new booking', 'reservation', 'reserve room', 'book guest', 'create stay', 'add booking', 'room booking', 'walk in']
  },
  {
    id: 'online-booking-requests',
    title: 'Handle online booking requests',
    category: 'Front Desk',
    screen: 'Bookings',
    route: '/bookings',
    summary: 'Review requests submitted from the public booking site and confirm or decline them from the Bookings workspace.',
    steps: [
      'Open Bookings.',
      'Look for the online request indicator or pending online bookings area.',
      'Open the request and review guest details, dates, room, and contact information.',
      'Confirm the request if the room and terms are correct.',
      'Decline it if it conflicts or cannot be accepted, then contact the guest if needed.'
    ],
    tips: [
      'New online requests can appear in the top attention strip.',
      'If offline, new website requests may arrive only after the app reconnects.'
    ],
    keywords: ['online booking', 'website booking', 'pending request', 'confirm request', 'decline request', 'guest request', 'public booking']
  },
  {
    id: 'check-in',
    title: 'Check in a guest',
    category: 'Front Desk',
    screen: 'Bookings',
    route: '/bookings',
    summary: 'Move an arriving booking into checked-in status once the guest arrives and payment rules are satisfied.',
    steps: [
      'Open Bookings.',
      'Search for the guest or today\'s arrival.',
      'Open the booking details.',
      'Confirm identity, room, dates, notes, and outstanding balance.',
      'Use the check-in action.',
      'Confirm the room status updates on the Room Board.'
    ],
    tips: [
      'If a balance is still due, collect or note the payment before checkout.',
      'Use Guest profiles when you need history or blacklist status.'
    ],
    keywords: ['check in', 'arrival', 'guest arrived', 'arrivals', 'occupy room', 'start stay', 'mark checked in']
  },
  {
    id: 'check-out',
    title: 'Check out a guest',
    category: 'Front Desk',
    screen: 'Bookings',
    route: '/bookings',
    summary: 'Complete a guest stay, making sure the booking is paid before checkout.',
    steps: [
      'Open Bookings.',
      'Find the checked-in booking.',
      'Review room charges, POS charges, and outstanding balance.',
      'Record any remaining payment.',
      'Use the check-out action.',
      'Send or print the final invoice if required.'
    ],
    tips: [
      'Boroko blocks unsafe checkout if a balance remains.',
      'Ask the assistant for overdue checkouts to find rooms that should have left already.'
    ],
    keywords: ['check out', 'checkout', 'departure', 'guest leaving', 'complete stay', 'mark checked out', 'overdue checkout']
  },
  {
    id: 'record-payment',
    title: 'Record a booking payment',
    category: 'Finance',
    screen: 'Invoices',
    route: '/invoices',
    summary: 'Record deposits, balances, and final payments through the payment workflow so the ledger stays correct.',
    steps: [
      'Open Invoices or the booking payment area.',
      'Find the booking or guest.',
      'Review total amount, charges, paid amount, and remaining balance.',
      'Choose record payment.',
      'Enter the amount and method: cash, card, or transfer.',
      'Save and confirm the receipt or invoice balance updated.'
    ],
    tips: [
      'Never edit amount paid directly. Use the payment action so audit history stays correct.',
      'If sync has failed, review System Health before treating totals as final.'
    ],
    keywords: ['payment', 'record payment', 'booking payment', 'record booking payment', 'receive payment', 'deposit', 'paid', 'pay', 'collect money', 'balance', 'settle bill', 'cash', 'card', 'transfer', 'amount paid']
  },
  {
    id: 'invoice-delivery',
    title: 'Send or manage booking invoices',
    category: 'Finance',
    screen: 'Invoices',
    route: '/invoices',
    summary: 'Use Invoices to review booking invoices, record delivery, and send documents when email is configured.',
    steps: [
      'Open Invoices.',
      'Find the invoice by guest, booking, date, or invoice number.',
      'Review line totals and payments.',
      'Send by email if configured, or save the invoice as needed.',
      'Use delivery history to confirm what was sent.'
    ],
    tips: [
      'Configure email settings before relying on email delivery.',
      'If offline, save or print locally and send once connected.'
    ],
    keywords: ['invoice', 'send invoice', 'email invoice', 'receipt', 'billing', 'invoice number', 'delivery history', 'pdf']
  },
  {
    id: 'quotations',
    title: 'Create and convert quotations',
    category: 'Front Desk',
    screen: 'Quotations',
    route: '/quotations',
    summary: 'Prepare estimates for potential guests, then convert accepted quotations into bookings with a deposit.',
    steps: [
      'Open Quotations.',
      'Create a new quotation with guest, dates, room, and pricing details.',
      'Save the quotation for the guest.',
      'When accepted, choose convert to booking.',
      'Enter any deposit payment and method.',
      'Confirm the new booking and invoice were created.'
    ],
    tips: [
      'Use duplicate when a guest wants a similar quote with different dates.',
      'Converted quotations follow the same financial rules as normal bookings.'
    ],
    keywords: ['quotation', 'quote', 'estimate', 'proposal', 'convert quote', 'convert quotation', 'duplicate quotation']
  },
  {
    id: 'room-board',
    title: 'Check room availability',
    category: 'Front Desk',
    screen: 'Room Board',
    route: '/roomgrid',
    summary: 'Use Room Board for a visual live view of rooms, occupancy, availability, and housekeeping status.',
    steps: [
      'Open Room Board.',
      'Scan rooms by status and date.',
      'Use the room cards to see occupied, available, maintenance, or dirty/clean states.',
      'Open the related booking or room when more detail is needed.'
    ],
    tips: [
      'Room Board is best for quick front-desk decisions.',
      'Use Planning when you need a wider date range.'
    ],
    keywords: ['room board', 'availability', 'available room', 'occupied', 'vacant', 'room grid', 'live board', 'front desk board']
  },
  {
    id: 'calendar-planning',
    title: 'Plan bookings on the calendar',
    category: 'Front Desk',
    screen: 'Planning',
    route: '/calendar',
    summary: 'Use Planning to look across dates, spot occupancy patterns, and manage reservations on a wider schedule.',
    steps: [
      'Open Planning.',
      'Move to the date range you want.',
      'Review bookings and open items that need changes.',
      'Use Bookings or Room Board for final action when needed.'
    ],
    tips: [
      'Planning is useful for group bookings and busy weekends.',
      'If dates look stale, check sync status in the top bar.'
    ],
    keywords: ['calendar', 'planning', 'schedule', 'date range', 'month', 'forecast', 'occupancy forecast', 'future bookings']
  },
  {
    id: 'guest-profiles',
    title: 'Manage guest profiles',
    category: 'Front Desk',
    screen: 'Guests',
    route: '/guests',
    summary: 'Use Guests to keep customer profiles, contact details, booking history, ID photos, and blacklist notes tidy.',
    steps: [
      'Open Guests.',
      'Search by name, phone, email, or ID details.',
      'Open a guest profile.',
      'Update contact information or ID photo if needed.',
      'Review booking history before creating a new booking.',
      'Use blacklist only when there is a clear operational reason.'
    ],
    tips: [
      'Clean guest profiles reduce duplicate records.',
      'Blacklist notes should be factual and professional.'
    ],
    keywords: ['guest', 'customer', 'profile', 'id photo', 'blacklist', 'contact', 'guest history', 'customer history']
  },
  {
    id: 'rooms-setup',
    title: 'Add or edit rooms',
    category: 'Property',
    screen: 'Rooms',
    route: '/rooms',
    summary: 'Use Rooms to define room numbers, room types, rates, photos, and operational status.',
    steps: [
      'Open Rooms.',
      'Create a new room or open an existing one.',
      'Enter room number, type, default rate, and description.',
      'Add or update photos if available.',
      'Save and confirm the room appears in Room Board and bookings.'
    ],
    tips: [
      'Use Maintenance status when a room should not be booked.',
      'Subscription limits may block new rooms on some plans.'
    ],
    keywords: ['room', 'rooms', 'add room', 'edit room', 'room number', 'room rate', 'room photo', 'room type', 'maintenance status']
  },
  {
    id: 'housekeeping',
    title: 'Update housekeeping status',
    category: 'Property',
    screen: 'Housekeeping',
    route: '/housekeeping',
    summary: 'Use Housekeeping to track clean, dirty, inspected, and turnover states for rooms.',
    steps: [
      'Open Housekeeping.',
      'Find the room that needs updating.',
      'Change the housekeeping status.',
      'Add notes if staff need context.',
      'Confirm Room Board reflects the update.'
    ],
    tips: [
      'Housekeeping works best when staff update rooms immediately after cleaning.',
      'Use Maintenance for repair problems, not cleaning status.'
    ],
    keywords: ['housekeeping', 'clean room', 'dirty room', 'turnover', 'cleaning', 'room status', 'inspected']
  },
  {
    id: 'maintenance',
    title: 'Raise or resolve maintenance tickets',
    category: 'Property',
    screen: 'Maintenance',
    route: '/maintenance',
    summary: 'Use Maintenance to record repair issues, track open tickets, and mark work resolved.',
    steps: [
      'Open Maintenance.',
      'Create a new ticket with title, room if relevant, priority, and notes.',
      'Set the room to maintenance if it should not be sold.',
      'Update the ticket as work progresses.',
      'Resolve the ticket and return the room to service when done.'
    ],
    tips: [
      'Maintenance costs can appear in reports when recorded.',
      'Open tickets can be surfaced in the assistant attention summary.'
    ],
    keywords: ['maintenance', 'repair', 'broken', 'ticket', 'fix room', 'resolve ticket', 'issue', 'out of service']
  },
  {
    id: 'pos-sale',
    title: 'Process a POS sale',
    category: 'Finance',
    screen: 'POS',
    route: '/pos',
    summary: 'Use POS for restaurant, bar, and shop orders, including room-linked charges where supported.',
    steps: [
      'Open POS.',
      'Select the outlet or menu area if required.',
      'Add items to the order.',
      'Link the order to a room or booking if it should go to the guest folio.',
      'Choose payment method or room charge.',
      'Complete the order and confirm stock/payment updates.'
    ],
    tips: [
      'Void operations require supervisor approval.',
      'Inventory-linked menu items can reduce stock automatically.'
    ],
    keywords: ['pos', 'point of sale', 'sale', 'restaurant', 'bar', 'cashier', 'order', 'folio', 'room charge', 'menu item']
  },
  {
    id: 'pos-void',
    title: 'Void a POS order safely',
    category: 'Finance',
    screen: 'POS',
    route: '/pos',
    summary: 'Use the POS void flow when an order needs reversal, with PIN approval and stock restoration rules.',
    steps: [
      'Open POS.',
      'Find the order that needs to be voided.',
      'Choose void.',
      'Enter the supervisor, manager, or admin PIN.',
      'Confirm the reason and review the result.',
      'Check inventory and reports if the void affected stock or revenue.'
    ],
    tips: [
      'Void history is part of the financial audit trail.',
      'Do not delete POS records manually.'
    ],
    keywords: ['void', 'void order', 'cancel sale', 'reverse pos', 'supervisor pin', 'manager pin', 'stock restore']
  },
  {
    id: 'inventory-stock',
    title: 'Manage inventory stock',
    category: 'Finance',
    screen: 'Inventory',
    route: '/inventory',
    summary: 'Use Inventory for stock items, purchases, adjustments, low-stock checks, and stocktakes.',
    steps: [
      'Open Inventory.',
      'Create or select the item.',
      'Use purchases to add bought stock with cost details.',
      'Use stock adjustment for corrections, wastage, or manual changes.',
      'Run stocktakes when you need counted stock to become authoritative.',
      'Review low-stock items before reordering.'
    ],
    tips: [
      'Use manager PINs where the app asks for approval.',
      'POS-linked stock may update automatically after sales.'
    ],
    keywords: ['inventory', 'stock', 'add stock', 'purchase', 'low stock', 'stocktake', 'adjust stock', 'wastage', 'item', 'supplier']
  },
  {
    id: 'room-supplies',
    title: 'Manage room supplies and linen',
    category: 'Finance',
    screen: 'Room Supplies',
    route: '/supplies',
    summary: 'Use Room Supplies for amenities, linen, room allocations, movements, purchases, and stocktakes.',
    steps: [
      'Open Room Supplies.',
      'Create supply items such as linen, soap, tea, or toiletries.',
      'Add purchases to increase stock.',
      'Load supplies to rooms or record usage/returns.',
      'Review movements and weekly allocations.',
      'Run stocktakes for supply counts.'
    ],
    tips: [
      'Room supply reporting helps separate guest-room cost from general inventory.',
      'Use Room Supplies for amenities, and Inventory for saleable or outlet stock.'
    ],
    keywords: ['supplies', 'linen', 'amenities', 'room stock', 'soap', 'towels', 'allocation', 'load room', 'return stock']
  },
  {
    id: 'expenses',
    title: 'Record expenses',
    category: 'Finance',
    screen: 'Expenses',
    route: '/expenses',
    summary: 'Use Expenses to capture operational costs so reports and profit calculations stay meaningful.',
    steps: [
      'Open Expenses.',
      'Add the expense date, category, outlet if relevant, amount, and notes.',
      'Save the expense.',
      'Review reports to see costs included in financial summaries.'
    ],
    tips: [
      'Use Inventory purchases for stock buying when the item should affect stock counts.',
      'Use Expenses for overheads, services, repairs, and non-stock costs.'
    ],
    keywords: ['expense', 'expenses', 'cost', 'purchase cost', 'overhead', 'supplier bill', 'repair cost']
  },
  {
    id: 'night-audit',
    title: 'Run night audit',
    category: 'Finance',
    screen: 'Night Audit',
    route: '/audit',
    summary: 'Use Night Audit to close the day, review unsettled activity, and catch issues before handover.',
    steps: [
      'Open Night Audit.',
      'Select the audit date.',
      'Review arrivals, departures, unpaid balances, revenue, and exceptions.',
      'Resolve any blocking issues such as unpaid checked-out bookings.',
      'Save the audit record if required.'
    ],
    tips: [
      'Run System Health first if sync failures are visible.',
      'Night audit is a good place to verify the day before financial reporting.'
    ],
    keywords: ['night audit', 'audit', 'close day', 'closing', 'reconciliation', 'end of day', 'handover']
  },
  {
    id: 'reports',
    title: 'Save and read reports',
    category: 'Finance',
    screen: 'Reports',
    route: '/reports',
    summary: 'Use Reports for occupancy, revenue, profit and loss, POS, stock, maintenance, and report packs.',
    steps: [
      'Open Reports.',
      'Choose the report type and date range.',
      'Review source badges to understand whether data is live or offline cache.',
      'Save PDF for a clean report or Excel for workbook analysis.',
      'Check System Health when figures depend on records that failed sync.'
    ],
    tips: [
      'Reports use authoritative formulas; do not calculate paid totals manually.',
      'Excel workbooks can include multiple sheets for the report pack.'
    ],
    keywords: ['reports', 'report', 'download report', 'excel', 'pdf', 'revenue report', 'occupancy report', 'profit loss', 'analytics', 'performance']
  },
  {
    id: 'financial-audit',
    title: 'Run financial checks',
    category: 'Finance',
    screen: 'Reports',
    route: '/reports',
    summary: 'Use financial validation, reconciliation, and audit views to detect mismatches, unpaid bookings, and risky records.',
    steps: [
      'Open Reports.',
      'Choose financial validation, reconciliation, or audit tools.',
      'Review alerts and mismatches.',
      'Open affected bookings or System Health where needed.',
      'Resolve issues through normal payment, booking, or sync flows.'
    ],
    tips: [
      'Ask the assistant for payment anomalies for a fast local scan.',
      'Failed financial sync means reports may be incomplete until repaired.'
    ],
    keywords: ['financial audit', 'reconciliation', 'validation', 'anomaly', 'fraud', 'suspicious', 'mismatch', 'payment anomaly']
  },
  {
    id: 'conference',
    title: 'Manage conference and event bookings',
    category: 'Front Desk',
    screen: 'Conference',
    route: '/conference',
    summary: 'Use Conference for meetings, banquets, events, attendee capacity, deposits, and event balances.',
    steps: [
      'Open Conference.',
      'Create a new event booking.',
      'Enter customer, date, time, capacity, room/resource, and pricing details.',
      'Record deposit or payment when received.',
      'Update status as the event is confirmed or completed.'
    ],
    tips: [
      'Conference may require a subscription tier with the module enabled.',
      'Keep event payments separate from room booking payments.'
    ],
    keywords: ['conference', 'event', 'meeting', 'banquet', 'capacity', 'hall', 'venue', 'conference booking']
  },
  {
    id: 'day-use',
    title: 'Manage day-use or pool entries',
    category: 'Front Desk',
    screen: 'Day Use',
    route: '/dayuse',
    summary: 'Use Day Use for pool/day-pass entries, guest counts, fees, and facility usage.',
    steps: [
      'Open Day Use.',
      'Create a new entry with guest or group details.',
      'Select the facility and count.',
      'Enter the fee and payment details if charged.',
      'Save and review daily totals.'
    ],
    tips: [
      'Day Use is separate from overnight bookings.',
      'Use reports when you need day-use revenue totals.'
    ],
    keywords: ['day use', 'day pass', 'pool', 'swimming', 'facility', 'walk in', 'entry fee']
  },
  {
    id: 'staff',
    title: 'Manage staff and permissions',
    category: 'Team',
    screen: 'Staff',
    route: '/staff',
    summary: 'Use Staff to create users, update roles, reset passwords, and control what each staff member can access.',
    steps: [
      'Open Staff.',
      'Create or select a staff user.',
      'Set the role and access level.',
      'Reset password or send invite if needed.',
      'Save and ask the user to sign in again if permissions changed.'
    ],
    tips: [
      'Use the lowest role that fits the person\'s job.',
      'Some plans limit staff user count.'
    ],
    keywords: ['staff', 'user', 'employee', 'role', 'permission', 'access', 'reset password', 'invite', 'manager', 'front desk']
  },
  {
    id: 'data-management',
    title: 'Bring in, save, and back up data',
    category: 'Admin',
    screen: 'Data Management',
    route: '/data-management',
    summary: 'Use Data Management for Excel data loading, backups, saved copies, and operational data safety.',
    steps: [
      'Open Data Management.',
      'Choose the data loading option when bringing in structured data from a template.',
      'Choose the save or download option when you need a copy of lodge data.',
      'Use backups regularly and verify that the latest backup exists.',
      'Review loading results before relying on the records.'
    ],
    tips: [
      'The app may remind you when weekly archiving is overdue.',
      'Keep backup files somewhere safe and outside the computer when possible.'
    ],
    keywords: ['data management', 'excel load', 'spreadsheet load', 'download data', 'backup', 'archive', 'template', 'restore', 'data safety']
  },
  {
    id: 'system-health',
    title: 'Fix failed sync and system health issues',
    category: 'Admin',
    screen: 'Settings',
    route: '/settings',
    state: { activeTab: 'system' },
    summary: 'Use System Health to review failed sync, pending operations, device health, validation alerts, and support bundles.',
    steps: [
      'Open Settings.',
      'Go to System Health.',
      'Review failed and pending sync items.',
      'Read the operator-safe reason for each issue.',
      'Retry failed items after fixing the cause, or save a support bundle if you need help.',
      'For financial failures, do not clear items unless you understand the audit warning.'
    ],
    tips: [
      'Failed financial sync can make revenue, balances, and reports incomplete.',
      'Ask the assistant "what needs attention" before a shift handover.'
    ],
    keywords: ['system health', 'sync', 'failed sync', 'pending sync', 'offline', 'error', 'support bundle', 'device health', 'cache stale', 'integrity']
  },
  {
    id: 'settings',
    title: 'Update lodge settings',
    category: 'Admin',
    screen: 'Settings',
    route: '/settings',
    summary: 'Use Settings for lodge profile, business configuration, email, licensing, system health, and app preferences.',
    steps: [
      'Open Settings.',
      'Choose the tab for the setting you need.',
      'Update the values carefully.',
      'Save and verify the change in the related screen.',
      'Use System Health if a setting affects sync, licensing, or cloud services.'
    ],
    tips: [
      'Email settings affect invoice and booking communication.',
      'License and subscription settings can control which modules are available.'
    ],
    keywords: ['settings', 'configuration', 'company', 'lodge profile', 'email', 'smtp', 'license', 'subscription', 'preferences']
  },
  {
    id: 'subscription-upgrade',
    title: 'Request an upgrade or unlock a module',
    category: 'Admin',
    screen: 'Settings',
    route: '/settings',
    summary: 'Use upgrade prompts or Settings to request access to modules that are locked by subscription plan.',
    steps: [
      'Open the locked module or Settings.',
      'Review the plan requirement shown by Boroko.',
      'Use Request Upgrade.',
      'Confirm lodge details and requested plan.',
      'Submit the request and wait for account follow-up.'
    ],
    tips: [
      'Locked modules are shown with the plan needed.',
      'Usage cards can recommend an upgrade when limits are close.'
    ],
    keywords: ['upgrade', 'subscription', 'plan', 'locked', 'module locked', 'license', 'billing', 'starter', 'standard', 'pro']
  },
  {
    id: 'mobile-pwa',
    title: 'Use the manager mobile app',
    category: 'Admin',
    screen: 'Staff',
    route: '/staff',
    summary: 'Use staff access and the Manager Mobile App for mobile workflows like alerts, reports, bookings, invoices, and control tasks.',
    steps: [
      'Open Staff.',
      'Select the user who needs mobile access.',
      'Enable the appropriate Mobile App access for their role.',
      'Ask the user to sign into the manager app.',
      'Review Control or Alerts on the Mobile App for device-local warnings.'
    ],
    tips: [
      'Mobile App queue health can be device-local, so compare with desktop System Health when investigating sync.',
      'Use roles carefully because mobile access can expose sensitive operations.'
    ],
    keywords: ['mobile', 'pwa', 'manager app', 'phone app', 'alerts', 'control', 'remote access', 'front desk request']
  }
]

const LOCAL_TOOL_INTENTS = [
  {
    tool: 'get_attention',
    title: 'What needs attention',
    response: 'I will check the live attention summary from this device.',
    responsePrompt: 'What needs my attention right now?',
    keywords: ['attention', 'needs attention', 'what should i do', 'priority', 'problems today', 'issues now', 'alerts', 'what is wrong', 'handover']
  },
  {
    tool: 'get_today_revenue',
    title: 'Today revenue',
    response: 'I will pull today\'s collected revenue summary.',
    responsePrompt: 'Show today revenue.',
    keywords: ['today revenue', 'todays revenue', 'money today', 'collected today', 'sales today', 'cash today', 'income today', 'payment mix']
  },
  {
    tool: 'get_unpaid_summary',
    title: 'Collections summary',
    response: 'I will build the unpaid collections summary using the local booking records.',
    responsePrompt: 'Give me the full unpaid collections summary.',
    keywords: ['collections summary', 'unpaid summary', 'outstanding balance', 'money owed', 'balances due', 'who owes', 'collect unpaid', 'debtors']
  },
  {
    tool: 'list_unpaid_bookings',
    title: 'List unpaid bookings',
    response: 'I will list bookings that still have balances due.',
    responsePrompt: 'Show unpaid bookings.',
    keywords: ['list unpaid', 'show unpaid bookings', 'unpaid bookings', 'who has not paid', 'balances list', 'guests owing']
  },
  {
    tool: 'get_overdue_checkouts',
    title: 'Overdue checkouts',
    response: 'I will look for checked-in bookings that should already have checked out.',
    responsePrompt: 'Show overdue checkouts.',
    keywords: ['overdue checkout', 'overdue checkouts', 'late checkout', 'should have checked out', 'departures overdue', 'still checked in']
  },
  {
    tool: 'get_daily_briefing',
    title: 'Daily briefing',
    response: 'I will generate the local daily operations briefing.',
    responsePrompt: 'Give me the daily briefing.',
    keywords: ['daily briefing', 'brief me', 'morning briefing', 'manager briefing', 'today briefing', 'executive briefing']
  },
  {
    tool: 'detect_payment_anomalies',
    title: 'Payment anomalies',
    response: 'I will run the local payment anomaly checks.',
    responsePrompt: 'Show payment anomalies.',
    keywords: ['payment anomalies', 'fraud', 'suspicious payment', 'suspicious activity', 'financial alerts', 'detect anomalies', 'payment risk']
  },
  {
    tool: 'get_revenue_comparison',
    title: 'Revenue comparison',
    response: 'I will compare recent revenue from local records.',
    responsePrompt: 'Compare revenue this week.',
    keywords: ['revenue trend', 'revenue this week', 'compare revenue', 'weekly revenue', 'how is revenue', 'revenue going up', 'revenue going down', 'sales trend']
  },
  {
    tool: 'get_room_availability',
    title: 'Room availability',
    response: 'I will check room availability from local bookings and rooms.',
    responsePrompt: 'Which rooms are available tonight?',
    keywords: ['room available', 'available room', 'which rooms', 'free room', 'vacant', 'any rooms', 'room free tonight', 'open rooms', 'unoccupied', 'availability']
  },
  {
    tool: 'get_room_rate',
    title: 'Room rate lookup',
    response: 'I will check room rates from local room setup.',
    responsePrompt: 'What is the rate for room 5?',
    keywords: ['room rate', 'how much is room', 'price of room', 'tariff', 'cost per night', 'nightly rate', 'what does room cost', 'room price']
  },
  {
    tool: 'search_guest',
    title: 'Guest lookup',
    response: 'I will search guest records locally.',
    responsePrompt: 'Find guest John Smith.',
    keywords: ['find guest', 'search guest', 'guest history', 'returning guest', 'been here before', 'guest phone', 'guest email', 'who is', 'lookup guest']
  },
  {
    tool: 'lookup_booking',
    title: 'Booking lookup',
    response: 'I will look up the matching booking and explain its status and balance.',
    responsePrompt: 'Balance for room 12.',
    keywords: ['balance for room', 'booking balance', 'who is in room', 'status of booking', 'invoice for room', 'find booking', 'lookup booking', 'booking status', 'guest in room']
  },
  {
    tool: 'get_occupancy_forecast',
    title: 'Occupancy forecast',
    response: 'I will project occupancy using confirmed bookings.',
    responsePrompt: 'Show occupancy forecast for this week.',
    keywords: ['occupancy forecast', 'upcoming occupancy', 'how full', 'next week', 'booking forecast', 'expected occupancy', 'capacity']
  },
  {
    tool: 'get_low_stock_overview',
    title: 'Low stock overview',
    response: 'I will check low stock items from local inventory.',
    responsePrompt: 'What supplies are low?',
    keywords: ['what supplies are low', 'do we need to buy inventory', 'low stock', 'stock running out', 'low supplies', 'reorder items']
  },
  {
    tool: 'get_pending_online_requests',
    title: 'Pending online booking requests',
    response: 'I will check online booking requests waiting for review.',
    responsePrompt: 'Any online booking requests?',
    keywords: ['new online requests', 'online booking requests', 'pending online bookings', 'website bookings pending', 'ota requests']
  },
  {
    tool: 'get_backup_status',
    title: 'Backup status',
    response: 'I will check recent local backup status.',
    responsePrompt: 'When was the last backup?',
    keywords: ['is my data backed up', 'last backup', 'backup status', 'backup health', 'backup overdue']
  },
  {
    tool: 'get_handover_report',
    title: 'Shift handover report',
    response: 'I will build a local handover report.',
    responsePrompt: 'Show shift handover report.',
    keywords: ['shift handover', 'handover report', 'handoff brief', 'what should next shift know', 'manager handover']
  },
  {
    tool: 'get_sync_impact',
    title: 'Sync impact',
    response: 'I will assess the operational impact of sync failures.',
    responsePrompt: 'Show sync impact.',
    keywords: ['sync impact', 'failed sync impact', 'what is affected by sync', 'sync queue impact', 'stuck financial sync']
  },
  {
    tool: 'get_maintenance_satisfaction_risk',
    title: 'Occupied room maintenance risk',
    response: 'I will look for in-house guests staying in rooms with open maintenance issues.',
    responsePrompt: 'Show maintenance satisfaction risk.',
    keywords: ['guest complaint', 'guest issue in room', 'occupied maintenance', 'maintenance risk', 'guest satisfaction risk', 'active guest maintenance', 'room problem with guest']
  },
  {
    tool: 'get_operational_cleanliness_audit',
    title: 'Operational cleanliness audit',
    response: 'I will audit bookings that look missed for check-in or check-out.',
    responsePrompt: 'Run the operational cleanliness audit.',
    keywords: ['forgotten check in', 'forgotten checkout', 'daily audit', 'operational cleanliness audit', 'missed check in', 'missed check out', 'arrival passed still booked', 'departure passed still checked in']
  }
]

// ─── Screen → relevant workflow IDs mapping (for dynamic fallback suggestions) ─
const ROUTE_WORKFLOW_HINTS = {
  '/': ['dashboard-overview', 'create-booking', 'check-in', 'check-out', 'record-payment'],
  '/bookings': ['create-booking', 'check-in', 'check-out', 'record-payment', 'online-booking-requests'],
  '/invoices': ['record-payment', 'invoice-delivery', 'financial-audit'],
  '/roomgrid': ['room-board', 'check-in', 'check-out', 'housekeeping'],
  '/calendar': ['calendar-planning', 'create-booking', 'check-in'],
  '/guests': ['guest-profiles', 'create-booking'],
  '/pos': ['pos-sale', 'pos-void', 'inventory-stock'],
  '/inventory': ['inventory-stock', 'room-supplies', 'expenses'],
  '/supplies': ['room-supplies', 'inventory-stock'],
  '/housekeeping': ['housekeeping', 'room-board', 'maintenance'],
  '/maintenance': ['maintenance', 'rooms-setup'],
  '/reports': ['reports', 'financial-audit', 'night-audit'],
  '/audit': ['night-audit', 'reports', 'financial-audit'],
  '/expenses': ['expenses', 'reports'],
  '/conference': ['conference'],
  '/dayuse': ['day-use'],
  '/quotations': ['quotations', 'create-booking'],
  '/staff': ['staff', 'mobile-pwa', 'subscription-upgrade'],
  '/data-management': ['data-management'],
  '/settings': ['settings', 'system-health', 'subscription-upgrade'],
  '/ai': ['assistant-overview', 'dashboard-overview', 'create-booking']
}

const WORKFLOW_CORPUS = buildCorpusDocuments(APP_WORKFLOWS, (entry) => entrySearchText(entry))
const TOOL_INTENT_CORPUS = buildCorpusDocuments(LOCAL_TOOL_INTENTS, (entry) => [entry.title, entry.response, ...(entry.keywords || [])].join(' '))
const FAQ_CORPUS = buildCorpusDocuments(FINANCIAL_FAQ, (entry) => [entry.title, entry.assistantText, ...(entry.suggestions || [])].join(' '))
const PLAYBOOK_CORPUS = buildCorpusDocuments(SCENARIO_PLAYBOOKS, (entry) => [entry.title, entry.summary, ...(entry.steps || []), ...(entry.prompts || [])].join(' '))

// ─── Text processing ──────────────────────────────────────────────────────

function applySynonyms(text) {
  let result = text
  for (const [from, to] of Object.entries(SYNONYM_MAP)) {
    // Use word-boundary safe replacement
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'g'), to)
  }
  return result
}

function normalizeText(value) {
  let text = String(value || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')

  for (const [pattern, replacement] of SPELLING_REPLACEMENTS) {
    text = text.replace(pattern, replacement)
  }

  text = applySynonyms(text)

  return text.replace(/\s+/g, ' ').trim()
}

function tokenize(value) {
  const normalized = normalizeText(value)
  if (!normalized) return []
  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && !STOP_WORDS.has(token))
    .map(stemToken)
}

function stemToken(token) {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function entrySearchText(entry) {
  return [
    entry.title,
    entry.category,
    entry.screen,
    entry.summary,
    ...(entry.steps || []),
    ...(entry.tips || []),
    ...(entry.keywords || [])
  ].join(' ')
}

function buildCorpusDocuments(entries, toText) {
  const corpus = entries.map((entry) => unique(tokenize(toText(entry))))
  const docCount = corpus.length || 1
  const frequencies = new Map()
  for (const tokens of corpus) {
    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1)
    }
  }
  const idf = new Map()
  for (const [token, count] of frequencies.entries()) {
    idf.set(token, Math.log((1 + docCount) / (1 + count)) + 1)
  }
  return { corpus, idf, docCount }
}

function semanticSimilarity(query, docTokens, idf) {
  const queryTokens = unique(tokenize(query))
  if (!queryTokens.length || !docTokens.length) return 0
  const querySet = new Set(queryTokens)
  const docSet = new Set(docTokens)
  let intersection = 0
  let queryNorm = 0
  let docNorm = 0
  for (const token of querySet) {
    const weight = idf.get(token) || 1
    queryNorm += weight * weight
    if (docSet.has(token)) intersection += weight * weight
  }
  for (const token of docSet) {
    const weight = idf.get(token) || 1
    docNorm += weight * weight
  }
  if (!intersection || !queryNorm || !docNorm) return 0
  return intersection / (Math.sqrt(queryNorm) * Math.sqrt(docNorm))
}

function fuzzyTokenScore(queryToken, targetToken) {
  if (!queryToken || !targetToken) return 0
  if (queryToken === targetToken) return 1
  if (targetToken.includes(queryToken) || queryToken.includes(targetToken)) return 0.82
  const maxLen = Math.max(queryToken.length, targetToken.length)
  const distance = editDistance(queryToken, targetToken, Math.min(4, Math.ceil(maxLen / 2)))
  const lev = Math.max(0, 1 - (distance / Math.max(1, maxLen)))
  const dice = diceSimilarity(queryToken, targetToken)
  return Math.max(lev, dice)
}

function fuzzySearchScore(query, documentText, title = '', keywords = []) {
  const queryTokens = unique(tokenize(query))
  const docTokens = unique(tokenize(documentText))
  if (!queryTokens.length || !docTokens.length) return { score: 0, terms: [] }

  const normalizedQuery = normalizeText(query)
  const normalizedTitle = normalizeText(title)
  const normalizedKeywords = keywords.map(normalizeText).filter(Boolean)
  let score = 0
  const terms = []

  for (const keyword of normalizedKeywords) {
    const keywordScore = fuzzyTokenScore(normalizedQuery, keyword)
    if (keywordScore >= 0.8) score += keywordScore * 5
  }

  for (const token of queryTokens) {
    let best = 0
    let bestTarget = ''
    for (const target of docTokens) {
      const next = fuzzyTokenScore(token, target)
      if (next > best) {
        best = next
        bestTarget = target
      }
    }
    if (best >= 0.78) {
      score += best * 1.5
      terms.push(bestTarget || token)
    }
  }

  const coverage = terms.length / Math.max(1, queryTokens.length)
  return { score: score + (coverage * 4), terms: unique(terms).slice(0, 8) }
}

// ─── Bi-gram phrase scoring ───────────────────────────────────────────────

/**
 * Returns a bonus score for phrase-level matches. Checked BEFORE token scoring
 * to prevent "check in" and "check out" from bleeding into each other.
 */
function phraseBonusScore(query, documentText, title = '') {
  const nq = normalizeText(query)
  const nd = normalizeText(documentText)
  const nt = normalizeText(title)
  let bonus = 0
  for (const phrase of KEY_PHRASES) {
    if (nq.includes(phrase)) {
      if (nt.includes(phrase)) bonus += 25
      else if (nd.includes(phrase)) bonus += 12
    }
  }
  return bonus
}

// ─── Edit distance & dice similarity ─────────────────────────────────────

function editDistance(a, b, limit = 3) {
  a = String(a || '')
  b = String(b || '')
  if (a === b) return 0
  if (!a || !b) return Math.max(a.length, b.length)
  if (Math.abs(a.length - b.length) > limit) return limit + 1

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = new Array(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      )
      rowMin = Math.min(rowMin, curr[j])
    }
    if (rowMin > limit) return limit + 1
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }

  return prev[b.length]
}

function diceSimilarity(a, b) {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const grams = new Map()
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2)
    grams.set(gram, (grams.get(gram) || 0) + 1)
  }
  let hits = 0
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2)
    const count = grams.get(gram) || 0
    if (count > 0) {
      hits++
      grams.set(gram, count - 1)
    }
  }
  return (2 * hits) / (a.length + b.length - 2)
}

function tokenMatchScore(queryToken, targetToken) {
  if (!queryToken || !targetToken) return 0
  if (queryToken === targetToken) return 4
  if (targetToken.startsWith(queryToken) || queryToken.startsWith(targetToken)) return 2.2

  const distance = editDistance(queryToken, targetToken, 2)
  if (distance === 1) return 2
  if (distance === 2 && Math.max(queryToken.length, targetToken.length) >= 5) return 1.2

  const dice = diceSimilarity(queryToken, targetToken)
  if (dice >= 0.72) return 1.4
  if (dice >= 0.58) return 0.8
  return 0
}

function scoreDocument(query, documentText, title = '', keywords = []) {
  const normalizedQuery = normalizeText(query)
  const normalizedDoc = normalizeText(documentText)
  const normalizedTitle = normalizeText(title)
  const normalizedKeywords = keywords.map(normalizeText)
  const queryTokens = unique(tokenize(query))
  const docTokens = unique(tokenize(documentText))

  if (!normalizedQuery || queryTokens.length === 0) return { score: 0, matchedTerms: [] }

  let score = 0
  const matchedTerms = []

  // Phrase-level bonus (runs first to prevent phrase bleedover)
  score += phraseBonusScore(query, documentText, title)

  if (normalizedTitle && normalizedTitle.includes(normalizedQuery)) score += 22
  if (normalizedDoc.includes(normalizedQuery)) score += 12

  for (const keyword of normalizedKeywords) {
    if (!keyword) continue
    if (keyword === normalizedQuery) score += 20
    else if (keyword.includes(normalizedQuery) || normalizedQuery.includes(keyword)) score += 10
  }

  for (const queryToken of queryTokens) {
    let best = 0
    let bestTarget = ''
    for (const targetToken of docTokens) {
      const next = tokenMatchScore(queryToken, targetToken)
      if (next > best) {
        best = next
        bestTarget = targetToken
      }
    }
    if (best > 0) {
      score += best
      matchedTerms.push(bestTarget || queryToken)
    }
  }

  const coverage = matchedTerms.length / Math.max(1, queryTokens.length)
  score += coverage * 10

  const semantic = semanticSimilarity(query, docTokens, WORKFLOW_CORPUS.idf)
  if (semantic > 0) score += semantic * 18
  const fuzzy = fuzzySearchScore(query, documentText, title, keywords)
  if (fuzzy.score > 0) {
    score += fuzzy.score
    matchedTerms.push(...fuzzy.terms)
  }

  return { score, matchedTerms: unique(matchedTerms).slice(0, 8) }
}

function publicWorkflow(entry, score = 0, matchedTerms = []) {
  return {
    id: entry.id,
    title: entry.title,
    category: entry.category,
    screen: entry.screen,
    route: entry.route,
    state: entry.state || null,
    summary: entry.summary,
    steps: entry.steps || [],
    tips: entry.tips || [],
    keywords: entry.keywords || [],
    score: Number(score.toFixed(2)),
    matchedTerms
  }
}

export function searchLocalAppHelp(query, { route = null, limit = 5 } = {}) {
  const normalizedQuery = normalizeText(query)
  const routeBoost = route ? String(route) : ''
  const scored = APP_WORKFLOWS.map((entry) => {
    const { score, matchedTerms } = scoreDocument(query, entrySearchText(entry), entry.title, entry.keywords || [])
    const boosted = score + (routeBoost && entry.route === routeBoost ? 4 : 0)
    return { entry, score: boosted, matchedTerms }
  })
    .filter((item) => item.score > 2)
    .sort((a, b) => b.score - a.score)

  if (!scored.length && normalizedQuery) {
    return []
  }

  return scored.slice(0, limit).map((item) => publicWorkflow(item.entry, item.score, item.matchedTerms))
}

function wantsCurrentScreenHelp(message) {
  const text = normalizeText(message)
  return /\b(this screen|current screen|where am i|what can i do here|on this page|this page|here)\b/.test(text)
}

function looksInstructional(message) {
  const text = normalizeText(message)
  return /\b(how|where|guide|instruction|steps|learn|find|locate|help|show me how|what can i do)\b/.test(text)
}

function looksLikeLiveDataQuestion(message) {
  const text = normalizeText(message)
  return /\b(show|list|what|give|run|check|today|now|summary|briefing|attention|revenue|unpaid|overdue|anomal|fraud|owed|owing)\b/.test(text)
}

function hasNegation(message) {
  return NEGATION_WORDS.test(normalizeText(message))
}

function isGreeting(text) {
  return /^(hi|hello|hey|good morning|good afternoon|good evening|howzit|dumela)\b/.test(text)
}

function isThanks(text) {
  return /^(thanks|thank you|cheers)\b/.test(text)
}

function isClosing(text) {
  return /^(bye|goodbye|goodnight|done|done for now|that'?s all|close|exit)\b/.test(text)
}

function isCapabilitiesQuestion(text) {
  return /^(help|what can you do|what do you know|capabilities|features|commands)\b/.test(text)
}

function extractRoomHint(message) {
  const match = String(message || '').match(/\b(?:room|rm)\s*(\d+[a-z]?)\b/i)
  return match ? String(match[1]).toUpperCase() : null
}

function extractDayWindow(message) {
  const text = normalizeText(message)
  if (/\btonight\b|\btoday\b/.test(text)) return 1
  if (/\btomorrow\b/.test(text)) return 2
  if (/\b(next month|this month)\b/.test(text)) return 30
  if (/\bthis weekend\b|\bweekend\b/.test(text)) {
    const today = new Date()
    const dayOfWeek = today.getDay()
    const daysToSunday = (7 - dayOfWeek) % 7 || 7
    return Math.max(2, Math.min(30, daysToSunday))
  }
  const weekdayMatch = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)
  if (weekdayMatch) {
    const weekdayIndex = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(weekdayMatch[1])
    const today = new Date()
    const todayIndex = today.getDay()
    const daysUntil = (weekdayIndex - todayIndex + 7) % 7 || 7
    return Math.max(1, Math.min(30, daysUntil))
  }
  if (/\bnext week\b|\bthis week\b|\b7 day\b|\bseven day\b/.test(text)) return 7
  const match = text.match(/\b(\d+)\s*(day|days)\b/)
  if (match) return Math.max(1, Math.min(30, Number(match[1]) || 1))
  return null
}

function extractGuestHint(message) {
  const direct = String(message || '').match(/\b(?:guest|customer|invoice)\s+(?:named\s+)?([a-z][a-z\s.'-]{1,40})$/i)
  if (direct) return direct[1].trim()
  const hasGuestIntent = /\b(find|search|lookup|guest|customer|who is|been here before)\b/.test(normalizeText(message))
  if (!hasGuestIntent) return null
  const cleaned = String(message || '')
    .replace(/\b(?:room|rooms|unit|number)\s*#?\s*\d+\??\b/gi, ' ')
    .replace(/\b(find|search|lookup|booking|reservation|invoice|guest|customer|who is|who|is|in|room|rooms|unit|number|has|been here before|with|phone|email)\b/gi, ' ')
    .replace(/\b#\s*\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length >= 3 ? cleaned : null
}

function extractBookingHint(message) {
  const raw = String(message || '')
  const bookingId = raw.match(/\b(?:booking|reservation|invoice)\s*(?:number|id|#)?\s*([a-z0-9-]{4,})\b/i)
  if (bookingId) return { booking_query: bookingId[1], room_number: extractRoomHint(message), guest_query: extractGuestHint(message) }
  return {
    booking_query: null,
    room_number: extractRoomHint(message),
    guest_query: extractGuestHint(message)
  }
}

function buildCapabilitiesSummary() {
  return [
    'I can help in five main ways:',
    '1. Find features and explain steps, like "How do I check in?" or "Where do I record a payment?"',
    '2. Read live local summaries, like attention, revenue, unpaid bookings, overdue checkouts, backups, and sync impact.',
    '3. Look up records, like a booking balance for a room, guest history, who is in a room now, or the rate for a room.',
    '4. Search local records and audits, like available rooms, online booking requests, occupancy forecast, missed check-ins, and occupied rooms with maintenance risk.',
    '5. Explain the current screen when you ask "What can I do here?", or let you browse known topics from the sidebar.'
  ].join('\n')
}

function getTimeContext() {
  const hour = new Date().getHours()
  if (hour < 6) return { period: 'early_morning', boost: 'get_backup_status', suggestion: 'When was the last backup?' }
  if (hour < 10) return { period: 'morning', boost: 'get_daily_briefing', suggestion: 'Give me the daily briefing.' }
  if (hour < 14) return { period: 'midday', boost: 'get_attention', suggestion: 'What needs my attention right now?' }
  if (hour < 18) return { period: 'afternoon', boost: 'get_overdue_checkouts', suggestion: 'Show overdue checkouts.' }
  if (hour < 22) return { period: 'evening', boost: 'get_handover_report', suggestion: 'Show shift handover report.' }
  return { period: 'night', boost: 'get_backup_status', suggestion: 'When was the last backup?' }
}

function extractRoomRateHint(message) {
  const room_number = extractRoomHint(message)
  const text = normalizeText(message)
  const roomTypeMatch = text.match(/\b(single|double|twin|family|deluxe|standard|suite|executive)\b/)
  return {
    room_number,
    rate_query: roomTypeMatch ? roomTypeMatch[1] : null
  }
}

function findFinancialFaq(message) {
  const text = normalizeText(message)
  const exact = FINANCIAL_FAQ.find((entry) => entry.match(text))
  if (/\b(balance for room|who is in room|invoice for room|booking id|booking number|find booking|lookup booking)\b/.test(text)) return null
  if (exact) return exact
  if (!/\b(deposit|payment|paid|amount paid|amount_paid|refund|checkout|check out|sync|role|permission|balance)\b/.test(text)) return null
  if (/\b(where|record|receive|take|add|show|list|find|lookup|open)\b/.test(text)) return null
  const scored = FINANCIAL_FAQ.map((entry, index) => {
    const doc = [entry.title, entry.assistantText, ...(entry.suggestions || [])].join(' ')
    const fuzzy = fuzzySearchScore(message, doc, entry.title, entry.suggestions || [])
    const semantic = semanticSimilarity(message, FAQ_CORPUS.corpus[index] || [], FAQ_CORPUS.idf)
    return { entry, score: fuzzy.score + (semantic * 20) }
  }).sort((a, b) => b.score - a.score)
  return scored[0]?.score >= 34 ? scored[0].entry : null
}

function findScenarioPlaybook(message) {
  const text = normalizeText(message)
  const exact = SCENARIO_PLAYBOOKS.find((entry) => entry.match(text))
  if (exact) return exact
  const scored = SCENARIO_PLAYBOOKS.map((entry, index) => {
    const doc = [entry.title, entry.summary, ...(entry.steps || []), ...(entry.prompts || [])].join(' ')
    const fuzzy = fuzzySearchScore(message, doc, entry.title, entry.prompts || [])
    const semantic = semanticSimilarity(message, PLAYBOOK_CORPUS.corpus[index] || [], PLAYBOOK_CORPUS.idf)
    return { entry, score: fuzzy.score + (semantic * 20) }
  }).sort((a, b) => b.score - a.score)
  return scored[0]?.score >= 80 ? scored[0].entry : null
}

function buildClarifier(message) {
  const text = normalizeText(message)
  if (/\binvoice details?\b/.test(text)) {
    return { text: 'I can look that up. What is the guest name or invoice number?', dialogue: { intent: 'lookup_booking', params: {}, missing: ['booking_or_room'] }, slot: 'booking_or_room' }
  }
  if (/\bguest\b/.test(text) && !extractGuestHint(message)) {
    return { text: 'I can search guest records. What guest name, phone number, or email should I look for?', dialogue: { intent: 'search_guest', params: {}, missing: ['guest_query'] }, slot: 'guest_query' }
  }
  if (/\broom\b/.test(text) && !extractRoomHint(message) && /\bavailable|free|vacant\b/.test(text)) {
    return { text: 'I can check room availability. Which room number, or should I check all rooms?', dialogue: { intent: 'get_room_availability', params: { days: extractDayWindow(message) || 1 }, missing: ['room_or_all'] }, slot: 'room_or_all' }
  }
  if (/\b(rate|price|tariff|cost)\b/.test(text) && !extractRoomHint(message) && !extractRoomRateHint(message)?.rate_query) {
    return { text: 'I can check the local room rate. Which room number or room type should I check?', dialogue: { intent: 'get_room_rate', params: {}, missing: ['room_or_type'] }, slot: 'room_or_type' }
  }
  return null
}

function resolveToolIntent(message) {
  const text = normalizeText(message)
  const instructional = looksInstructional(message)
  const negated = hasNegation(message)
  if (isGreeting(text)) {
    return {
      assistantText: 'Hello. Ask me about any feature, or try "What needs my attention?"',
      localHelp: { mode: 'greeting', confidence: 'high', query: message, bestMatch: null, matches: [], suggestions: LOCAL_ASSISTANT_SUGGESTIONS.slice(0, 4) }
    }
  }
  if (isThanks(text)) {
    return {
      assistantText: 'You are welcome. I am ready for the next question.',
      localHelp: { mode: 'thanks', confidence: 'high', query: message, bestMatch: null, matches: [], suggestions: LOCAL_ASSISTANT_SUGGESTIONS.slice(0, 4) }
    }
  }
  if (isClosing(text)) {
    return {
      assistantText: 'You are all set. Come back anytime you need help with the app.',
      localHelp: { mode: 'closing', confidence: 'high', query: message, bestMatch: null, matches: [], suggestions: [] }
    }
  }
  if (isCapabilitiesQuestion(text)) {
    return {
      assistantText: buildCapabilitiesSummary(),
      localHelp: { mode: 'capabilities', confidence: 'high', query: message, bestMatch: null, matches: [], suggestions: LOCAL_ASSISTANT_SUGGESTIONS.slice(0, 4) }
    }
  }
  if (negated && !instructional) {
    return {
      assistantText: 'It sounds like you are stopping or correcting something. Tell me what you want to check instead, and I will keep it read-only.',
      localHelp: { mode: 'clarify', confidence: 'medium', query: message, bestMatch: null, matches: [], suggestions: ['What needs my attention right now?', 'Show unpaid bookings.', 'How do I check out a guest?'], slot: 'negation', dialogue: null }
    }
  }
  if (/\b(shift handover report|handover report|handoff brief)\b/.test(text)) {
    return {
      tool: 'get_handover_report',
      params: {},
      assistantText: 'I will build a local handover report.',
      localIntent: { title: 'Shift handover report', confidence: 'high', matchedTerms: ['handover', 'report'] }
    }
  }

  const playbook = findScenarioPlaybook(message)
  if (playbook) {
    return {
      assistantText: `${playbook.title}\n${playbook.summary}`,
      localHelp: {
        mode: 'playbook',
        confidence: 'high',
        query: message,
        bestMatch: {
          id: playbook.id,
          title: playbook.title,
          category: 'Playbooks',
          screen: 'Assistant',
          route: '/ai',
          state: null,
          summary: playbook.summary,
          steps: playbook.steps,
          tips: [],
          keywords: [],
          score: 40,
          matchedTerms: []
        },
        matches: [],
        suggestions: playbook.prompts
      }
    }
  }

  const faq = findFinancialFaq(message)
  const faqStyleQuestion = /\b(difference|what is|why|can i|when|rule|policy|meaning)\b/.test(text)
  if (faq && ((faqStyleQuestion || !instructional) || /\bhow do\b.*\b(deposits?|payment status|refund)\b/.test(text)) && !/\bfailed sync\b/.test(text) && !/\bhow do i (create|record|open|send|check in|check out)\b/.test(text)) {
    return {
      assistantText: faq.assistantText,
      localHelp: {
        mode: 'faq',
        confidence: 'high',
        query: message,
        bestMatch: {
          id: faq.id,
          title: faq.title,
          category: 'Policies',
          screen: 'Assistant',
          route: '/ai',
          state: null,
          summary: faq.assistantText.split('\n')[0],
          steps: [],
          tips: [],
          keywords: [],
          score: 40,
          matchedTerms: []
        },
        matches: [],
        suggestions: faq.suggestions || []
      }
    }
  }
  const clarifier = buildClarifier(message)
  if (clarifier) {
    return {
      assistantText: clarifier.text,
      localHelp: { mode: 'clarify', confidence: 'medium', query: message, bestMatch: null, matches: [], suggestions: [], slot: clarifier.slot, dialogue: clarifier.dialogue || null }
    }
  }
  if (/\b(record|receive|take|add|where|how|guide|steps)\b/.test(text) && /\bpayment\b/.test(text) && !/\b(unpaid|owed|owing|outstanding|summary|anomal|fraud|risk|list)\b/.test(text)) {
    return null
  }
  if (instructional && /\b(check in|check out|failed sync|create booking|add stock|send invoice|invoice|maintenance|room board|night audit|calendar|report|settings|payment)\b/.test(text)) {
    return null
  }
  if (/\bunpaid\b|\bowed\b|\bowing\b|\bbalance\b/.test(text)) {
    if (/\b(room|booking id|invoice|this booking|room number)\b/.test(text) && !/\b(bookings|guests|who owes|list|summary|collections)\b/.test(text)) {
      return {
        tool: 'lookup_booking',
        params: buildToolParams('lookup_booking', message),
        assistantText: 'I will look up the booking and explain its current status and balance.',
        localIntent: { title: 'Booking lookup', confidence: 'high', matchedTerms: ['balance', 'booking'] }
      }
    }
    if (/\bsummary\b|\btotal\b|\bfull\b|\bcollections?\b|\boutstanding\b/.test(text)) {
      return {
        tool: 'get_unpaid_summary',
        assistantText: 'I will build the unpaid collections summary using the local booking records.',
        localIntent: { title: 'Collections summary', confidence: 'high', matchedTerms: ['unpaid', 'summary'] }
      }
    }
    if (/\bbooking\b|\bguest\b|\blist\b|\bshow\b|\bwho\b/.test(text)) {
      return {
        tool: 'list_unpaid_bookings',
        assistantText: 'I will list bookings that still have balances due.',
        localIntent: { title: 'List unpaid bookings', confidence: 'high', matchedTerms: ['unpaid', 'booking'] }
      }
    }
  }

  if (!instructional && /\bbackup\b/.test(text)) {
    return {
      tool: 'get_backup_status',
      params: {},
      assistantText: 'I will check local backup status and recency.',
      localIntent: { title: 'Backup status', confidence: 'high', matchedTerms: ['backup'] }
    }
  }
  if (!instructional && /\bonline\b/.test(text) && /\b(request|booking|pending|website|ota)\b/.test(text)) {
    return {
      tool: 'get_pending_online_requests',
      params: {},
      assistantText: 'I will check online booking requests waiting for review.',
      localIntent: { title: 'Pending online requests', confidence: 'high', matchedTerms: ['online', 'request'] }
    }
  }
  if (/\b(sync impact|failed sync impact|what is affected by sync|sync queue impact)\b/.test(text)) {
    return {
      tool: 'get_sync_impact',
      params: {},
      assistantText: 'I will assess what the current sync issues are affecting.',
      localIntent: { title: 'Sync impact', confidence: 'high', matchedTerms: ['sync', 'impact'] }
    }
  }
  if (/\b(balance for room|who is in room|status of booking|booking status|invoice for room|find booking|lookup booking|this booking|booking id)\b/.test(text)) {
    const dialogue = buildDialogueClarifier('lookup_booking', message)
    if (dialogue) return dialogue
    return {
      tool: 'lookup_booking',
      params: buildToolParams('lookup_booking', message),
      assistantText: 'I will look up the booking and explain its current status and balance.',
      localIntent: { title: 'Booking lookup', confidence: 'high', matchedTerms: ['booking', 'balance'] }
    }
  }
  if (!instructional && /\b(room rate|tariff|nightly rate|cost per night|room price|how much is room)\b/.test(text)) {
    const dialogue = buildDialogueClarifier('get_room_rate', message)
    if (dialogue) return dialogue
    return {
      tool: 'get_room_rate',
      params: buildToolParams('get_room_rate', message),
      assistantText: 'I will check room rates from local room setup.',
      localIntent: { title: 'Room rate lookup', confidence: 'high', matchedTerms: ['room', 'rate'] }
    }
  }

  const timeContext = getTimeContext()
  const scored = LOCAL_TOOL_INTENTS.map((intent) => {
    const intentText = [intent.title, intent.response, ...(intent.keywords || [])].join(' ')
    const { score, matchedTerms } = scoreDocument(message, intentText, intent.title, intent.keywords || [])
    const semantic = semanticSimilarity(message, TOOL_INTENT_CORPUS.corpus[LOCAL_TOOL_INTENTS.indexOf(intent)] || [], TOOL_INTENT_CORPUS.idf)
    const boostedScore = intent.tool === timeContext.boost ? score + 2.5 : score
    const negationPenalty = negated && /check_in|check_out|record_payment|bulk_/.test(intent.tool) ? 6 : 0
    return { ...intent, score: boostedScore + (semantic * 16) - negationPenalty, matchedTerms }
  }).sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best || best.score < 14) return null

  const second = scored[1]

  // ── Intent disambiguation: if two intents are too close, don't guess ──
  if (second && best.score - second.score < 3 && best.score < 24) {
    return {
      tool: null,
      assistantText: null,
      disambiguation: [
        { tool: best.tool, title: best.title, response: best.response, prompt: best.responsePrompt || best.keywords?.[0] || best.title, score: best.score },
        { tool: second.tool, title: second.title, response: second.response, prompt: second.responsePrompt || second.keywords?.[0] || second.title, score: second.score }
      ],
      localIntent: { title: 'Ambiguous intent', confidence: 'low', matchedTerms: best.matchedTerms || [] }
    }
  }

  if (looksInstructional(message) && !looksLikeLiveDataQuestion(message) && best.score < 24) return null

  const dialogue = buildDialogueClarifier(best.tool, message)
  if (dialogue) return dialogue

  return {
    tool: best.tool,
    params: buildToolParams(best.tool, message),
    assistantText: best.response,
    localIntent: {
      title: best.title,
      confidence: confidenceFromScore(best.score),
      matchedTerms: best.matchedTerms || []
    }
  }
}

function buildToolParams(tool, message) {
  const room = extractRoomHint(message)
  const guest = extractGuestHint(message)
  const days = extractDayWindow(message)
  if (tool === 'get_room_availability') return { room_number: room, days: days || 1 }
  if (tool === 'get_room_rate') return extractRoomRateHint(message)
  if (tool === 'search_guest') return { guest_query: guest }
  if (tool === 'lookup_booking') return extractBookingHint(message)
  if (tool === 'get_occupancy_forecast') return { days: days || 7 }
  if (tool === 'get_revenue_comparison') return { days: days || 7 }
  return {}
}

function missingSlotsForTool(tool, params = {}) {
  if (tool === 'search_guest' && !params.guest_query) return ['guest_query']
  if (tool === 'lookup_booking' && !params.booking_query && !params.room_number && !params.guest_query) return ['booking_or_room']
  if (tool === 'get_room_rate' && !params.room_number && !params.rate_query) return ['room_or_type']
  return []
}

function slotPrompt(tool, slot) {
  if (slot === 'guest_query') return 'I can search guest records. What guest name, phone number, or email should I look for?'
  if (slot === 'booking_or_room') return 'I can look that up. What is the booking number, invoice number, guest name, or room number?'
  if (slot === 'room_or_type') return 'I can check the local room rate. Which room number or room type should I check?'
  if (tool === 'get_room_availability') return 'I can check availability. Which room number, or should I check all rooms?'
  return 'What detail should I use for that?'
}

function buildDialogueClarifier(tool, message) {
  if (!tool) return null
  const params = buildToolParams(tool, message)
  const missing = missingSlotsForTool(tool, params)
  if (!missing.length) return null
  return {
    assistantText: slotPrompt(tool, missing[0]),
    localHelp: {
      mode: 'clarify',
      confidence: 'medium',
      query: message,
      bestMatch: null,
      matches: [],
      suggestions: [],
      dialogue: { intent: tool, params, missing },
      slot: missing[0]
    }
  }
}

function mergeDialogueParams(intent, existing = {}, message) {
  return { ...(existing || {}), ...buildToolParams(intent, message) }
}

function enrichFromDialogue(dialogue, message) {
  if (!dialogue?.intent) return message
  if (dialogue.intent === 'search_guest') return `find guest ${message}`
  if (dialogue.intent === 'lookup_booking') return `lookup booking ${message}`
  if (dialogue.intent === 'get_room_availability') return `which rooms are available ${message}`
  if (dialogue.intent === 'get_room_rate') return `what is the rate for ${message}`
  return message
}

function summarizeToolResult(toolName, result) {
  if (!result || typeof result !== 'object') return null
  const breakdownRows = result.breakdown
    ? [
        ...(result.breakdown.overdue?.rows || []),
        ...(result.breakdown.due_today?.rows || []),
        ...(result.breakdown.future?.rows || [])
      ]
    : []
  const rows = result.bookings || result.guests || result.rooms || result.unpaid || result.overdue_checkouts || result.items || result.all_rows || breakdownRows || []
  return {
    toolName,
    count: Number(result.count || result.unpaid_count || result.overdue_count || rows.length || 0),
    total: Number(result.total_outstanding || result.unpaid_total || result.weekly_total || result.financial_at_risk || result.financial_amount_at_risk || 0),
    room_numbers: Array.isArray(rows) ? rows.map((row) => row?.room_number).filter(Boolean).slice(0, 5) : [],
    booking_ids: Array.isArray(rows) ? rows.map((row) => row?.id).filter(Boolean).slice(0, 5) : [],
    guest_names: Array.isArray(rows) ? rows.map((row) => row?.guest || row?.name).filter(Boolean).slice(0, 5) : [],
    first: Array.isArray(rows) ? rows[0] || null : null
  }
}

function confidenceFromScore(score) {
  if (score >= 34) return 'high'
  if (score >= 18) return 'medium'
  return 'low'
}

// ─── Live data helpers ────────────────────────────────────────────────────

/**
 * Builds a short live context snippet to inject into help text.
 * Only surfaces information that is directly relevant to the matched workflow.
 */
function buildLiveContextSnippet(workflowId, liveContext) {
  if (!liveContext) return null
  const { stats, upcoming, unpaidCount, overdueCount, attentionSummary } = liveContext

  const snippets = []

  if (workflowId === 'check-in') {
    const todayArrivals = upcoming?.today?.length ?? stats?.arrivals_today ?? null
    if (todayArrivals != null && todayArrivals > 0) {
      snippets.push(`📋 You have **${todayArrivals}** arrival${todayArrivals !== 1 ? 's' : ''} today.`)
    }
  }

  if (workflowId === 'check-out') {
    if (overdueCount != null && overdueCount > 0) {
      snippets.push(`⚠️ **${overdueCount}** booking${overdueCount !== 1 ? 's are' : ' is'} overdue checkout.`)
    }
    const todayDeps = upcoming?.todayDepartures ?? stats?.departures_today ?? null
    if (todayDeps != null && todayDeps > 0) {
      snippets.push(`📋 ${todayDeps} departure${todayDeps !== 1 ? 's' : ''} expected today.`)
    }
  }

  if (workflowId === 'record-payment' || workflowId === 'financial-audit') {
    if (unpaidCount != null && unpaidCount > 0) {
      snippets.push(`💰 **${unpaidCount}** booking${unpaidCount !== 1 ? 's' : ''} currently have outstanding balances.`)
    }
  }

  if (workflowId === 'dashboard-overview' || workflowId === 'reports') {
    const occ = stats?.occupancy_rate ?? stats?.occupancy ?? null
    if (occ != null) {
      snippets.push(`📊 Current occupancy: **${Math.round(Number(occ))}%**`)
    }
  }

  if (workflowId === 'system-health') {
    const pending = stats?.sync_pending ?? null
    const failed = stats?.sync_failed ?? null
    if (failed != null && failed > 0) {
      snippets.push(`🔴 **${failed}** sync item${failed !== 1 ? 's' : ''} currently failing — check System Health.`)
    } else if (pending != null && pending > 0) {
      snippets.push(`🟡 **${pending}** item${pending !== 1 ? 's' : ''} pending sync.`)
    }
  }

  // General attention summary appended last if short
  if (attentionSummary && snippets.length === 0 && attentionSummary.length <= 120) {
    snippets.push(attentionSummary)
  }

  return snippets.length ? snippets.join('\n') : null
}

/**
 * Builds proactive attention text to show in fallback responses.
 * Surfaces the most important live alerts even when the query didn't match.
 */
function buildProactiveFallbackNote(liveContext) {
  if (!liveContext) return null
  const { overdueCount, unpaidCount, stats } = liveContext
  const notes = []

  const failed = stats?.sync_failed ?? null
  if (failed != null && failed > 0) {
    notes.push(`🔴 ${failed} sync failure${failed !== 1 ? 's' : ''} — check System Health.`)
  }
  if (overdueCount != null && overdueCount > 0) {
    notes.push(`⚠️ ${overdueCount} overdue checkout${overdueCount !== 1 ? 's' : ''}.`)
  }
  if (unpaidCount != null && unpaidCount > 0) {
    notes.push(`💰 ${unpaidCount} unpaid booking${unpaidCount !== 1 ? 's' : ''}.`)
  }

  if (notes.length === 0) return null
  return `While I couldn't find an exact match, here's what's live:\n${notes.join('\n')}`
}

function buildUiContextSnippet(uiContext) {
  if (!uiContext) return null
  const lines = []
  if (uiContext.screenLabel) lines.push(`You came from **${uiContext.screenLabel}**.`)
  if (uiContext.activeTabLabel) lines.push(`Active section: **${uiContext.activeTabLabel}**.`)
  if (uiContext.activeBookingId) lines.push(`Current booking in focus: **${uiContext.activeBookingId}**.`)
  if (uiContext.activeGuestName) lines.push(`Current guest in focus: **${uiContext.activeGuestName}**.`)
  if (uiContext.roomNumber) lines.push(`Current room in focus: **${uiContext.roomNumber}**.`)
  return lines.length ? lines.join('\n') : null
}

// ─── Help text builders ───────────────────────────────────────────────────

function buildHelpText(match, matches, confidence, liveContext = null, uiContext = null) {
  if (!match) {
    const fallbackNote = buildProactiveFallbackNote(liveContext)
    const lines = [
      'I could not find an exact app workflow for that, but I can still help you search the app.',
      'Try asking for a feature name, a task, or a rough phrase like "add stock", "guest payment", or "failed sync".'
    ]
    if (fallbackNote) lines.push('', fallbackNote)
    return lines.join('\n')
  }

  const intro = confidence === 'high'
    ? `You want ${match.title}.`
    : `Closest match: ${match.title}.`
  const lines = [
    `${intro} Open ${match.screen} and follow the steps in the guide card.`,
    match.summary
  ]

  // Inject live context snippet relevant to this workflow
  const liveSnippet = buildLiveContextSnippet(match.id, liveContext)
  if (liveSnippet) {
    lines.push('', liveSnippet)
  }
  const uiSnippet = buildUiContextSnippet(uiContext)
  if (uiSnippet) {
    lines.push('', uiSnippet)
  }

  const alternatives = matches.filter((item) => item.id !== match.id).slice(0, 2)
  if (alternatives.length) {
    lines.push(`Also related: ${alternatives.map((item) => item.title).join(', ')}.`)
  }

  return lines.join('\n')
}

function buildDisambiguationText(options) {
  const lines = ['I found two possible matches — which one did you mean?']
  options.forEach((opt, i) => {
    lines.push(`${i + 1}. **${opt.title}** — ${opt.response}`)
  })
  return lines.join('\n')
}

// ─── Route helpers ────────────────────────────────────────────────────────

function routeWorkflow(route) {
  if (!route) return null
  const exact = APP_WORKFLOWS.find((entry) => entry.route === route)
  if (exact) return exact
  return APP_WORKFLOWS.find((entry) => route !== '/' && entry.route !== '/' && route.startsWith(entry.route)) || null
}

function buildOverviewHelp(route, liveContext = null, uiContext = null) {
  const current = routeWorkflow(uiContext?.sourceRoute || route)
  const primary = current || APP_WORKFLOWS[0]
  const related = APP_WORKFLOWS
    .filter((entry) => entry.category === primary.category && entry.id !== primary.id)
    .slice(0, 4)
    .map((entry) => publicWorkflow(entry, 8, []))

  const match = publicWorkflow(primary, 30, [])
  return {
    assistantText: buildHelpText(match, [match, ...related], 'high', liveContext, uiContext),
    localHelp: {
      mode: 'current_screen',
      confidence: 'high',
      query: 'current screen',
      bestMatch: match,
      matches: [match, ...related],
      suggestions: related.map((entry) => `How do I use ${entry.title}?`).slice(0, 3)
    }
  }
}

// ─── Screen-aware dynamic suggestions ────────────────────────────────────

function buildDynamicFallbackMatches(route) {
  const routeStr = route ? String(route) : null
  const hintIds = routeStr ? (ROUTE_WORKFLOW_HINTS[routeStr] || ROUTE_WORKFLOW_HINTS['/']) : ['create-booking', 'record-payment', 'system-health', 'inventory-stock', 'reports']
  return APP_WORKFLOWS
    .filter((entry) => hintIds.includes(entry.id))
    .sort((a, b) => hintIds.indexOf(a.id) - hintIds.indexOf(b.id))
    .map((entry) => publicWorkflow(entry, 0, []))
}

// ─── Multi-turn session context ───────────────────────────────────────────

/**
 * Creates a local assistant session that retains the last N turns.
 * This enables follow-up questions like:
 *   Turn 1: "how do I check in?"  → returns check-in workflow
 *   Turn 2: "and the payment?"    → understands this is about the same booking flow
 */
export function createLocalAssistantSession({ maxTurns = 3 } = {}) {
  const history = [] // { query, workflowId, toolName, toolResult }
  let pendingDialogue = null

  function getContextualQuery(message) {
    if (history.length === 0) return message

    if (pendingDialogue) return enrichFromDialogue(pendingDialogue, message)

    const normalized = normalizeText(message)
    const contentTokens = normalized.split(' ').filter(t => !STOP_WORDS.has(t))
    const isVeryShort = contentTokens.length <= 2
    const isShortEnough = contentTokens.length <= 4
    const isAnaphoric = /\b(that|those|it|them|same|this|these|also|too|another|now|what about)\b/.test(normalized)

    if (!isVeryShort && !(isShortEnough || isAnaphoric)) return message

    // Short follow-up — try to enrich with last workflow's screen/category context
    const last = history[history.length - 1]
    if (last.workflowId) {
      const lastWorkflow = APP_WORKFLOWS.find(w => w.id === last.workflowId)
      if (lastWorkflow) {
        if (/\b(print|download|send|email)\b/.test(normalized) && /invoice/i.test(lastWorkflow.title)) {
          return `print invoice ${message}`
        }
        if (/\b(payment|pay|paid|receipt|settle|balance)\b/.test(normalized)) {
          return `record booking payment ${message}`
        }
        if (/\b(check out|checkout|leave|departure)\b/.test(normalized)) {
          return `check out booking ${lastWorkflow.title} ${message}`
        }
        if (/\b(check in|checkin|arrival)\b/.test(normalized)) {
          return `check in booking ${lastWorkflow.title} ${message}`
        }
        // Prepend last screen category to widen the query scope
        return `${lastWorkflow.category} ${message}`
      }
    }
    if (last.toolName) {
      if (/\b(compare|versus|vs|yesterday|last week|trend)\b/.test(normalized)) {
        if (/revenue|daily_briefing|get_today_revenue/.test(String(last.toolName))) return 'compare revenue this week'
        if (/occupancy|room_availability/.test(String(last.toolName))) return 'show occupancy forecast this week'
        if (/unpaid|collections/.test(String(last.toolName))) return 'give me full unpaid collections summary'
      }
      if (/\b(overdue|late checkout|late check out)\b/.test(normalized) && /unpaid|collections/.test(String(last.toolName))) {
        return `show overdue checkouts ${message}`
      }
      if (/\b(unpaid|balances|owing|outstanding)\b/.test(normalized) && /overdue|attention/.test(String(last.toolName))) {
        return `show unpaid bookings ${message}`
      }
      if (/\b(guest|who|name|phone|email)\b/.test(normalized) && /search_guest|lookup_booking/.test(String(last.toolName))) {
        return `search guest ${message}`
      }
      if (last.toolResult?.room_numbers?.length && /\b(room|that room|first room)\b/.test(normalized)) {
        return `${message} room ${last.toolResult.room_numbers[0]}`
      }
      if (last.toolResult?.booking_ids?.length && /\b(first one|that booking|first booking)\b/.test(normalized)) {
        if (/\b(collect|payment|pay|settle)\b/.test(normalized)) return `where do I record payment for booking ${last.toolResult.booking_ids[0]}`
        return `lookup booking ${last.toolResult.booking_ids[0]}`
      }
      if (last.toolResult?.guest_names?.length && /\b(that guest|first guest|them)\b/.test(normalized)) {
        return `find guest ${last.toolResult.guest_names[0]}`
      }
    }
    return message
  }

  function recordTurn(message, workflowId = null, toolName = null, toolResult = null) {
    history.push({ query: message, workflowId, toolName, toolResult, at: Date.now() })
    if (history.length > maxTurns) history.shift()
  }

  function rememberToolResult(toolName, result) {
    const last = history[history.length - 1]
    if (!last) return
    last.toolName = toolName || last.toolName
    last.toolResult = summarizeToolResult(toolName, result)
  }

  function resolve({ message, route = null, liveContext = null, uiContext = null } = {}) {
    const enrichedMessage = getContextualQuery(message)
    let result = resolveLocalAssistantTurn({ message: enrichedMessage, route, liveContext, uiContext })
    if (pendingDialogue && result?.tool === pendingDialogue.intent) {
      const params = mergeDialogueParams(pendingDialogue.intent, pendingDialogue.params, enrichedMessage)
      const missing = missingSlotsForTool(pendingDialogue.intent, params)
      if (missing.length) {
        result = {
          assistantText: slotPrompt(pendingDialogue.intent, missing[0]),
          localHelp: {
            mode: 'clarify',
            confidence: 'medium',
            query: message,
            bestMatch: null,
            matches: [],
            suggestions: [],
            dialogue: { intent: pendingDialogue.intent, params, missing },
            slot: missing[0]
          }
        }
      } else {
        result = { ...result, params }
      }
    }
    // Track for next turn
    const workflowId = result?.localHelp?.bestMatch?.id || null
    const toolName = result?.tool || history[history.length - 1]?.toolName || null
    pendingDialogue = result?.localHelp?.mode === 'clarify' ? result?.localHelp?.dialogue || null : null
    recordTurn(message, workflowId, toolName)
    return result
  }

  return { resolve, history, rememberToolResult }
}

// ─── Main resolver ────────────────────────────────────────────────────────

export function resolveLocalAssistantTurn({ message, route = null, liveContext = null, uiContext = null } = {}) {
  const query = String(message || '').trim()
  if (!query) return null

  if (wantsCurrentScreenHelp(query)) {
    return buildOverviewHelp(route, liveContext, uiContext)
  }

  const toolIntent = resolveToolIntent(query)

  // Handle disambiguation
  if (toolIntent?.disambiguation) {
    return {
      assistantText: buildDisambiguationText(toolIntent.disambiguation),
        localHelp: {
          mode: 'disambiguation',
          confidence: 'low',
          query,
          bestMatch: null,
          matches: [],
          suggestions: toolIntent.disambiguation.map(opt => ({ label: opt.title, prompt: opt.prompt || opt.title, description: opt.response }))
        },
        localIntent: toolIntent.localIntent || null
      }
  }

  if (toolIntent?.localHelp && !toolIntent?.tool) return toolIntent
  if (toolIntent?.tool) return toolIntent

  const effectiveRoute = uiContext?.sourceRoute || route
  const matches = searchLocalAppHelp(query, { route: effectiveRoute, limit: 5 })
  const best = matches[0] || null
  const confidence = best ? confidenceFromScore(best.score) : 'low'

  if (best && best.score >= 9) {
    return {
      assistantText: buildHelpText(best, matches, confidence, liveContext, uiContext),
      localHelp: {
        mode: 'workflow',
        confidence,
        query,
        bestMatch: best,
        matches,
        suggestions: buildSuggestions(best, matches, effectiveRoute)
      }
    }
  }

  return {
    assistantText: buildHelpText(null, [], 'low', liveContext, uiContext),
    localHelp: {
      mode: 'fallback',
      confidence: 'low',
      query,
      bestMatch: null,
      matches: buildDynamicFallbackMatches(effectiveRoute),
      suggestions: buildDynamicSuggestions(effectiveRoute)
    }
  }
}

function buildSuggestions(best, matches, route = null) {
  const suggestions = []
  if (best?.id === 'check-in') return ['Where do I record a payment?', 'How do I check out a guest?', 'What needs my attention right now?']
  if (best?.id === 'record-payment') return ['Show unpaid bookings.', 'How do I send an invoice?', 'How do I check out a guest?']
  if (best?.id === 'system-health') return ['Show sync impact.', 'What needs my attention right now?', 'When was the last backup?']
  if (best?.id === 'inventory-stock') return ['What supplies are low?', 'How do I use Room supplies?', 'How do I read reports?']
  if (best?.route && best.route !== '/ai') suggestions.push(`What can I do on ${best.screen}?`)
  if (best?.id !== 'system-health') suggestions.push('How do I fix failed sync?')
  if (best?.id !== 'record-payment') suggestions.push('Where do I record a payment?')
  for (const match of matches.slice(1, 4)) {
    suggestions.push(`How do I use ${match.title}?`)
  }
  return unique(suggestions).slice(0, 4)
}

function buildDynamicSuggestions(route) {
  const timeContext = getTimeContext()
  const routeStr = route ? String(route) : null
  const hintIds = routeStr ? (ROUTE_WORKFLOW_HINTS[routeStr] || null) : null
  if (!hintIds) return LOCAL_ASSISTANT_SUGGESTIONS

  const routeSuggestions = hintIds
    .map(id => APP_WORKFLOWS.find(w => w.id === id))
    .filter(Boolean)
    .map(w => `How do I ${w.title.toLowerCase()}?`)
    .slice(0, 4)

  if (routeSuggestions.length) return unique([...routeSuggestions, timeContext.suggestion]).slice(0, 4)
  return unique([timeContext.suggestion, ...LOCAL_ASSISTANT_SUGGESTIONS]).slice(0, 4)
}

export function getLocalAssistantCatalog() {
  return APP_WORKFLOWS.map((entry) => publicWorkflow(entry, 0, []))
}
