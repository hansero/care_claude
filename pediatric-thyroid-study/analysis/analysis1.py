import pandas as pd, numpy as np, json
from statsmodels.stats.proportion import proportion_confint
from scipy import stats
from classify import classify, ORDER
I=pd.read_pickle('index.pkl')
I['pheno']=[classify(*r) for r in I[['TSH','fT4','TSH_lo','TSH_hi','fT4_lo','fT4_hi']].itertuples(index=False)]
I['sexl']=I.sex.map({'K':'Female','E':'Male'})
I['sub']=np.where(I.pheno=='Isolated elevated TSH', np.where(I.TSH>=10,'marked','mild'),'')
I['sub2']=np.where(I.pheno=='Isolated low TSH', np.where(I.TSH<0.1,'<0.1','0.1-LLN'),'')
AB=['1–11 mo','1–5 y','6–11 y','12–17 y']
I['ageband']=pd.Categorical(I.ageband,AB,ordered=True)
I.to_pickle('index_cls.pkl')
pd.set_option('display.width',250)
print('Overall'); vc=I.pheno.value_counts().reindex(ORDER).fillna(0).astype(int)
for k,v in vc.items():
    lo,hi=proportion_confint(v,len(I),method='wilson'); print(f'{k:30s} {v:6d} {100*v/len(I):6.2f} ({100*lo:.2f}-{100*hi:.2f})')
print(I.groupby('pheno')['sub'].value_counts().to_string()); print(I.groupby('pheno')['sub2'].value_counts().to_string())
print('\nAge summary'); print(I.age.describe().round(2).to_dict()); print(I.groupby('sexl').age.describe().round(2).to_string())
print(pd.crosstab(I.ageband,I.sexl,margins=True).to_string())
print(I.groupby('sexl')[['TSH','fT4']].median().round(2).to_string())
print(I.groupby('ageband',observed=True)[['TSH','fT4']].quantile([.25,.5,.75]).round(2).unstack().to_string())
# by ageband x sex
tab=pd.crosstab([I.ageband,I.sexl],I.pheno).reindex(columns=ORDER,fill_value=0)
tab['N']=tab.sum(axis=1)
out=[]
for (ab,s),r in tab.iterrows():
    for ph in ORDER:
        v=r[ph]; lo,hi=proportion_confint(v,r.N,method='wilson')
        out.append(dict(ageband=ab,sex=s,pheno=ph,n=int(v),N=int(r.N),pct=100*v/r.N,lo=100*lo,hi=100*hi))
O=pd.DataFrame(out); O.to_csv('prev_ab_sex.csv',index=False)
print(O.pivot_table(index=['ageband','sex'],columns='pheno',values='pct',observed=True).reindex(columns=ORDER).round(2).to_string())
# sex comparison p-values within each ageband for each phenotype (Fisher/chi2 vs rest)
print('\nSex differences (phenotype vs all others) within age band')
for ab in AB:
    g=I[I.ageband==ab]
    for ph in ['Isolated elevated TSH','Overt hypothyroid pattern','Isolated low TSH','Overt hyperthyroid pattern']:
        ct=pd.crosstab(g.sexl,g.pheno==ph)
        if ct.shape==(2,2):
            p=stats.fisher_exact(ct.values)[1] if ct.values.min()<5 else stats.chi2_contingency(ct.values)[1]
            print(ab,ph,ct.values.tolist(),f'p={p:.4g}')
# overall chi2 across age bands per phenotype
for ph in ['Isolated elevated TSH','Overt hypothyroid pattern','Isolated low TSH','Overt hyperthyroid pattern']:
    ct=pd.crosstab(I.ageband,I.pheno==ph); print(ph,'age trend chi2 p=',stats.chi2_contingency(ct.values)[1])
# by epoch
print(pd.crosstab(I.epoch,I.pheno,normalize='index').reindex(columns=ORDER).mul(100).round(2).to_string())
