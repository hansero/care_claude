# Pediatric thyroid phenotypes: analysis code

Code for the retrospective laboratory cohort study "Age- and Sex-Specific Biochemical Thyroid Phenotypes Among Children Undergoing Thyroid Function Testing". The manuscript is maintained as a Claude Doc; this folder holds only the analysis code.

**Data are not included and must never be committed.** The raw extract contains identifiable information about children. Patient identifiers are replaced by a one-way hash in the first script, and all intermediate files are written to the working directory (ignored by git).

## Run order

```bash
pip install pandas numpy scipy statsmodels ruptures
cd analysis
export THYROID_CSV=/path/to/subset_thyroid_function.csv
python3 profile.py        # pseudonymize, profile tests (writes pseudo.pkl)
python3 profile2.py       # censored values, yearly assay drift
python3 profile3.py       # quarterly distributions
python3 build_pairs.py    # child-date records, same-day TSH-fT4 pairs, monthly medians
python3 epochs.py         # PELT change points -> assay periods
python3 ri.py             # indirect reference limits by period x age band
python3 cohort.py         # index cohort and exclusion flow
python3 analysis1.py      # phenotype classification and prevalence by age and sex
python3 analysis2.py      # logistic models, single-year prevalence
python3 analysis3.py      # repeat-testing outcomes
python3 analysis4.py      # antibodies, sensitivity analyses, testing patterns
python3 tables.py         # numbers for manuscript tables
```

`classify.py` holds the phenotype definitions shared by the scripts.

## Key design choices

- Index test: each child's first-ever thyroid test, Nov 2014 to Dec 2023, age 30 days to <18 years, with same-day TSH and fT4.
- Assay periods: change points in monthly median fT4 (PELT, penalty 0.1, minimum segment 6 months).
- Reference limits: indirect, per assay period and age band (Box-Cox, iterative Tukey fences, 2.5th/97.5th percentiles).
- Repeat testing: first paired retest 28 to 730 days after the index test.
