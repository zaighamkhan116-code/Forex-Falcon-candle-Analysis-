#!/usr/bin/env python3
import json, glob, os, re, statistics
from collections import Counter, defaultdict
BASELINE_MS=1788388509000

def acc(c):
    d=c.get('WIN',0)+c.get('LOSS',0)
    return round(100*c.get('WIN',0)/d,1) if d else None

def rc(rows):
    c=Counter(str(r.get('result','UNKNOWN')) for r in rows)
    return {'W':c['WIN'],'L':c['LOSS'],'T':c['TIE'],'accuracy':acc(c)}

def group(rows,key):
    d=defaultdict(list)
    for r in rows:d[str(key(r))].append(r)
    return {k:rc(v) for k,v in sorted(d.items())}

def streaks(rows):
    bestw=bestl=cw=cl=0
    for r in rows:
        x=r.get('result')
        if x=='WIN': cw+=1;cl=0;bestw=max(bestw,cw)
        elif x=='LOSS':cl+=1;cw=0;bestl=max(bestl,cl)
        else:cw=cl=0
    return {'maxWin':bestw,'maxLoss':bestl}

def truth(r,path,default=False):
    x=r
    for p in path.split('.'):
        if not isinstance(x,dict):return default
        x=x.get(p)
    return bool(x)

def val(r,path,default=None):
    x=r
    for p in path.split('.'):
        if not isinstance(x,dict):return default
        x=x.get(p)
    return default if x is None else x

def flagperf(rows,path):
    yes=[r for r in rows if truth(r,path)]
    no=[r for r in rows if not truth(r,path)]
    return {'true':rc(yes)|{'n':len(yes)},'false':rc(no)|{'n':len(no)}}

def summarize(rows):
    rows=sorted(rows,key=lambda r:r.get('resolvedAt') or r.get('expiry') or r.get('signalBoundary') or 0)
    conf=[float(r.get('confidence',0) or 0) for r in rows]
    low=[r for r in rows if 57<=float(r.get('confidence',0) or 0)<62]
    high=[r for r in rows if float(r.get('confidence',0) or 0)>=62]
    exact=[r for r in rows if r.get('authoritativeBoundarySettlement') is True and r.get('settlementRule')=='EXACT_BOUNDARY_OPEN_TO_EXPIRY_CLOSE']
    feat=lambda r:r.get('features') or {}
    combo=Counter()
    for r in rows:
        f=feat(r)
        combo[(str(r.get('regime')),str(f.get('emaStack')),str(f.get('bbState')),str(f.get('dynamicZoneSide')),str(f.get('mtfOppositionCount')),str(f.get('entryLane')))] += 1
    top=[{'combo':'|'.join(k),'n':n} for k,n in combo.most_common(5)]
    losscombo=Counter()
    for r in rows:
        if r.get('result')!='LOSS':continue
        f=feat(r)
        tags=[]
        if f.get('lateCounterTrendRisk'):tags.append('LATE_COUNTERTREND')
        if f.get('lateCounterTrendAdverseZone'):tags.append('ADVERSE_ZONE')
        if (f.get('mtfOppositionCount') or 0)>=2:tags.append('MTF_CONFLICT')
        if f.get('bullExtended') or f.get('bearExtended'):tags.append('EXTENDED')
        if f.get('failureToProgress') or f.get('transitionFailureToProgress'):tags.append('FAIL_PROGRESS')
        if f.get('transitionRiskActive'):tags.append('TRANSITION_RISK')
        if f.get('unresolvedFvgAtSignal'):tags.append('UNRESOLVED_FVG')
        if f.get('microRangeChop'):tags.append('CHOP')
        if not tags:tags=['OTHER']
        losscombo['+'.join(tags)] += 1
    return {
      'results':rc(rows),'n':len(rows),'exactBoundaryN':len(exact),'confidenceMean':round(sum(conf)/len(conf),1) if conf else None,'streaks':streaks(rows),
      'thresholdBuckets':{'57_61_9':rc(low)|{'n':len(low)},'gte62':rc(high)|{'n':len(high)}},
      'direction':group(rows,lambda r:r.get('direction','UNKNOWN')),
      'regime':group(rows,lambda r:r.get('regime','UNKNOWN')),
      'entryLane':group(rows,lambda r:val(r,'features.entryLane',r.get('entryLane','UNKNOWN'))),
      'emaStack':group(rows,lambda r:val(r,'features.emaStack','UNKNOWN')),
      'bbState':group(rows,lambda r:val(r,'features.bbState','UNKNOWN')),
      'fvgState':group(rows,lambda r:val(r,'features.activeFvgState','NONE')),
      'sr':group(rows,lambda r:val(r,'features.sr','UNKNOWN')),
      'mtfConflict':flagperf(rows,'features.lateCounterTrendMtfOpposition'),
      'mtfOpposition2Plus':{'yes':rc([r for r in rows if (val(r,'features.mtfOppositionCount',0) or 0)>=2])|{'n':sum((val(r,'features.mtfOppositionCount',0) or 0)>=2 for r in rows)},'no':rc([r for r in rows if (val(r,'features.mtfOppositionCount',0) or 0)<2])|{'n':sum((val(r,'features.mtfOppositionCount',0) or 0)<2 for r in rows)}},
      'adverseZone':flagperf(rows,'features.lateCounterTrendAdverseZone'),
      'extended':{'yes':rc([r for r in rows if truth(r,'features.bullExtended') or truth(r,'features.bearExtended')])|{'n':sum(truth(r,'features.bullExtended') or truth(r,'features.bearExtended') for r in rows)}},
      'failureToProgress':flagperf(rows,'features.failureToProgress'),
      'transitionRisk':flagperf(rows,'features.transitionRiskActive'),
      'lateCounterTrendRisk':flagperf(rows,'features.lateCounterTrendRisk'),
      'continuationResetRequired':flagperf(rows,'features.continuationResetRequired'),
      'breakoutAccepted':flagperf(rows,'features.breakoutAccepted'),
      'tickAgreement':flagperf(rows,'features.forexTickAgreement'),
      'maBbPositive':{'yes':rc([r for r in rows if float(val(r,'features.maBbConfirmation',0) or 0)>0])|{'n':sum(float(val(r,'features.maBbConfirmation',0) or 0)>0 for r in rows)}},
      'topFeatureCombos':top,'lossFailureCombos':[{'combo':k,'n':n} for k,n in losscombo.most_common(6)]
    }

def main():
    batches={}
    for p in sorted(glob.glob('audit/new-batches/*.json')):
        m=re.search(r'/([a-z]+)-(\d+)m-batch-(\d+)\.json$',p)
        if not m:continue
        pair=m.group(1).upper(); h=int(m.group(2)); b=int(m.group(3))
        rows=json.load(open(p))
        batches[f'{pair}-{h}M-B{b}']={'pair':pair,'horizon':h,'batch':b,**summarize(rows)}
    cumulative={}
    for pair in ['EURUSD','GBPUSD','EURJPY','USDJPY','AUDUSD']:
        data=json.load(open(f'audit/resolved/{pair.lower()}.json'))
        for h in [1,2,3,5,15]:
            rows=[r for r in data if int(r.get('horizon',0) or 0)==h and int(r.get('resolvedAt') or r.get('expiry') or r.get('signalBoundary') or 0)>BASELINE_MS]
            if rows:cumulative[f'{pair}-{h}M']=summarize(rows)
    out={'generatedAt':__import__('datetime').datetime.utcnow().isoformat()+'Z','baselineMs':BASELINE_MS,'batches':batches,'cumulativePostBaseline':cumulative}
    json.dump(out,open('audit/new-batch-metrics.json','w'),indent=2)
if __name__=='__main__':main()
