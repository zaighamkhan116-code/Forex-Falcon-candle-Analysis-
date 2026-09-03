#!/usr/bin/env python3
import json,re
src=json.load(open('audit/new-batch-metrics.json'))
state=json.load(open('audit/automation-state-20-batch.json'))
def pick(x):
    return {k:x.get(k) for k in ('W','L','T','accuracy','n') if k in x}
def compact(m):
    return {
      'results':pick(m['results'])|{'n':m.get('n')},'exactBoundaryN':m.get('exactBoundaryN'),'confidenceMean':m.get('confidenceMean'),'streaks':m.get('streaks'),
      'low57_61_9':pick(m['thresholdBuckets']['57_61_9']),'gte62':pick(m['thresholdBuckets']['gte62']),
      'direction':m.get('direction'),'regime':m.get('regime'),'entryLane':m.get('entryLane'),
      'emaStack':m.get('emaStack'),'bbState':m.get('bbState'),'fvgState':m.get('fvgState'),'sr':m.get('sr'),
      'mtf2plus':m.get('mtfOpposition2Plus'),'adverseZone':m.get('adverseZone'),'transitionRisk':m.get('transitionRisk'),'lateCounterTrendRisk':m.get('lateCounterTrendRisk'),'continuationResetRequired':m.get('continuationResetRequired'),'breakoutAccepted':m.get('breakoutAccepted'),'tickAgreement':m.get('tickAgreement'),'maBbPositive':m.get('maBbPositive'),'lossFailureCombos':m.get('lossFailureCombos')
    }
def brief(m):
    return {
      'results':pick(m['results'])|{'n':m.get('n')},'exactBoundaryN':m.get('exactBoundaryN'),'confidenceMean':m.get('confidenceMean'),'streaks':m.get('streaks'),
      'low57_61_9':pick(m['thresholdBuckets']['57_61_9']),'gte62':pick(m['thresholdBuckets']['gte62']),
      'direction':m.get('direction'),'regime':m.get('regime'),'entryLane':m.get('entryLane'),
      'mtf2plus':m.get('mtfOpposition2Plus'),'adverseZone':m.get('adverseZone'),'transitionRisk':m.get('transitionRisk'),'lateCounterTrendRisk':m.get('lateCounterTrendRisk'),'continuationResetRequired':m.get('continuationResetRequired'),'breakoutAccepted':m.get('breakoutAccepted'),'tickAgreement':m.get('tickAgreement'),'maBbPositive':m.get('maBbPositive'),'lossFailureCombos':m.get('lossFailureCombos')
    }
def fmt(x):
    if not x or not x.get('n'): return '-'
    return f"{x.get('W',0)}/{x.get('L',0)}/{x.get('T',0)} {x.get('accuracy')}% n={x.get('n')}"
def splits(x):
    if not isinstance(x,dict): return '-'
    parts=[]
    for k,v in x.items():
        if isinstance(v,dict) and ('accuracy' in v or 'W' in v):
            n=v.get('n', (v.get('W',0)+v.get('L',0)+v.get('T',0)))
            parts.append(f"{k}:{v.get('accuracy')}%(n={n})")
    return ','.join(parts) if parts else '-'
all_batches={k:compact(v) for k,v in src['batches'].items()}
out={'generatedAt':src.get('generatedAt'),'batches':all_batches,'tracks':{k:compact(v) for k,v in src['cumulativePostBaseline'].items()}}
json.dump(out,open('audit/new-batch-scorecard.json','w'),separators=(',',':'))
reported=state.get('reportedBatches',{})
unreported={}; unreported_brief={}; table=[]; detail=[]
for k,v in src['batches'].items():
    m=re.match(r'^([A-Z]+)-(\d+)M-B(\d+)$',k)
    if not m: continue
    track=f'{m.group(1)}-{m.group(2)}M'; batch=int(m.group(3))
    if batch>int(reported.get(track,0) or 0):
        unreported[k]=compact(v); unreported_brief[k]=brief(v)
        cum=src.get('cumulativePostBaseline',{}).get(track,{})
        row={
          'track':track,'batch':batch,'results':pick(v['results'])|{'n':v.get('n')},
          'low57_61_9':pick(v['thresholdBuckets']['57_61_9']),'gte62':pick(v['thresholdBuckets']['gte62']),
          'cumulative':pick(cum.get('results',{}))|{'n':cum.get('n')},
          'maxLoss':(v.get('streaks') or {}).get('maxLoss'),
          'direction':v.get('direction'),'regime':v.get('regime'),
          'adverseZone':v.get('adverseZone'),'mtf2plus':v.get('mtfOpposition2Plus'),
          'transitionRisk':v.get('transitionRisk'),'lateCounterTrendRisk':v.get('lateCounterTrendRisk'),
          'continuationResetRequired':v.get('continuationResetRequired'),'breakoutAccepted':v.get('breakoutAccepted'),
          'tickAgreement':v.get('tickAgreement'),'maBbPositive':v.get('maBbPositive'),
          'lossFailureCombos':v.get('lossFailureCombos')
        }
        table.append(row)
        detail.append((track,batch,v))
tracks={track:compact(src['cumulativePostBaseline'][track]) for track in sorted({re.sub(r'-B\d+$','',k) for k in unreported}) if track in src['cumulativePostBaseline']}
track_brief={track:brief(src['cumulativePostBaseline'][track]) for track in tracks}
json.dump({'generatedAt':src.get('generatedAt'),'batches':unreported,'tracks':tracks},open('audit/unreported-batch-scorecard.json','w'),indent=2)
json.dump({'generatedAt':src.get('generatedAt'),'batches':unreported_brief,'tracks':track_brief},open('audit/unreported-batch-brief.json','w'),indent=2)
table=sorted(table,key=lambda x:(x['track'],x['batch']))
json.dump({'generatedAt':src.get('generatedAt'),'rows':table},open('audit/unreported-batch-table.json','w'),indent=2)
with open('audit/unreported-batch-table.txt','w') as fp:
    fp.write('track|batch|W/L/T acc|57-61.9|>=62|cumulative|maxLoss\n')
    for r in table:
        fp.write(f"{r['track']}|B{r['batch']}|{fmt(r['results'])}|{fmt(r['low57_61_9'])}|{fmt(r['gte62'])}|{fmt(r['cumulative'])}|{r['maxLoss']}\n")
with open('audit/unreported-batch-diagnostics.txt','w') as fp:
    fp.write('track|batch|direction|regime|EMAstack|BB|FVG|SR|MTF2+|adverse|transition|lateCT|reset|breakout|tick|MA_BB|lossCombos\n')
    for track,batch,v in sorted(detail,key=lambda x:(x[0],x[1])):
        combos=','.join(f"{z.get('combo')}:{z.get('n')}" for z in (v.get('lossFailureCombos') or [])[:4]) or '-'
        fp.write('|'.join([
          track,f'B{batch}',splits(v.get('direction')),splits(v.get('regime')),splits(v.get('emaStack')),splits(v.get('bbState')),splits(v.get('fvgState')),splits(v.get('sr')),
          splits(v.get('mtfOpposition2Plus')),splits(v.get('adverseZone')),splits(v.get('transitionRisk')),splits(v.get('lateCounterTrendRisk')),splits(v.get('continuationResetRequired')),splits(v.get('breakoutAccepted')),splits(v.get('tickAgreement')),splits(v.get('maBbPositive')),combos
        ])+'\n')
