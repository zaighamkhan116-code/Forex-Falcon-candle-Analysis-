#!/usr/bin/env python3
import json
src=json.load(open('audit/new-batch-metrics.json'))
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
out={'generatedAt':src.get('generatedAt'),'batches':{k:compact(v) for k,v in src['batches'].items()},'tracks':{k:compact(v) for k,v in src['cumulativePostBaseline'].items()}}
json.dump(out,open('audit/new-batch-scorecard.json','w'),separators=(',',':'))
