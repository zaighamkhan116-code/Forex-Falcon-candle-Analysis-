import test from 'node:test';
import assert from 'node:assert/strict';
import {qualificationSummary} from '../lib/decisionFusion.js';
import {diagnoseLoss,applyLossContext} from '../lib/lossLearning.js';

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
