import argparse
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader


def normalized_page(reader, page_number):
    return " ".join((reader.pages[page_number - 1].extract_text() or "").lower().split())


def saved_print_route(text):
    overlay_steps = re.search(
        r"in the overlay, verify (?:its |the )?saved receipt number and total, then choose print receipt",
        text,
    )
    return all((
        "my sales (cashier's own history)" in text,
        "manage > sales (if authorized)" in text,
        "find the saved record and choose print receipt" in text,
        text.count("print receipt") >= 2,
        overlay_steps is not None,
    ))


def same_receipt_recovery(text):
    return all((
        "printer" in text,
        "paper" in text,
        "same saved receipt" in text or "that same saved receipt" in text,
        "never collect payment again" in text,
    ))


def conditional_escalation(text):
    has_manager_or_support = "manager" in text and "support" in text
    has_condition = all((
        "record is missing" in text,
        "print receipt is unavailable" in text,
        "printing keeps failing" in text,
    ))
    return has_manager_or_support and has_condition


def page_is_current(text):
    return all((
        saved_print_route(text),
        same_receipt_recovery(text),
        conditional_escalation(text),
        "approved reprint route" not in text,
        "if the completed-sale pos receipt overlay is available" not in text,
    ))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("quick_pdf", type=Path)
    parser.add_argument("--manual", type=Path)
    args = parser.parse_args()

    quick = PdfReader(str(args.quick_pdf))
    if len(quick.pages) < 4:
        raise SystemExit(f"quick-start has fewer than four pages: {len(quick.pages)}")
    p2 = normalized_page(quick, 2)
    p4 = normalized_page(quick, 4)
    checks = {
        "quick_page_2_saved_record_print_and_recovery": page_is_current(p2),
        "quick_page_4_saved_record_print_and_recovery": page_is_current(p4),
    }

    manual_details = None
    if args.manual:
        manual = PdfReader(str(args.manual))
        if len(manual.pages) < 19:
            raise SystemExit(f"manual has fewer than nineteen pages: {len(manual.pages)}")
        p18 = normalized_page(manual, 18)
        p19 = normalized_page(manual, 19)
        p18_aligned = all((
            "find a previous sale" in p18,
            "page 19" in p18,
            "my sales" in p18,
            "sales" in p18 and "authorized" in p18,
            "never collect payment again" in p18,
            "approved reprint route" not in p18,
        ))
        p19_supported = all((
            "my sales" in p19,
            "print receipt" in p19,
            "receipt number" in p19,
            "total" in p19,
            "overlay" in p19,
            "same saved receipt" in p19,
            "never collect payment again" in p19,
        ))
        checks["manual_page_18_points_to_supported_page_19_route"] = p18_aligned and p19_supported
        manual_details = {"page18": p18, "page19": p19}

    result = {
        "quickPdf": str(args.quick_pdf),
        "manualPdf": str(args.manual) if args.manual else None,
        "checks": checks,
        "passed": sum(checks.values()),
        "total": len(checks),
        "quickPage2": p2,
        "quickPage4": p4,
        "manual": manual_details,
    }
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

