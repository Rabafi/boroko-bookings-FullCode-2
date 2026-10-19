"""Rendered-PDF regression for the isolated Bar stock guide draft.

The exact v10 pair is an asserted red baseline. The scratch and current draft PDF
pairs must contain the repaired stock instructions in the correct task/page spans.
"""
import argparse, hashlib, json, re, sys
from pathlib import Path
from pypdf import PdfReader

ROOT=Path.cwd()
DRAFT=ROOT/'docs/audits/2026-10-09/bar-v10-continuation/draft-v11-semantic-review-01'
V10_MANUAL='AAC263DDCD914136E416AC0DBDDC85D417D9D028A8EA6BF203092884B8B4FED6'
V10_QUICK='7C9FEE67CE801576280640627C0C963C29EDEF727DF41250F98EDC3A45BBAAF0'
MANUAL='Tsa-Bonno-Bar-Customer-Manual.pdf'
QUICK='Tsa-Bonno-Bar-Quick-Start.pdf'
EXPECTED={
 'BAR-DOC-047':[
  'Manage > Service stock > Receive delivery',
  'quantity physically received',
  'line reason and batch note are optional',
  'one-item row Receive form',
  'short note/reference',
  'purchase-order receipt is a separate task',
  'Never enter a second delivery',
 ],
 'BAR-DOC-048':[
  'Count All includes every listed item in that outlet',
  'including 0',
  'One-item Count needs a reason category',
  'every item has a last-known stock version',
  'balance is provisional',
  'server confirmation',
  'Cancel hides the form',
  'cannot undo a posted or queued count',
 ],
 'BAR-DOC-049':[
  'Select the closest reason category',
  'short detail/reference',
  'do not close/reopen or change the quantity and submit again',
 ],
 'BAR-DOC-050':[
  'Read-only movement history',
  'View full history',
  'Show archived',
  'Print blank count sheet',
  'configured printer',
  'not that paper physically printed',
  'search does not filter by category',
 ],
}
QUICK_TERMS=[
 'A stock count, receipt or waste entry is unclear',
 'Service stock says saved on this computer and queued',
 'the balance is provisional',
 'do not submit another stock change',
 'BAR-DOC-047', 'BAR-DOC-048', 'BAR-DOC-049', 'BAR-DOC-050',
]

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest().upper()
def norm(s):
 s=s.replace('\u2019',"'").replace('\u2018',"'").replace('\u201c','"').replace('\u201d','"').replace('\u2013','-').replace('\u2014','-').replace('\u00a0',' ')
 return re.sub(r'\s+',' ',s).casefold()
def outline_titles(items):
 result=[]
 for item in items:
  if isinstance(item,list): result.extend(outline_titles(item))
  else:
   result.append(str(getattr(item,'title','')))
 return result
def task_text(reader,task_id):
 # Extract across continuation pages, then stop at the next actual task
 # heading. A neighbouring task's warning cannot satisfy this task.
 if not hasattr(reader,'_barGuideExtractedText'):
  reader._barGuideExtractedText='\n'.join(p.extract_text() or '' for p in reader.pages)
 text=reader._barGuideExtractedText
 marker=re.compile(rf'{re.escape(task_id)}\s*[-–]\s*')
 parts=[]
 for m in marker.finditer(text):
  stop=re.search(r'BAR-DOC-\d{3}\s*[-–]\s*',text[m.end():])
  end=m.end()+stop.start() if stop else len(text)
  body=text[m.start():end]
  if 'Who:' in body and 'Where:' in body:parts.append(body)
 return norm(' '.join(parts))

def check_v10_red(directory):
 mp=directory/MANUAL; qp=directory/QUICK
 if not mp.is_file() or not qp.is_file():raise AssertionError('Frozen v10 PDF pair is missing')
 hashes={'manual':sha(mp),'quick_start':sha(qp)}
 if hashes!={'manual':V10_MANUAL,'quick_start':V10_QUICK}:raise AssertionError(f'Exact v10 hash mismatch: {hashes}')
 manual=PdfReader(str(mp)); quick=PdfReader(str(qp))
 missing=[]
 for task,terms in EXPECTED.items():
  body=task_text(manual,task)
  if not body: missing.append(task+': task body not found')
  for term in terms:
   if norm(term) not in body:missing.append(task+': '+term)
 qtext=norm(' '.join(p.extract_text() or '' for p in quick.pages))
 for term in QUICK_TERMS:
  if norm(term) not in qtext:missing.append('quick-start: '+term)
 if not missing:raise AssertionError('Expected red baseline unexpectedly satisfies all v11 stock guidance')
 return {'outcome':'EXPECTED_RED_V10','manual_pages':len(manual.pages),'quick_pages':len(quick.pages),'sha256':hashes,'missing_required_semantics':missing}
def check_green(directory):
 mp=directory/MANUAL; qp=directory/QUICK
 if not mp.is_file() or not qp.is_file():raise AssertionError('Draft PDF pair is missing: '+str(directory))
 manual=PdfReader(str(mp)); quick=PdfReader(str(qp))
 range_file=directory/'task-page-ranges.csv' if (directory/'task-page-ranges.csv').is_file() else directory.parent/'task-page-ranges.csv'
 ranges={r['id']:(int(r['first_printed_page']),int(r['last_printed_page'])) for r in __import__('csv').DictReader(range_file.open(encoding='utf-8-sig',newline=''))}
 missing=[]; spans={}
 for task,terms in EXPECTED.items():
  if task not in ranges:missing.append(task+': page range missing');continue
  a,b=ranges[task]
  if a<1 or b>len(manual.pages):missing.append(task+f': invalid page range {a}-{b}');continue
  span=norm(' '.join(manual.pages[i-1].extract_text() or '' for i in range(a,b+1)))
  spans[task]=[a,b]
  # Verify the task title is within its recorded printed-page span.
  if task.casefold() not in span:missing.append(task+': task absent from registered page span')
  body=task_text(manual,task)
  for term in terms:
   if norm(term) not in body:missing.append(task+': '+term)
 # Route labels and no obsolete label are checked on affected rendered manual pages.
 for task in ('BAR-DOC-047','BAR-DOC-048','BAR-DOC-049','BAR-DOC-050'):
  if task not in ranges:continue
  a,b=ranges[task]
  span=norm(' '.join(manual.pages[i-1].extract_text() or '' for i in range(a,b+1)))
  if 'service stock' not in span:missing.append(task+': current Service stock route missing')
  if 'stock counts' in span:missing.append(task+': stale Stock counts label present')
 qpages=[norm(p.extract_text() or '') for p in quick.pages]
 if len(qpages)!=5:missing.append(f'quick-start page count is {len(qpages)}, expected 5')
 else:
  for term in QUICK_TERMS:
   if norm(term) not in qpages[4]:missing.append('quick-start page 5: '+term)
 # Whole-manual pagination can grow as remaining action groups are reviewed.
 # Every affected registered span and bookmark still has to resolve.
 meta=manual.metadata or {}
 if 'Draft v11' not in str(meta.get('/Title','')):missing.append('manual metadata title is not Draft v11')
 outline_source=manual.outline() if callable(manual.outline) else manual.outline
 outlines=outline_titles(outline_source)
 for task in EXPECTED:
  if not any(task in item for item in outlines):missing.append(task+': bookmark missing')
 qmeta=quick.metadata or {}
 if 'Draft v11' not in str(qmeta.get('/Title','')):missing.append('quick-start metadata title is not Draft v11')
 if missing:raise AssertionError(json.dumps({'pdf_dir':str(directory),'missing':missing,'registered_spans':spans},ensure_ascii=False))
 return {'outcome':'PASS_DRAFT_RENDER','manual_pages':len(manual.pages),'quick_pages':len(quick.pages),'sha256':{'manual':sha(mp),'quick_start':sha(qp)},'registered_task_spans':spans,'bookmarks_checked':len(EXPECTED),'quick_page_5_references_checked':True}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--mode',choices=('red','green'),required=True);ap.add_argument('--pdf-dir',type=Path,required=True);args=ap.parse_args()
 try:
  result=check_v10_red(args.pdf_dir) if args.mode=='red' else check_green(args.pdf_dir)
  print(json.dumps(result,indent=2,ensure_ascii=False));return 0
 except Exception as e:
  print(json.dumps({'outcome':'FAIL','error':str(e)},indent=2,ensure_ascii=False));return 1
if __name__=='__main__':sys.exit(main())
