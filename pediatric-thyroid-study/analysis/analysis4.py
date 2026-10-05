import pandas as pd, numpy as np
from classify import classify, ORDER
from statsmodels.stats.proportion import proportion_confint
I=pd.read_pickle('index_cls.pkl'); W=pd.read_pickle('child_dates.pkl'); P=pd.read_pickle('pairs_epoch.pkl')
# --- antibodies: any measurement within ±90 days of index
A=W[W.TPOAb.notna()|W.TgAb.notna()][['pid','date','TPOAb','TgAb']].merge(I[['pid','date','pheno','sexl','ageband']].rename(columns={'date':'idate'}),on='pid')
A['d']=(A.date-A.idate).dt.days.abs(); A=A[A.d<=90].sort_values('d')
tpo=A[A.TPOAb.notna()].drop_duplicates('pid'); tg=A[A.TgAb.notna()].drop_duplicates('pid')
print('TPOAb children near index', len(tpo), 'TgAb', len(tg), 'either', pd.concat([tpo.pid,tg.pid]).nunique())
raw=pd.read_pickle('pseudo.pkl'); raw=raw[raw.TEST_NAME.isin(['Anti TPO','Anti TG'])]
print(raw.groupby([raw.TEST_NAME, raw.dt.dt.year]).RESULT_VALUE_RAW.apply(lambda s: s.astype(str).str.strip().head(3).tolist()).to_string())
print(tpo.groupby('pheno').TPOAb.describe().round(2).to_string()); print(tg.groupby('pheno').TgAb.describe().round(2).to_string())
print(tpo[['date']].assign(y=tpo.date.dt.year).y.value_counts().to_dict())
# --- sensitivity: fixed limits
S=I.copy()
S['fx']=[classify(t,f,0.5,5.0,0.8,1.8) for t,f in S[['TSH','fT4']].itertuples(index=False)]
print('\nFixed limits overall'); print(S.fx.value_counts(normalize=True).reindex(ORDER).mul(100).round(2).to_string())
print(pd.crosstab(S.epoch,S.fx,normalize='index').reindex(columns=ORDER).mul(100).round(2).to_string())
print('agreement kappa-ish: same class', (S.fx==S.pheno).mean().round(4))
# sens2: fixed TSH 0.5-5.0, epoch-specific fT4
S['fx2']=[classify(t,f,0.5,5.0,fl,fh) for t,f,fl,fh in S[['TSH','fT4','fT4_lo','fT4_hi']].itertuples(index=False)]
print('\nFixed TSH + method-specific fT4'); print(pd.crosstab(S.epoch,S.fx2,normalize='index').reindex(columns=ORDER).mul(100).round(2).to_string())
print(S.fx2.value_counts(normalize=True).reindex(ORDER).mul(100).round(2).to_string())
# absolute clinical thresholds
print('TSH>=10', (I.TSH>=10).sum(), 'TSH<0.1', (I.TSH<0.1).sum(), 'TSH>5', (I.TSH>5).sum(), 'TSH<0.5',(I.TSH<0.5).sum())
S.to_pickle('index_sens.pkl')
# --- testing patterns
PP=P[P.pid.isin(I.pid)&(P.date>=pd.Timestamp('2014-11-01'))&(P.age<18)]
npc=PP.groupby('pid').size(); print('\npairs per child', npc.describe().round(2).to_dict(), (npc>=2).mean().round(3), (npc>=5).mean().round(3))
print('total pairs in window for index children', len(PP))
# testing volume per year for index children
print(I.groupby(I.date.dt.year).size().to_dict())
