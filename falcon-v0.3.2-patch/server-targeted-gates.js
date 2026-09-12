// Forex Falcon Desktop v0.3.2 targeted entry-quality replacement
// Replace commandDeadlineMs() and entryQuality() in the stable v0.3.0 server.mjs.
// Goal: preserve the v0.3.0 signal engine and 65% confidence threshold while vetoing only
// failure modes that were repeatedly observed in the saved 3,000-result database.

function commandDeadlineMs(s){
  const e=Number(s?.expirySeconds||0);
  if(e<=10)return 5500;
  if(e<=15)return 7500;
  if(e<=30)return 7000;
  if(e<=60)return 8000;
  if(e<=120)return 10000;
  return 12000;
}

function entryQuality(s){
  const expiry=Number(s?.expirySeconds||0);
  const dir=/UP|BUY|CALL/.test(String(s?.direction||'').toUpperCase())?1:-1;
  const f=s?.features||{},a=s?.attribution||{},d=s?.microDiagnostics||a?.microDiagnostics||{},ctx=s?.structureContext||{};
  const regime=String(f.structureRegime||ctx?.structure?.regime||a.regime||'UNKNOWN').toUpperCase();
  const strategy=String(s?.primaryAnalysis?.name||s?.entryPattern||s?.strategy||s?.engine||'UNKNOWN').toUpperCase();
  const reasons=[];
  const agreeCount=Number(s?.agreementCount??a.agreementCount??0);
  const opposed=Number(d.opposedWindows||0);
  const agreement=Number(d.microAgreement);
  const windows=d.windows||{};
  const count=w=>Number(windows?.[w]?.count||0);
  const shortCovered10=[count('1s')>=2,count('3s')>=2,count('5s')>=2].filter(Boolean).length>=2;
  const shortCovered15=[count('3s')>=2,count('5s')>=2,count('10s')>=2].filter(Boolean).length>=2;
  const levelState=String(a.levelState||ctx?.interaction?.state||'').toUpperCase();
  const acceptedBreak=/ACCEPTED_BREAK|BREAK_ACCEPT/.test(levelState)||/BREAKOUT_ACCEPTANCE/.test(strategy);
  const bb=Number(a.bbBandPos);
  const exhaustion=Number.isFinite(bb)&&((dir>0&&bb>=.92)||(dir<0&&bb<=.08));
  const structureBias=Number(ctx?.structure?.bias||(/UPTREND/.test(regime)?1:/DOWNTREND/.test(regime)?-1:0));

  // 10s needs real micro data. A nominal microAgreement of 1.0 with one-tick windows is not evidence.
  if(expiry===10&&!shortCovered10)reasons.push('10S_INSUFFICIENT_MICRO_COVERAGE');

  // 15s is allowed to remain frequent, but still requires enough live micro observations to validate execution.
  if(expiry===15&&!shortCovered15)reasons.push('15S_INSUFFICIENT_MICRO_COVERAGE');

  // Late reversal/multi-window conflict was one of the clearest short-expiry failure patterns.
  if(expiry<=30&&d.recentOpposition&&opposed>=(expiry===30?3:2))reasons.push('LATE_MICRO_REVERSAL');

  // Do not chase a stretched Bollinger edge unless the move is a genuinely accepted breakout.
  if(exhaustion&&!acceptedBreak)reasons.push(dir>0?'BUY_UPPER_BAND_EXHAUSTION':'SELL_LOWER_BAND_EXHAUSTION');

  // Only veto EMA opposition when structure independently agrees with the EMA opposition.
  if(String(a.emaAlignment||'').toUpperCase()==='AGAINST_EMA'&&structureBias===-dir)reasons.push('EMA_AND_STRUCTURE_OPPOSE');

  // A known false break is not a valid continuation entry until acceptance/reclaim is visible.
  if(levelState==='FALSE_BREAK'&&/TREND|CONTINUATION|BREAK/.test(strategy))reasons.push('FALSE_BREAK_CONTINUATION');

  // Transition is not banned. It only needs independent confirmation on the short expiries.
  if(expiry<=30&&regime==='TRANSITION'&&agreeCount<2)reasons.push('TRANSITION_UNCONFIRMED');

  // Keep the stable 1m/2m/5m logic broadly intact; no generic momentum scoring penalties are applied here.
  const maxClickAgeMs=expiry===10?5000:expiry===15?7000:expiry===30?8500:expiry===60?15000:expiry===120?25000:45000;
  return{
    passed:reasons.length===0,
    score:Math.max(0,100-reasons.length*20),
    reasons,
    maxClickAgeMs,
    expiry,
    regime,
    strategy,
    targetedGateVersion:'FALCON_V0.3.2_TARGETED'
  };
}
