import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {OtcShadowEngine} from './otc_shadow_engine.js';

const args=process.argv.slice(2);
const files=args.filter(x=>!x.startsWith('--'));
const outArg=args.find(x=>x.startsWith('--out='));
const pairArg=args.find(x=>x.startsWith('--pair='));
const pairFilter=pairArg?pairArg.split('=')[1].toUpperCase():null;
if(!files.length){console.error('Usage: npm run quotex:backtest -- <tick.jsonl> [more.jsonl] [--pair=USDARS] [--out=/tmp/falcon-replay]');process.exit(2);}
const root=outArg?outArg.slice(6):await fs.mkdtemp(path.join(os.tmpdir(),'falcon-otc-replay-'));
const engine=new OtcShadowEngine({root});
let ticks=0,skipped=0;
for(const file of files){
  const text=await fs.readFile(file,'utf8');
  for(const line of text.split(/\r?\n/)){
    if(!line.trim())continue;
    let row;try{row=JSON.parse(line);}catch{skipped++;continue;}
    const pair=String(row.pair||'').toUpperCase().replace(/[^A-Z]/g,'');
    if(pairFilter&&pair!==pairFilter)continue;
    const timestamp_ms=Number(row.timestamp_ms||row.client_timestamp_ms),price=Number(row.price);
    if(!pair||!Number.isFinite(timestamp_ms)||!Number.isFinite(price)||price<=0){skipped++;continue;}
    await engine.onTick({pair,market:'OTC',timestamp_ms,receivedAtMs:timestamp_ms,client_lag_ms:0,price,source:'QUOTEX_REPLAY'});ticks++;
  }
}
await engine.writeQueue;
const snap=engine.snapshot();
const summary={engineVersion:snap.engineVersion,ticks,skipped,outputDir:root,expiries:snap.expiries,stats:snap.stats,pairs:snap.pairs.map(p=>({pair:p.pair,results:p.results,structureRegime:p.structureContext?.structure?.regime||null}))};
console.log(JSON.stringify(summary,null,2));
