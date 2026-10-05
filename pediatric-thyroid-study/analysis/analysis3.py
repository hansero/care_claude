import pandas as pd, numpy as np, warnings
import statsmodels.formula.api as smf
from statsmodels.stats.proportion import proportion_confint
from classify import classify, ORDER
warnings.filterwarnings('ignore')
I=pd.read_pickle('index_cls.pkl')
P=pd.read_pickle('pairs_epoch.pkl')
R=pd.read_pickle('ri.pkl').set_index(['epoch','ageband'])
def lim(e,ab):
    if e=='E1' and ab=='12–17 y': ab='6–11 y'
    return R.loc[(e,ab)]
# subsequent pairs within window, age <18 (ageband defined), after index
F=P[P.pid.isin(I.pid)&P.epoch.notna()&P.ageband.notna()].merge(I[['pid','date','pheno','TSH','sexl','ageband','epoch']].rename(columns={'date':'idate','pheno':'ipheno','TSH':'iTSH','ageband':'iab','epoch':'iepoch'}),on='pid')
F['gap']=(F.date-F.idate).dt.days
F=F[(F.gap>=28)&(F.gap<=730)].sort_values(['pid','date']).drop_duplicates('pid')
L=F.apply(lambda r: lim(r.epoch,r.ageband)[['TSH_lo','TSH_hi','fT4_lo','fT4_hi']],axis=1); F=pd.concat([F,L],axis=1)
F['fpheno']=[classify(*r) for r in F[['TSH','fT4','TSH_lo','TSH_hi','fT4_lo','fT4_hi']].itertuples(index=False)]
F.to_pickle('followup.pkl')
# retest rates by index phenotype
I['retested']=I.pid.isin(F.pid)
rt=I.groupby('pheno').agg(N=('pid','size'),retested=('retested','sum')).reindex(ORDER)
rt['pct']=(100*rt.retested/rt.N).round(1); print(rt.to_string())
print('median gap days by index pheno'); print(F.groupby('ipheno').gap.describe()[['50%','25%','75%']].reindex(ORDER).to_string())
def outcome(r):
    if r.fpheno=='Euthyroid': return 'Normalized'
    if r.fpheno==r.ipheno: return 'Persistent'
    if r.ipheno=='Isolated elevated TSH' and r.fpheno=='Overt hypothyroid pattern': return 'Progressed'
    if r.ipheno=='Isolated low TSH' and r.fpheno=='Overt hyperthyroid pattern': return 'Progressed'
    if r.ipheno=='Overt hypothyroid pattern' and r.fpheno=='Isolated elevated TSH': return 'Improved (subclinical)'
    if r.ipheno=='Overt hyperthyroid pattern' and r.fpheno=='Isolated low TSH': return 'Improved (subclinical)'
    return 'Other abnormal'
F['outcome']=F.apply(outcome,axis=1)
print(pd.crosstab(F.ipheno,F.outcome,margins=True).reindex(ORDER+['All']).to_string())
ct=pd.crosstab(F.ipheno,F.fpheno).reindex(index=ORDER,columns=ORDER,fill_value=0); print(ct.to_string())
ct.to_csv('transition.csv')
for ph in ['Isolated elevated TSH','Isolated low TSH','Overt hypothyroid pattern','Overt hyperthyroid pattern','Euthyroid']:
    g=F[F.ipheno==ph]
    for o in ['Normalized','Persistent','Progressed']:
        v=(g.outcome==o).sum(); lo,hi=proportion_confint(v,len(g),method='wilson') if len(g) else (np.nan,np.nan)
        print(f'{ph:28s} {o:11s} {v:4d}/{len(g):4d} {100*v/max(len(g),1):5.1f} ({100*lo:.1f}-{100*hi:.1f})')
# for euthyroid index: new abnormality at retest
g=F[F.ipheno=='Euthyroid']; print('Euthyroid retest abnormal', (g.fpheno!='Euthyroid').sum(), len(g), g.fpheno.value_counts().to_dict())
# predictors of normalization in isolated elevated TSH
g=F[F.ipheno=='Isolated elevated TSH'].copy(); g['norm']=(g.outcome=='Normalized').astype(int)
g['female']=(g.sexl=='Female').astype(int)
g['tshcat']=np.where(g.iTSH>=10,'≥10',np.where(g.iTSH>=7,'7–<10','ULN–<7'))
print(g.groupby('tshcat').norm.agg(['sum','size','mean']).to_string())
print(g.groupby('sexl').norm.agg(['sum','size','mean']).to_string()); print(g.groupby('iab',observed=True).norm.agg(['sum','size','mean']).to_string())
g['ab2']=np.where(g.iab.astype(str).isin(['12–17 y']),'12–17 y',np.where(g.iab.astype(str)=='6–11 y','6–11 y','<6 y'))
m=smf.logit("norm ~ female + C(ab2, Treatment('<6 y')) + C(tshcat, Treatment('ULN–<7')) + np.log(gap)",g).fit(disp=0)
print(pd.DataFrame({'OR':np.exp(m.params),'lo':np.exp(m.conf_int()[0]),'hi':np.exp(m.conf_int()[1]),'p':m.pvalues}).round(3).to_string())
g2=F[F.ipheno=='Isolated low TSH'].copy(); g2['norm']=(g2.outcome=='Normalized').astype(int); g2['female']=(g2.sexl=='Female').astype(int)
print(g2.groupby('sexl').norm.agg(['sum','size','mean']).to_string())
F.to_pickle('followup.pkl'); I.to_pickle('index_cls.pkl')
