"""Candidate v3 layout corrections for the compiled Bar guide engine.

The compiled shared engine owns the quick-start page content. This module wraps
its actual callout/numbered flowable inputs, keyed to the traced v2 inputs, and
fails closed if either call stops reaching the correction.
"""
import importlib.util
from pathlib import Path

BUILD_DIR = Path(__file__).resolve().parent
BASE_PATH = BUILD_DIR / "build_manual.py"
spec = importlib.util.spec_from_file_location("tsa_bonno_bar_candidate_v3_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("The shared Bar layout wrapper could not be loaded.")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
engine = base.engine

MANUAL_REVISION = "bar-manual-2026.10.06-candidate.3"
QUICK_REVISION = "bar-quick-start-2026.10.06-candidate.3"
QUICK_RESULT = (
    "Open My sales (cashier's own history) or Manage > Sales (if authorized). "
    "Find the saved record and choose Print receipt. In the overlay, verify the "
    "saved receipt number and total, then choose Print receipt. If printing fails, "
    "check printer and paper and print the same saved receipt again. Never collect "
    "payment again. Ask a manager or support only if the record is missing, Print receipt is "
    "unavailable, or printing keeps failing."
)
QUICK_TIMEOUT_PRINT_STEP = (
    "Open My sales (cashier's own history) or Manage > Sales (if authorized). Find "
    "the saved record and choose Print receipt. In the overlay, verify its saved "
    "receipt number and total, then choose Print receipt. If printing fails, check "
    "printer and paper and print that same saved receipt again. Never collect payment "
    "again. Ask a manager or support only if the record is missing, Print receipt is unavailable, or "
    "printing keeps failing."
)
OLD_RESULT_INPUT = (
    "Keep the completed receipt reference. When the receipt overlay is open, choose "
    "<b>Print receipt</b>. Otherwise use <b>Sales</b> or <b>My sales</b> to confirm "
    "the recorded sale and ask the manager or support for an approved reprint route."
)
OLD_TIMEOUT_PRINT_STEP = (
    "If the completed-sale <b>POS Receipt</b> overlay is available, choose "
    "<b>Print receipt</b>."
)
MANUAL_IMMEDIATE_PRINT_RECOVERY = (
    "If paper does not print, never collect payment again. For a saved sale use My "
    "sales (cashier) or Manage > Sales (authorized manager/finance). Follow Find a "
    "previous sale on page 19; for the Sales route use page 42. Ask a manager or "
    "support only if the record is missing, Print receipt is unavailable, or printing keeps failing."
)

_seen = {"quickResult": 0, "quickStep": 0, "manualPage18": 0}
_original_callout = engine.callout
_original_numbered = engine.numbered
_original_procedure = engine.procedure


def callout(title, text, tone="sage"):
    if base._BUILDING_LUNA_QUICK_START and title == "Result" and text == OLD_RESULT_INPUT:
        _seen["quickResult"] += 1
        text = QUICK_RESULT
    return _original_callout(title, text, tone)


def numbered(items, *args, **kwargs):
    if base._BUILDING_LUNA_QUICK_START and isinstance(items, (tuple, list)):
        rewritten = list(items)
        for index, item in enumerate(rewritten):
            if item == OLD_TIMEOUT_PRINT_STEP:
                _seen["quickStep"] += 1
                rewritten[index] = QUICK_TIMEOUT_PRINT_STEP
        items = rewritten
    return _original_numbered(items, *args, **kwargs)


def procedure(title, purpose, before, where, steps, check, wrong, approval=None):
    if title == "Print the receipt immediately after a sale":
        _seen["manualPage18"] += 1
        wrong = MANUAL_IMMEDIATE_PRINT_RECOVERY
    return _original_procedure(title, purpose, before, where, steps, check, wrong, approval)


_original_write_metadata = base._set_candidate_pdf_metadata


def write_candidate_metadata(path, quick):
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(path)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    metadata = {str(key): str(value) for key, value in (reader.metadata or {}).items() if value is not None}
    doc_id = "bar-quick-start" if quick else "bar-manual"
    revision = QUICK_REVISION if quick else MANUAL_REVISION
    label = "Tsa Bonno Bar Quick Start" if quick else "Tsa Bonno Bar Customer Manual"
    metadata.update({
        "/Title": f"{label} (Candidate v3)",
        "/Subject": f"{doc_id}; revision {revision}; reviewed {base.CANDIDATE_REVIEW_DATE}; candidate only",
        "/Keywords": f"Bar, Tsa Bonno, {revision}, candidate only",
    })
    writer.add_metadata(metadata)
    temporary = Path(path).with_name(Path(path).stem + ".candidate-v3-metadata.tmp.pdf")
    with temporary.open("wb") as stream:
        writer.write(stream)
    temporary.replace(path)


def build_manual(filename, quick=False):
    base.MANUAL_CANDIDATE_REVISION = MANUAL_REVISION
    base.QUICK_START_CANDIDATE_REVISION = QUICK_REVISION
    base._set_candidate_pdf_metadata = write_candidate_metadata
    engine.callout = callout
    engine.numbered = numbered
    engine.procedure = procedure
    try:
        result = base.build_manual(filename, quick=quick)
        if quick:
            expected = {"quickResult": 1, "quickStep": 1}
            actual = {key: _seen[key] for key in expected}
            if actual != expected:
                raise RuntimeError(f"Quick-start v3 flowable inputs were not all corrected exactly once: {actual}")
            _seen["quickResult"] = 0
            _seen["quickStep"] = 0
        elif _seen["manualPage18"] != 1:
            raise RuntimeError(f"Manual page 18 input correction did not run exactly once: {_seen['manualPage18']}")
        else:
            _seen["manualPage18"] = 0
        return result
    finally:
        engine.callout = _original_callout
        engine.numbered = _original_numbered
        engine.procedure = _original_procedure
        base._set_candidate_pdf_metadata = _original_write_metadata


if __name__ == "__main__":
    build_manual("Tsa-Bonno-Bar-Customer-Manual.pdf", quick=False)
    build_manual("Tsa-Bonno-Bar-Quick-Start.pdf", quick=True)
