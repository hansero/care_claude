import pandas as pd, numpy as np, re
df=pd.read_pickle('pseudo.pkl')
df['raw']=df.RESULT_VALUE_RAW.astype(str).str.strip()
# parse censored values
def parse(row):
    v=row.RESULT_VALUE_IF_NUMERIC
    if pd.notna(v): return v, ''
    m=re.match(r'^([<>])\s*([0-9]+[.,]?[0-9]*)$', row.raw)
    if m: return float(m.group(2).replace(',','.')), m.group(1)
    return np.nan, ''
p=df.apply(parse, axis=1, result_type='expand'); df['val']=p[0]; df['cens']=p[1]
log={}
log['rows_total']=len(df); log['children_total']=df.pid.nunique()
log['rows_nonnumeric_excluded']=int(df.val.isna().sum())
d=df[df.val.notna()].copy()
d['date']=d.dt.dt.normalize()
keep=d[d.TEST_NAME.isin(['TSH','Serbest T4','Anti TPO','Anti TG','Serbest T3'])]
# per child-date-test: first measurement of the day
keep=keep.sort_values('dt')
first=keep.groupby(['pid','date','TEST_NAME']).agg(val=('val','first'),cens=('cens','first'),age=('AGE_AT_REQUEST','first'),sex=('GENDER','first'),dt=('dt','first')).reset_index()
w=first.pivot_table(index=['pid','date'],columns='TEST_NAME',values='val',aggfunc='first')
meta=first.groupby(['pid','date']).agg(age=('age','min'),sex=('sex','first'),dt=('dt','min'))
w=w.join(meta).reset_index().rename(columns={'Serbest T4':'fT4','Serbest T3':'fT3','Anti TPO':'TPOAb','Anti TG':'TgAb'})
w.to_pickle('child_dates.pkl')
pairs=w[w.TSH.notna()&w.fT4.notna()].copy()
log['pairs_all_ages']=len(pairs); log['children_pairs_all_ages']=pairs.pid.nunique()
print(log)
print('TSH-only dates', (w.TSH.notna()&w.fT4.isna()).sum(), 'fT4-only', (w.TSH.isna()&w.fT4.notna()).sum())
pairs.to_pickle('pairs_all.pkl')
# monthly fT4 & logTSH median for changepoints (all pairs, ages 1-18 to limit neonatal influence)
pp=pairs[(pairs.age>=1)&(pairs.age<18)].copy(); pp['m']=pp.date.dt.to_period('M')
mon=pp.groupby('m').agg(n=('fT4','size'),fT4=('fT4','median'),lTSH=('TSH',lambda s: np.log(s.clip(lower=0.001)).median()))
mon.to_pickle('monthly.pkl'); print(mon.n.describe())
