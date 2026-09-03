import test from 'node:test';
import assert from 'node:assert/strict';
import {rerankDirection,tuneFrequencyScore} from '../lib/frequencyScoring.js';

test('USDJPY 1M can rerank when opposite direction is materially stronger',()=>{
  const signal={
    pair:'USDJPY',horizon:1,direction:'BUY',confidence:70,evidenceScore:-0.9,
    features:{
      evidenceScore:-0.9,progressScore:-8,groupBullStrength:0.1,groupBearStrength:1.1,
      groupConsensusDirection:'SELL',groupDominance:0.9,moveQualityScore:6,
      tickReliabilityScore:7,forexTickDirection:'SELL'
    }
  };
  const rank=rerankDirection(signal);
  assert.equal(rank.eligible,true);
  assert.equal(rank.reranked,true);
  assert.equal(rank.direction,'SELL');
});

test('AUDUSD 2M is no longer excluded from direction reranking',()=>{
  const signal={
    pair:'AUDUSD',horizon:2,direction:'SELL',confidence:68,evidenceScore:0.85,
    features:{
      evidenceScore:0.85,progressScore:6,groupBullStrength:1,groupBearStrength:0,
      groupConsensusDirection:'BUY',groupDominance:0.8,moveQualityScore:6
    }
  };
  const rank=rerankDirection(signal);
  assert.equal(rank.eligible,true);
  assert.equal(rank.reranked,true);
  assert.equal(rank.direction,'BUY');
});

test('frequency score preserves warnings instead of clearing them',()=>{
  const out=tuneFrequencyScore({
    pair:'EURUSD',horizon:1,direction:'BUY',confidence:66,evidenceScore:0.5,
    vetoReasons:['EXTENDED_MOVE','WEAK_MOVE_QUALITY'],
    features:{evidenceScore:0.5,moveQualityScore:5,groupDominance:0.2,tickReliabilityScore:4}
  });
  assert.deepEqual(out.vetoReasons,['EXTENDED_MOVE','WEAK_MOVE_QUALITY']);
  assert.deepEqual(out.features.scoreOnlyWarnings,['EXTENDED_MOVE','WEAK_MOVE_QUALITY']);
  assert.equal(out.qualified,true);
  assert.equal(out.tradeQualified,true);
});

test('confidence is direction-aware instead of using absolute evidence strength',()=>{
  const supportive=tuneFrequencyScore({
    pair:'USDJPY',horizon:1,direction:'SELL',confidence:70,evidenceScore:-0.8,
    features:{evidenceScore:-0.8,moveQualityScore:6,groupDominance:0,tickReliabilityScore:0}
  });
  const contradictory=tuneFrequencyScore({
    pair:'USDJPY',horizon:1,direction:'SELL',confidence:70,evidenceScore:0.8,
    features:{evidenceScore:0.8,moveQualityScore:6,groupDominance:0,tickReliabilityScore:0}
  });
  assert.ok(supportive.confidence>contradictory.confidence);
});

test('frequency preservation still keeps minimum confidence and qualification',()=>{
  const out=tuneFrequencyScore({
    pair:'GBPUSD',horizon:5,direction:'BUY',confidence:48,evidenceScore:-0.2,
    vetoReasons:['MODEL_WARNING'],features:{evidenceScore:-0.2,moveQualityScore:2}
  });
  assert.ok(out.confidence>=57);
  assert.equal(out.minimumConfidence,57);
  assert.equal(out.qualified,true);
  assert.equal(out.tradeQualified,true);
  assert.equal(out.features.frequencyPreserved,true);
  assert.equal(out.features.quotaPreserved,true);
});
