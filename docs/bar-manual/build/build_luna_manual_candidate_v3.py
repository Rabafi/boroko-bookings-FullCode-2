import hashlib
import importlib.util
import json
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

BUILD_DIR = Path(__file__).resolve().parent
ROOT = BUILD_DIR.parents[2]
CANDIDATE_DIR = BUILD_DIR / "remediation-candidate-2026-10-06-v3"
PDF_DIR = CANDIDATE_DIR / "pdf"
MANIFEST_PATH = CANDIDATE_DIR / "candidate-manifest.json"
REVIEW_PATH = CANDIDATE_DIR / "REVIEW.md"
BUILDER_PATH = BUILD_DIR / "build_manual_candidate_v3.py"
V2_DIR = BUILD_DIR / "remediation-candidate-2026-10-06-v2"
REVISION = {
    "manual": "bar-manual-2026.10.06-candidate.3",
    "quick": "bar-quick-start-2026.10.06-candidate.3",
}

parser = argparse.ArgumentParser()
parser.add_argument("--rebuild", action="store_true", help="replace only generated v3 PDFs and records, keeping evidence and screenshots")
args = parser.parse_args()

if args.rebuild:
    candidate_root = CANDIDATE_DIR.resolve()
    for generated in (PDF_DIR, MANIFEST_PATH, REVIEW_PATH):
        resolved = generated.resolve()
        if resolved == candidate_root or not resolved.is_relative_to(candidate_root):
            raise SystemExit(f"Refusing to remove a path outside candidate v3: {resolved}")
        if generated.is_dir():
            shutil.rmtree(generated)
        elif generated.exists():
            generated.unlink()
else:
    if MANIFEST_PATH.exists() or REVIEW_PATH.exists():
        raise SystemExit(f"Candidate v3 record already exists: {MANIFEST_PATH} or {REVIEW_PATH}")
    if PDF_DIR.exists() and any(PDF_DIR.iterdir()):
        raise SystemExit(f"Candidate v3 PDF directory is not empty: {PDF_DIR}")
PDF_DIR.mkdir(parents=True, exist_ok=True)

manual_source = (BUILD_DIR.parent / "manuscript.md").read_text(encoding="utf-8")
quick_source = (BUILD_DIR.parent / "quick-start-manuscript.md").read_text(encoding="utf-8")
required_sources = (
    ("manual", manual_source, [REVISION["manual"], "page 19", "authorized manager/finance"]),
    ("quick-start", quick_source, [REVISION["quick"], "Review date: **06 October 2026**", "Length: **5 pages**", "saved receipt number and total", "same saved receipt again", "Never collect payment again", "Print receipt is unavailable"]),
)
for label, source, required in required_sources:
    missing = [text for text in required if text.lower() not in source.lower()]
    if missing:
        raise SystemExit(f"{label} manuscript is missing required candidate-v3 content: {missing}")

screenshots = CANDIDATE_DIR / "screenshots"
if not screenshots.exists():
    shutil.copytree(V2_DIR / "screenshots", screenshots)
raw = screenshots / "raw"
annotated = screenshots / "annotated"
for folder in (raw, annotated):
    if not folder.is_dir():
        raise SystemExit(f"Candidate screenshots are not ready: {folder}")

spec = importlib.util.spec_from_file_location("tsa_bonno_bar_candidate_v3_builder", BUILDER_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("The Bar candidate-v3 layout wrapper could not be loaded.")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
builder.engine.OUT = PDF_DIR
builder.engine.RAW = raw
builder.engine.ANN = annotated
builder.build_manual("Tsa-Bonno-Bar-Customer-Manual.pdf", quick=False)
builder.build_manual("Tsa-Bonno-Bar-Quick-Start.pdf", quick=True)

from pypdf import PdfReader

documents = []
for doc_id, label, filename, revision, expected_pages in (
    ("bar-manual", "Bar customer manual", "Tsa-Bonno-Bar-Customer-Manual.pdf", REVISION["manual"], 56),
    ("bar-quick-start", "Bar quick-start", "Tsa-Bonno-Bar-Quick-Start.pdf", REVISION["quick"], 5),
):
    path = PDF_DIR / filename
    if not path.is_file():
        raise SystemExit(f"Candidate v3 PDF was not generated: {path}")
    reader = PdfReader(str(path))
    if len(reader.pages) != expected_pages:
        raise SystemExit(f"{filename}: expected {expected_pages} pages, got {len(reader.pages)}")
    metadata = reader.metadata or {}
    if revision not in str(metadata.get("/Subject", "")) or "06 October 2026" not in str(metadata.get("/Subject", "")):
        raise SystemExit(f"{filename}: candidate-v3 revision/date metadata mismatch")
    documents.append({
        "id": doc_id,
        "revision": revision,
        "label": label,
        "filename": filename,
        "pages": len(reader.pages),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest().upper(),
        "metadataTitle": str(metadata.get("/Title", "")),
        "metadataSubject": str(metadata.get("/Subject", "")),
    })

contract = ROOT / "tests" / "bar-guide-quick-receipt-pdf-contract.py"
quick = PDF_DIR / "Tsa-Bonno-Bar-Quick-Start.pdf"
manual = PDF_DIR / "Tsa-Bonno-Bar-Customer-Manual.pdf"
check = subprocess.run([sys.executable, str(contract), str(quick), "--manual", str(manual)], capture_output=True, text=True, encoding="utf-8")
if check.returncode != 0:
    raise SystemExit(f"Candidate v3 actual-PDF contract failed:\n{check.stdout}\n{check.stderr}")

manifest = {
    "candidateOnly": True,
    "approvalState": "awaiting-content-and-visual-approval",
    "reviewDate": "2026-10-06",
    "productId": "hospitality-pos",
    "operatingMode": "bar_only",
    "appVersion": "1.5.7",
    "supportedVersionRange": "1.5.7",
    "findings": ["GUIDE-01", "GUIDE-02", "GUIDE-03"],
    "documents": documents,
    "evidenceDirectory": "evidence/",
    "screenshotsDirectory": "screenshots/",
    "officialManifestChanged": False,
    "canonicalPdfsChanged": False,
    "packagedGuidesChanged": False,
    "supersedesCandidate": "bar-guide-candidate-2026-10-06-v2",
    "pdfContractChecks": json.loads(check.stdout)["checks"],
}
MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
REVIEW_PATH.write_text(
    "# Bar guide review candidate v3 - 2026-10-06\n\n"
    "State: **awaiting content and visual approval**. This exact candidate pair is not approved and has not been promoted. Candidates v1 and v2 are preserved.\n\n"
    "GUIDE-02 corrects the authoritative layout inputs that emitted quick-start page 2's Result box and page 4's numbered payment-timeout step. Both pages now describe the saved-record route, overlay receipt-number/total verification, same-record printer recovery, no second payment, and conditional manager/support escalation. Manual page 18 points to the supported historical-receipt procedures on pages 19 and 42.\n\n"
    "The final and scratch-built v3 PDFs pass the extracted-page contract. The same contract returns the expected red result against both exact v2 PDFs and a scratch build using the v2 layout wrapper.\n\n"
    "The official document manifest, canonical PDFs and packaged guides remain unchanged pending approval of this exact pair. Disposable SQL proof, runtime advisories and packaged offline cashier open/save acceptance remain separate unresolved gates.\n",
    encoding="utf-8",
)
print("Candidate-v3 PDFs and manifest written to", CANDIDATE_DIR)
for doc in documents:
    print(f"{doc['filename']} pages={doc['pages']} sha256={doc['sha256']}")
print(check.stdout)
