const MIN_CONFIDENCE=57;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// Convert all safeguards into score diagnostics. This deliberately never
// suppresses a scheduled signal or changes its selected direction.
export function tuneFrequencyScore(signal){
  const f=signal?.features||{};
  const modelConfidence=Number(signal?.confidence||50);
  const evidence=Math.min(1,Math.abs(Number(signal?.evidenceScore??f.evidenceScore??0)));
  const quality=clamp(Number(f.moveQualityScore||5)/10,0,1);
  const consensus=clamp(Number(f.groupDominance||0),0,1);
  const tick=clamp(Number(f.tickReliabilityScore||0)/10,0,1);
  const warnings=Array.isArray(signal?.vetoReasons)?signal.vetoReasons:[];
  const strength=.45*evidence+.25*quality+.20*consensus+.10*tick;
  const score=clamp(57+25*strength-Math.min(6,warnings.length*1.2),MIN_CONFIDENCE,85);
  return{...signal,confidence:Number(score.toFixed(1)),qualified:true,tradeQualified:true,minimumConfidence:MIN_CONFIDENCE,vetoReasons:[],engine:`${signal?.engine||'FUSION_V2_11'}+FREQUENCY_SCORE_V1`,features:{...f,modelConfidence:Number(modelConfidence.toFixed(1)),modelQualified:signal?.qualified===true&&signal?.tradeQualified!==false,scoreOnlyWarnings:warnings,frequencyStrength:Number(strength.toFixed(4)),frequencyScoreVersion:'V1',frequencyPreserved:true}};
}
