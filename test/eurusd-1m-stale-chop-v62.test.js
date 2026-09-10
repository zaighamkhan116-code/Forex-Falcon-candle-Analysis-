import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStreakState,recordTrackOutcome} from '../lib/streakState.js';

const stale={lateCounterTrendRisk:true,continuationResetRequired:true,continuationFreshEvidence:false,efficiency:.10};
const loss=()=>recordTrackOutcome({pair:'EURUSD',horizon:1,direction:'BUY',regime:'CHOPPY',result:'LOSS',features:stale});

test('EURUSD 1M stale chop is softened only after repeat losses and cadence floor stays 57',()=>{
  loss();
  let one=applyStreakState({pair:'EURUSD',horizon:1,direction:'BUY',regime:'CHOPPY',confidence:65,features:stale});
  assert.equal(one.features.eurusd1mStaleChopForwardValidation,true);
  assert.equal(one.confidence,65);
  loss();
  const two=applyStreakState({pair:'EURUSD',horizon:1,direction:'BUY',regime:'CHOPPY',confidence:65,features:stale});
  assert.ok(two.confidence<65);
  const floor=applyStreakState({pair:'EURUSD',horizon:1,direction:'BUY',regime:'CHOPPY',confidence:57,features:stale});
  assert.equal(floor.confidence,57);
});

test('does not spill into EURUSD 2M or healthy/fresh 1M continuation',()=>{
  const other=applyStreakState({pair:'EURUSD',horizon:2,direction:'BUY',regime:'CHOPPY',confidence:65,features:stale});
  assert.equal(other.features.eurusd1mStaleChopForwardValidation,false);
  assert.equal(other.confidence,65);
  const fresh=applyStreakState({pair:'EURUSD',horizon:1,direction:'BUY',regime:'CHOPPY',confidence:65,features:{...stale,continuationFreshEvidence:true}});
  assert.equal(fresh.features.eurusd1mStaleChopForwardValidation,false);
});
