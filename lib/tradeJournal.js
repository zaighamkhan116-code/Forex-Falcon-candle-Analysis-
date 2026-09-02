// tradeJournal.js — persistent trade log, streak tracking, and a report after every 20 resolved trades.
// Persists to data/ (JSONL append-only log). On Railway, mount a volume at /app/data (or set DATA_DIR)
// so the journal survives restarts and redeploys; otherwise it lives for the lifetime of the instance.
import fs from 'fs';
import path from 'path';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const DATA_DIR=process.env.DATA_DIR||path.join(process.cwd(),'data');
const LOG_FILE=path.join(DATA_DIR,'tradeLog.jsonl');
const REPORTS_DIR=path.join(DATA_DIR,'reports');
const REPORT_INTERVAL=20;

// ---------- persistence ----------
try{fs.mkdirSync(DATA_DIR,{recursive:true});fs.mkdirSync(REPORTS_DIR,{recursive:true});}catch(e){console.error('journal init dirs failed:',e.message)}

let trades=[];              // resolved trades, newest last
let reports=[];             // generated report summaries
let currentStreak=null;     // {type:'WIN'|'LOSS'|'TIE', count, startedAt, signalIds, conditions:[]}
let longestWinStreak={count:0},longestLossStreak={count:0};

function loadPersisted(){
  try{
    if(!fs.existsSync(LOG_FILE))return;
    const lines=fs.readFileSync(LOG_FILE,'utf8').split('\n').filter(Boolean);
    for(const line of lines){
      try{
        const rec=JSON.parse(line);
        if(rec.type==='TRADE')trades.push(rec.trade);
        else if(rec.type==='REPORT')reports.push(rec.report);
      }catch{/* skip malformed line */}
    }
    rebuildStreaks();
    console.log(`tradeJournal: restored ${trades.length} trades, ${reports.length} reports from disk`);
  }catch(e){console.error('tradeJournal restore failed:',e.message)}
}
function append(rec){
  try{fs.appendFileSync(LOG_FILE,JSON.stringify(rec)+'\n')}catch(e){console.error('journal write failed:',e.message)}
}

function rebuildStreaks(){
  currentStreak=null;longestWinStreak={count:0};longestLossStreak={count:0};
  for(const t of trades){
    updateStreaks(t);
  }
}

function conditionsOf(t){
  const f=t.features||{};
  return{
    pair:t.pair,horizon:t.horizon,analysisTimeframe:t.analysisTimeframe,direction:t.direction,
    confidence:t.confidence??t.probability??null,qualityScore:t.qualityScore??null,evidenceScore:t.evidenceScore??null,
    regime:t.regime??null,engine:t.engine??null,entrySource:t.entrySource??null,settlementRule:t.settlementRule??null,
    isRecovery:t.isRecovery===true,recoveryStep:t.recoveryStep??null,
    snapshotEvolution:f.snapshotEvolution??null,sr:f.sr??null,dynamicZoneSide:f.dynamicZoneSide??null,
    liquidity:f.liquidity??null,breakout:f.breakout??null,moveQualityScore:f.moveQualityScore??null,
    mtfAgreementCount:f.mtfAgreementCount??null,mtfOppositionCount:f.mtfOppositionCount??null,
    tickReversal:f.tickReversal===true,allTickWindowsAgree:f.allTickWindowsAgree===true,tickPersistence:f.tickPersistence??null,
    lossReasons:(t.lossReview&&t.lossReview.reasons)||[],lossSeverity:t.lossReview?t.lossReview.severity:null
  };
}

function updateStreaks(t){
  const type=t.result==='WIN'||t.result==='LOSS'||t.result==='TIE'?t.result:null;
  if(!type)return;
  const cond=conditionsOf(t);
  if(currentStreak&&currentStreak.type===type){currentStreak.count++;currentStreak.signalIds.push(t.id);currentStreak.conditions.push(cond);currentStreak.endedAt=t.resolvedAt||Date.now();}
  else{
    if(currentStreak)finalizeStreak(currentStreak);
    currentStreak={type,count:1,startedAt:t.resolvedAt||Date.now(),endedAt:t.resolvedAt||Date.now(),signalIds:[t.id],conditions:[cond]};
  }
}

function finalizeStreak(streak){
  if(streak.type==='WIN'&&streak.count>longestWinStreak.count)longestWinStreak=streak;
  if(streak.type==='LOSS'&&streak.count>longestLossStreak.count)longestLossStreak=streak;
}

// ---------- aggregation ----------
function summarizeConditions(list){
  const agg={count:list.length,byPair:{},byHorizon:{},byDirection:{},byRegime:{},avgConfidence:0,avgQuality:0,
    commonLossReasons:{},tickReversalCount:0,recoveryCount:0,avgEvidence:0};
  let conf=0,confN=0,qual=0,qualN=0,ev=0,evN=0;
  for(const c of list){
    agg.byPair[c.pair]=(agg.byPair[c.pair]||0)+1;
    agg.byHorizon[c.horizon]=(agg.byHorizon[c.horizon]||0)+1;
    agg.byDirection[c.direction]=(agg.byDirection[c.direction]||0)+1;
    if(c.regime)agg.byRegime[c.regime]=(agg.byRegime[c.regime]||0)+1;
    if(Number.isFinite(Number(c.confidence))){conf+=Number(c.confidence);confN++}
    if(Number.isFinite(Number(c.qualityScore))){qual+=Number(c.qualityScore);qualN++}
    if(Number.isFinite(Number(c.evidenceScore))){ev+=Number(c.evidenceScore);evN++}
    if(c.tickReversal)agg.tickReversalCount++;
    if(c.isRecovery)agg.recoveryCount++;
    for(const r of c.lossReasons||[])agg.commonLossReasons[r]=(agg.commonLossReasons[r]||0)+1;
  }
  agg.avgConfidence=confN?Number((conf/confN).toFixed(2)):null;
  agg.avgQuality=qualN?Number((qual/qualN).toFixed(2)):null;
  agg.avgEvidence=evN?Number((ev/evN).toFixed(3)):null;
  // rank loss reasons
  agg.commonLossReasons=Object.entries(agg.commonLossReasons).sort((a,b)=>b[1]-a[1]).map(([reason,count])=>({reason,count}));
  return agg;
}

function buildReport(tradesBatch,reportNumber){
  const wins=tradesBatch.filter(t=>t.result==='WIN'),losses=tradesBatch.filter(t=>t.result==='LOSS'),ties=tradesBatch.filter(t=>t.result==='TIE');
  const byPair={},byHorizon={};
  for(const t of tradesBatch){
    byPair[t.pair]=byPair[t.pair]||{total:0,win:0,loss:0,tie:0};
    byPair[t.pair][t.result.toLowerCase()]++;byPair[t.pair].total++;
    byHorizon[t.horizon]=byHorizon[t.horizon]||{total:0,win:0,loss:0,tie:0};
    byHorizon[t.horizon][t.result.toLowerCase()]++;byHorizon[t.horizon].total++;
  }
  // confidence buckets: does higher confidence actually win more?
  const buckets={'57-61':{w:0,l:0,t:0},'62-66':{w:0,l:0,t:0},'67-71':{w:0,l:0,t:0},'72+':{w:0,l:0,t:0}};
  for(const t of tradesBatch){
    const c=Number(t.confidence??t.probability??0);
    const b=c>=72?'72+':c>=67?'67-71':c>=62?'62-66':'57-61';
    buckets[b][t.result==='WIN'?'w':t.result==='LOSS'?'l':'t']++;
  }
  const winRate=tradesBatch.length?Number(((wins.length/tradesBatch.length)*100).toFixed(1)):null;
  // streaks inside this batch
  const batchStreaks=[];let cur=null;
  for(const t of tradesBatch){
    if(cur&&cur.type===t.result)cur.count++;
    else{if(cur)batchStreaks.push(cur);cur={type:t.result,count:1,signalIds:[t.id]}}
  }
  if(cur)batchStreaks.push(cur);
  const maxWinStreak=Math.max(0,...batchStreaks.filter(s=>s.type==='WIN').map(s=>s.count));
  const maxLossStreak=Math.max(0,...batchStreaks.filter(s=>s.type==='LOSS').map(s=>s.count));
  return{
    reportNumber,generatedAt:new Date().toISOString(),tradeCount:tradesBatch.length,
    firstTradeAt:tradesBatch[0]?.resolvedAt||null,lastTradeAt:tradesBatch.at(-1)?.resolvedAt||null,
    results:{wins:wins.length,losses:losses.length,ties:ties.length,winRate},
    maxWinStreakInBatch:maxWinStreak,maxLossStreakInBatch:maxLossStreak,
    byPair,byHorizon,confidenceBuckets:buckets,
    winningConditions:summarizeConditions(wins.map(conditionsOf)),
    losingConditions:summarizeConditions(losses.map(conditionsOf)),
    trades:tradesBatch.map(t=>({id:t.id,pair:t.pair,horizon:t.horizon,direction:t.direction,confidence:t.confidence??t.probability,qualityScore:t.qualityScore,evidenceScore:t.evidenceScore,regime:t.regime,engine:t.engine,result:t.result,entry:t.entry,exit:t.exit,priceDifference:t.priceDifference,resolvedAt:t.resolvedAt,isRecovery:t.isRecovery===true,lossReasons:(t.lossReview&&t.lossReview.reasons)||[],features:t.features}))
  };
}

function markdownReport(r){
  const lines=[];
  lines.push(`# Falcon Trade Journal — Report #${r.reportNumber}`);
  lines.push(`_Generated ${r.generatedAt} · ${r.tradeCount} trades (${r.results.wins}W / ${r.results.losses}L / ${r.results.ties}T) · Win rate ${r.results.winRate}%_`);
  lines.push('');
  lines.push(`**Streaks in batch:** longest win streak ${r.maxWinStreakInBatch}, longest loss streak ${r.maxLossStreakInBatch}`);
  lines.push('');
  lines.push('## Losing trades — why they lost');
  lines.push(`Avg confidence ${r.losingConditions.avgConfidence} · avg quality ${r.losingConditions.avgQuality} · avg evidence ${r.losingConditions.avgEvidence}`);
  lines.push(`Regimes: ${JSON.stringify(r.losingConditions.byRegime)} · Pairs: ${JSON.stringify(r.losingConditions.byPair)} · Directions: ${JSON.stringify(r.losingConditions.byDirection)}`);
  if(r.losingConditions.commonLossReasons.length)lines.push(`Common loss reasons: ${r.losingConditions.commonLossReasons.map(x=>`${x.reason} (x${x.count})`).join(', ')}`);
  if(r.losingConditions.tickReversalCount)lines.push(`Tick reversals present in ${r.losingConditions.tickReversalCount} losses`);
  lines.push('');
  lines.push('## Winning trades — what is working');
  lines.push(`Avg confidence ${r.winningConditions.avgConfidence} · avg quality ${r.winningConditions.avgQuality} · avg evidence ${r.winningConditions.avgEvidence}`);
  lines.push(`Regimes: ${JSON.stringify(r.winningConditions.byRegime)} · Pairs: ${JSON.stringify(r.winningConditions.byPair)} · Directions: ${JSON.stringify(r.winningConditions.byDirection)}`);
  if(r.winningConditions.recoveryCount)lines.push(`Recovery trades in wins: ${r.winningConditions.recoveryCount}`);
  lines.push('');
  lines.push('## Confidence calibration');
  for(const[k,v]of Object.entries(r.confidenceBuckets)){const n=v.w+v.l+v.t;if(n)lines.push(`- ${k}: ${v.w}W/${v.l}L/${v.t}T → win rate ${((v.w/n)*100).toFixed(1)}%`)}
  lines.push('');
  lines.push('## Per-pair / per-horizon');
  for(const[p,v]of Object.entries(r.byPair))lines.push(`- ${p}: ${v.win}W/${v.loss}L/${v.tie}T (${((v.win/v.total)*100).toFixed(1)}%)`);
  for(const[h,v]of Object.entries(r.byHorizon))lines.push(`- ${h}M: ${v.win}W/${v.loss}L/${v.tie}T (${((v.win/v.total)*100).toFixed(1)}%)`);
  return lines.join('\n');
}

// ---------- public API ----------
export function recordResolution(signal){
  if(!signal||signal.journaled)return;
  if(!['WIN','LOSS','TIE'].includes(signal.result))return;
  signal.journaled=true;
  const t={
    id:signal.id,runId:signal.runId,pair:signal.pair,horizon:signal.horizon,analysisTimeframe:signal.analysisTimeframe,
    direction:signal.direction,confidence:signal.confidence??signal.probability??null,probability:signal.probability??null,
    qualityScore:signal.qualityScore??null,evidenceScore:signal.evidenceScore??null,
    signalBoundary:signal.signalBoundary,entry:signal.entry,exit:signal.exit,entrySource:signal.entrySource,exitSource:signal.exitSource,
    priceDifference:signal.priceDifference,result:signal.result,resolvedAt:signal.resolvedAt||Date.now(),
    regime:signal.regime??null,engine:signal.engine??null,features:signal.features||{},
    settlementRule:signal.settlementRule??null,settlementSource:signal.settlementSource??null,
    authoritativeBoundarySettlement:signal.authoritativeBoundarySettlement===true,
    isRecovery:signal.isRecovery===true,recoveryStep:signal.recoveryStep??null,recoveryParentId:signal.recoveryParentId??null,
    lossReview:signal.lossReview??null
  };
  trades.push(t);
  append({type:'TRADE',trade:t});
  updateStreaks(t);
  if(currentStreak&&currentStreak.count>10)finalizeStreak({...currentStreak}); // keep updating longest trackers as streaks grow
  if(trades.length%REPORT_INTERVAL===0)generateReport();
}

export function generateReport(){
  if(!trades.length)return null;
  const reportNumber=reports.length+1;
  const batch=trades.slice(-REPORT_INTERVAL);
  const report=buildReport(batch,reportNumber);
  const md=markdownReport(report);
  try{
    fs.writeFileSync(path.join(REPORTS_DIR,`report-${reportNumber}.json`),JSON.stringify(report,null,2));
    fs.writeFileSync(path.join(REPORTS_DIR,`report-${reportNumber}.md`),md);
  }catch(e){console.error('journal report write failed:',e.message)}
  const summary={reportNumber,generatedAt:report.generatedAt,tradeCount:report.tradeCount,results:report.results,
    maxWinStreakInBatch:report.maxWinStreakInBatch,maxLossStreakInBatch:report.maxLossStreakInBatch,
    losingConditions:{avgConfidence:report.losingConditions.avgConfidence,byRegime:report.losingConditions.byRegime,commonLossReasons:report.losingConditions.commonLossReasons},
    winningConditions:{avgConfidence:report.winningConditions.avgConfidence,byRegime:report.winningConditions.byRegime},
    byPair:report.byPair,byHorizon:report.byHorizon,confidenceBuckets:report.confidenceBuckets};
  reports.push(summary);
  append({type:'REPORT',report:summary});
  return report;
}

export function journalSummary(){
  const wins=trades.filter(t=>t.result==='WIN').length,losses=trades.filter(t=>t.result==='LOSS').length,ties=trades.filter(t=>t.result==='TIE').length;
  return{
    totalTrades:trades.length,wins,losses,ties,
    winRate:trades.length?Number(((wins/trades.length)*100).toFixed(1)):null,
    tradesUntilNextReport:REPORT_INTERVAL-(trades.length%REPORT_INTERVAL),
    currentStreak:currentStreak?{type:currentStreak.type,count:currentStreak.count,startedAt:currentStreak.startedAt,conditions:currentStreak.conditions.at(-1)}:null,
    longestWinStreak:{count:longestWinStreak.count,startedAt:longestWinStreak.startedAt??null,endedAt:longestWinStreak.endedAt??null,conditions:longestWinStreak.conditions?summarizeConditions(longestWinStreak.conditions):null},
    longestLossStreak:{count:longestLossStreak.count,startedAt:longestLossStreak.startedAt??null,endedAt:longestLossStreak.endedAt??null,conditions:longestLossStreak.conditions?summarizeConditions(longestLossStreak.conditions):null},
    recentTrades:trades.slice(-20).reverse()
  };
}

export function getRecentTrades(n=50){return trades.slice(-n).reverse()}
export function getReports(){return reports.slice().reverse()}
export function getLatestReport(){return reports[0]||null}
export const REPORT_INTERVAL_MINUTES=()=>REPORT_INTERVAL;

loadPersisted();
