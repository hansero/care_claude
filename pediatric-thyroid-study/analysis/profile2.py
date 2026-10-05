import pandas as pd, numpy as np
df=pd.read_pickle('pseudo.pkl')
df['raw']=df.RESULT_VALUE_RAW.astype(str).str.strip()
for t in ['TSH','Serbest T4','Anti TPO','Anti TG']:
    nn=df[(df.TEST_NAME==t)&df.RESULT_VALUE_IF_NUMERIC.isna()]
    print('==',t, len(nn)); print(nn.raw.value_counts().head(25).to_string())
    # censored with numeric parse?
    cen=df[(df.TEST_NAME==t)&df.raw.str.match(r'^[<>]')]
    print('censored', cen.raw.value_counts().head(10).to_dict())
df['year']=df.dt.dt.year
print(df[df.TEST_NAME=='TSH'].groupby('year').RESULT_VALUE_IF_NUMERIC.agg(['count','median',lambda s:s.quantile(.025),lambda s:s.quantile(.975)]).round(2).to_string())
print(df[df.TEST_NAME=='Serbest T4'].groupby('year').RESULT_VALUE_IF_NUMERIC.agg(['count','median',lambda s:s.quantile(.025),lambda s:s.quantile(.975)]).round(2).to_string())
# time-of-day
print(df.dt.dt.hour.value_counts().sort_index().to_dict())
# exact duplicates
print('dup rows', df.duplicated(['pid','dt','TEST_NAME']).sum())
