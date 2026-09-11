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

STOCK_TASK_SHOTS = {"21-stock-delivery.png", "22-stock-count.png", "26-count-all.png"}
TASK_SHOT_SIZES = {
    "17-completed-receipt.png": (112, 100),
    "18-sale-detail-reprint.png": (112, 76),
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
    return _original_shot(*payload)


def _attach_to_task(title, payload):
    group = _task_groups.get(title)
    if group is None:
        _deferred_shots[title] = payload
        return False
    group._content.extend(_render_payload(payload))
    return True


def shot(name, caption, width=None, annotated=True, max_height=None):
    global _receipt_overlay_seen
    payload = _shot_payload(name, caption, width, annotated, max_height)

    if name == "17-completed-receipt.png":
        if not _receipt_overlay_seen:
            _receipt_overlay_seen = True
            _attach_to_task("Print the receipt immediately after a sale", payload)
            return []
        if _attach_to_task("Review a completed sale in Sales", payload):
            return []
        return _render_payload(payload)

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
    return output


def heading(text, level=1):
    global _deferred_stock_heading
    if str(text) == "Breakage, wastage and availability":
        _deferred_stock_heading = (text, level)
        return []
    return _original_heading(text, level)


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

    table = _original_data_table(headers, rows, widths, small)
    if headers and str(headers[0]) == "Event" and _deferred_stock_heading is not None:
        title, level = _deferred_stock_heading
        _deferred_stock_heading = None
        return engine.KeepTogether([_original_heading(title, level), table])
    return table


def build_manual(filename, quick=False):
    _reset_layout_state()
    return _original_build_manual(filename, quick)


engine.shot = shot
engine.procedure = procedure
engine.heading = heading
engine.data_table = data_table

if __name__ == "__main__":
    build_manual("Tsa-Bonno-Bar-Customer-Manual.pdf", quick=False)
    build_manual("Tsa-Bonno-Bar-Quick-Start.pdf", quick=True)



