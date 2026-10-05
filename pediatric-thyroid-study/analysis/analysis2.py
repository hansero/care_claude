import pandas as pd, numpy as np, warnings
import statsmodels.formula.api as smf
from scipy import stats
from statsmodels.stats.proportion import proportion_confint
warnings.filterwarnings('ignore')
I=pd.read_pickle('index_cls.pkl')
I['female']=(I.sexl=='Female').astype(int)
I['ab']=I.ageband.astype(str)
def fit(ph, inter=True):
    d=I[I.pheno.isin(['Euthyroid',ph])].copy(); d['y']=(d.pheno==ph).astype(int)
    m0=smf.logit("y ~ female + C(ab, Treatment('1–5 y')) + C(epoch)",d).fit(disp=0)
    m1=smf.logit("y ~ female * C(ab, Treatment('1–5 y')) + C(epoch)",d).fit(disp=0)
    lr=2*(m1.llf-m0.llf); p_int=stats.chi2.sf(lr,m1.df_model-m0.df_model)
    ors=pd.DataFrame({'OR':np.exp(m0.params),'lo':np.exp(m0.conf_int()[0]),'hi':np.exp(m0.conf_int()[1]),'p':m0.pvalues})
    return ors, p_int, int(d.y.sum()), len(d)
for ph in ['Isolated elevated TSH','Isolated low TSH','Overt hypothyroid pattern','Overt hyperthyroid pattern']:
    ors,pi,ny,n=fit(ph)
    print(f'\n== {ph}: events {ny} / {n}; sex x age interaction LR p={pi:.3f}')
    print(ors.drop('Intercept').round(3).to_string())
# sex-specific ORs within age band (female vs male) for isolated elevated TSH & low TSH, adjusted for epoch
print('\nFemale vs male OR within age band (adj. epoch)')
for ph in ['Isolated elevated TSH','Isolated low TSH']:
    for ab in ['1–11 mo','1–5 y','6–11 y','12–17 y']:
        d=I[I.pheno.isin(['Euthyroid',ph])&(I.ab==ab)].copy(); d['y']=(d.pheno==ph).astype(int)
        m=smf.logit("y ~ female + C(epoch)",d).fit(disp=0)
        print(ph,ab,round(np.exp(m.params.female),2),np.exp(m.conf_int().loc['female']).round(2).tolist(),round(m.pvalues.female,4))
# Single-year-of-age prevalence by sex (for chart)
I['ay']=np.floor(I.age).clip(upper=17).astype(int)
rows=[]
for (a,s),g in I.groupby(['ay','sexl']):
    for ph,key in [('Isolated elevated TSH','iet'),('Isolated low TSH','ilt'),('Overt hypothyroid pattern','oho'),('Overt hyperthyroid pattern','ohe'),('Euthyroid','eu')]:
        v=(g.pheno==ph).sum(); lo,hi=proportion_confint(v,len(g),method='wilson')
        rows.append(dict(age=a,sex=s,pheno=key,n=int(v),N=len(g),pct=round(100*v/len(g),2),lo=round(100*lo,2),hi=round(100*hi,2)))
Y=pd.DataFrame(rows); Y.to_csv('prev_ageyear_sex.csv',index=False)
print(Y[Y.pheno.isin(['iet','ilt'])].pivot_table(index='age',columns=['pheno','sex'],values='pct').to_string())
print(Y[Y.pheno=='eu'].pivot_table(index='age',columns='sex',values='N').to_string())
