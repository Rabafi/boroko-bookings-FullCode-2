from pypdf import PdfReader
from pathlib import Path
import re
terms = re.compile(r'\b(legacy|lodging|manager pwa|hospitality-pos|bar_only|signed|release target|authoritative|server|operation key|durable|readiness|activation|cutover|entitlement|deployment|publication|idempotent|database)\b', re.I)
for f in ['output/pdf/Tsa-Bonno-Bar-Customer-Manual.pdf','output/pdf/Tsa-Bonno-Bar-Quick-Start.pdf']:
    reader = PdfReader(f)
    text = '\n'.join((page.extract_text() or '') for page in reader.pages)
    print(Path(f).name, 'pages', len(reader.pages), 'chars', len(text), 'bookmarks', len(reader.outline))
    print('forbidden', sorted(set(m.group(0) for m in terms.finditer(text))))
    fonts = sorted({str(font.get('/BaseFont')) for page in reader.pages for font in (page.get('/Resources', {}).get('/Font', {}) or {}).values() if font.get('/BaseFont')})
    print('fonts', fonts)
    print('annots', sum(len(page.get('/Annots', []) or []) for page in reader.pages))