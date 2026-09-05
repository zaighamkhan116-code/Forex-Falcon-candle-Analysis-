import test from 'node:test';
import assert from 'node:assert/strict';
import {assessTrackCalibration} from '../lib/trackCalibration.js';
import {tuneFrequencyScore} from '../lib/frequencyScoring.js';

const base=(pair,horizon,direction='BUY',features={})=>({pair,horizon,direction,confidence:65,evidenceScore:direction==='BUY'?.3:-.3,features:{moveQualityScore:6,groupConsensusDirection:direction,groupDominance:.55,groupConsensusVotes:2,mtfAgreementCount:2,...features}});

test('GBPUSD 1M weak wick-heavy reaction is penalized without dropping cadence',()=>{
  const s=base('GBPUSD',1,'BUY',{vsaPoorResult:true,vsaScore:-.35,candleBodyRatio:.2,bodyAtr:.15,upperWickRatioVsa:.55,sequencePressure:-.1,progressScore:-2,failureToProgress:true});
  const cal=assessTrackCalibration(s,'BUY');
  assert.equal(cal.reactionQuality,'WEAK');
  assert.ok(cal.confidenceAdjustment<=-4);
  const out=tuneFrequencyScore(s);
  assert.equal(out.qualified,true);
  assert.equal(out.tradeQualified,true);
  assert.ok(out.confidence>=57);
  assert.ok(out.features.trackCalibrationTags.includes('GBPUSD_1M_WEAK_REACTION'));
});

test('EURUSD 5M mature displacement without healthy reaction gets exhaustion penalty',()=>{
  const s=base('EURUSD',5,'BUY',{bullExtended:true,vwapDistanceAtr:2.1,rangeAtr:1.4,vsaPoorResult:true,vsaScore:-.2,upperWickRatioVsa:.45,sequencePressure:-.05,progressScore:-1,failureToProgress:true});
  const cal=assessTrackCalibration(s,'BUY');
  assert.equal(cal.matureDisplacement,true);
  assert.ok(cal.tags.includes('EURUSD_MATURE_CONTINUATION_RISK'));
  assert.ok(cal.confidenceAdjustment<0);
});

test('EURJPY 3M clean healthy structure receives confirmation credit',()=>{
  const s=base('EURJPY',3,'SELL',{vsaScore:-.3,candleBodyRatio:.6,bodyAtr:.5,sequencePressure:-.2,progressScore:-4,evidenceScore:-.4,mtfAgreementCount:3,mtfOppositionCount:0,groupConsensusDirection:'SELL',groupDominance:.7,failureToProgress:false,transitionRiskActive:false});
  const cal=assessTrackCalibration(s,'SELL');
  assert.equal(cal.reactionQuality,'HEALTHY');
  assert.ok(cal.tags.includes('EURJPY_STRUCTURAL_CONFIRMATION'));
  assert.ok(cal.confidenceAdjustment>0);
});

test('USDJPY 3M recovery is preserved rather than broadly penalized',()=>{
  const s=base('USDJPY',3,'BUY',{vsaScore:.25,candleBodyRatio:.58,bodyAtr:.45,sequencePressure:.18,progressScore:3,mtfAgreementCount:3,mtfOppositionCount:0,transitionRiskActive:false});
  const cal=assessTrackCalibration(s,'BUY');
  assert.ok(cal.tags.includes('USDJPY_3M_RECOVERY_PRESERVE'));
  assert.ok(cal.confidenceAdjustment>=0);
});

test('AUDUSD healthy mature 5M reaction is allowed instead of punished for lateness alone',()=>{
  const s=base('AUDUSD',5,'BUY',{bullExtended:true,vwapDistanceAtr:2.2,rangeAtr:1.3,vsaScore:.3,candleBodyRatio:.6,bodyAtr:.5,sequencePressure:.2,progressScore:3,activeFvgState:'FULLY_MITIGATED',mtfAgreementCount:3,mtfOppositionCount:0});
  const cal=assessTrackCalibration(s,'BUY');
  assert.equal(cal.reactionQuality,'HEALTHY');
  assert.ok(cal.confidenceAdjustment>0);
  assert.ok(cal.tags.includes('AUDUSD_5M_MATURE_REACTION_ALLOWED'));
});

test('15M calibration is capped while sample remains small',()=>{
  const s=base('GBPUSD',15,'BUY',{vsaPoorResult:true,candleBodyRatio:.1,upperWickRatioVsa:.7,sequencePressure:-.4,progressScore:-5,failureToProgress:true});
  const cal=assessTrackCalibration(s,'BUY');
  assert.ok(Math.abs(cal.confidenceAdjustment)<=1);
  assert.ok(Math.abs(cal.directionBias)<=.25);
  assert.ok(cal.tags.includes('15M_SMALL_SAMPLE_CAP'));
});
