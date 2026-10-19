"""Actual-PDF product instructions; exact v10 is retained as the red baseline."""
import argparse,json,sys,importlib.util
from pathlib import Path
from pypdf import PdfReader
spec=importlib.util.spec_from_file_location('stock_checks',Path(__file__).with_name('bar-guide-stock-v11-regression.py'));checks=importlib.util.module_from_spec(spec);spec.loader.exec_module(checks)
EXPECTED={
 'BAR-DOC-038':['Stock units consumed per sale','Create matching stock','Link existing stock','Save & add another','keep the original form unchanged'],
 'BAR-DOC-039':['Stock only (not sold directly)','Create matching stock','does not use the selected existing stock record','Bar or Kitchen location','stop','sends no selling price','Clear barcode'],
 'BAR-DOC-041':['No stock tracking','Simple Food','Cocktails','missing row alone does not prove'],
 'BAR-DOC-042':['no separate pack-price fields','Stock selling price','6, 12 or 24','six counted units','leading zeroes'],
 'BAR-DOC-044':['check every pack flag and pack barcode','Available for sale','does not reliably carry these saved settings','recipe','Mark sold out','Cancel'],
 'BAR-DOC-045':['keep the original form open','latest till update','not prove that nothing saved','change a field first','manager or provider','service stock','do not choose Retry publication'],
 'BAR-DOC-046':['Manage sizes & extras','one choice per line as option name|price','Minimum choices','Maximum choices','There is no separate Required checkbox','Maximum 0 means no upper limit','comma-separated category names','Save modifier group','Done','offline saves are queued'],
}
FORBIDDEN={
 'BAR-DOC-045':[
  'Retry this save on that exact row',
  'original Products row Retry this save',
  'Products original-row Retry this save',
  'check the same row again after reconnecting',
 ]
}
def check(directory,red=False):
 manual=directory/checks.MANUAL;quick=directory/checks.QUICK
 hashes={'manual':checks.sha(manual),'quick_start':checks.sha(quick)}
 if red:assert hashes=={'manual':checks.V10_MANUAL,'quick_start':checks.V10_QUICK},hashes
 reader=PdfReader(str(manual));missing=[]
 for task,terms in EXPECTED.items():
  body=checks.task_text(reader,task)
  for term in terms:
   if checks.norm(term) not in body:missing.append(task+': '+term)
  if task=='BAR-DOC-042' and "enter each pack's price" in body:missing.append(task+': fabricated pack-price input remains')
  for phrase in FORBIDDEN.get(task,[]):
   if checks.norm(phrase) in body:missing.append(task+': stale promise remains: '+phrase)
 quick_reader=PdfReader(str(quick));assert len(quick_reader.pages)==5,'quick-start must remain five pages';quick_last=checks.norm(quick_reader.pages[-1].extract_text() or '')
 quick_required=['Keep the original form open and unchanged','A missing row or failed list is not proof that nothing saved','do not change a field','BAR-DOC-045']
 quick_missing=[term for term in quick_required if checks.norm(term) not in quick_last]
 missing.extend('QUICK-PAGE-5: '+term for term in quick_missing)
 if red:assert missing,'Expected exact v10 to miss the newly source-verified guidance'
 else:assert not missing,json.dumps(missing)
 result={'outcome':'EXPECTED_RED_EXACT_V10' if red else 'PASS_ACTUAL_PDF','sha256':hashes,'missing_semantics':missing,'tasks_checked':list(EXPECTED),'manual_pages':len(reader.pages),'quick_start_pages':len(quick_reader.pages),'quick_page_5_required':quick_required,'quick_page_5_missing':quick_missing}
 return result
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--pdf-dir',type=Path,required=True);ap.add_argument('--red',action='store_true');args=ap.parse_args()
 try:print(json.dumps(check(args.pdf_dir,args.red),indent=2));sys.exit(0)
 except Exception as e:print(json.dumps({'outcome':'FAIL','error':str(e)},indent=2));sys.exit(1)
