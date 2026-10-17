"""Flatten FDC Foundation (2026-04) + SR Legacy (2018-04) into one table of per-100g macros."""
import pandas as pd
NUTS = {1008:'kcal',2047:'kcal_atw_gen',2048:'kcal_atw_spec',1003:'protein',1005:'carbs',1004:'fat',1079:'fiber'}
out=[]
for d,kind,idfile in [('ff','foundation','foundation_food.csv'),('sr','sr_legacy','sr_legacy_food.csv')]:
    food=pd.read_csv(f'{d}/food.csv',dtype={'fdc_id':int})
    ids=set(pd.read_csv(f'{d}/{idfile}')['fdc_id'])
    food=food[food.fdc_id.isin(ids)]
    fn=pd.read_csv(f'{d}/food_nutrient.csv',usecols=['fdc_id','nutrient_id','amount'])
    fn=fn[fn.fdc_id.isin(ids)&fn.nutrient_id.isin(NUTS)]
    p=fn.pivot_table(index='fdc_id',columns='nutrient_id',values='amount',aggfunc='first').rename(columns=NUTS)
    m=food[['fdc_id','description']].merge(p,left_on='fdc_id',right_index=True,how='left')
    m['data_type']=kind; out.append(m)
t=pd.concat(out)
t.to_csv('fdc_flat.csv',index=False)
print(len(t), t.data_type.value_counts().to_dict())
