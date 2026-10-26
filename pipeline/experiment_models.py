"""Compare candidate fair-value models on the same honest time split (not used by the website).

All variants train on sales before TEST_FROM and predict every later sale. Printed per variant:
median absolute error, share within 10% and within 20%, overall and for homes with a known size.
"""

from __future__ import annotations

import math
import sys

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import RidgeCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from step4_model import TEST_FROM, baseline_per_m2, features, load, metrics


def ridge(cats, nums):
    pre = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), cats),
                             ("num", "passthrough", nums)])
    return Pipeline([("pre", pre), ("ridge", RidgeCV(alphas=np.logspace(-2, 2, 13)))])


def market_adjust(model, past, pred):
    """Unseen future quarters: carry the latest known market level forward (ridge only)."""
    names = model.named_steps["pre"].get_feature_names_out()
    coef = model.named_steps["ridge"].coef_
    q = [i for i, n in enumerate(names) if n == f"cat__quarter_{past['quarter'].max()}"]
    return pred * math.exp(coef[q[0]]) if q else pred


def report(name, future, pred):
    known = future["has_epc"].values == 1
    print(f"{name:42s} all {metrics(future['price'].values, pred)}", flush=True)
    print(f"{'':42s} sized {metrics(future['price'].values[known], pred[known])}", flush=True)


def main() -> int:
    df = load()
    cats, nums = features(df)
    df["is_flat"] = (df["property_type"] == "F").astype(int)
    df["lsoa_flat"] = df["lsoa_code"] + "_" + df["is_flat"].astype(str)
    df["log_area_flat"] = df["log_area"] * df["is_flat"]
    df["t"] = (df["date"] - df["date"].min()).dt.days / 365.25
    past, future = df[df["date"] < TEST_FROM], df[df["date"] >= TEST_FROM]

    known = future["has_epc"].values == 1
    print(f"Test sales: {len(future)}, with size {known.sum()}", flush=True)
    print(f"{'Per-m2 yardstick (sized homes only)':42s} {metrics(future['price'].values[known], baseline_per_m2(past, future[known]))}")

    # A. current ridge
    m = ridge(cats, nums).fit(past[cats + nums], past["log_price"])
    report("A ridge (current)", future, market_adjust(m, past, np.exp(m.predict(future[cats + nums]))))

    # B. ridge with neighbourhood x flat/house and size x flat
    cats_b, nums_b = cats + ["lsoa_flat"], nums + ["log_area_flat"]
    m = ridge(cats_b, nums_b).fit(past[cats_b + nums_b], past["log_price"])
    report("B ridge + area/flat interactions", future, market_adjust(m, past, np.exp(m.predict(future[cats_b + nums_b]))))

    # C. gradient boosting on location coordinates and the same features, time as a number
    gb_cats = ["type_tenure", "new_build", "epc_band"]
    gb_nums = ["la", "lo", "t", "log_area", "rooms_f", "has_epc", "log_station", "busy"]
    df["la"], df["lo"] = df["lat"], df["lon"]
    past, future = df[df["date"] < TEST_FROM], df[df["date"] >= TEST_FROM]
    X = lambda d: pd.concat([d[gb_nums], pd.get_dummies(d[gb_cats].astype(str))], axis=1)
    Xp, Xf = X(past).align(X(future), join="left", axis=1, fill_value=0)
    gb = HistGradientBoostingRegressor(max_iter=600, learning_rate=0.05, max_leaf_nodes=48, min_samples_leaf=20,
                                       l2_regularization=1.0, random_state=0).fit(Xp, past["log_price"])
    # Market drift past the training window: shift by the median residual of the last training quarter.
    last = past["quarter"] == past["quarter"].max()
    drift = float(np.median(past.loc[last, "log_price"] - gb.predict(Xp[last.values])))
    report("C gradient boosting (lat/lon)", future, np.exp(gb.predict(Xf) + drift))

    # D. blend of B and C
    m = ridge(cats_b, nums_b).fit(past[cats_b + nums_b], past["log_price"])
    pb = market_adjust(m, past, np.exp(m.predict(future[cats_b + nums_b])))
    pc = np.exp(gb.predict(Xf) + drift)
    report("D blend 50/50 of B and C", future, np.sqrt(pb * pc))
    return 0


if __name__ == "__main__":
    sys.exit(main())
