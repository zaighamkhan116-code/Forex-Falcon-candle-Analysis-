import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBreakoutMaturity} from '../lib/decisionFusion.js';

test('strong accepted continuation is not blocked by a mitigating FVG',()=>{
  const out=assessBreakoutMaturity({
    activeFvgState:'MITIGATING',
    breakoutAccepted:true,
    bullExtended:true,
    moveQualityScore:7.4,
    progressScore:7,
    groupConsensusVotes:2,
    groupOpposingVotes:0,
    groupDominance:.5,
    failureToProgress:false,
    lastUpperWickRatio:.18
  },'BUY',1);
  assert.equal(out.strongAcceptedContinuation,true);
  assert.equal(out.active,false);
  assert.equal(out.gate,true);
  assert.equal(out.penalty,0);
});

test('accepted breakout remains blocked when there is actual failure or rejection',()=>{
  const out=assessBreakoutMaturity({
    activeFvgState:'MITIGATING',
    breakoutAccepted:true,
    bullExtended:true,
    moveQualityScore:7.4,
    progressScore:2,
    groupConsensusVotes:2,
    groupOpposingVotes:0,
    groupDominance:.5,
    failureToProgress:true,
    lastUpperWickRatio:.42
  },'BUY',1);
  assert.equal(out.strongAcceptedContinuation,false);
  assert.equal(out.active,true);
  assert.equal(out.gate,false);
  assert.ok(out.penalty>0);
});
