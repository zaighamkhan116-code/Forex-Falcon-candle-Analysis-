#!/usr/bin/env python3
import json, os
OUT='audit/unreported-report'

def acc(x):
    if not x:return None
    return x.get('accuracy',x.get('wr'))
def n(x):
    if not x:return 0
    return x.get('n',(x.get('W',0)+x.get('L',0)+x.get('T',0)))
def fmt_cond(name,obj):
    if not obj:return None
    yes=obj.get('true') or obj.get('yes'); no=obj.get('false') or obj.get('no')
    if not yes or not no or acc(yes) is None or acc(no) is None:return None
    return {'name':name,'yes':acc(yes),'yn':n(yes),'no':acc(no),'nn':n(no),'delta':round(acc(yes)-acc(no),1)}
def extreme(group):
    vals=[(k,v) for k,v in (group or {}).items() if acc(v) is not None and (v.get('W',0)+v.get('L',0))>=2]
    if not vals:return None
    lo=min(vals,key=lambda z:acc(z[1])); hi=max(vals,key=lambda z:acc(z[1]))
    return {'best':[hi[0],acc(hi[1]),n(hi[1])],'worst':[lo[0],acc(lo[1]),n(lo[1])]}
def fdiff(fo,key):
    w=(fo or {}).get('winNumeric',{});l=(fo or {}).get('lossNumeric',{})
    if key not in w or key not in l:return None
    return [w[key],l[key],round(w[key]-l[key],6)]
lines=[]
for pair in ['eurusd','gbpusd','eurjpy','usdjpy','audusd']:
    p=json.load(open(f'{OUT}/{pair}.json'))
    for track,t in p['tracks'].items():
        r=t['newBatches'][0]; low=r['threshold']['57_61_9']; high=r['threshold']['gte62']; cum=t['cumulative']['results']
        conds=[]
        for name,key in [('transition','transitionRisk'),('adverse','adverseZone'),('failProgress','failureToProgress'),('late','lateCounterTrendRisk'),('breakout','breakoutAccepted'),('tick','tickAgreement')]:
            z=fmt_cond(name,r.get(key));
            if z: conds.append(z)
        mtf=r.get('mtfOpposition2Plus') or {}; z=fmt_cond('mtf2',{'yes':mtf.get('yes'),'no':mtf.get('no')});
        if z:conds.append(z)
        conds=sorted(conds,key=lambda x:abs(x['delta']),reverse=True)[:3]
        fo=r.get('featureOutcomes') or {}
        features={k:fdiff(fo,k) for k in ['atrNormalized','rangeAtr','bodyAtr','vwapDistanceAtr','vwapSlopeAtr','vsaScore','relativeVolume','advancedMomentumScore','sequence','efficiency','emaCompression','bbExpansion','maBbConfirmation']}
        features={k:v for k,v in features.items() if v is not None}
        lines.append({'track':track,'B':r['batch'],'R':r['results'],'low':low['results'],'high':high['results'],'cum':cum,'streaks':r.get('streaks'),'direction':extreme(r.get('direction')),'regime':extreme(r.get('regime')),'ema':extreme(r.get('emaStack')),'bb':extreme(r.get('bbState')),'fvg':extreme(r.get('fvgState')),'sr':extreme(r.get('sr')),'conds':conds,'loss':(r.get('lossFailureCombos') or [])[:2],'features':features,'lowProfile':{k:low.get(k) for k in ['latePct','adversePct','mtfOpp2Pct','transitionPct','extendedPct','failProgressPct','avgEfficiency','avgMoveQuality','avgProgress']},'highProfile':{k:high.get(k) for k in ['latePct','adversePct','mtfOpp2Pct','transitionPct','extendedPct','failProgressPct','avgEfficiency','avgMoveQuality','avgProgress']}})
json.dump({'count':len(lines),'lines':lines},open(f'{OUT}/line-digest.json','w'),indent=2)
