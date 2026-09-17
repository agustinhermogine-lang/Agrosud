import re, os, json
from datetime import datetime, date
from pypdf import PdfReader
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
url='https://www.nabsa.com.ar/assets/vessels_sailed_update.pdf'; pdf='vessels_sailed_update.pdf'
text='\n'.join((p.extract_text() or '') for p in PdfReader(pdf).pages)
lines=[re.sub(r'\s+',' ',x).strip() for x in text.splitlines() if x.strip()]
# identify report date and period from all date-like strings
pat=re.compile(r'(?<!\d)(\d{1,2})[\-/](\d{1,2})[\-/](\d{2,4})(?!\d)')
dates=[]
for l in lines:
 for m in pat.finditer(l):
  d,mn,y=map(int,m.groups()); y += 2000 if y<100 else 0
  try: dates.append((date(y,mn,d),l))
  except: pass
# Header date is generally the first date in the title/header; prefer dates near report/update text
header=None
for d,l in dates:
 if re.search(r'(?i)(report|update|sailed|fecha|per[ií]odo)',l): header=d; break
if header is None and dates: header=dates[0][0]
# Extract rows from layout text. Keep lines containing both filters; otherwise inspect nearby lines and group by date.
raw=[l for l in lines if re.search(r'(?i)\bCORN\b',l) and re.search(r'(?i)ARGENTINA',l)]
rows=[]
# common single-line table layout: tokenize around fields
for l in raw:
 ds=pat.search(l); dt=None
 if ds:
  a,b,c=map(int,ds.groups()); c+=2000 if c<100 else 0
  try: dt=date(c,b,a)
  except: dt=None
 nums=re.findall(r'(?<![\w])\d{1,3}(?:\.\d{3})*(?:,\d+)?(?![\w])',l)
 tons=nums[-1] if nums else ''
 # preserve source line when PDF layout does not expose stable columns
 rows.append(['', '', '', 'CORN', 'ARGENTINA', tons, dt, l])
# fallback: create records by date-bearing lines in blocks containing both terms
if not rows:
 for i,l in enumerate(lines):
  if re.search(r'(?i)CORN',l):
   block=' '.join(lines[max(0,i-3):i+4])
   if re.search(r'(?i)ARGENTINA',block):
    ds=pat.search(block); dt=None
    if ds:
     a,b,c=map(int,ds.groups()); c+=2000 if c<100 else 0
     try: dt=date(c,b,a)
     except: pass
    rows.append(['','','','CORN','ARGENTINA','',dt,block])
target=date(2026,9,10)
rows=[r for r in rows if r[6] is None or r[6]<=target]
# Parse Argentine numeric quantities
for r in rows:
 s=r[5]
 try: r[5]=float(s.replace('.','').replace(',','.')) if s else 0
 except: r[5]=0
# workbook
out='NABSA_MAIZ_SAILED_HASTA_HOY_2026-09-10.xlsx'
wb=Workbook(); ws=wb.active; ws.title='Detalle'
headers=['Vessel','Puerto','Muelle','Cargo','Origin','Toneladas','Date','Fecha de reporte','Fuente PDF']
ws.append(headers)
for r in rows: ws.append(r[:6]+[r[6],header,url])
for c in ws[1]: c.font=Font(bold=True)
# summaries, based on parsed puerto/muelle (blank if PDF extraction is unstructured)
for title,key in [('Total por puerto',1),('Total por muelle',2)]:
 sh=wb.create_sheet(title); sh.append([headers[key], 'Toneladas'])
 agg={}
 for r in rows: agg[r[key]]=agg.get(r[key],0)+r[5]
 for k,v in sorted(agg.items(),key=lambda x:str(x[0])): sh.append([k,v])
 sh['A1'].font=sh['B1'].font=Font(bold=True)
sh=wb.create_sheet('Fuentes'); sh.append(['Campo','Valor'])
period='; '.join(sorted(set(d.strftime('%d/%m/%Y') for d,_ in dates))) or 'No identificado'
items=[('Fecha de consulta','10/09/2026'),('Fecha del último reporte encontrado',header.strftime('%d/%m/%Y') if header else 'No identificada'),('Período incluido',period),('URL pública',url),('Aviso','NABSA publica información de referencia sujeta a cambios.'),('¿Existe reporte fechado 10/09/2026?','Sí' if header==target else 'No')]
for x in items: sh.append(x)
sh['A1'].font=sh['B1'].font=Font(bold=True)
for sh in wb.worksheets:
 sh.freeze_panes='A2'; sh.auto_filter.ref=sh.dimensions
 for col in sh.columns:
  letter=col[0].column_letter; sh.column_dimensions[letter].width=min(45,max(12,max(len(str(x.value or '')) for x in col)+2))
wb.save(out)
# validate
v=load_workbook(out,read_only=True); assert v.sheetnames==['Detalle','Total por puerto','Total por muelle','Fuentes']; n=v['Detalle'].max_row-1; total=sum((x[5].value or 0) for x in v['Detalle'].iter_rows(min_row=2)); v.close()
print(json.dumps({'ruta':os.path.abspath(out),'filas':n,'total_toneladas':total,'fecha_encontrada':header.isoformat() if header else None,'dates_found':[d.isoformat() for d,_ in dates[:20]],'raw_matches':len(raw)},ensure_ascii=False))
