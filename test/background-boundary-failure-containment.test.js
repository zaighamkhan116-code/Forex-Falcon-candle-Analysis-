import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../lib/backgroundResearch.js',import.meta.url),'utf8');

test('boundary-on-demand market-data failure is contained before it can escape the background timer',()=>{
  const start=source.indexOf('async function lockCandidateAtBoundary');
  const end=source.indexOf('async function scanState',start);
  assert.ok(start>=0&&end>start,'lockCandidateAtBoundary function must exist');
  const fn=source.slice(start,end);
  const tryAt=fn.indexOf('try{');
  const onDemandAt=fn.indexOf("await computeAnalysis(s,boundary,'BOUNDARY_ON_DEMAND')");
  const catchAt=fn.indexOf('}catch(e)');
  assert.ok(tryAt>=0,'boundary lock must contain a try block');
  assert.ok(onDemandAt>tryAt,'BOUNDARY_ON_DEMAND analysis must execute inside the try block');
  assert.ok(catchAt>onDemandAt,'market-data rejection must be handled by the boundary-lock catch');
  assert.match(fn,/s\.targetBoundary=boundary/,'failed boundary remains retryable instead of being silently advanced');
});
