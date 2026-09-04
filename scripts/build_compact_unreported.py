#!/usr/bin/env python3
import json, os
OUT='audit/unreported-report'

def cond_delta(obj):
    if not isinstance(obj,dict): return None
    a=obj.get('true') or obj.get('yes'); b=obj.get('false') or obj.get('no')
    if not a or not b: return None
    if a.get('accuracy') is None or b.get('accuracy') is None:return None
    return {'on':a,'off':b,'delta':round(a['accuracy']-b['accuracy'],1)}

def bestworst(obj):
    if not isinstance(obj,dict):return None
    vals=[(k,v) for k,v in obj.items() if isinstance(v,dict) and v.get('accuracy') is not None and (v.get('W',0)+v.get('L',0))>=2]
    if not vals:return None
    vals=sorted(vals,key=lambda kv:kv[1]['accuracy'])
    return {'worst':{vals[0][0]:vals[0][1]},'best':{vals[-1][0]:vals[-1][1]}}

def feature_diff(fo):
    w=(fo or {}).get('winNumeric') or {}; l=(fo or {}).get('lossNumeric') or {}
    keep={}
    for k in sorted(set(w)&set(l)):
        if any(x in k.lower() for x in ['atr','vwap','vsa','volume','range','wick','body','momentum','sequence','tick','emaslope','emacompression','bbwidth','bbexpansion','mabb','progress','efficiency']):
            keep[k]={'win':w[k],'loss':l[k],'delta':round(w[k]-l[k],6)}
    return dict(list(keep.items())[:14])

compact={'newBatchCount':0,'batches':[],'tracks':{}}
for pair in ['eurusd','gbpusd','eurjpy','usdjpy','audusd']:
    p=f'{OUT}/{pair}.json'
    if not os.path.exists(p):continue
    data=json.load(open(p))
    for key,t in data.get('tracks',{}).items():
        compact['tracks'][key]={'cumulative':t.get('cumulative',{}).get('results'),'thresholdCumulative':t.get('cumulative',{}).get('thresholdBuckets')}
        for r in t.get('newBatches',[]):
            low=r['threshold']['57_61_9']; high=r['threshold']['gte62']
            compact['batches'].append({
              'track':key,'batch':r['batch'],'results':r['results'],'exactBoundaryN':r['exactBoundaryN'],'confidenceMean':r.get('confidenceMean'),'streaks':r.get('streaks'),
              'low':{'results':low['results'],'direction':low['direction'],'regime':low['regime'],'sr':low['sr'],'latePct':low['latePct'],'adversePct':low['adversePct'],'mtfOpp2Pct':low['mtfOpp2Pct'],'transitionPct':low['transitionPct'],'extendedPct':low['extendedPct'],'failProgressPct':low['failProgressPct'],'avgEfficiency':low['avgEfficiency'],'avgMoveQuality':low['avgMoveQuality'],'avgProgress':low['avgProgress']},
              'high':{'results':high['results'],'direction':high['direction'],'regime':high['regime'],'sr':high['sr'],'latePct':high['latePct'],'adversePct':high['adversePct'],'mtfOpp2Pct':high['mtfOpp2Pct'],'transitionPct':high['transitionPct'],'extendedPct':high['extendedPct'],'failProgressPct':high['failProgressPct'],'avgEfficiency':high['avgEfficiency'],'avgMoveQuality':high['avgMoveQuality'],'avgProgress':high['avgProgress']},
              'direction':r.get('direction'),'regime':r.get('regime'),
              'riskDeltas':{k:cond_delta(r.get(k)) for k in ['transitionRisk','adverseZone','failureToProgress','lateCounterTrendRisk','continuationResetRequired','breakoutAccepted','tickAgreement']},
              'mtfOpposition2Plus':r.get('mtfOpposition2Plus'),
              'groupExtremes':{k:bestworst(r.get(k)) for k in ['emaStack','bbState','fvgState','sr','entryLane']},
              'maBbPositive':r.get('maBbPositive'),'extended':r.get('extended'),
              'lossFailureCombos':(r.get('lossFailureCombos') or [])[:4],
              'featureDiffs':feature_diff(r.get('featureOutcomes'))
            })
            compact['newBatchCount']+=1
json.dump(compact,open(f'{OUT}/compact.json','w'),indent=2)
