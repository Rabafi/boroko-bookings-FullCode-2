#!/usr/bin/env python3
import argparse,csv,hashlib,json,re,sys
from pathlib import Path
from pypdf import PdfReader

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest().upper()
def norm(text): return re.sub(r"\s+"," ",text or "").casefold()
def read_csv(path):
    with open(path,encoding="utf-8-sig",newline="") as f: return list(csv.DictReader(f))
def check(name,passed,detail): return {"check":name,"pass":bool(passed),"detail":detail}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--manual',required=True);ap.add_argument('--quick',required=True);ap.add_argument('--candidate-dir',required=True);ap.add_argument('--expect',choices=['red','green'],required=True);ap.add_argument('--report');ap.add_argument('--red-evidence');a=ap.parse_args()
    root=Path(a.candidate_dir);manual=PdfReader(a.manual);quick=PdfReader(a.quick)
    ranges={r['id']:r for r in read_csv(root/'task-page-ranges.csv')}
    if 'BAR-DOC-037' not in ranges: raise SystemExit('BAR-DOC-037 missing from task-page-ranges.csv')
    span=ranges['BAR-DOC-037'];lo=int(span['first_printed_page']);hi=int(span['last_printed_page'])
    mt=' '.join((manual.pages[i-1].extract_text() or '') for i in range(lo,hi+1)); mt=norm(mt)
    qt=norm(quick.pages[4].extract_text() or '') if len(quick.pages)>=5 else ''
    checks=[]
    required='one stock choice applies to all packaged items on this receipt'
    checks.append(check('manual states one receipt-wide stock choice',required in mt,f"BAR-DOC-037 pages {lo}-{hi}; exact phrase tested"))
    mixed=all(x in mt for x in ['some packaged items are unopened and others are opened','choose cancel','ask your manager or provider','two sealed bottles','one sealed bottle and one broken bottle'])
    checks.append(check('manual gives mixed and partial stop path with example',mixed,'Requires mixed condition, Cancel before submit, manager/provider escalation, and concrete example.'))
    safe='choose restore only if every affected packaged item and quantity is physically returned unopened'
    checks.append(check('manual bounds restore to all affected unopened quantities',safe in mt,'Receipt-wide restore condition must be explicit.'))
    checks.append(check('manual preserves recipe, refund and settled boundaries',('recipe ingredients stay consumed' in mt) and ('not a cash refund' in mt or 'does not itself return cash' in mt) and all(x in mt for x in ['settled','stop','manager/provider','take payment again']), 'Checks recipe consumption, void/refund distinction and settled-stop escalation; does not assume a Bar return route.'))
    checks.append(check('manual removes per-item implication and customer engineering jargon',not any(x in mt for x in ['condition of each direct packaged item','local source does not establish','sync.manage','operation key','database acceptance']), 'Rejects the v9 per-item phrase and backend language in the customer task.'))
    short=('one stock choice covers every packaged item on that receipt' in qt or 'one stock choice covers all packaged items on the receipt' in qt) and all(x in qt for x in ['mixed or partial','choose cancel','bar-doc-037']) and ('never repeat the void or collect payment again' in qt or 'do not repeat the void or collect payment again' in qt)
    checks.append(check('quick start has concise receipt-wide stop warning and exact task pointer',short,'Quick Start page 5 must include short stop guidance and BAR-DOC-037 cross-reference.'))
    checks.append(check('quick start contains no unsupported per-item recovery wording',not any(x in qt for x in ['choose from each item','decide each item','per-item stock choice']), 'Checks the final Quick Start PDF page.'))
    duplicate_heading_count=qt.count('a packaged-stock choice is unclear')
    checks.append(check('quick start has no duplicate packaged-stock recovery heading',duplicate_heading_count<=1,f'Found {duplicate_heading_count} copies on exact PDF page 5; candidate must contain at most one.'))
    report={'expectation':a.expect,'manual':{'path':str(Path(a.manual).resolve()),'sha256':sha(a.manual),'pages':len(manual.pages)},'quick_start':{'path':str(Path(a.quick).resolve()),'sha256':sha(a.quick),'pages':len(quick.pages)},'manual_task_span':{'id':'BAR-DOC-037','first':lo,'last':hi},'checks':checks,'failed':[x['check'] for x in checks if not x['pass']]}
    if a.expect=='red':
        expected={'manual states one receipt-wide stock choice','manual gives mixed and partial stop path with example','manual bounds restore to all affected unopened quantities','quick start has concise receipt-wide stop warning and exact task pointer'}
        report['red_evidence_validated']=bool(expected.issubset(set(report['failed'])))
        ok=report['red_evidence_validated']
    else:
        red_valid=False
        if a.red_evidence:
            red=json.loads(Path(a.red_evidence).read_text(encoding='utf-8'))
            expected_red={'manual states one receipt-wide stock choice','manual gives mixed and partial stop path with example','manual bounds restore to all affected unopened quantities','quick start has concise receipt-wide stop warning and exact task pointer'}
            red_valid=(red.get('expectation')=='red'
                and red.get('manual',{}).get('sha256')=='E157C3D36718488F11935165ECE1464DAC1A75025D66DD491BE8EAE6A5F5620C'
                and red.get('quick_start',{}).get('sha256')=='7E114A829EE998BE39503C25210FD0F34ABD300F46EEB993B7382E6B2FC00E2F'
                and expected_red.issubset(set(red.get('failed',[])))
                and red.get('red_evidence_validated') is True)
        report['red_evidence_validated']=red_valid
        ok=not report['failed'] and red_valid
    if a.report: Path(a.report).parent.mkdir(parents=True,exist_ok=True);Path(a.report).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))
    return 0 if ok else 1
if __name__=='__main__': sys.exit(main())
