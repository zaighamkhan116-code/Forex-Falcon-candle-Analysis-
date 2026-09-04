import json
from pathlib import Path
R=Path('audit/unreported-report')
PAIRS=['eurusd','gbpusd','eurjpy','usdjpy','audusd']
FEATURES=['rangeAtr','bodyAtr','vwapDistanceAtr','vsaScore','relativeVolume','advancedMomentumScore','sequence','efficiency','emaCompression','bbExpansion','maBbConfirmation','progressScore']

def res(x):
    x=(x or {}).get('results') or {}
    return [x.get('W',0),x.get('L',0),x.get('T',0),x.get('n',0),x.get('wr')]
def prof(x):
    x=x or {}
    return [x.get('latePct'),x.get('adversePct'),x.get('mtfOpp2Pct'),x.get('transitionPct'),x.get('extendedPct'),x.get('failProgressPct'),x.get('avgEfficiency'),x.get('avgMoveQuality'),x.get('avgProgress')]
def merge_cat(a,b,key):
    out={}
    for src in ((a or {}).get(key) or {},(b or {}).get(key) or {}):
      for k,v in src.items():
        z=out.setdefault(k,{'W':0,'L':0,'T':0,'n':0})
        for q in ('W','L','T','n'): z[q]+=int((v or {}).get(q,0) or 0)
    for k,z in out.items(): z['wr']=round(100*z['W']/(z['W']+z['L']),1) if z['W']+z['L'] else None
    return out
def topcat(d):
    if not d:return None
    k=max(d,key=lambda x:d[x].get('n',0));v=d[k]
    return [k,v.get('W'),v.get('L'),v.get('T'),v.get('n'),v.get('wr')]
def features(b):
    fo=b.get('featureOutcomes') or {}; w=fo.get('winNumeric') or {}; l=fo.get('lossNumeric') or {};o={}
    for f in FEATURES:
      if f in w or f in l:
        a=w.get(f);c=l.get(f)
        try:d=None if a is None or c is None else round(float(a)-float(c),4)
        except:d=None
        o[f]=[a,c,d]
    return o
summary=json.loads((R/'summary.json').read_text())
cum={k:v.get('cumulative') for k,v in (summary.get('tracks') or {}).items()}
rows=[]
for p in PAIRS:
  d=json.loads((R/f'{p}.json').read_text())
  for track,t in (d.get('tracks') or {}).items():
    for b in t.get('newBatches') or []:
      th=b.get('threshold') or {}; lo=th.get('57_61_9') or {}; hi=th.get('gte62') or {}
      cats={k:merge_cat(lo,hi,k) for k in ['direction','regime','entryLane','sr','fvgState','emaStack','bbState']}
      rows.append({'track':track,'B':b.get('batch'),'R':[b.get('results',{}).get(q,0) for q in ['W','L','T','n']]+[b.get('results',{}).get('wr')],
       'low':res(lo),'high':res(hi),'lp':prof(lo),'hp':prof(hi),'cum':cum.get(track),
       'dir':cats['direction'],'reg':cats['regime'],'lane':topcat(cats['entryLane']),'sr':topcat(cats['sr']),'fvg':topcat(cats['fvgState']),'ema':topcat(cats['emaStack']),'bb':topcat(cats['bbState']),
       'feat':features(b)})
rows.sort(key=lambda x:(x['track'],x['B']))
(R/'automation-table.json').write_text(json.dumps({'legend':{'R':'W,L,T,n,WR','low/high':'W,L,T,n,WR','lp/hp':'late,adverse,mtfOpp2,transition,extended,failProgress,efficiency,moveQuality,progress','cat':'name,W,L,T,n,WR','feat':'winAvg,lossAvg,delta'},'count':len(rows),'rows':rows},separators=(',',':'))+'\n')
print(len(rows))
