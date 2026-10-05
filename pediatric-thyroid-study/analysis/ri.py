import pandas as pd, numpy as np
from scipy import stats
rng=np.random.default_rng(2026)
P=pd.read_pickle('pairs_all.pkl')
EPOCHS=[('E1','2014-11-01','2017-04-30'),('E2','2017-05-01','2018-12-31'),('E3','2019-01-01','2021-06-30'),('E4','2021-07-01','2023-12-31')]
def epoch(d):
    for e,a,b in EPOCHS:
        if pd.Timestamp(a)<=d<=pd.Timestamp(b): return e
    return None
P['epoch']=P.date.map(epoch)
AGEB=[(30/365.25,1,'1–11 mo'),(1,6,'1–5 y'),(6,12,'6–11 y'),(12,18,'12–17 y')]
def ageband(a):
    for lo,hi,l in AGEB:
        if lo<=a<hi: return l
    return None
P['ageband']=P.age.map(ageband)
P.to_pickle('pairs_epoch.pkl')
def tukey_ri(x, nboot=500):
    x=np.asarray(x,float); x=x[x>0]
    lam=stats.boxcox(x)[1]
    tx=stats.boxcox(x,lam)
    keep=np.ones(len(x),bool)
    while True:
        q1,q3=np.percentile(tx[keep],[25,75]); iqr=q3-q1
        k2=keep&(tx>=q1-1.5*iqr)&(tx<=q3+1.5*iqr)
        if k2.sum()==keep.sum(): break
        keep=k2
    xr=x[keep]
    lo,hi=np.percentile(xr,[2.5,97.5])
    bs=np.array([np.percentile(rng.choice(xr,len(xr)),[2.5,97.5]) for _ in range(nboot)])
    return dict(n_in=len(x),n_ref=int(keep.sum()),lo=lo,hi=hi,lo_ci=tuple(np.percentile(bs[:,0],[5,95])),hi_ci=tuple(np.percentile(bs[:,1],[5,95])))
rows=[]
for (e,ab),g in P.dropna(subset=['epoch','ageband']).groupby(['epoch','ageband']):
    g=g.sort_values('date').drop_duplicates('pid')  # one sample per child per partition
    f=tukey_ri(g.loc[(g.TSH>=0.5)&(g.TSH<=5.0),'fT4'])
    t=tukey_ri(g.loc[(g.fT4>=f['lo'])&(g.fT4<=f['hi']),'TSH'])
    rows.append(dict(epoch=e,ageband=ab,n_children=len(g),fT4_n=f['n_ref'],fT4_lo=f['lo'],fT4_hi=f['hi'],fT4_lo_ci=f['lo_ci'],fT4_hi_ci=f['hi_ci'],
                     TSH_n=t['n_ref'],TSH_lo=t['lo'],TSH_hi=t['hi'],TSH_lo_ci=t['lo_ci'],TSH_hi_ci=t['hi_ci']))
R=pd.DataFrame(rows); R.to_pickle('ri.pkl')
pd.set_option('display.width',250)
print(R[['epoch','ageband','n_children','fT4_n','fT4_lo','fT4_hi','TSH_n','TSH_lo','TSH_hi']].round(2).to_string())
print(R[['epoch','ageband','fT4_lo_ci','fT4_hi_ci','TSH_lo_ci','TSH_hi_ci']].map(lambda v: tuple(round(i,2) for i in v) if isinstance(v,tuple) else v).to_string())
