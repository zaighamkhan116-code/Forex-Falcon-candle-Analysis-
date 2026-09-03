import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonCategory,marketConditionTags,summarizeModelArbitration} from '../lib/modelArbitration.js';

const row=(falconDirection,result,shadowDirection,shadowResult,features={},regime='TRENDING')=>({
  direction:falconDirection,result,regime,features,
  shadowModel:{status:'READY',settled:true,direction:shadowDirection,result:shadowResult,confidence:68,influencedLiveSignal:false}
});

test('classifies agreement wins and losses',()=>{
  assert.equal(comparisonCategory(row('BUY','WIN','BUY','WIN')),'AGREE_WIN');
  assert.equal(comparisonCategory(row('SELL','LOSS','SELL','LOSS')),'AGREE_LOSS');
});

test('classifies disagreement winner',()=>{
  assert.equal(comparisonCategory(row('BUY','WIN','SELL','LOSS')),'DISAGREE_FALCON_WIN');
  assert.equal(comparisonCategory(row('BUY','LOSS','SELL','WIN')),'DISAGREE_SHADOW_WIN');
});

test('extracts conditions behind shared failures',()=>{
  const tags=marketConditionTags(row('BUY','LOSS','BUY','LOSS',{failureToProgress:true,vwapExtended:true,mtfOppositionCount:2,moveQualityScore:3,tickReliability:.2},'CHOPPY'));
  assert.ok(tags.includes('REGIME_CHOPPY'));
  assert.ok(tags.includes('FAILURE_TO_PROGRESS'));
  assert.ok(tags.includes('VWAP_EXTENDED'));
  assert.ok(tags.includes('MTF_CONFLICT'));
  assert.ok(tags.includes('WEAK_MOVE_QUALITY'));
  assert.ok(tags.includes('LOW_TICK_RELIABILITY'));
});

test('does not move away from 50/50 before enough disagreement evidence',()=>{
  const rows=[];for(let i=0;i<8;i++)rows.push(row('BUY','WIN','SELL','LOSS'));
  const s=summarizeModelArbitration(rows);
  assert.equal(s.globalWeights.falcon,.5);
  assert.equal(s.globalWeights.shadow,.5);
  assert.equal(s.influencesLiveSignal,false);
});

test('research weights move gradually after sufficient disagreement evidence',()=>{
  const rows=[];
  for(let i=0;i<15;i++)rows.push(row('BUY','WIN','SELL','LOSS',{},'TRENDING'));
  for(let i=0;i<5;i++)rows.push(row('BUY','LOSS','SELL','WIN',{},'TRENDING'));
  const s=summarizeModelArbitration(rows);
  assert.ok(s.globalWeights.falcon>.5);
  assert.ok(s.globalWeights.falcon<=.75);
  assert.ok(s.regimeWeights.REGIME_TRENDING.falcon>.5);
  assert.equal(s.regimeWeights.REGIME_TRENDING.researchOnly,true);
});
