import hashlib
import importlib.util
import json
from datetime import date
from pathlib import Path

BUILD_DIR = Path(__file__).resolve().parent
ROOT = BUILD_DIR.parents[2]
CANDIDATE_DIR = BUILD_DIR / "remediation-candidate-2026-10-06-v2"
PDF_DIR = CANDIDATE_DIR / "pdf"
MANIFEST_PATH = CANDIDATE_DIR / "candidate-manifest.json"
REVIEW_PATH = CANDIDATE_DIR / "REVIEW.md"
BUILDER_PATH = BUILD_DIR / "build_manual.py"
REVISION = {
    "manual": "bar-manual-2026.10.06-candidate.2",
    "quick": "bar-quick-start-2026.10.06-candidate.2",
}

for path in (MANIFEST_PATH, REVIEW_PATH):
    if path.exists():
        raise SystemExit(f"Candidate record already exists: {path}")
if PDF_DIR.exists() and any(PDF_DIR.iterdir()):
    raise SystemExit(f"Candidate PDF directory is not empty: {PDF_DIR}")
if not PDF_DIR.exists():
    PDF_DIR.mkdir(parents=True)

manual_source = (BUILD_DIR.parent / "manuscript.md").read_text(encoding="utf-8")
quick_source = (BUILD_DIR.parent / "quick-start-manuscript.md").read_text(encoding="utf-8")
for label, source, required in (
    ("manual", manual_source, ["bar-manual-2026.10.06-candidate.2", "Review date: **06 October 2026**", "identity-conflict path creates no Failed operations row", "historical receipt printing"]),
    ("quick-start", quick_source, ["bar-quick-start-2026.10.06-candidate.2", "Review date: **06 October 2026**", "Length: **5 pages**", "same saved receipt again"]),
):
    missing = [text for text in required if text.lower() not in source.lower()]
    if missing:
        raise SystemExit(f"{label} manuscript is missing required candidate-v2 content: {missing}")

spec = importlib.util.spec_from_file_location("tsa_bonno_bar_candidate_v2_builder", BUILDER_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("The Bar layout builder could not be loaded.")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
builder.engine.OUT = PDF_DIR
builder.engine.RAW = CANDIDATE_DIR / "screenshots" / "raw"
builder.engine.ANN = CANDIDATE_DIR / "screenshots" / "annotated"
for folder in (builder.engine.RAW, builder.engine.ANN):
    if not folder.is_dir():
        raise SystemExit(f"Candidate screenshots are not ready: {folder}")
builder.build_manual("Tsa-Bonno-Bar-Customer-Manual.pdf", quick=False)
builder.build_manual("Tsa-Bonno-Bar-Quick-Start.pdf", quick=True)

from pypdf import PdfReader

documents = []
for doc_id, label, filename, revision, required_pages in (
    ("bar-manual", "Bar customer manual", "Tsa-Bonno-Bar-Customer-Manual.pdf", REVISION["manual"], 56),
    ("bar-quick-start", "Bar quick-start", "Tsa-Bonno-Bar-Quick-Start.pdf", REVISION["quick"], 5),
):
    path = PDF_DIR / filename
    if not path.is_file():
        raise SystemExit(f"Candidate PDF was not generated: {path}")
    reader = PdfReader(str(path))
    if len(reader.pages) != required_pages:
        raise SystemExit(f"{filename}: expected {required_pages} pages, got {len(reader.pages)}")
    metadata = reader.metadata or {}
    if revision not in str(metadata.get("/Subject", "")) or "06 October 2026" not in str(metadata.get("/Subject", "")):
        raise SystemExit(f"{filename}: candidate revision/date metadata mismatch")
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
}
MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
REVIEW_PATH.write_text(
    "# Bar guide review candidate v2 - 2026-10-06\n\n"
    "State: **awaiting content and visual approval**. This exact candidate pair is not approved and has not been promoted.\n\n"
    "GUIDE-01 corrects identity quarantine guidance and uses current isolated signed-peer merge/store/diagnostic output for S27/S28. The original operation remains pending; the incoming changed-payload peer copy is quarantined; the Network note is visible; this path creates no failed row. Ordinary replay failure remains a separate state with Retry/Clear controls.\n\n"
    "GUIDE-02 updates the cashier My sales and authorized manager/finance Sales receipt procedures and S18/S29 screenshots. Component tests invoke the native print bridge and observe no sale, payment, void or inventory mutation; they do not claim physical printer acceptance.\n\n"
    "GUIDE-03 aligns the review date, candidate revisions, five-page quick-start length, contents, bookmarks and urgent-recovery references.\n\n"
    "The official document manifest, canonical PDFs and packaged guides remain unchanged pending approval of this exact pair.\n",
    encoding="utf-8",
)
print("Candidate-v2 PDFs and manifest written to", CANDIDATE_DIR)
for doc in documents:
    print(f"{doc['filename']} pages={doc['pages']} sha256={doc['sha256']}")
