import test from 'node:test';
import assert from 'node:assert/strict';
import {tuneFrequencyScore} from '../lib/frequencyScoring.js';
import {assessScoreRedistribution} from '../lib/scoreRedistribution.js';
import {assessContinuationReset} from '../lib/decisionFusion.js';

const stale={
  pair:'EURJPY',horizon:2,direction:'BUY',confidence:72,evidenceScore:.8,qualified:true,tradeQualified:true,
  features:{
    progressScore:-2,failureToProgress:true,moveQualityScore:5.8,groupConsensusDirection:'BUY',groupDominance:.8,
    groupConsensusVotes:3,groupOpposingVotes:0,mtfOppositionCount:2,dynamicZoneSide:'RESISTANCE',
    activeFvgState:'FULLY_MITIGATED',lateContinuationRisk:true,efficiency:.12
  }
};

test('failed-progress compound state cannot retain positive evidence and consensus support',()=>{
  const out=tuneFrequencyScore(stale);
  assert.equal(out.features.frequencyStaleCompoundOverride,true);
  assert.ok(out.features.frequencyEvidenceSupportApplied<=.5);
  assert.ok(out.features.frequencyConsensusSupportApplied<=.5);
  assert.ok(!out.features.frequencyFreshEvidence.includes('FVG_RESOLVED_CONFIRMED'));
  assert.equal(out.qualified,true);
  assert.equal(out.tradeQualified,true);
});

test('resolved FVG receives no score bonus without confirmed progress',()=>{
  const score=assessScoreRedistribution(stale.features,{},'BUY',2);
  assert.equal(score.fvgResolved,true);
  assert.equal(score.fvgResolvedConfirmed,false);
  assert.doesNotMatch(score.bonusTags,/FVG_RESOLVED/);
});

test('resolved FVG cannot bypass a required continuation reset while stalled',()=>{
  const reset=assessContinuationReset(stale.features,{},'BUY',2);
  assert.equal(reset.fvgResolved,true);
  assert.equal(reset.fvgResolvedConfirmed,false);
  assert.equal(reset.freshEvidence,false);
  assert.equal(reset.active,true);
  assert.ok(reset.tags.includes('FVG_STATE_RESOLVED_UNCONFIRMED'));
});

test('resolved FVG is confirmed when direction, progress and quality agree',()=>{
  const features={...stale.features,progressScore:5,failureToProgress:false,moveQualityScore:6.4,mtfOppositionCount:0,dynamicZoneSide:'CLEAR',lateContinuationRisk:false,efficiency:.34};
  const score=assessScoreRedistribution(features,{},'BUY',2);
  const reset=assessContinuationReset(features,{},'BUY',2);
  assert.equal(score.fvgResolvedConfirmed,true);
  assert.match(score.bonusTags,/FVG_RESOLVED_CONFIRMED/);
  assert.equal(reset.fvgResolvedConfirmed,true);
});
