import pandas as pd, numpy as np
df=pd.read_pickle('pseudo.pkl')
df['ym']=df.dt.dt.to_period('Q')
f=df[df.TEST_NAME=='Serbest T4']; t=df[df.TEST_NAME=='TSH']
q=pd.DataFrame({'fT4_n':f.groupby('ym').size(),'fT4_med':f.groupby('ym').RESULT_VALUE_IF_NUMERIC.median(),
 'fT4_p2.5':f.groupby('ym').RESULT_VALUE_IF_NUMERIC.quantile(.025),'fT4_p97.5':f.groupby('ym').RESULT_VALUE_IF_NUMERIC.quantile(.975),
 'TSH_med':t.groupby('ym').RESULT_VALUE_IF_NUMERIC.median(),'TSH_p97.5':t.groupby('ym').RESULT_VALUE_IF_NUMERIC.quantile(.975)})
print(q.round(2).to_string())
# decimals precision by period (platform fingerprint)
f2=f.copy(); f2['dec']=f2.RESULT_VALUE_RAW.astype(str).str.strip().str.extract(r'\.(\d+)$')[0].str.len()
print(f2.groupby(f2.dt.dt.year).dec.agg(lambda s:s.value_counts().to_dict()).to_string())
t2=t.copy(); t2['dec']=t2.RESULT_VALUE_RAW.astype(str).str.strip().str.extract(r'\.(\d+)$')[0].str.len()
print(t2.groupby(t2.dt.dt.year).dec.agg(lambda s:s.value_counts().to_dict()).to_string())
