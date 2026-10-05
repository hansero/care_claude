import pandas as pd, numpy as np, json
W=pd.read_pickle('child_dates.pkl')   # per child-date, all tests (numeric)
P=pd.read_pickle('pairs_epoch.pkl')
R=pd.read_pickle('ri.pkl')
flow={}
flow['children_any_record']=27484
th=W[W.TSH.notna()|W.fT4.notna()].sort_values('date')
flow['children_with_numeric_TSH_or_fT4']=th.pid.nunique()
first=th.drop_duplicates('pid').copy()
start,end=pd.Timestamp('2014-11-01'),pd.Timestamp('2023-12-31')
flow['excl_first_test_before_window']=int((first.date<start).sum())
f=first[first.date>=start]
flow['excl_first_test_neonatal_lt30d']=int((f.age<30/365.25).sum()); f=f[f.age>=30/365.25]
flow['excl_age_ge18']=int((f.age>=18).sum()); f=f[f.age<18]
flow['excl_sex_missing']=int(f.sex.isna().sum())
flow['excl_first_date_not_paired']=int((f.TSH.isna()|f.fT4.isna()).sum()); f=f[f.TSH.notna()&f.fT4.notna()]
flow['index_children']=len(f)
print(json.dumps(flow,indent=1))
# attach epoch/ageband via P
idx=P.merge(f[['pid','date']],on=['pid','date'])
assert len(idx)==len(f)
# merge E1 adolescents with 6-11 limits (n<120 reference children)
R2=R.set_index(['epoch','ageband'])
def lim(e,ab):
    if e=='E1' and ab=='12–17 y': ab='6–11 y'
    return R2.loc[(e,ab)]
L=idx.apply(lambda r: lim(r.epoch,r.ageband)[['TSH_lo','TSH_hi','fT4_lo','fT4_hi']],axis=1)
idx=pd.concat([idx,L],axis=1)
print(idx.epoch.value_counts().sort_index().to_dict(), idx.ageband.value_counts().to_dict(), idx.sex.value_counts().to_dict())
idx.to_pickle('index.pkl'); json.dump(flow,open('flow.json','w'))
