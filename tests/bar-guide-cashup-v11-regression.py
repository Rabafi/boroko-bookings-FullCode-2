"""Actual-PDF and current-source regressions for cash-up/customer workflow distinctions."""
import argparse,csv,hashlib,importlib.util,json,re,sys
from pathlib import Path
from pypdf import PdfReader

ROOT=Path.cwd()
D=ROOT/'docs/audits/2026-10-09/bar-v10-continuation/draft-v11-semantic-review-01'
V10_MANUAL='AAC263DDCD914136E416AC0DBDDC85D417D9D028A8EA6BF203092884B8B4FED6'
V10_QUICK='7C9FEE67CE801576280640627C0C963C29EDEF727DF41250F98EDC3A45BBAAF0'
MANUAL='Tsa-Bonno-Bar-Customer-Manual.pdf';QUICK='Tsa-Bonno-Bar-Quick-Start.pdf'
spec=importlib.util.spec_from_file_location('stock_checks',ROOT/'tests/bar-guide-stock-v11-regression.py')
checks=importlib.util.module_from_spec(spec);spec.loader.exec_module(checks)
EXPECTED={
 'BAR-DOC-051':['Move cash to safe','Pay an expense from drawer','Add change to drawer','operator Staff PIN','do not record a movement while offline','not automatically the separate finance expense record'],
 'BAR-DOC-052':['Handover count','Record handover','does not add or remove money','Offline counts are queued without local Staff PIN verification'],
 'BAR-DOC-053':['your own account workflow','My cash-up','My Shift','opening cash float','0.00','Physical cash counted','Retained cash tips are excluded','Clock out attendance','provisional until the server confirms it'],
 'BAR-DOC-054':['manager stays signed in','shared terminal','Staff member','private Staff PIN','Service role','Expected hours','Clock in','separate pouches','shared drawer','Clock out','ask an admin for a reset'],
 'BAR-DOC-055':['Shared outlet','Physical cash counted','Count note','optional Staff PIN field is not bound to an operator identity','Record handover','Offline submission is queued and provisional'],
 'BAR-DOC-056':['Refresh','Review unavailable','Expected cash','Counted cash','variance','Return for correction','Approve & close shift','Approve & close','can also be queued against the counted amount without server totals','untouched outlet shifts','All clear summary is not proof','refresh every shared outlet separately'],
 'BAR-DOC-057':['Cash-up evidence','submitted personal cash-up','PDF, JPG or PNG','8 MB','SHA-256 verified','View (60s)','Durable upload may be left unregistered'],
}
FORBIDDEN={
 'BAR-DOC-053':['enter their PIN on the shared terminal','manager stays signed in on the shared terminal as your personal sign-in'],
 'BAR-DOC-054':["the member's shift ends without a personal-pouch cash-up"],
 'BAR-DOC-055':['Staff PIN is verified for the manager closing count','the optional Staff PIN proves the operator'],
 'BAR-DOC-056':['If the action is unavailable while offline, wait until the Till reconnects.'],
 'BAR-DOC-057':['attach a proof while offline','upload completion proves the cash-up is approved'],
}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest().upper()
def norm(s):return checks.norm(s)
def outline_dests(items,reader):
 for item in items or []:
  if isinstance(item,list): yield from outline_dests(item,reader)
  else:
   try: yield str(item.title),reader.get_destination_page_number(item)+1
   except Exception: pass
def source_checks():
 files={
  'my_cashup':ROOT/'src/renderer/src/components/hospitality-pos/HposMyCashup.jsx',
  'my_shift':ROOT/'src/renderer/src/components/hospitality-pos/HposMyShift.jsx',
  'shared_terminal':ROOT/'src/renderer/src/components/hospitality-pos/HposSharedShiftClose.jsx',
  'movements':ROOT/'src/renderer/src/components/hospitality-pos/HposDrawerMovements.jsx',
  'drawer_close':ROOT/'src/renderer/src/components/hospitality-pos/HposDrawerClose.jsx',
  'cash_close':ROOT/'src/renderer/src/components/hospitality-pos/HposCashClose.jsx',
  'proof':ROOT/'src/renderer/src/components/hospitality-pos/HposCashupProofs.jsx',
  'domain':ROOT/'src/main/domains/pos.js',
  'drawer_sql':ROOT/'supabase/migrations/20260918000000_village_cash_containers.sql',
}
 text={k:p.read_text(encoding='utf-8') for k,p in files.items()}
 assert 'Physical cash counted' in text['my_cashup'] and 'Expected totals and variances are intentionally withheld' in text['my_cashup']
 assert 'Clock out attendance' in text['my_shift'] and 'Opening cash float' in text['my_shift']
 assert 'The manager stays signed in' in text['shared_terminal'] and 'Private Staff PIN' in text['shared_terminal']
 assert 'Move cash to safe' in text['movements'] and 'Record handover' in text['movements']
 assert 'offline against this device' in text['movements'].lower(), 'record the current UI hint, even though the current domain queue does not validate offline PINs'
 # The offline paths queue the PIN but do not locally validate it.
 movement=text['domain'][text['domain'].index('export async function recordCashMovement'):text['domain'].index('export async function recordCashCount')]
 count=text['domain'][text['domain'].index('export async function recordCashCount'):text['domain'].index('export async function submitDrawerPeriodCashup')]
 assert 'pin: pin || null' in movement and 'queueOperation' in movement and 'validateCachedPosPin' not in movement
 assert 'pin: pin || null' in count and 'queueOperation' in count and 'validateCachedPosPin' not in count
 # Current closing count UI sends a PIN but no operator identity; SQL validates only a supplied different operator.
 submit=text['drawer_close'][text['drawer_close'].index('const submissionPayload ='):text['drawer_close'].index('if (!result?.success)',text['drawer_close'].index('const submissionPayload ='))]
 assert 'submitDrawerPeriodCashup' in submit and 'pin: pin.trim() || null' in submit
 assert 'operator_id' not in submit
 sql=text['drawer_sql'][text['drawer_sql'].index('create or replace function public.submit_pos_drawer_period_cashup'):text['drawer_sql'].index('create or replace function public.review_pos_drawer_period_cashup')]
 assert 'if v_operator is not null and v_operator is distinct from v_actor' in sql
 # Personal offline review can approve provisional counts with no server totals; manual warns to wait.
 assert 'provisionalReview' in text['cash_close'] and 'accepts the counted cash' in text['cash_close']
 # Drawer summary skips unknown outlet states; the customer guide must require per-outlet checks.
 assert "period === 'unknown' || !period" in text['cash_close'] and 'setDrawerReviewCounts({ awaiting, open, loaded: true })' in text['cash_close']
 assert 'MAX_PROOF_BYTES = 8 * 1024 * 1024' in text['proof']
 assert 'Proof files must be between 1 byte and 8 MB' in text['domain']
 assert 'Durable upload remains unregistered for supervisor recovery' in text['domain']
 return {k:sha(p) for k,p in files.items()}
def red(directory):
 mp=directory/MANUAL;qp=directory/QUICK
 actual={'manual':sha(mp),'quick_start':sha(qp)}
 assert actual=={'manual':V10_MANUAL,'quick_start':V10_QUICK},'The red case is not the frozen exact v10 PDF pair: '+json.dumps(actual)
 reader=PdfReader(str(mp));missing=[]
 for tid,terms in EXPECTED.items():
  body=norm(checks.task_text(reader,tid))
  missing.extend(tid+': '+term for term in terms if norm(term) not in body)
 stale={tid:[term for term in terms if norm(term) in norm(checks.task_text(reader,tid))] for tid,terms in FORBIDDEN.items()}
 stale={tid:terms for tid,terms in stale.items() if terms}
 assert missing,'Expected exact v10 to miss corrected cash-up distinctions.'
 assert stale.get('BAR-DOC-054') and stale.get('BAR-DOC-056'),'Exact v10 must retain the stale shared-shift and offline-review claims.'
 cash_page=reader.pages[41]
 cash_text=norm(cash_page.extract_text() or '')
 assert norm('BAR-DOC-051 - Record a drawer cash movement') in cash_text and len(cash_page.images)>0,'Exact v10 must show the disputed movement screenshot on the frozen task page.'
 return {'outcome':'EXPECTED_RED_EXACT_V10','sha256':actual,'missing_semantics':missing,'stale_semantics':stale,'cashup_screenshot_page':42,'cashup_screenshot_images':len(cash_page.images)}
def green(directory):
 mp=directory/MANUAL;qp=directory/QUICK
 m=PdfReader(str(mp));q=PdfReader(str(qp));missing=[];ranges=list(csv.DictReader((D/'task-page-ranges.csv').open(encoding='utf-8-sig',newline='')))
 byid={r['id']:r for r in ranges};page_checks={}
 for tid,terms in EXPECTED.items():
  body=norm(checks.task_text(m,tid))
  miss=[term for term in terms if norm(term) not in body]
  missing.extend(tid+': '+term for term in miss)
  r=byid.get(tid)
  if not r: missing.append(tid+': no task range');continue
  first,last=int(r['first_printed_page']),int(r['last_printed_page'])
  span=norm(' '.join((m.pages[i-1].extract_text() or '') for i in range(first,last+1)))
  for term in terms:
   if norm(term) not in span:missing.append(tid+f' p.{first}-{last}: '+term)
  page_checks[tid]={'first':first,'last':last,'bookmark_title':r['bookmark_title'],'bookmark_page':int(r['bookmark_page'])}
  if int(r['bookmark_page'])<first or int(r['bookmark_page'])>last:missing.append(tid+': bookmark outside registered task span')
  if tid=='BAR-DOC-051':
   image_count=len(m.pages[first-1].images)
   page_checks[tid]['page_images']=image_count
   if image_count:missing.append(tid+': customer PDF still includes the contradictory offline-PIN screenshot')
  if int(r['first_printed_page'])>int(r['last_printed_page']):missing.append(tid+': reversed page span')
 for tid,terms in FORBIDDEN.items():
  body=norm(checks.task_text(m,tid))
  missing.extend(tid+': stale wording: '+term for term in terms if norm(term) in body)
 outline=dict(outline_dests(m.outline,m))
 for tid,r in byid.items():
  if tid in page_checks and r['bookmark_title'] not in outline:missing.append(tid+': missing bookmark')
 quick_text=norm(' '.join(p.extract_text() or '' for p in q.pages))
 for phrase in ['BAR-DOC-053','BAR-DOC-054','BAR-DOC-055','BAR-DOC-056']:
  if norm(phrase) not in quick_text:missing.append('quick start missing cash-up route '+phrase)
 builder=(D/'build_candidate.py').read_text(encoding='utf-8')
 if '"BAR-DOC-051":(' in builder: missing.append('BAR-DOC-051: contradictory screenshot mapping remains in the builder')
 sources=source_checks()
 if missing: raise AssertionError(json.dumps({'missing':missing,'pages':page_checks},ensure_ascii=False))
 return {'outcome':'PASS_ACTUAL_PDF_AND_CURRENT_SOURCE','sha256':{'manual':sha(mp),'quick_start':sha(qp)},'manual_pages':len(m.pages),'quick_pages':len(q.pages),'cashup_tasks':page_checks,'bookmarks_checked':len(page_checks),'source_sha256':sources,'limits':'Local source and rendered PDF only; no deployed database, live permission, package/offline acceptance or human acceptance.'}
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--mode',choices=['red','green'],required=True);ap.add_argument('--pdf-dir',type=Path,required=True);args=ap.parse_args()
 try:
  result=red(args.pdf_dir) if args.mode=='red' else green(args.pdf_dir)
  print(json.dumps(result,indent=2,ensure_ascii=False));return 0
 except Exception as e:
  print(json.dumps({'outcome':'FAIL','error':str(e)},indent=2,ensure_ascii=False));return 1
if __name__=='__main__':sys.exit(main())
