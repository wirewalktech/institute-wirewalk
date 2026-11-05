"""Check actual built pages, public schema and crawler exclusions; no network writes."""
import argparse,json,re,xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
class Head(HTMLParser):
 def __init__(self):super().__init__();self.meta={};self.canon=[];self.scripts=[];self.in_ld=False;self.ld='';self.title='';self.in_title=False;self.h1='';self.in_h1=False
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='meta':self.meta.setdefault(a.get('name',a.get('property','')),[]).append(a.get('content',''))
  if tag=='link' and a.get('rel')=='canonical':self.canon.append(a.get('href'))
  if tag=='title':self.in_title=True
  if tag=='h1':self.in_h1=True
  if tag=='script' and a.get('type')=='application/ld+json':self.in_ld=True;self.ld=''
 def handle_endtag(self,tag):
  if tag=='title':self.in_title=False
  if tag=='h1':self.in_h1=False
  if tag=='script' and self.in_ld:self.scripts.append(json.loads(self.ld));self.in_ld=False
 def handle_data(self,data):
  if self.in_title:self.title+=data
  if self.in_h1:self.h1+=data
  if self.in_ld:self.ld+=data

def types(value):
 if isinstance(value,dict):
  yield value
  for v in value.values():yield from types(v)
 elif isinstance(value,list):
  for v in value:yield from types(v)

def page(root,url):
 p=root/(url.strip('/')+'/index.html' if url!='/' else 'index.html');h=Head();h.feed(p.read_text());return h
ap=argparse.ArgumentParser();ap.add_argument('built',type=Path);ap.add_argument('--index-enabled',action='store_true');ap.add_argument('--receipt',type=Path,required=True);a=ap.parse_args();root=a.built
catalog=json.loads((Path(__file__).resolve().parents[1]/'_data/catalog.json').read_text());guides=json.loads((Path(__file__).resolve().parents[1]/'_data/learning-seo.json').read_text());base='https://institute.wirewalk.com'
assert set(guides)=={x['id'] for x in catalog['tracks']}
assert sum(x['category']=='industry' for x in guides.values())==10
assert sum(x['category']=='technology' for x in guides.values())==17
checked=0;titles=set();descriptions=set();schema_count=0
for track in catalog['tracks']:
 url='/tracks/'+track['id']+'/';h=page(root,url);checked+=1
 assert h.title not in titles,(url,'duplicate title');titles.add(h.title)
 desc=h.meta['description'];assert len(desc)==1 and desc[0] not in descriptions,(url,'duplicate description');descriptions.add(desc[0]);assert 80<=len(desc[0])<=165
 assert h.h1.strip()==guides[track['id']]['heading']
 assert h.canon==[base+url]
 assert len(h.meta['robots'])==1
 assert ('noindex' not in h.meta['robots'][0])==(a.index_enabled and track['onSale']>0)
 for data in h.scripts:
  for node in types(data):
   if node.get('@type')=='ListItem':assert node.get('name') or node.get('item'),(url,'empty list item')
   if node.get('@type')=='Course':
    assert node.get('name') and node.get('description') and node.get('provider')
    cid=node['url'].strip('/').split('/')[-1];assert next(c for c in catalog['courses'] if c['id']==cid)['status']=='on_sale'
for course in catalog['courses']:
 url='/courses/'+course['id']+'/';h=page(root,url);checked+=1;assert h.canon==[base+url];assert len(h.meta['robots'])==1
 assert ('noindex' not in h.meta['robots'][0])==(a.index_enabled and course['status']=='on_sale')
 schemas=[n for d in h.scripts for n in types(d) if n.get('@type')=='Course']
 assert len(schemas)==(1 if course['status']=='on_sale' else 0),(url,'planned/available schema mismatch')
 for data in schemas:
  assert data['name']==course['title'] and data['description'] and re.fullmatch(r'PT[1-9][0-9]*H',data['timeRequired'])
  assert 'offers' not in data,'Price must remain API-resolved'
  schema_count+=1
 crumbs=[n for d in h.scripts for n in types(d) if n.get('@type')=='BreadcrumbList']
 assert len(crumbs)==1 and all(n.get('name') for n in crumbs[0]['itemListElement']),(url,'blank breadcrumb')
for url in ['/learn/','/learn/cart/','/learn/exam/','/learn/reset/','/learn/team/','/admin/','/email/unsubscribe/','/waitlist/confirm/','/verify/','/go/developers/','/teams/thanks/','/teams/enterprise/thanks/']:
 h=page(root,url);assert h.meta['robots']==['noindex, nofollow'],(url,'private route indexing');assert not h.scripts,(url,'utility schema');checked+=1
private_html_checked=0
for area in ['learn','admin','email','waitlist','verify','go']:
 for private_file in (root/area).rglob('*.html'):
  private_head=Head();private_head.feed(private_file.read_text())
  assert private_head.meta.get('robots')==['noindex, nofollow'],(str(private_file),'private index leak')
  private_html_checked+=1
for url in ['/','/industries/','/technologies/','/courses/']:
 h=page(root,url);assert h.canon==[base+url] and h.title and h.meta['description'];checked+=1
xml=ET.parse(root/'sitemap.xml');urls=[x.text for x in xml.findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc')];assert len(urls)==len(set(urls))
assert bool(urls)==a.index_enabled
for url in urls:
 assert url.startswith(base+'/') and '?' not in url and '#' not in url
 path=url[len(base):];assert not any(path.startswith('/'+p+'/') for p in ['learn','admin','email','waitlist','verify','go','badges'])
 h=page(root,path);assert 'noindex' not in h.meta['robots'][0],(path,'sitemap noindex URL')
if a.index_enabled:
 for c in catalog['courses']:assert (base+'/courses/'+c['id']+'/' in urls)==(c['status']=='on_sale')
robots=(root/'robots.txt').read_text();assert ('Disallow: /\n' in robots)==(not a.index_enabled)
if a.index_enabled:
 assert 'Sitemap: '+base+'/sitemap.xml' in robots
 assert 'Disallow: /learn/' not in robots,'Crawlers must be able to read the noindex directive'
# Validate owned learning links against actual generated artifacts, not redirecting github.io URLs.
class Links(HTMLParser):
 def __init__(self):super().__init__();self.hrefs=[]
 def handle_starttag(self,tag,attrs):
  if tag=='a':self.hrefs.append(dict(attrs).get('href',''))
links_checked=0
for url in ['/','/industries/','/technologies/']+['/tracks/'+t['id']+'/' for t in catalog['tracks']]:
 source=root/(url.strip('/')+'/index.html' if url!='/' else 'index.html');links=Links();links.feed(source.read_text())
 for href in links.hrefs:
  target_url=urlsplit(href)
  if not href or target_url.scheme or target_url.netloc or href.startswith('#'):continue
  path=unquote(target_url.path)
  target=root/path.lstrip('/') if path.startswith('/') else source.parent/path
  assert target.is_file() or (target/'index.html').is_file(),(url,'broken internal link',href)
  links_checked+=1
result={'built':str(root),'ownedLearningLinksChecked':links_checked,'allPrivateHtmlChecked':private_html_checked,'indexEnabledFixture':a.index_enabled,'pagesChecked':checked,'trackGuides':len(guides),'industryGuides':10,'technologyAndSkillsGuides':17,'availableCourseSchemas':schema_count,'sitemapUrls':len(urls),'privateRoutesNoindexAndExcluded':True,'plannedCoursesNotInCourseSchemaOrSitemap':True,'allJsonLdParsed':True,'uniqueTrackMetadata':True,'canonicalChecks':True}
a.receipt.parent.mkdir(parents=True,exist_ok=True);a.receipt.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
