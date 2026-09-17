import urllib.request, pdfplumber, re
url='https://www.nabsa.com.ar/assets/vessels_sailed_update.pdf'; pdf='report.pdf'; urllib.request.urlretrieve(url,pdf)
with pdfplumber.open(pdf) as d:
 s='\n'.join(p.extract_text() or '' for p in d.pages)
open('report_text.txt','w',encoding='utf8').write(s)
for line in s.splitlines():
 if 'CORN' in line.upper() or any(x in line for x in ['01/09/2026','02/09/2026','03/09/2026','04/09/2026','05/09/2026','06/09/2026','07/09/2026','08/09/2026','09/09/2026','10/09/2026']): print(line)
