import json
from pathlib import Path

ROOT=Path('audit/unreported-report')
PAIRS=['eurusd','gbpusd','eurjpy','usdjpy','audusd']
FEATURES=['rangeAtr','bodyAtr','vwapDistanceAtr','vsaScore','relativeVolume','advancedMomentumScore','sequence','efficiency','emaCompression','bbExpansion','maBbConfirmation','progressScore']

def compact_bucket(b):
    if not b: return None
    return {
      'results': b.get('results'),
      'direction': b.get('direction'),
      'regime': b.get('regime'),
      'entryLane': b.get('entryLane'),
      'sr': b.get('sr'),
      'fvgState': b.get('fvgState'),
      'emaStack': b.get('emaStack'),
      'bbState': b.get('bbState'),
      'latePct': b.get('latePct'),'adversePct': b.get('adversePct'),'mtfOpp2Pct': b.get('mtfOpp2Pct'),
      'transitionPct': b.get('transitionPct'),'extendedPct': b.get('extendedPct'),'failProgressPct': b.get('failProgressPct'),
      'breakoutAcceptedPct': b.get('breakoutAcceptedPct'),'tickAgreementPct': b.get('tickAgreementPct'),'maBbPositivePct': b.get('maBbPositivePct'),
      'avgEfficiency': b.get('avgEfficiency'),'avgMoveQuality': b.get('avgMoveQuality'),'avgProgress': b.get('avgProgress'),
      'avgEmaCompression': b.get('avgEmaCompression'),'avgBbWidth': b.get('avgBbWidth'),'avgBbExpansion': b.get('avgBbExpansion'),'avgMaBb': b.get('avgMaBb')
    }

def feature_delta(batch):
    fo=(batch.get('featureOutcomes') or {})
    w=fo.get('winNumeric') or {}; l=fo.get('lossNumeric') or {}
    out={}
    for f in FEATURES:
        if f in w or f in l:
            a=w.get(f); b=l.get(f)
            try: d=None if a is None or b is None else round(float(a)-float(b),5)
            except: d=None
            out[f]=[a,b,d]
    return out

rows=[]; tracks={}
for p in PAIRS:
    fp=ROOT/f'{p}.json'
    if not fp.exists(): continue
    data=json.loads(fp.read_text())
    for track,t in (data.get('tracks') or {}).items():
        tracks[track]={'previousReportedBatch':t.get('previousReportedBatch'),'currentCompletedBatch':t.get('currentCompletedBatch'),'cumulative':t.get('cumulative')}
        for b in t.get('newBatches') or []:
            th=b.get('threshold') or {}
            rows.append({
              'track':track,'batch':b.get('batch'),'results':b.get('results'),'exactBoundaryN':b.get('exactBoundaryN'),
              'low':compact_bucket(th.get('57_61_9')),'high':compact_bucket(th.get('gte62')),
              'direction':b.get('direction'),'regime':b.get('regime'),'entryLane':b.get('entryLane'),'emaStack':b.get('emaStack'),'bbState':b.get('bbState'),
              'fvgState':b.get('fvgState'),'sr':b.get('sr'),'mtfOpposition2Plus':b.get('mtfOpposition2Plus'),'adverseZone':b.get('adverseZone'),
              'extended':b.get('extended'),'failureToProgress':b.get('failureToProgress'),'transitionRisk':b.get('transitionRisk'),
              'lateCounterTrendRisk':b.get('lateCounterTrendRisk'),'breakoutAccepted':b.get('breakoutAccepted'),'tickAgreement':b.get('tickAgreement'),
              'maBbPositive':b.get('maBbPositive'),'lossFailureCombos':b.get('lossFailureCombos'),'topFeatureCombos':b.get('topFeatureCombos'),
              'featureDelta':feature_delta(b)
            })
rows.sort(key=lambda x:(x['track'],x['batch'] or 0))
out={'count':len(rows),'tracks':tracks,'batches':rows}
(ROOT/'automation-digest.json').write_text(json.dumps(out,indent=2,sort_keys=False)+'\n')
print('wrote',len(rows),'batches')
