import pandas as pd, numpy as np
def classify(TSH,fT4,tl,th,fl,fh):
    hiT, loT = TSH>th, TSH<tl
    hiF, loF = fT4>fh, fT4<fl
    if not hiT and not loT and not hiF and not loF: return 'Euthyroid'
    if hiT and not hiF and not loF: return 'Isolated elevated TSH'
    if hiT and loF: return 'Overt hypothyroid pattern'
    if loT and not hiF and not loF: return 'Isolated low TSH'
    if loT and hiF: return 'Overt hyperthyroid pattern'
    if not hiT and not loT and loF: return 'Isolated low fT4'
    if not hiT and not loT and hiF: return 'Isolated high fT4'
    if hiT and hiF: return 'High TSH with high fT4'
    if loT and loF: return 'Low TSH with low fT4'
ORDER=['Euthyroid','Isolated elevated TSH','Overt hypothyroid pattern','Isolated low TSH','Overt hyperthyroid pattern','Isolated low fT4','Isolated high fT4','High TSH with high fT4','Low TSH with low fT4']
