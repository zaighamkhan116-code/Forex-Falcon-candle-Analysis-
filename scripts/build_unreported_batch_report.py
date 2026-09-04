#!/usr/bin/env python3
import json, os, re, math
from collections import Counter, defaultdict

STATE='audit/automation-state-20-batch.json'
STATUS='audit/exact-20-batch-status.json'
METRICS='audit/new-batch-metrics.json'
OUTDIR='audit/unreported-report'

with open(STATE) as f: state=json.load(f)
with open(STATUS) as f: status=json.load(f)
with open(METRICS) as f: metrics=json.load(f)
os.makedirs(OUTDIR, exist_ok=True)


def result_counts(rows):
    c=Counter(str(r.get('result','UNKNOWN')) for r in rows)
    d=c['WIN']+c['LOSS']
    return {'W':c['WIN'],'L':c['LOSS'],'T':c['TIE'],'n':len(rows),'wr':round(100*c['WIN']/d,1) if d else None}

def feat(r): return r.get('features') or {}
def num(x):
    try:
        v=float(x)
        return v if math.isfinite(v) else None
    except: return None

def group(rows, getter):
    d=defaultdict(list)
    for r in rows: d[str(getter(r))].append(r)
    return {k:result_counts(v) for k,v in sorted(d.items())}

def rate(rows, pred):
    return round(100*sum(1 for r in rows if pred(r))/len(rows),1) if rows else None

def avg(rows, getter):
    vals=[num(getter(r)) for r in rows]
    vals=[v for v in vals if v is not None]
    return round(sum(vals)/len(vals),5) if vals else None

def profile(rows):
    return {
      'results':result_counts(rows),
      'avgConfidence':avg(rows,lambda r:r.get('confidence')),
      'direction':group(rows,lambda r:r.get('direction','UNKNOWN')),
      'regime':group(rows,lambda r:r.get('regime','UNKNOWN')),
      'entryLane':group(rows,lambda r:feat(r).get('entryLane',r.get('entryLane','UNKNOWN'))),
      'sr':group(rows,lambda r:feat(r).get('sr','UNKNOWN')),
      'fvgState':group(rows,lambda r:feat(r).get('activeFvgState','NONE')),
      'emaStack':group(rows,lambda r:feat(r).get('emaStack','UNKNOWN')),
      'bbState':group(rows,lambda r:feat(r).get('bbState','UNKNOWN')),
      'latePct':rate(rows,lambda r:bool(feat(r).get('lateCounterTrendRisk'))),
      'adversePct':rate(rows,lambda r:bool(feat(r).get('lateCounterTrendAdverseZone'))),
      'mtfOpp2Pct':rate(rows,lambda r:(num(feat(r).get('mtfOppositionCount')) or 0)>=2),
      'transitionPct':rate(rows,lambda r:bool(feat(r).get('transitionRiskActive'))),
      'extendedPct':rate(rows,lambda r:bool(feat(r).get('bullExtended')) or bool(feat(r).get('bearExtended'))),
      'failProgressPct':rate(rows,lambda r:bool(feat(r).get('failureToProgress')) or bool(feat(r).get('transitionFailureToProgress'))),
      'breakoutAcceptedPct':rate(rows,lambda r:bool(feat(r).get('breakoutAccepted'))),
      'tickAgreementPct':rate(rows,lambda r:bool(feat(r).get('forexTickAgreement'))),
      'maBbPositivePct':rate(rows,lambda r:(num(feat(r).get('maBbConfirmation')) or 0)>0),
      'avgEfficiency':avg(rows,lambda r:feat(r).get('efficiency')),
      'avgMoveQuality':avg(rows,lambda r:feat(r).get('moveQualityScore')),
      'avgProgress':avg(rows,lambda r:feat(r).get('progressScore')),
      'avgEmaCompression':avg(rows,lambda r:feat(r).get('emaCompression')),
      'avgBbWidth':avg(rows,lambda r:feat(r).get('bbWidth')),
      'avgBbExpansion':avg(rows,lambda r:feat(r).get('bbExpansion')),
      'avgMaBb':avg(rows,lambda r:feat(r).get('maBbConfirmation')),
      'avgAtr':avg(rows,lambda r:feat(r).get('atr')),
      'avgVolatility':avg(rows,lambda r:feat(r).get('volatility')),
    }

def numeric_feature_avgs(rows, regex):
    keys=set()
    rx=re.compile(regex,re.I)
    for r in rows:
        for k,v in feat(r).items():
            if rx.search(k) and num(v) is not None: keys.add(k)
    out={}
    for k in sorted(keys):
        av=avg(rows,lambda r,k=k:feat(r).get(k))
        if av is not None: out[k]=av
    return out

def categorical_feature_counts(rows, regex):
    keys=set();rx=re.compile(regex,re.I)
    for r in rows:
        for k,v in feat(r).items():
            if rx.search(k) and isinstance(v,str): keys.add(k)
    out={}
    for k in sorted(keys):
        c=Counter(str(feat(r).get(k,'NONE')) for r in rows)
        out[k]=dict(c.most_common(6))
    return out

def feature_outcomes(rows):
    win=[r for r in rows if r.get('result')=='WIN']; loss=[r for r in rows if r.get('result')=='LOSS']
    rx='atr|vwap|vsa|volume|range|wick|body|momentum|sequence|tick|emaSlope|emaCompression|bbWidth|bbExpansion|maBb|progress|efficiency'
    return {
      'winNumeric':numeric_feature_avgs(win,rx),
      'lossNumeric':numeric_feature_avgs(loss,rx),
      'winCategorical':categorical_feature_counts(win,'vwap|vsa|volume|range|momentum|tick|bbState|emaStack|maBbTags'),
      'lossCategorical':categorical_feature_counts(loss,'vwap|vsa|volume|range|momentum|tick|bbState|emaStack|maBbTags')
    }

pairs=['EURUSD','GBPUSD','EURJPY','USDJPY','AUDUSD']
summary={'generatedAt':metrics.get('generatedAt'),'previousReportedAt':state.get('lastReportedAt'),'newBatchCount':0,'tracks':{},'pairs':{}}
for pair in pairs:
    pdata={'pair':pair,'tracks':{}}
    for h in [1,2,3,5,15]:
        key=f'{pair}-{h}M'; prev=int(state['reportedBatches'].get(key,0)); curr=int(status['tracks'][key]['completed20Batches'])
        if curr<=prev: continue
        t={'previousReportedBatch':prev,'currentCompletedBatch':curr,'newBatches':[]}
        for b in range(prev+1,curr+1):
            bkey=f'{pair}-{h}M-B{b}'
            path=f'audit/new-batches/{pair.lower()}-{h}m-batch-{b}.json'
            with open(path) as f: rows=json.load(f)
            m=metrics['batches'].get(bkey,{})
            low=[r for r in rows if 57<=float(r.get('confidence',0) or 0)<62]
            high=[r for r in rows if float(r.get('confidence',0) or 0)>=62]
            exact=[r for r in rows if r.get('authoritativeBoundarySettlement') is True and r.get('settlementRule')=='EXACT_BOUNDARY_OPEN_TO_EXPIRY_CLOSE']
            rec={
              'batch':b,'results':result_counts(rows),'exactBoundaryN':len(exact),
              'confidenceMean':m.get('confidenceMean'),'streaks':m.get('streaks'),
              'threshold':{'57_61_9':profile(low),'gte62':profile(high)},
              'direction':m.get('direction'),'regime':m.get('regime'),'entryLane':m.get('entryLane'),
              'emaStack':m.get('emaStack'),'bbState':m.get('bbState'),'fvgState':m.get('fvgState'),'sr':m.get('sr'),
              'mtfOpposition2Plus':m.get('mtfOpposition2Plus'),'adverseZone':m.get('adverseZone'),'extended':m.get('extended'),
              'failureToProgress':m.get('failureToProgress'),'transitionRisk':m.get('transitionRisk'),'lateCounterTrendRisk':m.get('lateCounterTrendRisk'),
              'continuationResetRequired':m.get('continuationResetRequired'),'breakoutAccepted':m.get('breakoutAccepted'),'tickAgreement':m.get('tickAgreement'),
              'maBbPositive':m.get('maBbPositive'),'lossFailureCombos':m.get('lossFailureCombos'),'topFeatureCombos':m.get('topFeatureCombos'),
              'featureOutcomes':feature_outcomes(rows)
            }
            t['newBatches'].append(rec); summary['newBatchCount']+=1
        cum=metrics['cumulativePostBaseline'].get(key,{})
        t['cumulative']={k:cum.get(k) for k in ['results','n','confidenceMean','streaks','thresholdBuckets','direction','regime','entryLane','emaStack','bbState','fvgState','sr','mtfOpposition2Plus','adverseZone','extended','failureToProgress','transitionRisk','lateCounterTrendRisk','continuationResetRequired','breakoutAccepted','tickAgreement','maBbPositive','lossFailureCombos']}
        pdata['tracks'][key]=t
        summary['tracks'][key]={'previousReportedBatch':prev,'currentCompletedBatch':curr,'newBatchCount':curr-prev,'cumulative':t['cumulative'].get('results')}
    summary['pairs'][pair]=list(pdata['tracks'])
    with open(f'{OUTDIR}/{pair.lower()}.json','w') as f: json.dump(pdata,f,indent=2)
with open(f'{OUTDIR}/summary.json','w') as f: json.dump(summary,f,indent=2)
