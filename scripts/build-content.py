#!/usr/bin/env python3
"""Build checked-in packs from pinned source bytes. Offline by default; --download refreshes pinned bytes."""
import argparse, hashlib, json, re, urllib.request, zipfile
from pathlib import Path
from html.parser import HTMLParser
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'content/raw'
OUT = ROOT / 'public/content'
SOURCES = {
 'bsb.txt': 'https://bereanbible.com/bsb.txt',
 'kjv.zip': 'https://ebible.org/Scriptures/eng-kjv_usfm.zip?download=1',
 'web.zip': 'https://ebible.org/Scriptures/eng-web_usfm.zip?download=1',
 'westminster_shorter_catechism.json': 'https://raw.githubusercontent.com/NonlinearFruit/Creeds.json/master/creeds/westminster_shorter_catechism.json',
 'heidelberg-schaff.html': 'https://ccel.org/ccel/schaff/creeds3.iv.vi.html',
 'apostles-schaff.html': 'https://ccel.org/ccel/schaff/creeds2.iv.i.i.i.html',
 'nicene-schaff.html': 'https://ccel.org/ccel/schaff/creeds2.iv.i.ii.ii.html',
}
BOOK_NAMES = 'Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|1 Samuel|2 Samuel|1 Kings|2 Kings|1 Chronicles|2 Chronicles|Ezra|Nehemiah|Esther|Job|Psalms|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|2 Corinthians|Galatians|Ephesians|Philippians|Colossians|1 Thessalonians|2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|1 John|2 John|3 John|Jude|Revelation'.split('|')
CODES = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split()
BOOKS = [dict(id=c.lower(), name=n) for c,n in zip(CODES, BOOK_NAMES)]
def compact(s):
 return re.sub(r'\s+', ' ', s).strip()
def emit(path, data):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
def item(id,title,text,collection,translation=''):
 return dict(id=id,title=title,text=compact(text),collection=collection,translation=translation)
class Node:
 def __init__(self,tag='',attrs=()): self.tag=tag;self.attrs=dict(attrs);self.children=[]
 def text(self):
  if self.attrs.get('class') in ('mnote','Note','pb','Footnote') or self.tag in ('script','style'):return ''
  return ''.join(c if isinstance(c,str) else c.text() for c in self.children)
 def all(self,tag):
  for c in self.children:
   if isinstance(c,Node):
    if c.tag==tag:yield c
    yield from c.all(tag)
class Tree(HTMLParser):
 def __init__(self,s):
  super().__init__(); self.root=Node();self.stack=[self.root];self.feed(s)
 def handle_starttag(self,t,a):
  n=Node(t,a);self.stack[-1].children.append(n)
  if t not in ('br','hr','img','meta','link','input'):self.stack.append(n)
 def handle_startendtag(self,t,a):self.handle_starttag(t,a);self.handle_endtag(t)
 def handle_endtag(self,t):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==t:self.stack=self.stack[:i];break
 def handle_data(self,d):self.stack[-1].children.append(d)
def tree(name):return Tree((RAW/name).read_text()).root
def usfm_text(s):
 # Omit apparatus and section titles, not Scripture. Retain supplied words and poetry.
 for tag in ('f','fe','x','fig'):
  s=re.sub(r'\\'+tag+r'\b.*?\\'+tag+r'\*','',s,flags=re.S)
 s=re.sub(r'(?m)^\\(?:s\d*|ms\d*|mr|r|d|cl|cp|sp|sr)\b[^\n]*','',s)
 s=re.sub(r'\\\+?w\s+([^|\\]+)\|.*?\\\+?w\*',r'\1',s,flags=re.S)
 s=re.sub(r'\\[+\w]+\*?\s*',' ',s)
 return compact(s.replace('¶',''))
def bibles():
 bsb={b['id']:{} for b in BOOKS};byname={b['name']:b['id'] for b in BOOKS};byname['Psalm']='psa';byname['Song of Songs']='sng'
 for line in (RAW/'bsb.txt').read_text(encoding='utf-8-sig').splitlines():
  m=re.match(r'(.+?) (\d+):(\d+)\t(.*)',line)
  if m:
   name,ch,v,text=m.groups();bsb[byname[name]].setdefault(ch,{})[v]=compact(text)
 translations={'BSB':bsb}
 for tr in ('KJV','WEB'):
  data={}
  with zipfile.ZipFile(RAW/(tr.lower()+'.zip')) as z:
   for filename in z.namelist():
    code=next((b['id'] for b in BOOKS if re.search(r'-'+b['id']+r'eng',filename,re.I)),None)
    if not code:continue
    s=z.read(filename).decode('utf-8-sig');chapters={}
    pieces=re.split(r'\\c\s+(\d+)\b',s)
    for i in range(1,len(pieces),2):
     ch=pieces[i];verses={};vparts=re.split(r'\\v\s+(\d+(?:-\d+)?)\s+',pieces[i+1])
     for j in range(1,len(vparts),2):
      v=vparts[j];text=usfm_text(vparts[j+1])
      if not text: continue  # Text-critical omissions retain absent numbering, never fabricated text.
      assert '\\' not in text and 'strong=' not in text,(tr,code,ch,v,text)
      # Both selected editions use individual verse numbers, not bridges.
      assert v.isdigit(),(tr,code,ch,v)
      verses[v]=text
     chapters[ch]=verses
    data[code]=chapters
  assert len(data)==66,(tr,len(data));translations[tr]=data
 for tr,data in translations.items():
  for b in BOOKS:
   assert data[b['id']],(tr,b)
   emit(OUT/tr.lower()/(b['id']+'.json'),dict(book=b['name'],translation=tr,chapters=data[b['id']]))
 return translations
def documents():
 docs=[]
 wsc=json.loads((RAW/'westminster_shorter_catechism.json').read_text())['Data']
 assert len(wsc)==107 and [q['Number'] for q in wsc]==list(range(1,108))
 docs.append(dict(id='wsc',title='Westminster Shorter Catechism',subtitle='107 questions · historic English',color='sage',items=[item(f'wsc-{q["Number"]}',q['Question'],q['Answer'],'wsc')|{'number':q['Number']} for q in wsc]))
 # Schaff's bilingual edition: the final column in each two-column row is English.
 rows=[]
 for row in tree('heidelberg-schaff.html').all('tr'):
  cells=[c for c in row.children if isinstance(c,Node) and c.tag=='td']
  if len(cells)==2:rows.append(compact(cells[-1].text()))
 ends=[2,5,8,11,15,19,23,25,26,28,30,32,34,36,39,44,45,49,52,53,56,58,61,64,68,71,74,77,79,82,85,87,91,95,98,100,102,103,104,107,109,111,112,115,119,121,122,123,124,125,126,129]
 questions=[];current=None;part='question'
 for text in rows:
  m=re.fullmatch(r'\(?Question\s*(\d+)\.',text)
  if m:
   if current:questions.append(current)
   current={'number':int(m[1]),'question':[],'answer':[]};part='question';continue
  if text=='Answer.':part='answer';continue
  if current and text and not re.fullmatch(r'[—\s]+|THE .* PART\.|OF .*|Of .*',text):current[part].append(text)
 if current:questions.append(current)
 assert [q['number'] for q in questions]==list(range(1,130))
 hitems=[]
 for q in questions:
  n=q['number'];day=next(i+1 for i,end in enumerate(ends) if n<=end)
  answer=' '.join(q['answer'])
  if n==80: answer=answer.rstrip(')')  # Schaff encloses the entire question in editorial parentheses.
  hitems.append(item(f'heidelberg-{n}',' '.join(q['question']),answer,'heidelberg')|{'number':n,'lordsDay':day})
 docs.append(dict(id='heidelberg',title='Heidelberg Catechism',subtitle="129 questions · 52 Lord’s Days · Schaff historic English",color='clay',items=hitems))
 for id,title,filename,ids in [('apostles',"Apostles’ Creed",'apostles-schaff.html',['iv.i.i.i-p12','iv.i.i.i-p13','iv.i.i.i-p16']),('nicene','Nicene Creed','nicene-schaff.html',['iv.i.ii.ii-p8','iv.i.ii.ii-p10','iv.i.ii.ii-p10.6','iv.i.ii.ii-p10.11'])]:
  root=tree(filename);nodes={n.attrs.get('id'):n for tag in ('p','td') for n in root.all(tag)}
  text=' '.join(compact(nodes[k].text()) for k in ids)
  # Omit Schaff's inline editorial glosses; include bracketed Western additions.
  for gloss in (' [Hades, spirit-world]',' [flesh]',' [essence]'):text=text.replace(gloss,'')
  text=text.replace('(begotten) ','').replace('worlds [God of God]', 'worlds, [God of God]').replace('[','').replace(']','')
  docs.append(dict(id=id,title=title,subtitle='Traditional English · Schaff',color='ink',items=[item(id,title,text,id)]))
 assert len(hitems)==129 and len(docs)==4
 emit(OUT/'documents.json',docs)
 return docs

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--download',action='store_true');args=parser.parse_args()
 RAW.mkdir(parents=True,exist_ok=True)
 manifest_path=ROOT/'content/source-lock.json'
 lock=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
 for name,url in SOURCES.items():
  path=RAW/name
  if args.download:
   data=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=90).read()
   if name in lock and hashlib.sha256(data).hexdigest()!=lock[name]['sha256']:raise ValueError(f'{name} upstream changed; review and deliberately update source-lock.json first')
   path.write_bytes(data)
  sha=hashlib.sha256(path.read_bytes()).hexdigest()
  if name in lock:assert sha==lock[name]['sha256'],f'Source checksum mismatch: {name}'
  lock[name]={'url':url,'sha256':sha}
 emit(manifest_path,lock)
 translations=bibles();docs=documents()
 def verse(ref):
  m=re.match(r'(.+) (\d+):(\d+)',ref);name,ch,v=m.groups();b=next(b for b in BOOKS if b['name']==name)
  return item(f'bsb-{b["id"]}-{ch}-{v}',ref,translations['BSB'][b['id']][ch][v],'bible','BSB')
 gospel=['John 3:16','Romans 3:23','Romans 6:23','Romans 5:8','Ephesians 2:8','Ephesians 2:9','John 14:6','Romans 10:9','Romans 10:13','1 John 1:9']
 starters=[dict(id='gospel',title='The Gospel in 10 verses',subtitle='Grace, received by faith',color='clay',items=[verse(r) for r in gospel]),dict(id='wsc-start',title='Westminster Shorter Catechism',subtitle='Questions 1–12',color='sage',items=docs[0]['items'][:12]),dict(id='heidelberg-start',title='Heidelberg · Lord’s Day 1',subtitle='Our only comfort',color='ochre',items=docs[1]['items'][:2]),dict(id='apostles-start',title='The Apostles’ Creed',subtitle='The faith we confess',color='ink',items=docs[2]['items']),dict(id='psalm23',title='Psalm 23',subtitle='The Lord is my shepherd',color='sage',items=[verse(f'Psalms 23:{n}') for n in range(1,7)])]
 emit(OUT/'starters.json',starters);emit(OUT/'books.json',BOOKS)
 counts={tr:sum(len(vs) for chs in data.values() for vs in chs.values()) for tr,data in translations.items()}
 emit(OUT/'manifest.json',{'version':1,'translations':['BSB','KJV','WEB'],'books':BOOKS,'verseCounts':counts,'documentCounts':{'wsc':107,'heidelberg':129,'apostles':1,'nicene':1}})
 print(json.dumps(counts));print('Built 198 book packs, 4 documents, 5 starters (offline).')
if __name__=='__main__':main()
