import test from 'node:test';
import assert from 'node:assert/strict';
import {assessTrackCalibration} from '../lib/trackCalibration.js';

const utc=(hour,minute=15)=>Date.UTC(2026,8,9,hour,minute,0);

function staleSignal(signalBoundary){
  return {
    pair:'EURUSD',
    horizon:1,
    signalBoundary,
    direction:'BUY',
    features:{
      progressScore:-1,
      failureToProgress:true,
      lateCounterTrendRisk:true,
      mtfOppositionCount:2,
      moveQualityScore:4.2,
      groupConsensusDirection:'SELL',
      groupDominance:.5,
      dynamicZoneSide:'RESISTANCE',
      lastUpperWickRatio:.45,
      emaCompression:true
    }
  };
}

test('EURUSD 1M London pre-open stale state gets targeted V9.2 penalty',()=>{
  const preopen=assessTrackCalibration(staleSignal(utc(7)),'BUY'); // 12:00 PKT
  const londonOpen=assessTrackCalibration(staleSignal(utc(8)),'BUY'); // 13:00 PKT
  assert.equal(preopen.session,'LONDON_PREOPEN');
  assert.equal(londonOpen.session,'LONDON_OPEN');
  assert.ok(preopen.tags.includes('EURUSD_1M_LONDON_PREOPEN_STALE_RISK_V9_2'));
  assert.ok(!londonOpen.tags.includes('EURUSD_1M_LONDON_PREOPEN_STALE_RISK_V9_2'));
  assert.equal(preopen.confidenceAdjustment,londonOpen.confidenceAdjustment-2);
  assert.equal(preopen.directionBias,londonOpen.directionBias-.65);
  assert.equal(preopen.version,'V9_2_EURUSD_1M_LONDON_PREOPEN_STALE_RISK');
});

test('EURUSD 1M clean London pre-open continuation is not penalized by the V9.2 stale-state rule',()=>{
  const signal={
    pair:'EURUSD',horizon:1,signalBoundary:utc(7),direction:'BUY',
    directionalEvidenceScore:.3,
    features:{
      progressScore:3,moveQualityScore:6.5,directionalEfficiency:.5,
      groupConsensusDirection:'BUY',groupDominance:.6,mtfAgreementCount:2,mtfOppositionCount:0,
      vsaScore:.2,sequencePressure:.2,candleBodyRatio:.6,lastUpperWickRatio:.15,
      failureToProgress:false,lateCounterTrendRisk:false,transitionRiskActive:false,
      emaCompression:false,bbContraction:false,dynamicZoneSide:'CLEAR'
    }
  };
  const result=assessTrackCalibration(signal,'BUY');
  assert.equal(result.session,'LONDON_PREOPEN');
  assert.ok(!result.tags.includes('EURUSD_1M_LONDON_PREOPEN_STALE_RISK_V9_2'));
  assert.ok(result.tags.includes('EURUSD_1M_CLEAN_CONTINUATION'));
});