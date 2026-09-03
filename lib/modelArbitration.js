const MIN_REGIME_SAMPLE=15;
const MIN_DISAGREEMENT_SAMPLE=20;
const PRIOR_WINS=10;
const PRIOR_LOSSES=10;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>Number.isFinite(Number(v))?Number(v):null;

export function comparisonCategory(signal){
  const shadow=signal?.shadowModel;
  if(!shadow||shadow.status!=='READY'||!shadow.settled||!['BUY','SELL'].includes(shadow.direction))return null;
  const falcon=String(signal.direction||'').toUpperCase();
  if(!['BUY','SELL'].includes(falcon))return null;
  const agree=falcon===shadow.direction;
  if(agree){
    if(signal.result==='WIN')return 'AGREE_WIN';
    if(signal.result==='LOSS')return 'AGREE_LOSS';
    return 'AGREE_TIE';
  }
  if(signal.result==='WIN')return 'DISAGREE_FALCON_WIN';
  if(shadow.result==='WIN')return 'DISAGREE_SHADOW_WIN';
  return 'DISAGREE_TIE';
}

export function marketConditionTags(signal){
  const f=signal?.features||{},tags=[];
  const regime=String(signal?.regime||f.regime||'').toUpperCase();
  if(regime)tags.push(`REGIME_${regime}`);
  if(f.failureToProgress===true)tags.push('FAILURE_TO_PROGRESS');
  if(f.bullExtended===true||f.bearExtended===true||f.extendedMove===true)tags.push('EXTENDED_MOVE');
  if(f.vwapExtended===true)tags.push('VWAP_EXTENDED');
  if(f.vwapSlopeConflict===true)tags.push('VWAP_SLOPE_CONFLICT');
  if(Number(f.mtfOppositionCount||0)>=2)tags.push('MTF_CONFLICT');
  if(Number(f.mtfAgreementCount||0)>=2)tags.push('MTF_AGREEMENT');
  const q=finite(f.moveQualityScore);if(q!==null&&q<5)tags.push('WEAK_MOVE_QUALITY');
  const tr=finite(f.tickReliability);if(tr!==null&&tr<0.4)tags.push('LOW_TICK_RELIABILITY');
  const td=finite(f.tickDensity);if(td!==null&&td<0.4)tags.push('LOW_TICK_DENSITY');
  if(f.bbContraction===true||f.emaCompression===true||f.compression===true)tags.push('COMPRESSION');
  if(f.fvgState)tags.push(`FVG_${String(f.fvgState).toUpperCase()}`);
  if(f.activeFvgDirection)tags.push(`FVG_DIR_${String(f.activeFvgDirection).toUpperCase()}`);
  if(f.liquiditySweep===true||f.sweepDetected===true)tags.push('LIQUIDITY_SWEEP');
  if(f.rejectionDetected===true||f.wickRejection===true)tags.push('REJECTION');
  return [...new Set(tags)];
}

function smoothedRate(wins,losses){return (wins+PRIOR_WINS)/(wins+losses+PRIOR_WINS+PRIOR_LOSSES)}
function weightFromRates(falconWins,shadowWins){
  const fr=smoothedRate(falconWins,shadowWins),sr=smoothedRate(shadowWins,falconWins),sum=fr+sr||1;
  return{falcon:Number(clamp(fr/sum,.25,.75).toFixed(3)),shadow:Number(clamp(sr/sum,.25,.75).toFixed(3))};
}

export function summarizeModelArbitration(rows=[]){
  const usable=[];
  for(const signal of rows){const category=comparisonCategory(signal);if(category)usable.push({signal,category,tags:marketConditionTags(signal)})}
  const counts={AGREE_WIN:0,AGREE_LOSS:0,AGREE_TIE:0,DISAGREE_FALCON_WIN:0,DISAGREE_SHADOW_WIN:0,DISAGREE_TIE:0};
  for(const x of usable)counts[x.category]++;
  const agreement=counts.AGREE_WIN+counts.AGREE_LOSS+counts.AGREE_TIE;
  const disagreement=counts.DISAGREE_FALCON_WIN+counts.DISAGREE_SHADOW_WIN+counts.DISAGREE_TIE;
  const agreementDecided=counts.AGREE_WIN+counts.AGREE_LOSS;
  const disagreementDecided=counts.DISAGREE_FALCON_WIN+counts.DISAGREE_SHADOW_WIN;
  const byCondition={};
  for(const x of usable){for(const tag of x.tags){const c=byCondition[tag]||(byCondition[tag]={sample:0,agreeWin:0,agreeLoss:0,falconWin:0,shadowWin:0,tie:0});c.sample++;if(x.category==='AGREE_WIN')c.agreeWin++;else if(x.category==='AGREE_LOSS')c.agreeLoss++;else if(x.category==='DISAGREE_FALCON_WIN')c.falconWin++;else if(x.category==='DISAGREE_SHADOW_WIN')c.shadowWin++;else c.tie++}}
  const regimeWeights={};
  for(const [tag,c] of Object.entries(byCondition)){
    const d=c.falconWin+c.shadowWin;
    if(!tag.startsWith('REGIME_')||c.sample<MIN_REGIME_SAMPLE||d<MIN_DISAGREEMENT_SAMPLE)continue;
    regimeWeights[tag]={sample:c.sample,disagreements:d,...weightFromRates(c.falconWin,c.shadowWin),researchOnly:true};
  }
  const globalWeights=disagreementDecided>=MIN_DISAGREEMENT_SAMPLE?{...weightFromRates(counts.DISAGREE_FALCON_WIN,counts.DISAGREE_SHADOW_WIN),researchOnly:true}:{falcon:.5,shadow:.5,researchOnly:true,reason:`INSUFFICIENT_DISAGREEMENTS_${disagreementDecided}_OF_${MIN_DISAGREEMENT_SAMPLE}`};
  return{
    comparisonSample:usable.length,
    agreement,disagreement,
    agreementRate:usable.length?agreement/usable.length:null,
    agreementAccuracy:agreementDecided?counts.AGREE_WIN/agreementDecided:null,
    disagreementFalconAccuracy:disagreementDecided?counts.DISAGREE_FALCON_WIN/disagreementDecided:null,
    disagreementShadowAccuracy:disagreementDecided?counts.DISAGREE_SHADOW_WIN/disagreementDecided:null,
    counts,byCondition,globalWeights,regimeWeights,
    weightingPolicy:'RESEARCH_ONLY_BAYES_SMOOTHED_CAPPED_25_75',
    influencesLiveSignal:false
  };
}
