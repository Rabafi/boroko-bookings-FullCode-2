import {
  LayoutDashboard,
  BedDouble,
  CalendarDays,
  BookOpen,
  BarChart3,
  Users,
  Settings,
  Grid3X3,
  Sparkles,
  UserRound,
  Wrench,
  Receipt,
  CreditCard,
  ShoppingCart,
  Package,
  Boxes,
  ClipboardList,
  Presentation,
  Briefcase,
  Database,
  FileText,
  Banknote
} from 'lucide-react'

export const ALL_NAV = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    end: true,
    types: ['lodge', 'restaurant'],
    capability: 'dashboard.view',
    keywords: ['home', 'overview', 'kpi', 'occupancy']
  },
  {
    to: '/ai',
    label: 'Assistant',
    icon: Sparkles,
    end: true,
    types: ['lodge', 'restaurant'],
    capability: 'dashboard.view',
    keywords: ['ai', 'assistant', 'help', 'instructions', 'guide', 'find feature', 'locate function', 'how do i', 'local']
  },
  {
    to: '/bookings',
    label: 'Bookings',
    icon: BookOpen,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'bookings.view',
    keywords: ['reservations', 'check in', 'check out']
  },
  {
    to: '/quotations',
    label: 'Quotations',
    icon: FileText,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'quotations.view',
    keywords: ['quotes', 'estimates']
  },
  {
    to: '/invoices',
    label: 'Invoices',
    icon: CreditCard,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'invoices.view',
    keywords: ['billing', 'payments', 'receipts']
  },
  {
    to: '/prepayments',
    label: 'Prepayments',
    icon: Banknote,
    types: ['lodge'],
    group: 'Finance',
    capability: 'invoices.view',
    keywords: ['customer credit', 'advance payment', 'deposit without dates', 'held money']
  },
  {
    to: '/roomgrid',
    label: 'Room Board',
    icon: Grid3X3,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'rooms.view',
    keywords: ['availability', 'rooms', 'grid', 'live board', 'front desk']
  },
  {
    to: '/calendar',
    label: 'Planning',
    icon: CalendarDays,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'bookings.view',
    keywords: ['schedule', 'reservations', 'planning', 'occupancy forecast', 'monthly']
  },
  {
    to: '/guests',
    label: 'Guests',
    icon: UserRound,
    types: ['lodge'],
    group: 'Front Desk',
    capability: 'guests.view',
    keywords: ['customers', 'profiles']
  },
  {
    to: '/conference',
    label: 'Events & Venues',
    icon: Presentation,
    types: ['lodge'],
    group: 'Front Desk',
    feature: 'conference',
    tier: 'Standard',
    capability: 'conference.view',
    keywords: ['events', 'venues', 'meetings', 'banquet', 'weddings', 'parties', 'conference']
  },
  {
    to: '/dayuse',
    label: 'Day Use',
    icon: Briefcase,
    types: ['lodge'],
    group: 'Front Desk',
    feature: 'pool',
    tier: 'Standard',
    capability: 'pool.view',
    keywords: ['pool', 'day pass']
  },
  {
    to: '/rooms',
    label: 'Rooms',
    icon: BedDouble,
    types: ['lodge'],
    group: 'Property',
    capability: 'rooms.view',
    keywords: ['inventory', 'house rooms']
  },
  {
    to: '/housekeeping',
    label: 'Housekeeping',
    icon: Sparkles,
    types: ['lodge'],
    group: 'Property',
    capability: 'housekeeping.manage',
    keywords: ['cleaning', 'turnover']
  },
  {
    to: '/maintenance',
    label: 'Maintenance',
    icon: Wrench,
    types: ['lodge'],
    group: 'Property',
    capability: 'maintenance.view',
    keywords: ['repairs', 'issues']
  },
  {
    to: '/expenses',
    label: 'Expenses',
    icon: Receipt,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'expenses',
    tier: 'Standard',
    capability: 'expenses.view',
    keywords: ['costs', 'purchases']
  },
  {
    to: '/audit',
    label: 'Night Audit',
    icon: ClipboardList,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'audit',
    tier: 'Standard',
    capability: 'audit.view',
    keywords: ['closing', 'reconciliation']
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: BarChart3,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'reports',
    tier: 'Standard',
    capability: 'reports.view',
    keywords: ['analytics', 'performance', 'insights']
  },
  {
    to: '/pos',
    label: 'POS',
    icon: ShoppingCart,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'pos',
    tier: 'Pro',
    capability: 'pos.view',
    keywords: ['point of sale', 'sales', 'cashier']
  },
  {
    to: '/inventory',
    label: 'Inventory',
    icon: Package,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'inventory',
    tier: 'Pro',
    capability: 'inventory.view',
    keywords: ['stock', 'items']
  },
  {
    to: '/supplies',
    label: 'Room Supplies',
    icon: Boxes,
    types: ['lodge'],
    group: 'Finance',
    feature: 'supplies',
    tier: 'Pro',
    capability: 'supplies.view',
    keywords: ['amenities', 'linen', 'supplies']
  },
  {
    to: '/staff',
    label: 'Staff',
    icon: Users,
    types: ['lodge', 'restaurant'],
    group: 'Team',
    feature: 'staff',
    tier: 'Standard',
    capability: 'staff.view',
    keywords: ['employees', 'team']
  },
  {
    to: '/data-management',
    label: 'Data Management',
    icon: Database,
    types: ['lodge', 'restaurant'],
    group: 'Finance',
    feature: 'import',
    tier: 'Standard',
    capability: 'data.import',
    keywords: ['import', 'export', 'backup']
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings,
    types: ['lodge', 'restaurant'],
    capability: 'settings.view',
    keywords: ['preferences', 'configuration', 'admin']
  }
]

export const NAV_GROUPS = ['Front Desk', 'Property', 'Finance', 'Team']

export function getDesktopNavItems(bizType, access) {
  return ALL_NAV
    .filter((item) => item.types.includes(bizType))
    .filter((item) => !item.capability || access?.allowedByRole?.[item.capability] === true)
}
