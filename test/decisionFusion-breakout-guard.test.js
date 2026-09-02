import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBreakoutMaturity} from '../lib/decisionFusion.js';

test('blocks an approaching FVG before confirmation',()=>{
  const risk=assessBreakoutMaturity({activeFvgState:'APPROACHING'},'BUY',1);
  assert.equal(risk.active,true);
  assert.equal(risk.gate,false);
  assert.match(risk.tags.join('|'),/FVG_APPROACHING_UNCONFIRMED/);
});

test('blocks an accepted breakout inside a mitigating FVG when consensus is fragile',()=>{
  const risk=assessBreakoutMaturity({activeFvgState:'MITIGATING',breakoutAccepted:true,bullExtended:true,groupConsensusVotes:2,groupOpposingVotes:0,groupDominance:.49},'BUY',2);
  assert.equal(risk.fragileAcceptedBreakout,true);
  assert.equal(risk.gate,false);
});

test('allows mature accepted-through and rejected FVG structures',()=>{
  for(const state of ['ACCEPTED_THROUGH','REJECTED','FULLY_MITIGATED']){
    const risk=assessBreakoutMaturity({activeFvgState:state,breakoutAccepted:true,bullExtended:true,groupConsensusVotes:3,groupOpposingVotes:0,groupDominance:.7},'BUY',1);
    assert.equal(risk.gate,true,state);
  }
});
