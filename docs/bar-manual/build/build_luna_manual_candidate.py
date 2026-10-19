import importlib.util
from pathlib import Path

root = Path(__file__).resolve().parents[3]
builder_path = Path(__file__).with_name("build_manual.py")
output_dir = Path(__file__).with_name("remediation-candidate-2026-10-06-v1") / "pdf"
if output_dir.exists() and any(output_dir.iterdir()):
    raise SystemExit("Candidate output already contains files; choose a new candidate version to preserve prior review evidence.")
output_dir.mkdir(parents=True, exist_ok=False)
spec = importlib.util.spec_from_file_location("tsa_bonno_bar_candidate_builder", builder_path)
if spec is None or spec.loader is None:
    raise SystemExit("The Bar layout builder could not be loaded.")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
builder.engine.OUT = output_dir
builder.build_manual("Tsa-Bonno-Bar-Customer-Manual.pdf", quick=False)
builder.build_manual("Tsa-Bonno-Bar-Quick-Start.pdf", quick=True)
print("Review candidates written to", output_dir)