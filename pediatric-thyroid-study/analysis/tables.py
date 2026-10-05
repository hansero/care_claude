import pandas as pd, numpy as np
from statsmodels.stats.proportion import proportion_confint
from scipy import stats
from classify import ORDER
I=pd.read_pickle('index_cls.pkl'); F=pd.read_pickle('followup.pkl'); R=pd.read_pickle('ri.pkl')
def mi(s): return f'{s.median():.2f} ({s.quantile(.25):.2f}–{s.quantile(.75):.2f})'
print('== Table 1')
for lab,g in [('All',I),('Female',I[I.sexl=='Female']),('Male',I[I.sexl=='Male'])]:
    print(lab, len(g), 'age', f'{g.age.median():.1f} ({g.age.quantile(.25):.1f}–{g.age.quantile(.75):.1f})', 'TSH', mi(g.TSH), 'fT4', mi(g.fT4))
    print('  ageband', g.ageband.value_counts().reindex(['1–11 mo','1–5 y','6–11 y','12–17 y']).map(lambda v: f'{v} ({100*v/len(g):.1f})').to_dict())
    print('  epoch', g.epoch.value_counts().sort_index().map(lambda v: f'{v} ({100*v/len(g):.1f})').to_dict())
    print('  pheno', g.pheno.value_counts().reindex(ORDER).fillna(0).astype(int).map(lambda v: f'{v} ({100*v/len(g):.2f})').to_dict())
    print('  retested', g.retested.sum(), f'{100*g.retested.mean():.1f}')
print('p age sex', stats.mannwhitneyu(I[I.sexl=='Female'].age,I[I.sexl=='Male'].age).pvalue, 'TSH',stats.mannwhitneyu(I[I.sexl=='Female'].TSH,I[I.sexl=='Male'].TSH).pvalue,'fT4',stats.mannwhitneyu(I[I.sexl=='Female'].fT4,I[I.sexl=='Male'].fT4).pvalue)
print('p ageband x sex', stats.chi2_contingency(pd.crosstab(I.ageband,I.sexl)).pvalue, 'p pheno x sex', stats.chi2_contingency(pd.crosstab(I.pheno,I.sexl)).pvalue)
print('== subgroup detail')
g=I[I.pheno=='Isolated elevated TSH']; print('IET TSH', mi(g.TSH), 'n>=10', (g.TSH>=10).sum(), 'fT4', mi(g.fT4))
g=I[I.pheno=='Isolated low TSH']; print('ILT TSH', mi(g.TSH), '<0.1', (g.TSH<0.1).sum(), '<0.4',(g.TSH<0.4).sum())
g=I[I.pheno=='Overt hyperthyroid pattern']; print('OHyper TSH', mi(g.TSH), '<0.1',(g.TSH<0.1).sum(), 'fT4', mi(g.fT4), g.sexl.value_counts().to_dict(), g.ageband.value_counts().to_dict())
g=I[I.pheno=='Overt hypothyroid pattern']; print('OHypo TSH', mi(g.TSH), '>=10',(g.TSH>=10).sum(), 'fT4', mi(g.fT4), g.sexl.value_counts().to_dict(), g.ageband.value_counts().to_dict())
print('discordant total', I.pheno.isin(ORDER[5:]).sum(), 100*I.pheno.isin(ORDER[5:]).mean())
print('LLN/ULN ranges', R[['TSH_lo','TSH_hi','fT4_lo','fT4_hi']].drop(index=0).agg(['min','max']).round(2).to_dict())
print('== Table 3 prev by ageband sex (4 main + eu)')
O=pd.read_csv('prev_ab_sex.csv')
for ph in ['Euthyroid','Isolated elevated TSH','Overt hypothyroid pattern','Isolated low TSH','Overt hyperthyroid pattern','Isolated low fT4','Isolated high fT4']:
    s=O[O.pheno==ph]
    print(ph, {f"{r.ageband}|{r.sex}": f"{r.n} ({r.pct:.1f}; {r.lo:.1f}–{r.hi:.1f})" for r in s.itertuples()})
print('ageband totals', I.groupby(['ageband','sexl'],observed=True).size().to_dict())
# by age band totals both sexes
for ph in ['Isolated elevated TSH','Isolated low TSH','Overt hypothyroid pattern','Overt hyperthyroid pattern']:
    print(ph, {ab: f"{(g.pheno==ph).sum()} ({100*(g.pheno==ph).mean():.2f})" for ab,g in I.groupby('ageband',observed=True)}, 'sex', {s: f"{(g.pheno==ph).sum()} ({100*(g.pheno==ph).mean():.2f})" for s,g in I.groupby('sexl')})
print('== followup')
print('retested total', len(F), f'{100*len(F)/len(I):.1f}', 'gap', F.gap.median(), F.gap.quantile(.25), F.gap.quantile(.75))
ab=F[F.ipheno!='Euthyroid']; print('abnormal index retested', len(ab), 'of', (I.pheno!='Euthyroid').sum())
