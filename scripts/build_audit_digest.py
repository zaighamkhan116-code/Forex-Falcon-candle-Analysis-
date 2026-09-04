#!/usr/bin/env python3
import json, os
OUT='audit/unreported-report'
summary=json.load(open(f'{OUT}/summary.json'))

def rr(x):
    if not isinstance(x,dict): return None
    return {k:x.get(k) for k in ['W','L','T','n','wr','accuracy'] if k in x}

def risk(x):
    if not x:return None
    return {'on':rr(x.get('on')),'off':rr(x.get('off')),'delta':x.get('delta')}

def threshold(p):
    return {'results':rr(p.get('results')),'late':p.get('latePct'),'adverse':p.get('adversePct'),'mtf2':p.get('mtfOpp2Pct'),'transition':p.get('transitionPct'),'extended':p.get('extendedPct'),'failProgress':p.get('failProgressPct'),'eff':p.get('avgEfficiency'),'moveQ':p.get('avgMoveQuality'),'progress':p.get('avgProgress'),'direction':p.get('direction'),'regime':p.get('regime'),'sr':p.get('sr')}

def pick_features(fo):
    w=(fo or {}).get('winNumeric') or {}; l=(fo or {}).get('lossNumeric') or {}
    wanted=['atr14','atrNormalized','rangeAtr','bodyAtr','vwapDistanceAtr','vwapSlopeAtr','vwapExtensionAtr','vwapScore','vsaScore','vsaEffortResult','relativeVolume','candleBodyRatio','lastUpperWickRatio','lastLowerWickRatio','advancedMomentumScore','sequence','efficiency','progressScore','emaSlope5','emaSlope8','emaSlope13','emaSlope20','emaCompression','bbWidth','bbExpansion','maBbConfirmation']
    out={}
    lowmap={k.lower():k for k in set(w)|set(l)}
    for target in wanted:
        key=lowmap.get(target.lower())
        if key and key in w and key in l: out[key]={'W':w[key],'L':l[key],'d':round(w[key]-l[key],6)}
    # catch other VWAP/VSA fields
    for key in sorted(set(w)&set(l)):
        if ('vwap' in key.lower() or 'vsa' in key.lower()) and key not in out:
            out[key]={'W':w[key],'L':l[key],'d':round(w[key]-l[key],6)}
    return out

def extreme_simple(x):
    if not x:return None
    out={}
    for side in ['worst','best']:
        z=x.get(side)
        if not z:continue
        k=next(iter(z)); out[side]={k:rr(z[k])}
    return out

table=[]
for pair in ['eurusd','gbpusd','eurjpy','usdjpy','audusd']:
    p=json.load(open(f'{OUT}/{pair}.json'))
    digest={'pair':p['pair'],'tracks':{}}
    for key,t in p['tracks'].items():
        cum=t.get('cumulative',{}).get('results')
        for r in t['newBatches']:
            table.append({'track':key,'B':r['batch'],'R':rr(r['results']),'low':rr(r['threshold']['57_61_9']['results']),'high':rr(r['threshold']['gte62']['results']),'cum':rr(cum),'streaks':r.get('streaks'),'exact':r.get('exactBoundaryN')})
            digest['tracks'][key]={
              'batch':r['batch'],'results':rr(r['results']),'cumulative':rr(cum),'confidenceMean':r.get('confidenceMean'),'streaks':r.get('streaks'),
              'low':threshold(r['threshold']['57_61_9']),'high':threshold(r['threshold']['gte62']),
              'direction':r.get('direction'),'regime':r.get('regime'),
              'transition':risk({'on':r.get('transitionRisk',{}).get('true'),'off':r.get('transitionRisk',{}).get('false'),'delta':None} if r.get('transitionRisk') else None),
              'adverse':risk({'on':r.get('adverseZone',{}).get('true'),'off':r.get('adverseZone',{}).get('false'),'delta':None} if r.get('adverseZone') else None),
              'late':risk({'on':r.get('lateCounterTrendRisk',{}).get('true'),'off':r.get('lateCounterTrendRisk',{}).get('false'),'delta':None} if r.get('lateCounterTrendRisk') else None),
              'failProgress':risk({'on':r.get('failureToProgress',{}).get('true'),'off':r.get('failureToProgress',{}).get('false'),'delta':None} if r.get('failureToProgress') else None),
              'breakout':risk({'on':r.get('breakoutAccepted',{}).get('true'),'off':r.get('breakoutAccepted',{}).get('false'),'delta':None} if r.get('breakoutAccepted') else None),
              'tick':risk({'on':r.get('tickAgreement',{}).get('true'),'off':r.get('tickAgreement',{}).get('false'),'delta':None} if r.get('tickAgreement') else None),
              'mtf2':r.get('mtfOpposition2Plus'),'extended':r.get('extended'),'maBbPositive':r.get('maBbPositive'),
              'ema':extreme_simple({'worst':({k:v for k,v in (r.get('emaStack') or {}).items()} and {min((r.get('emaStack') or {}).items(),key=lambda kv:kv[1].get('accuracy') if kv[1].get('accuracy') is not None else 999)[0]:min((r.get('emaStack') or {}).items(),key=lambda kv:kv[1].get('accuracy') if kv[1].get('accuracy') is not None else 999)[1]}), 'best':({k:v for k,v in (r.get('emaStack') or {}).items()} and {max((r.get('emaStack') or {}).items(),key=lambda kv:kv[1].get('accuracy') if kv[1].get('accuracy') is not None else -1)[0]:max((r.get('emaStack') or {}).items(),key=lambda kv:kv[1].get('accuracy') if kv[1].get('accuracy') is not None else -1)[1]})} if r.get('emaStack') else None),
              'bb':r.get('bbState'),'fvg':r.get('fvgState'),'sr':r.get('sr'),'lossCombos':(r.get('lossFailureCombos') or [])[:4],
              'features':pick_features(r.get('featureOutcomes'))
            }
    json.dump(digest,open(f'{OUT}/digest-{pair}.json','w'),indent=2)
json.dump({'newBatchCount':len(table),'table':table},open(f'{OUT}/table.json','w'),indent=2)
