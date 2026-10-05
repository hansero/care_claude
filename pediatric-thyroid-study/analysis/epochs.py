import pandas as pd, numpy as np, ruptures as rpt
mon=pd.read_pickle('monthly.pkl')
mon=mon[mon.n>=10]  # stable medians
sig=mon[['fT4']].values
for pen in [0.05,0.1,0.2,0.3]:
    algo=rpt.Pelt(model='l2',min_size=6).fit(sig)
    bk=algo.predict(pen=pen)
    starts=[mon.index[0]]+[mon.index[b] for b in bk[:-1]]
    print(pen, [str(s) for s in starts])
# per-segment summary for chosen pen
algo=rpt.Pelt(model='l2',min_size=6).fit(sig); bk=algo.predict(pen=0.1)
seg=np.zeros(len(mon),int)
for i,b in enumerate(bk[:-1]): seg[b:]+=1
mon['seg']=seg
print(mon.groupby('seg').agg(start=('fT4',lambda s:str(s.index.min())),end=('fT4',lambda s:str(s.index.max())),months=('n','size'),n=('n','sum'),fT4=('fT4','median'),lTSH=('lTSH','median')).to_string())
