"""
Generate Boroko Bookings Interactive QA Checklist PDF
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black, Color
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
import pypdf
import io, os

# ── Brand colours ─────────────────────────────────────────────────────────────
GREEN_DARK  = HexColor('#14532d')
GREEN_MID   = HexColor('#166534')
GREEN_LIGHT = HexColor('#dcfce7')
GREEN_ROW   = HexColor('#f0fdf4')
GRAY_LIGHT  = HexColor('#f8fafc')
GRAY_MID    = HexColor('#e2e8f0')
GRAY_TEXT   = HexColor('#475569')

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm

# ── Styles ─────────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

cover_title = ParagraphStyle('CoverTitle',
    fontSize=30, leading=36, textColor=white,
    fontName='Helvetica-Bold', alignment=TA_CENTER)

cover_sub = ParagraphStyle('CoverSub',
    fontSize=14, leading=20, textColor=HexColor('#bbf7d0'),
    fontName='Helvetica', alignment=TA_CENTER)

cover_date = ParagraphStyle('CoverDate',
    fontSize=11, leading=16, textColor=HexColor('#86efac'),
    fontName='Helvetica', alignment=TA_CENTER)

section_heading = ParagraphStyle('SectionHeading',
    fontSize=13, leading=17, textColor=GREEN_DARK,
    fontName='Helvetica-Bold', spaceAfter=4)

sub_label = ParagraphStyle('SubLabel',
    fontSize=8, leading=10, textColor=GRAY_TEXT,
    fontName='Helvetica')

cell_normal = ParagraphStyle('CellNormal',
    fontSize=7.5, leading=10, textColor=black,
    fontName='Helvetica')

cell_bold = ParagraphStyle('CellBold',
    fontSize=7.5, leading=10, textColor=white,
    fontName='Helvetica-Bold')

# ── QA Data ───────────────────────────────────────────────────────────────────
SECTIONS = [
    ("Authentication & Login", [
        ("Valid login", "Enter correct email + password → click Login", "Redirected to Dashboard"),
        ("Invalid password", "Enter correct email + wrong password → click Login", "Error message displayed, no redirect"),
        ("Wrong role blocked", "Log in as a 'staff' role account", "Login rejected with 'Access denied' message"),
        ("Session persists on reload", "Log in, close tab, reopen app URL", "User remains logged in"),
        ("Logout clears session", "Click Logout button", "Redirected to login, session cleared"),
    ]),
    ("Lodge Setup Wizard", [
        ("First-time setup", "Fill lodge name, type, number of rooms → save", "Settings saved, setup_complete flag set"),
        ("Redirect after setup", "Complete setup wizard", "Redirected to Dashboard automatically"),
        ("Setup not repeated", "Restart app after setup complete", "Wizard does not appear again"),
    ]),
    ("Dashboard", [
        ("Occupancy % correct", "Create occupied bookings, view Dashboard", "% matches occupied rooms / total rooms"),
        ("Check-in/out counts", "Check in and check out bookings, view Dashboard", "Counts match actual check-in/out actions today"),
        ("Revenue today accurate", "Add bookings with payment, view Dashboard", "Revenue total matches sum of today's payments"),
        ("Recent activity shows", "Perform any lodge action, view Dashboard", "Action appears in recent activity feed"),
    ]),
    ("Room Management", [
        ("Add room", "Go to Rooms → Add Room → fill details → save", "Room appears in room grid"),
        ("Edit room type/rate", "Click a room → edit type and nightly rate → save", "Changes persist and show correctly"),
        ("Change status", "Click a room → change status to Maintenance", "Room shows correct status colour in grid"),
        ("Room grid updates live", "Make changes, return to room grid", "Grid reflects latest status without full reload"),
    ]),
    ("Bookings", [
        ("Create booking", "Go to Bookings → New → fill guest, room, dates → save", "Booking appears in list with correct details"),
        ("Assign room", "Create booking → select a specific room", "Room marked as occupied for that date range"),
        ("Check-in action", "Find an arrival booking → click Check In", "Booking status changes to 'checked_in'"),
        ("Check-out action", "Find a checked-in booking → click Check Out", "Booking status changes to 'checked_out', room freed"),
        ("Cancel booking", "Find a booking → click Cancel", "Booking status changes to 'cancelled', room freed"),
        ("Overbooking prevention", "Try to book same room for overlapping dates", "Error shown, booking not created"),
    ]),
    ("Guest Management", [
        ("Add guest", "Go to Guests → Add Guest → fill details → save", "Guest appears in guest list"),
        ("Edit guest", "Click a guest → edit name/contact → save", "Changes persist correctly"),
        ("Search by name/email", "Use search bar to find a guest", "Matching guests appear in results"),
        ("Guest history", "Click a guest → view history tab", "Past bookings for that guest are listed"),
    ]),
    ("Housekeeping", [
        ("Mark room clean", "Go to Housekeeping → select room → mark Clean", "Room status updates to clean"),
        ("Mark room dirty", "Go to Housekeeping → select room → mark Dirty", "Room status updates to dirty"),
        ("Add housekeeping note", "Mark a room → add a note before saving", "Note saved and visible in history"),
        ("Filter by status", "Use status filter on Housekeeping screen", "Only rooms matching filter are shown"),
        ("History log", "View housekeeping history for a room", "Previous status changes with timestamps shown"),
    ]),
    ("Maintenance", [
        ("Raise ticket", "Go to Maintenance → New Ticket → fill issue/room → save", "Ticket appears in maintenance list"),
        ("Assign priority", "Create ticket with Urgent priority", "Ticket shows correct priority badge"),
        ("Resolve ticket", "Click a ticket → mark as Resolved", "Ticket status changes, removed from open list"),
        ("Ticket in alerts", "Create a maintenance ticket", "Alert badge count increases on dashboard"),
    ]),
    ("Expenses", [
        ("Add expense", "Go to Expenses → Add → fill amount/category → save", "Expense appears in list"),
        ("Categorise expense", "Add expense with specific category", "Category shows correctly in list and reports"),
        ("Edit expense", "Click an expense → change amount → save", "Updated amount reflected"),
        ("Delete expense", "Click an expense → delete", "Expense removed from list and totals"),
        ("Total in reports", "Add several expenses, view Reports", "Expense total matches sum of added expenses"),
    ]),
    ("POS / Bar", [
        ("Add sale item", "Go to POS → add an item to the sale", "Item appears in current sale list"),
        ("Apply discount", "Add item → apply a % or fixed discount", "Total updates correctly with discount applied"),
        ("Complete sale", "Add items → click Complete/Pay", "Sale saved and totals updated"),
        ("Receipt generated", "Complete a sale", "Receipt appears and can be printed/saved"),
        ("Sales in reports", "Complete sales, view Reports", "POS sales total matches completed transactions"),
    ]),
    ("Inventory", [
        ("Add item", "Go to Inventory → Add Item → fill details → save", "Item appears in inventory list with stock level"),
        ("Adjust stock", "Click an item → adjust quantity", "Stock level updates correctly"),
        ("Low stock alert", "Set item stock below reorder level", "Alert appears on dashboard/alerts screen"),
        ("Reorder level respected", "Check items at or below reorder level", "These items flagged in low stock view"),
    ]),
    ("Room Supplies", [
        ("Log supply usage", "Go to Room Supplies → select room → log items used", "Usage saved to history"),
        ("View usage history", "Open a room's supply history", "All logged supply events shown with dates"),
        ("Deduct from inventory", "Log supplies used for a room", "Corresponding inventory quantities decrease"),
    ]),
    ("Conference / Events", [
        ("Book conference room", "Go to Conference → New Booking → fill details → save", "Booking appears in conference list"),
        ("Set capacity", "Add a conference booking with max attendees", "Capacity shown in booking details"),
        ("Add catering notes", "Add notes to a conference booking", "Notes saved and visible on the booking"),
        ("View calendar", "Open conference calendar view", "Bookings appear on correct dates"),
    ]),
    ("Day Use / Pool", [
        ("Add day use booking", "Go to Day Use → New → fill guest/package → save", "Booking appears in day use list"),
        ("Charge fee", "Add day use with a fee", "Fee shows in booking and daily revenue"),
        ("Expiry by end of day", "Create a day use booking, check after midnight", "Booking shown as expired/completed next day"),
    ]),
    ("Night Audit", [
        ("Run audit", "Go to Night Audit → Run Audit", "Audit processes without errors"),
        ("Verify balances", "Run audit, check totals", "All financial totals reconcile correctly"),
        ("Flag unpaid bookings", "Run audit with unpaid bookings present", "Unpaid bookings highlighted in audit report"),
        ("Generate audit report", "Complete night audit", "Audit report can be exported/printed"),
    ]),
    ("Reports", [
        ("Revenue by date range", "Go to Reports → Revenue → set start/end dates", "Revenue shown for that period only"),
        ("Occupancy report", "Go to Reports → Occupancy", "% matches actual room occupancy data"),
        ("Expense summary", "Go to Reports → Expenses", "Totals match expenses entered"),
        ("Export to Excel", "Click Export on any report", "Excel file downloads with correct data"),
    ]),
    ("Staff Management", [
        ("Add staff", "Go to Staff → Add → fill name/role → save", "Staff appears in user list"),
        ("Assign role", "Create staff with 'staff' role", "User can log in but has restricted access"),
        ("Deactivate account", "Click a user → deactivate", "User cannot log in after deactivation"),
        ("Admin area blocked", "Log in as staff role → try to access admin area", "Access denied or nav item not shown"),
    ]),
    ("Data Import", [
        ("Import bookings", "Go to Import → upload a valid Excel file → import", "Bookings created from file data"),
        ("Validate rows", "Import file with missing required fields", "Invalid rows skipped with error summary"),
        ("Skip duplicates", "Import same file twice", "Second import skips already-imported records"),
        ("Import summary", "Complete an import", "Summary shows imported count, skipped count, errors"),
    ]),
    ("Settings", [
        ("Update lodge info", "Go to Settings → change lodge name → save", "New name persists after reload"),
        ("Change currency", "Go to Settings → change currency symbol → save", "Currency symbol updates throughout app"),
        ("Persist across sessions", "Change a setting, restart app", "Setting remains changed after restart"),
    ]),
    ("Broadcasts", [
        ("Admin creates broadcast", "In Command Central → Broadcasts → create new", "Broadcast saved with active status"),
        ("Lodge app shows banner", "Open lodge app with active broadcast", "Green banner appears at top of screen"),
        ("Dismiss persists in session", "Dismiss the broadcast banner", "Banner does not reappear in same session"),
        ("Expired broadcast hidden", "Create broadcast with past expiry date", "Banner does not show in lodge app"),
    ]),
    ("Feature Flags", [
        ("Disable feature", "Command Central → Feature Flags → disable POS for a lodge", "POS nav item shows as locked in lodge app (within 60s)"),
        ("Locked item greyed out", "View locked nav item in lodge app", "Item appears greyed with lock icon and tier badge"),
        ("Re-enable unlocks", "Re-enable feature in Command Central", "Nav item becomes active in lodge app"),
        ("Tier preset apply", "Apply Starter preset to a lodge", "All non-Starter features locked"),
    ]),
    ("Support Tickets", [
        ("Lodge submits ticket", "In lodge app → Help → fill title/description → submit", "Ticket appears in Command Central Support tab"),
        ("Command Central receives", "View Support Tickets in Command Central", "New ticket visible with correct lodge name"),
        ("Admin resolves", "Click ticket → change status to Resolved → save", "Ticket status updates to resolved"),
        ("Email notification", "Submit a ticket with SMTP configured", "Notification email received at configured address"),
    ]),
    ("Upgrade Request", [
        ("Click locked feature", "Click a greyed-out locked nav item", "Upgrade modal opens"),
        ("Modal shows tiers", "View upgrade modal", "All 3 tiers (Starter, Standard, Pro) displayed with features"),
        ("Submit upgrade request", "Select a tier → click Request Upgrade", "Support ticket created with category 'Upgrade Request'"),
        ("Ticket in Command Central", "After submitting upgrade request", "Ticket visible in Command Central with upgrade badge"),
    ]),
    ("Manager PWA", [
        ("Login on mobile", "Open Vercel URL on mobile → enter credentials", "Logged in and Dashboard shown"),
        ("View dashboard", "Open Dashboard screen on PWA", "Occupancy, KPIs, and alerts load correctly"),
        ("View rooms", "Open Rooms screen on PWA", "Room grid shows colour-coded statuses"),
        ("View bookings", "Open Bookings screen on PWA", "Today's and upcoming bookings listed"),
        ("View alerts", "Open Alerts screen on PWA", "Overdue checkouts and maintenance shown"),
        ("Install as PWA", "Open in Edge/Chrome → install to home screen", "App installs and opens standalone"),
        ("Data matches desktop", "Compare PWA data with desktop app", "Same rooms, bookings, revenue shown"),
    ]),
    ("Email Notifications", [
        ("Configure SMTP", "Command Central → Email Alerts → fill SMTP details → save", "Config saved without errors"),
        ("Test email", "Click 'Send Test Email' after saving SMTP config", "Test email received at configured address"),
        ("Support ticket email", "Submit a support ticket from lodge app", "Notification email received for new ticket"),
        ("Upgrade request email", "Submit an upgrade request", "Upgrade-specific email received with tier details"),
    ]),
]

# ── Helper to build a section table ───────────────────────────────────────────
COL_WIDTHS = [
    36*mm,  # Test Case
    52*mm,  # Steps
    48*mm,  # Expected Result
    18*mm,  # Pass/Fail
    20*mm,  # Notes
]

def make_section_table(tests):
    header = [
        Paragraph('Test Case', cell_bold),
        Paragraph('Steps', cell_bold),
        Paragraph('Expected Result', cell_bold),
        Paragraph('Pass / Fail', cell_bold),
        Paragraph('Notes', cell_bold),
    ]
    rows = [header]
    for i, (name, steps, expected) in enumerate(tests):
        bg = GREEN_ROW if i % 2 == 0 else white
        rows.append([
            Paragraph(name, cell_normal),
            Paragraph(steps, cell_normal),
            Paragraph(expected, cell_normal),
            Paragraph('☐ Pass\n☐ Fail', cell_normal),
            Paragraph('', cell_normal),
        ])

    tbl = Table(rows, colWidths=COL_WIDTHS, repeatRows=1)
    tbl.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0,0), (-1,0), GREEN_DARK),
        ('TEXTCOLOR',  (0,0), (-1,0), white),
        ('FONTNAME',   (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',   (0,0), (-1,0), 7.5),
        ('TOPPADDING', (0,0), (-1,0), 5),
        ('BOTTOMPADDING', (0,0), (-1,0), 5),
        # Data rows
        ('FONTSIZE',   (0,1), (-1,-1), 7.5),
        ('VALIGN',     (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,1), (-1,-1), 4),
        ('BOTTOMPADDING', (0,1), (-1,-1), 4),
        ('LEFTPADDING',  (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
        # Alternating rows
        *[('BACKGROUND', (0,i+1), (-1,i+1), GREEN_ROW if i%2==0 else white)
          for i in range(len(tests))],
        # Grid
        ('GRID', (0,0), (-1,-1), 0.4, GRAY_MID),
        ('LINEBELOW', (0,0), (-1,0), 1, GREEN_DARK),
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [None]),
    ]))
    return tbl

# ── Build story ────────────────────────────────────────────────────────────────
def build_story():
    story = []

    # ── Cover page (drawn via canvas callback) ──
    story.append(Spacer(1, 60*mm))
    story.append(Paragraph('Boroko Bookings', cover_title))
    story.append(Spacer(1, 6*mm))
    story.append(Paragraph('QA Testing Checklist', cover_sub))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph('Manual Testing Guide', cover_sub))
    story.append(Spacer(1, 10*mm))
    story.append(HRFlowable(width='60%', thickness=1, color=HexColor('#4ade80'), spaceAfter=10))
    story.append(Paragraph('Version 1.0 &nbsp;·&nbsp; 2026-03-19', cover_date))
    story.append(Spacer(1, 8*mm))
    story.append(Paragraph(f'{len(SECTIONS)} Feature Areas &nbsp;·&nbsp; '
                            f'{sum(len(t) for _,t in SECTIONS)} Test Cases',
                            cover_date))
    story.append(PageBreak())

    # ── Sections ──
    for idx, (title, tests) in enumerate(SECTIONS, 1):
        story.append(Paragraph(f'{idx}. {title}', section_heading))
        story.append(HRFlowable(width='100%', thickness=0.5, color=GREEN_MID, spaceAfter=4))
        story.append(make_section_table(tests))
        story.append(Spacer(1, 5*mm))

        # Tester sign-off row
        sign_data = [
            [Paragraph('<b>Tester Name:</b>', sub_label),
             Paragraph('_' * 32, sub_label),
             Paragraph('<b>Date:</b>', sub_label),
             Paragraph('_' * 20, sub_label),
             Paragraph('<b>Overall:</b>', sub_label),
             Paragraph('☐ Pass &nbsp; ☐ Fail', sub_label)],
        ]
        sign_tbl = Table(sign_data, colWidths=[24*mm, 50*mm, 12*mm, 36*mm, 18*mm, 34*mm])
        sign_tbl.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ]))
        story.append(sign_tbl)
        story.append(Spacer(1, 3*mm))

        if idx < len(SECTIONS):
            story.append(PageBreak())

    return story

# ── Canvas callbacks for cover bg ─────────────────────────────────────────────
def on_page(canvas, doc):
    canvas.saveState()
    page_num = doc.page
    w, h = A4
    if page_num == 1:
        # Dark green full-page background
        canvas.setFillColor(GREEN_DARK)
        canvas.rect(0, 0, w, h, fill=1, stroke=0)
        # Lighter green accent strip
        canvas.setFillColor(GREEN_MID)
        canvas.rect(0, h*0.35, w, h*0.02, fill=1, stroke=0)
        # Tent / lodge icon
        canvas.setFillColor(HexColor('#4ade80'))
        cx, cy = w/2, h*0.62
        s = 30
        canvas.setLineWidth(2)
        canvas.setStrokeColor(HexColor('#4ade80'))
        # Triangle
        p = canvas.beginPath()
        p.moveTo(cx, cy + s)
        p.lineTo(cx + s*1.2, cy - s*0.4)
        p.lineTo(cx - s*1.2, cy - s*0.4)
        p.close()
        canvas.drawPath(p, fill=0, stroke=1)
        # Door
        canvas.rect(cx - s*0.2, cy - s*0.4, s*0.4, s*0.5, fill=0, stroke=1)
    else:
        # Header bar
        canvas.setFillColor(GREEN_DARK)
        canvas.rect(0, h - 12*mm, w, 12*mm, fill=1, stroke=0)
        canvas.setFillColor(white)
        canvas.setFont('Helvetica-Bold', 8)
        canvas.drawString(MARGIN, h - 8*mm, 'Boroko Bookings — QA Testing Checklist')
        canvas.setFont('Helvetica', 8)
        canvas.drawRightString(w - MARGIN, h - 8*mm, f'Page {page_num - 1}')
        # Footer
        canvas.setFillColor(GRAY_MID)
        canvas.rect(0, 0, w, 8*mm, fill=1, stroke=0)
        canvas.setFillColor(GRAY_TEXT)
        canvas.setFont('Helvetica', 7)
        canvas.drawString(MARGIN, 3*mm, 'Boroko Bookings  ·  Confidential  ·  Internal Use Only')
        canvas.drawRightString(w - MARGIN, 3*mm, '2026-03-19')
    canvas.restoreState()

# ── Build PDF ──────────────────────────────────────────────────────────────────
OUTPUT = r"C:\Users\Botswapelo Studios\Documents\Work\Boroko Bookings\Boroko-Bookings-QA-Checklist.pdf"

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=20*mm, bottomMargin=14*mm,
    title='Boroko Bookings QA Checklist',
    author='Boroko Bookings',
    subject='Manual Testing Guide',
)

doc.build(build_story(), onFirstPage=on_page, onLaterPages=on_page)
print(f"PDF saved to: {OUTPUT}")
