import pandas as pd, hashlib, numpy as np
import os
F=os.environ["THYROID_CSV"]  # path to the raw laboratory extract (never commit it)
df=pd.read_csv(F)
# pseudonymize immediately
df['pid']=df['PATIENT_ID'].map(lambda s: hashlib.sha256(s.encode()).hexdigest()[:12])
df=df.drop(columns=['PATIENT_ID'])
print(df.shape); print(df.dtypes)
print(df['TEST_NAME'].value_counts())
print(df['TEST_SUBGROUP'].value_counts())
print(df['GENDER'].value_counts(dropna=False))
print(df['AGE_AT_REQUEST'].describe())
df['dt']=pd.to_datetime(df['REQUEST_DATETIME_LOCAL'])
print(df['dt'].min(), df['dt'].max())
print('patients', df.pid.nunique())
print(df['RESULT_VALUE_IF_NUMERIC'].isna().groupby(df.TEST_NAME).sum())
nonnum=df[df.RESULT_VALUE_IF_NUMERIC.isna()]
print(nonnum.groupby('TEST_NAME').RESULT_VALUE_RAW.apply(lambda s: s.str.strip().value_counts().head(15).to_dict()))
for t in df.TEST_NAME.unique():
    v=df.loc[df.TEST_NAME==t,'RESULT_VALUE_IF_NUMERIC']
    print(t, v.describe(percentiles=[.01,.025,.05,.5,.95,.975,.99]).round(3).to_dict())
df.to_pickle('pseudo.pkl')
