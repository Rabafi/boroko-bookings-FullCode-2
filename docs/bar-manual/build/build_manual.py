import re
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINE_PATH = ROOT / "build_manual_engine.pyc"
spec = spec_from_file_location("tsa_bonno_bar_layout_engine", ENGINE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("The bundled layout engine could not be loaded.")
engine = module_from_spec(spec)
spec.loader.exec_module(engine)

_original_shot = engine.shot
_original_procedure = engine.procedure
_original_heading = engine.heading
_original_data_table = engine.data_table
_original_build_manual = engine.build_manual
_original_para = engine.para
_original_numbered = engine.numbered

CANDIDATE_REVIEW_DATE = "06 October 2026"
MANUAL_CANDIDATE_REVISION = "bar-manual-2026.10.06-candidate.2"
QUICK_START_CANDIDATE_REVISION = "bar-quick-start-2026.10.06-candidate.2"

STOCK_TASK_SHOTS = {"21-stock-delivery.png", "22-stock-count.png", "26-count-all.png"}
TASK_SHOT_SIZES = {
    "17-completed-receipt.png": (112, 100),
    "18-sale-detail-reprint.png": (112, 88),
    "29-sales-historical-receipt.png": (112, 88),
    "20-product-edit.png": (112, 78),
    "21-stock-delivery.png": (130, 82),
    "22-stock-count.png": (130, 82),
    "26-count-all.png": (130, 82),
    "23-operator-cashup.png": (108, 66),
    "24-manager-cashup-review.png": (108, 66),
}
TASK_TITLES = {
    "Print the receipt immediately after a sale",
    "Find a previous sale",
    "Create products, categories, prices and packs",
    "Receive a simple delivery",
    "Count one item",
    "Run Count All",
    "Submit my cash-up",
    "Review staff cash-ups",
    "Review a completed sale in Sales",
}
DEFERRED_SHOT_TARGETS = {
    "18-sale-detail-reprint.png": "Find a previous sale",
    "23-operator-cashup.png": "Submit my cash-up",
    "24-manager-cashup-review.png": "Review staff cash-ups",
}
FINAL_CONTENTS_PAGES = {
    "A. Welcome": "4",
    "B. Setup": "5",
    "C. Shift": "13",
    "D. Tabs and corrections": "21",
    "E. Stock routines": "33",
    "F. Cash-up and reports": "38",
    "G. Optional packages": "44",
    "H. Recovery and support": "51",
}

_deferred_shots = {}
_task_groups = {}
_last_task_title = None
_receipt_overlay_seen = False
_deferred_stock_heading = None


def _reset_layout_state():
    global _deferred_shots, _task_groups, _last_task_title
    global _receipt_overlay_seen, _deferred_stock_heading
    _deferred_shots = {}
    _task_groups = {}
    _last_task_title = None
    _receipt_overlay_seen = False
    _deferred_stock_heading = None


def _shot_payload(name, caption, width=None, annotated=True, max_height=None):
    if name in TASK_SHOT_SIZES:
        width_mm, max_height_mm = TASK_SHOT_SIZES[name]
        return name, caption, width_mm * engine.mm, annotated, max_height_mm * engine.mm
    if width is None:
        width = 168 * engine.mm
    if max_height is None:
        max_height = 105 * engine.mm
    return name, caption, width, annotated, max_height


def _render_payload(payload):
    rendered = _original_shot(*payload)
    return list(rendered) if isinstance(rendered, (list, tuple)) else [rendered]


def _attach_to_task(title, payload):
    group = _task_groups.get(title)
    if group is None:
        _deferred_shots[title] = payload
        return False
    group._content.extend(_render_payload(payload))
    return True


def shot(name, caption, width=None, annotated=True, max_height=None):
    global _receipt_overlay_seen
    if name == "18-sale-detail-reprint.png":
        caption = "Cashier reprint: the saved My sales receipt opens in the shared POS Receipt overlay with its existing number, items, tender and total."
    payload = _shot_payload(name, caption, width, annotated, max_height)

    if name == "17-completed-receipt.png":
        if not _receipt_overlay_seen:
            _receipt_overlay_seen = True
            _attach_to_task("Print the receipt immediately after a sale", payload)
            return []
        return []

    target = DEFERRED_SHOT_TARGETS.get(name)
    if target:
        _attach_to_task(target, payload)
        return []

    if name in {"20-product-edit.png", "21-stock-delivery.png", "22-stock-count.png", "26-count-all.png"}:
        if _attach_to_task(_last_task_title, payload):
            return []

    return _render_payload(payload)


def procedure(title, purpose, before, where, steps, check, wrong, approval=None):
    global _last_task_title
    if title == "Find a previous sale":
        where = "Sell &gt; My sales (cashier's own PIN-verified history)."
        steps = [
            "Open My sales, set the correct From and To dates, then search by receipt number, table or payment.",
            "Choose Print receipt on the matching row, or open the record and choose Print receipt in Receipt detail.",
            "Confirm the saved POS Receipt number, items, tender and total.",
            "Choose Print receipt in the overlay. If paper does not print, check the selected printer and paper, then retry this same saved receipt; never collect payment again."
        ]
        check = "The saved receipt number, items, tender and total match. Reprinting creates no sale or payment."
        wrong = "If the row is missing, check the business date, outlet and search term, then refresh. If printing still fails, ask the manager or support and retry this same receipt; never collect payment again."
        approval = "Physical output depends on the configured Windows printer, paper and printer acceptance."
    elif title == "Review a completed sale in Sales":
        where = "Manage &gt; Sales (authorized manager or finance access)."
        steps = [
            "Choose the correct From and To dates.",
            "Search the receipt number, tab, operator or tender.",
            "Choose Print receipt on the matching row, or open Open receipt … and choose Print receipt in the Receipt &amp; audit trail detail.",
            "Check the saved POS Receipt number, items, tender and total.",
            "Choose Print receipt in the overlay and compare its reference with the record.",
            "If paper does not print, check the selected printer and paper, then retry this same saved receipt; do not collect payment again."
        ]
        check = "The same receipt number, items, tender, total and status remain visible in the confirmed Sales record."
        wrong = "If rows look similar, compare the date, operator and outlet. If printing fails, use the same record again after checking the printer and paper; do not collect payment again."
        approval = "The print control opens the saved receipt and does not create a sale, payment, void or stock movement. Physical printer acceptance is checked at the printer."
    before = before.replace("online confirmed online submissions", "online submissions confirmed by the app")
    wrong = wrong.replace("ask the manager to confirm the confirmed status", "ask the manager to confirm the status")
    result = list(_original_procedure(title, purpose, before, where, steps, check, wrong, approval))
    _last_task_title = title
    if title in TASK_TITLES:
        group = engine.KeepTogether(result)
        _task_groups[title] = group
        output = [group]
    else:
        output = result

    payload = _deferred_shots.pop(title, None)
    if payload is not None:
        if title in _task_groups:
            _task_groups[title]._content.extend(_render_payload(payload))
        else:
            output.extend(_render_payload(payload))
    if title == "Review a completed sale in Sales":
        receipt_capture = _shot_payload(
            "29-sales-historical-receipt.png",
            "Manager path: the saved Sales receipt opens in POS Receipt with Print receipt. This is the recorded receipt, not a new sale.",
            annotated=True,
            max_height=88 * engine.mm
        )
        _task_groups[title]._content.extend(_render_payload(receipt_capture))
    return output


def heading(text, level=1):
    global _deferred_stock_heading
    if str(text) == "Breakage, wastage and availability":
        _deferred_stock_heading = (text, level)
        return []
    result = _original_heading(text, level)
    if str(text) == "Opening, closing and emergency cards":
        return engine.KeepTogether([
            result,
            engine.para("If two tills disagree, keep the original pending work visible and read the Network note in Manage &gt; System Health &gt; Sync &amp; queue. See the full steps on page 56.")
        ])
    if str(text) == "Customer display":
        return [engine.PageBreak(), result]
    if _BUILDING_LUNA_QUICK_START and str(text) == "When something goes wrong":
        return engine.KeepTogether([
            result,
            engine.para("For a signed-till identity conflict, use <b>Two tills disagree?</b> on page 5.")
        ])
    return result


def data_table(headers, rows, widths=None, small=False):
    global _deferred_stock_heading
    if headers and str(headers[0]) == "Part":
        corrected = []
        for row in rows:
            values = list(row)
            label = str(values[0]) if values else ""
            for part, page in FINAL_CONTENTS_PAGES.items():
                if part in label and len(values) > 1:
                    values[1] = page
                    break
            corrected.append(tuple(values) if isinstance(row, tuple) else values)
        rows = corrected

    if headers and str(headers[0]) == "Part":
        rows = list(rows)
        if not any("identity-conflict recovery" in str(row[0]).lower() for row in rows if row):
            rows.append(("Identity-conflict recovery", "56", "Original pending operation, quarantined peer copy and Network note."))

    table = _original_data_table(headers, rows, widths, small)

    if headers and str(headers[0]) == "Event" and _deferred_stock_heading is not None:
        title, level = _deferred_stock_heading
        _deferred_stock_heading = None
        return engine.KeepTogether([_original_heading(title, level), table])
    return table


_BUILDING_LUNA_QUICK_START = False
_PAGE_COUNT = r"(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)"


def para_text(text, *args, **kwargs):
    if isinstance(text, str):
        if re.fullmatch(r"Review date: \d{2} [A-Za-z]+ \d{4}", text):
            revision = QUICK_START_CANDIDATE_REVISION if _BUILDING_LUNA_QUICK_START else MANUAL_CANDIDATE_REVISION
            text = f"Review date: {CANDIDATE_REVIEW_DATE}<br/>Candidate revision: {revision}"
        elif re.match(rf"Use this {_PAGE_COUNT}-page card at the Till\.", text):
            text = re.sub(rf"^Use this {_PAGE_COUNT}-page card", "Use this five-page card", text, count=1)
            text += f"<br/><b>Review date:</b> {CANDIDATE_REVIEW_DATE} | <b>Candidate revision:</b> {QUICK_START_CANDIDATE_REVISION}"
        elif re.search(rf"quick-start PDF is the {_PAGE_COUNT}-page card for opening, selling, closing and urgent recovery\.", text):
            text = re.sub(
                rf"quick-start PDF is the {_PAGE_COUNT}-page card for opening, selling, closing and urgent recovery\.",
                "five-page quick-start PDF covers opening, selling, closing, urgent recovery and the separate multi-till identity-conflict route.",
                text,
                count=1,
            )
        elif text == "Preserve the original attempt. Check its named status before initiating another transaction.":
            recovery_page = "5" if _BUILDING_LUNA_QUICK_START else "56"
            text = f"Preserve the original attempt. Check its named status before initiating another transaction. If two tills disagree, follow the manager's separate identity-conflict steps on page {recovery_page}."
        elif text == "If the completed-sale POS Receipt overlay is available, choose Print receipt.":
            text = "For a saved receipt, open My sales (cashier's own history) or Manage > Sales (authorized manager/finance access), then choose Print receipt on the record. Printing opens the shared receipt overlay and does not take payment. If paper does not print, check the printer and paper, then print that same saved receipt again."
    return _original_para(text, *args, **kwargs)


def numbered(items, *args, **kwargs):
    if isinstance(items, (tuple, list)):
        items = [
            "For a saved sale, open My sales (cashier's own history) or Manage > Sales (authorized manager or finance access) and choose Print receipt. If printing fails, check the selected printer and paper, then print this same saved receipt again. Never collect payment again."
            if item == "If the completed-sale POS Receipt overlay is available, choose Print receipt." else item
            for item in items
        ]
    return _original_numbered(items, *args, **kwargs)


def _luna_recovery_addendum(quick):
    if quick:
        return [
            engine.heading("Two tills disagree?", 1),
            engine.para("A signed peer sent different contents for an operation ID or financial key already saved on this till. The incoming peer operation is quarantined. The original local operation remains pending under <b>Waiting for confirmation</b>; this identity conflict does not automatically pause its normal sync or replay. This path does not create a <b>Failed operations</b> row."),
            engine.callout("Keep the original attempt", "Do not ring the sale again, repeat the stock movement, change the operation key or clear pending work. Do not treat the quarantined peer copy as a failed item.", tone="amber"),
            engine.para("<b>Manager:</b> Open Manage &gt; System Health &gt; Sync &amp; queue. Confirm the original is still under <b>Waiting for confirmation</b>, then read the persistent <b>Network note</b> under <b>Other tills on this network</b>. The identity-conflict path has no quarantine Retry or Clear controls."),
            engine.para("<b>Ordinary replay failure is different:</b> a replay error appears under <b>Failed operations</b> with manager Retry and Clear controls. Check the original result first. Retry keeps the original operation identifiers and payload; Clear stops retries and records the item for manager review. These controls do not resolve a quarantined peer copy."),
            engine.para("If help is needed, open <b>App issues</b> and choose <b>Send problem to support</b> to send the device status summary. Give support the outlet, time and safe operation reference when requested. Never send a PIN, password, card number or private customer information."),
        ]
    return [
        engine.heading("When two tills disagree", 1),
        engine.para("When a signed nearby till sends different contents for a queue ID or financial key already saved on this till, the incoming peer operation is quarantined. The original local operation remains pending under <b>Waiting for confirmation</b>. This identity-conflict path does not automatically pause its normal sync or replay, and it does not create a <b>Failed operations</b> row."),
        engine.callout("Preserve the original operation", "Do not repeat the sale or stock action, create a replacement operation, change the original operation key, or clear pending work. The quarantined peer copy has no Retry or Clear control.", tone="amber"),
        *engine.shot("27-mesh-identity-warning.png", "1. The original local sale stays under Waiting for confirmation; this identity conflict creates no Failed operations row.", width=168 * engine.mm, annotated=True, max_height=55 * engine.mm),
        *engine.shot("28-mesh-network-warning.png", "2. The persistent Network note appears under Other tills on this network and reports the quarantined incoming operation.", width=168 * engine.mm, annotated=True, max_height=19 * engine.mm),
        engine.para("<b>Manager:</b> Open Manage &gt; System Health &gt; Sync &amp; queue. Confirm the original operation under <b>Waiting for confirmation</b>, then read the persistent <b>Network note</b> under <b>Other tills on this network</b>. The quarantine is not a failed queue row and has no Retry or Clear control."),
        engine.heading("Ordinary replay failure is different", 2),
        engine.para("A normal replay error appears under <b>Failed operations</b> and offers manager Retry and Clear controls. Check the original result before retrying. Retry reuses the original operation ID and payload; Clear stops its retries and records the item for manager review. Those controls do not change the quarantined incoming peer copy."),
        engine.para("If help is needed, open <b>App issues</b> and choose <b>Send problem to support</b> to send the device status summary. Give support the outlet, time and safe operation reference when requested. Never send a PIN, password, card number or private customer information."),
    ]


_original_doc_template = engine.ManualDocTemplate


class _LunaRecoveryDocTemplate(_original_doc_template):
    def build(self, flowables, *args, **kwargs):
        story = list(flowables)
        story.append(engine.PageBreak())
        story.extend(_luna_recovery_addendum(_BUILDING_LUNA_QUICK_START))
        return super().build(story, *args, **kwargs)


def _set_candidate_pdf_metadata(path, quick):
    from pypdf import PdfReader, PdfWriter

    document_id = "bar-quick-start" if quick else "bar-manual"
    revision = QUICK_START_CANDIDATE_REVISION if quick else MANUAL_CANDIDATE_REVISION
    label = "Tsa Bonno Bar Quick Start" if quick else "Tsa Bonno Bar Customer Manual"
    reader = PdfReader(path)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    metadata = {str(key): str(value) for key, value in (reader.metadata or {}).items() if value is not None}
    metadata.update({
        "/Title": f"{label} (Candidate v2)",
        "/Subject": f"{document_id}; revision {revision}; reviewed {CANDIDATE_REVIEW_DATE}; candidate only",
        "/Keywords": f"Bar, Tsa Bonno, {revision}, candidate only"
    })
    writer.add_metadata(metadata)
    temporary = path.with_name(path.stem + ".metadata.tmp.pdf")
    with temporary.open("wb") as stream:
        writer.write(stream)
    temporary.replace(path)


def build_manual(filename, quick=False):
    global _BUILDING_LUNA_QUICK_START
    _reset_layout_state()
    previous_template = engine.ManualDocTemplate
    _BUILDING_LUNA_QUICK_START = bool(quick)
    engine.ManualDocTemplate = _LunaRecoveryDocTemplate
    try:
        result = _original_build_manual(filename, quick)
        output_path = Path(engine.OUT) / filename
        _set_candidate_pdf_metadata(output_path, quick)
        return result
    finally:
        engine.ManualDocTemplate = previous_template
        _BUILDING_LUNA_QUICK_START = False


engine.shot = shot
engine.procedure = procedure
engine.heading = heading
engine.data_table = data_table
engine.para = para_text
engine.numbered = numbered

if __name__ == "__main__":
    build_manual("Tsa-Bonno-Bar-Customer-Manual.pdf", quick=False)
    build_manual("Tsa-Bonno-Bar-Quick-Start.pdf", quick=True)
