import test from 'node:test';
import assert from 'node:assert/strict';
import {qualificationSummary} from '../lib/decisionFusion.js';
import {diagnoseLoss,applyLossContext} from '../lib/lossLearning.js';
import {rerankDirection,tuneFrequencyScore} from '../lib/frequencyScoring.js';

test('qualification defaults to 57 percent and exposes contradiction veto',()=>{
  const ok=qualificationSummary({confidence:57,qualified:true,features:{} });
  assert.equal(ok.minimumConfidence,57);
  assert.equal(ok.tradeQualified,true);
  const blocked=qualificationSummary({confidence:80,qualified:true,features:{highConfidenceContradictionGate:false}});
  assert.equal(blocked.tradeQualified,false);
  assert.match(blocked.vetoReasons.join('|'),/HIGH_CONFIDENCE_CONTRADICTION_GATE/);
});

test('two same-direction losses require fresh evidence before another same-direction entry',()=>{
  const baseSignal={pair:'EURUSD',horizon:1,direction:'SELL',probability:82,regime:'CHOPPY',features:{failureToProgress:true,moveQualityScore:4.5,sr:'AT SUPPORT'}};
  diagnoseLoss({...baseSignal,id:'loss-1'});
  const review=diagnoseLoss({...baseSignal,id:'loss-2'});
  assert.equal(review.adaptiveContextActivated,true);
  const candidate={direction:'SELL',confidence:80,qualified:true,tradeQualified:true,features:{failureToProgress:true,moveQualityScore:5,progressScore:0,groupConsensusVotes:2,groupOpposingVotes:1,groupDominance:.3,activeFvgState:'MITIGATING'}};
  const guarded=applyLossContext(candidate,'EURUSD',1).result;
  assert.equal(guarded.minimumConfidence,57);
  assert.equal(guarded.tradeQualified,false);
  assert.equal(guarded.features.repeatedDirectionGuard,true);
  assert.match(guarded.vetoReasons.join('|'),/REPEATED_DIRECTION_FRESH_EVIDENCE_GATE/);
});


test('frequency scoring keeps a rejected setup available without hiding its diagnostics',()=>{
  const signal={direction:'SELL',confidence:52,qualified:false,tradeQualified:false,vetoReasons:['TRANSITION_GATE','ENTRY_LANE_GATE'],evidenceScore:-.42,features:{moveQualityScore:5.8,groupDominance:.61,tickReliabilityScore:7}};
  const tuned=tuneFrequencyScore(signal);
  assert.equal(tuned.direction,'SELL');
  assert.equal(tuned.qualified,true);
  assert.equal(tuned.tradeQualified,true);
  assert.ok(tuned.confidence>=57);
  assert.deepEqual(tuned.vetoReasons,[]);
  assert.deepEqual(tuned.features.scoreOnlyWarnings,['TRANSITION_GATE','ENTRY_LANE_GATE']);
  assert.equal(tuned.features.frequencyPreserved,true);
});

test('targeted weak track reranks a strongly contradicted direction without removing the signal',()=>{
  const signal={pair:'EURUSD',horizon:1,direction:'BUY',confidence:76,qualified:false,tradeQualified:false,vetoReasons:['LATE_CONTINUATION_GATE'],evidenceScore:-.7,features:{horizon:1,evidenceScore:-.7,progressScore:-6,groupBullStrength:.1,groupBearStrength:1.1,groupConsensusDirection:'SELL',groupDominance:.7,dynamicZoneSide:'RESISTANCE',bullExtended:true,lastUpperWickRatio:.44,failureToProgress:true,mtfOppositionCount:2,moveQualityScore:5.2,tickReliabilityScore:5}};
  const rank=rerankDirection(signal),tuned=tuneFrequencyScore(signal);
  assert.equal(rank.reranked,true);
  assert.equal(tuned.direction,'SELL');
  assert.equal(tuned.features.originalDirection,'BUY');
  assert.equal(tuned.tradeQualified,true);
  assert.equal(tuned.features.quotaPreserved,true);
  assert.ok(tuned.confidence>=57);
});

test('non-target track preserves direction and every boundary remains qualified',()=>{
  const signal={pair:'AUDUSD',horizon:2,direction:'BUY',confidence:52,qualified:false,tradeQualified:false,vetoReasons:['FUSION_QUALITY_GATE'],evidenceScore:-1,features:{horizon:2,evidenceScore:-1,progressScore:-8,groupConsensusDirection:'SELL',groupBearStrength:2,groupBullStrength:0,groupDominance:1,moveQualityScore:4}};
  const tuned=tuneFrequencyScore(signal);
  assert.equal(tuned.direction,'BUY');
  assert.equal(tuned.features.directionRerankEligible,false);
  assert.equal(tuned.tradeQualified,true);
  assert.equal(tuned.features.frequencyPreserved,true);
});
