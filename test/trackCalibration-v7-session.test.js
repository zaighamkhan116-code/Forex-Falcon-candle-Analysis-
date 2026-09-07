import test from 'node:test';
import assert from 'node:assert/strict';
import {assessTrackCalibration} from '../lib/trackCalibration.js';
import {tuneFrequencyScore} from '../lib/frequencyScoring.js';

const pktTs=(hour,minute=30)=>Date.UTC(2026,8,7,hour-5,minute,0);
const base=(pair,horizon,direction='BUY',features={})=>({pair,horizon,direction,confidence:65,evidenceScore:direction==='BUY'?.3:-.3,signalBoundary:pktTs(14),features:{moveQualityScore:6,groupConsensusDirection:direction,groupDominance:.55,groupConsensusVotes:2,mtfAgreementCount:2,...features}});

test('EURUSD 5M London compound conflict gets profile penalty without cadence veto',()=>{
  const s=base('EURUSD',5,'BUY',{moveQualityScore:3.5,efficiency:.15,progressScore:-2,failureToProgress:true,mtfOppositionCount:2,emaCompression:true,lateContinuationRisk:true,transitionRiskActive:true});
  const cal=assessTrackCalibration(s,'BUY');
  assert.equal(cal.session,'LONDON_EARLY_MID');
  assert.ok(cal.compoundConflict>=3);
  assert.ok(cal.tags.includes('EURUSD_5M_LONDON_COMPOUND_CONFLICT'));
  const out=tuneFrequencyScore(s);
  assert.equal(out.qualified,true);
  assert.equal(out.tradeQualified,true);
  assert.ok(out.confidence>=57);
  assert.equal(out.features.frequencyPreserved,true);
});

test('GBPUSD 5M London clean healthy continuation is protected',()=>{
  const s=base('GBPUSD',5,'BUY',{vsaScore:.28,candleBodyRatio:.62,bodyAtr:.5,sequencePressure:.2,progressScore:3,mtfAgreementCount:3,mtfOppositionCount:0,groupConsensusDirection:'BUY',groupDominance:.7,failureToProgress:false,transitionRiskActive:false,emaCompression:false});
  const cal=assessTrackCalibration(s,'BUY');
  assert.equal(cal.session,'LONDON_EARLY_MID');
  assert.ok(cal.tags.includes('GBPUSD_5M_LONDON_PROTECTED_CONTINUATION'));
  assert.ok(cal.confidenceAdjustment>0);
});

test('USDJPY 5M compound conflict is down-ranked rather than blocked',()=>{
  const s=base('USDJPY',5,'SELL',{moveQualityScore:3.8,efficiency:.18,progressScore:2,failureToProgress:true,mtfOppositionCount:3,bbContraction:true,lateContinuationRisk:true});
  const cal=assessTrackCalibration(s,'SELL');
  assert.ok(cal.tags.includes('USDJPY_5M_COMPOUND_CONFLICT'));
  const out=tuneFrequencyScore(s);
  assert.ok(out.features.frequencyConflictCount>=1);
  assert.ok(out.features.frequencyStructuralPenalty>0);
  assert.equal(out.tradeQualified,true);
});

test('generic breakout progress gets less credit than mature breakout progress',()=>{
  const generic=tuneFrequencyScore(base('AUDUSD',5,'BUY',{breakoutAccepted:true,progressScore:3,failureToProgress:false}));
  const mature=tuneFrequencyScore(base('AUDUSD',5,'BUY',{breakoutAccepted:true,breakoutMaturityGate:true,progressScore:3,failureToProgress:false}));
  assert.ok(mature.features.frequencyFreshCredit>generic.features.frequencyFreshCredit);
});

test('EURJPY 3M V9 forward-validation profile penalizes only compound weak state and preserves cadence',()=>{
  const bad=base('EURJPY',3,'BUY',{moveQualityScore:3.6,efficiency:.16,progressScore:-2,failureToProgress:true,mtfOppositionCount:3,emaCompression:true,lateContinuationRisk:true,vsaScore:-.22,candleBodyRatio:.25});
  const cal=assessTrackCalibration(bad,'BUY');
  assert.equal(cal.version,'V9_FORWARD_VALIDATION_TRACK_CONFLICT_CALIBRATION');
  assert.ok(cal.tags.includes('EURJPY_3M_FORWARD_VALIDATION_CONFLICT_V9'));
  assert.ok(cal.directionBias<0);
  const out=tuneFrequencyScore(bad);
  assert.equal(out.tradeQualified,true);
  assert.equal(out.features.frequencyPreserved,true);
  assert.ok(out.confidence>=57);
  const healthy=assessTrackCalibration(base('EURJPY',3,'BUY',{vsaScore:.3,candleBodyRatio:.65,bodyAtr:.5,sequencePressure:.2,progressScore:3,mtfAgreementCount:3,mtfOppositionCount:0,failureToProgress:false,emaCompression:false}),'BUY');
  assert.ok(!healthy.tags.includes('EURJPY_3M_FORWARD_VALIDATION_CONFLICT_V9'));
});

test('AUDUSD 2M V9 forward-validation profile targets compound weak state without global suppression',()=>{
  const bad=base('AUDUSD',2,'SELL',{moveQualityScore:3.7,efficiency:.17,progressScore:2,failureToProgress:true,mtfOppositionCount:3,bbContraction:true,lateContinuationRisk:true,vsaScore:.25,candleBodyRatio:.24});
  const cal=assessTrackCalibration(bad,'SELL');
  assert.ok(cal.tags.includes('AUDUSD_2M_FORWARD_VALIDATION_CONFLICT_V9'));
  assert.ok(cal.confidenceAdjustment<0);
  const out=tuneFrequencyScore(bad);
  assert.equal(out.qualified,true);
  assert.equal(out.tradeQualified,true);
  assert.ok(out.confidence>=57);
  const control=assessTrackCalibration(base('AUDUSD',5,'BUY',{vsaScore:.3,candleBodyRatio:.62,bodyAtr:.48,sequencePressure:.2,progressScore:3,mtfAgreementCount:3,mtfOppositionCount:0,failureToProgress:false}),'BUY');
  assert.ok(!control.tags.includes('AUDUSD_2M_FORWARD_VALIDATION_CONFLICT_V9'));
});
