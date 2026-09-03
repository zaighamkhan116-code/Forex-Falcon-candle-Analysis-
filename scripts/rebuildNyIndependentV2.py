"""Rebuild candidate for the historical NY Independent V2 ensemble.

This is a REPRODUCTION CANDIDATE, not yet claimed as byte-for-byte parity with the
original missing fitted RF/ExtraTrees/HGB artifacts. The handoff preserves the
architecture and signal-level validation record but not those three fitted model
objects or their exact hyperparameters.

Protocol preserved from the handoff:
- EURUSD M1
- May 2026 fit only
- June 2026 architecture/calibration only
- July 2026 untouched unseen validation
- NY dataset clock 15:00-20:00
- 5-minute direction
- RF + ExtraTrees + HistGradientBoosting majority direction
- rank by ensemble directional confidence
- exactly top 3 candidates per represented hour
- logistic probability-of-win calibration on June selected signals

The initial conservative candidate below produced 330 June signals and 336 July
signals (the same historical counts) and ~63.99% July raw accuracy in local
reproduction, close to the saved 63.39% benchmark. Timestamp/direction parity is
still required before promotion to NY_INDEPENDENT_V2_REPRODUCED.
"""

from __future__ import annotations
import argparse
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression

FEATURES = [
    'r1','r2','r3','r5','r8','r13','r21','r34','r55',
    *[f'{p}{k}' for k in (3,5,8,13,21,34,55) for p in ('rv','up','loc','rng')],
    'body','uw','lw','ema9_sep','ema9_slope3','ema21_sep','ema21_slope3',
    'ema50_sep','ema50_slope3','rsi14','bbz20','bbwidth20','eff10','eff20',
    'bull_fvg','bear_fvg','todsin','todcos'
]


def load_histdata(path: str | Path) -> pd.DataFrame:
    d=pd.read_csv(path,sep=';',header=None,names=['stamp','open','high','low','close','volume'])
    d['dt']=pd.to_datetime(d['stamp'],format='%Y%m%d %H%M%S')
    return d.sort_values('dt').reset_index(drop=True)


def build_features(d: pd.DataFrame) -> pd.DataFrame:
    x=d.copy(); c=x['close']; x['r1']=c.pct_change()
    for k in (2,3,5,8,13,21,34,55): x[f'r{k}']=c.pct_change(k)
    for k in (3,5,8,13,21,34,55):
        x[f'rv{k}']=x['r1'].rolling(k).std(); x[f'up{k}']=x['r1'].gt(0).rolling(k).mean()
        hi=x['high'].rolling(k).max(); lo=x['low'].rolling(k).min()
        x[f'loc{k}']=(c-lo)/(hi-lo+1e-12); x[f'rng{k}']=(hi-lo)/(c+1e-12)
    rr=(x['high']-x['low'])+1e-12
    x['body']=(x['close']-x['open'])/rr
    x['uw']=(x['high']-np.maximum(x['open'],x['close']))/rr
    x['lw']=(np.minimum(x['open'],x['close'])-x['low'])/rr
    for n in (9,21,50):
        e=c.ewm(span=n,adjust=False).mean()
        x[f'ema{n}_sep']=(c-e)/(c+1e-12); x[f'ema{n}_slope3']=(e-e.shift(3))/(c+1e-12)
    delta=c.diff(); gain=delta.clip(lower=0).rolling(14).mean(); loss=(-delta.clip(upper=0)).rolling(14).mean()
    rs=gain/(loss+1e-12); x['rsi14']=100-100/(1+rs)
    ma=c.rolling(20).mean(); sd=c.rolling(20).std(); x['bbz20']=(c-ma)/(sd+1e-12); x['bbwidth20']=(4*sd)/(c+1e-12)
    for k in (10,20): x[f'eff{k}']=(c-c.shift(k)).abs()/(c.diff().abs().rolling(k).sum()+1e-12)
    x['bull_fvg']=(x['low']>x['high'].shift(2)).astype(int); x['bear_fvg']=(x['high']<x['low'].shift(2)).astype(int)
    hr=x['dt'].dt.hour+x['dt'].dt.minute/60
    x['todsin']=np.sin(2*np.pi*hr/24); x['todcos']=np.cos(2*np.pi*hr/24)
    future=c.shift(-5); future_dt=x['dt'].shift(-5)
    x['y5']=np.where((future_dt-x['dt'])==pd.Timedelta(minutes=5),(future>c).astype(int),np.nan)
    return x.dropna(subset=FEATURES+['y5']).copy()


def fit_models(may: pd.DataFrame):
    y=may['y5'].astype(int); X=may[FEATURES]
    rf=RandomForestClassifier(n_estimators=100,min_samples_leaf=8,max_features=.7,class_weight='balanced',random_state=11,n_jobs=-1)
    et=ExtraTreesClassifier(n_estimators=120,min_samples_leaf=8,max_features=.7,class_weight='balanced',random_state=22,n_jobs=-1)
    hgb=HistGradientBoostingClassifier(max_iter=120,max_leaf_nodes=31,learning_rate=.06,l2_regularization=.3,random_state=33)
    return [rf.fit(X,y),et.fit(X,y),hgb.fit(X,y)]


def selected_signals(d: pd.DataFrame, models, calibrator=None) -> pd.DataFrame:
    probs=np.column_stack([m.predict_proba(d[FEATURES])[:,1] for m in models])
    votes=(probs>=.5).sum(axis=1); pred=(votes>=2).astype(int)
    mean_buy=probs.mean(axis=1); conf=np.where(pred==1,mean_buy,1-mean_buy)
    z=d[['dt','y5']].copy(); z['pred']=pred; z['confens']=conf
    z=z[(z['dt'].dt.hour>=15)&(z['dt'].dt.hour<20)].copy(); z['hourkey']=z['dt'].dt.floor('h')
    ids=z.groupby('hourkey')['confens'].nlargest(3).reset_index()['level_1']; z=z.loc[ids].sort_values('dt').copy()
    z['Direction']=np.where(z['pred']==1,'BUY','SELL'); z['win']=(z['pred']==z['y5'].astype(int)).astype(int)
    if calibrator is not None:z['calibrated_win_p']=calibrator.predict_proba(z[['confens']])[:,1]
    return z


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--may',required=True); ap.add_argument('--june',required=True); ap.add_argument('--july',required=True); ap.add_argument('--out',default='ny_independent_v2_rebuilt.joblib'); a=ap.parse_args()
    may,june,july=(build_features(load_histdata(p)) for p in (a.may,a.june,a.july))
    models=fit_models(may); june_sel=selected_signals(june,models)
    calibrator=LogisticRegression().fit(june_sel[['confens']],june_sel['win'])
    july_sel=selected_signals(july,models,calibrator)
    print({'juneSignals':len(june_sel),'juneRaw':float(june_sel.win.mean()),'julySignals':len(july_sel),'julyRaw':float(july_sel.win.mean())})
    bundle={'feature_names':FEATURES,'random_forest':models[0],'extra_trees':models[1],'hist_gradient_boosting':models[2],'calibrator':calibrator,'model_version':'NY_INDEPENDENT_V2_REBUILD_CANDIDATE_1','feature_schema':'ny-independent-v2-rebuild-candidate-1','parity_status':'TIMESTAMP_DIRECTION_PARITY_PENDING'}
    joblib.dump(bundle,a.out)

if __name__=='__main__': main()
