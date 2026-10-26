"""Step 4: fair-value model, honest test, and the files the website reads.

Model: a regularised (ridge) regression on log sale price. Every part of a predicted price can be
traced to a feature, which is what lets the site explain *why* a home is above or below fair value.
Features: property type, tenure, new build, sale quarter (market level), borough, neighbourhood
(LSOA, shrunk towards the borough when it has few sales), distance to a station, busy main road,
and - when EPC data is present - floor area, rooms and energy rating.

Test: train on sales before the cut-off date, predict every later sale, compare with a simple
baseline (median price of the same type in the same neighbourhood).
Each home's own verdict uses an out-of-fold estimate, so no home is valued by a model that saw it.

Outputs in public/data/: homes.json, nearby.json, areas.json, places.json, model.json
"""

from __future__ import annotations

import json
import math
import sys

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from config import PLACES, PROCESSED, PUBLIC

TEST_FROM = "2025-07-01"
TYPE_NAMES = {"F": "Flat", "T": "Terraced house", "S": "Semi-detached house", "D": "Detached house"}
TENURE_NAMES = {"F": "Freehold", "L": "Leasehold"}


def load() -> pd.DataFrame:
    sales = pd.read_csv(PROCESSED / "sales.csv", dtype=str)
    sales["price"] = sales["price"].astype(int)
    pc = pd.read_csv(PROCESSED / "postcodes.csv")
    nearby = pd.read_csv(PROCESSED / "nearby.csv")
    pc = pc[pc["borough"].isin(["Islington", "Hammersmith and Fulham"])]  # drops mis-recorded addresses
    df = sales.merge(pc[["postcode", "lat", "lon", "lsoa_code"]], on="postcode", how="inner") \
              .merge(nearby[["postcode", "station_m", "main_road_m", "street_feel"]], on="postcode", how="left")
    df = df.dropna(subset=["lat", "lsoa_code"])
    epc_path = PROCESSED / "epc_matched.csv"
    if epc_path.exists():
        epc = pd.read_csv(epc_path, dtype={"transaction_id": str})
        df = df.merge(epc, on="transaction_id", how="left")
    df["date"] = pd.to_datetime(df["date"])
    df["quarter"] = df["date"].dt.year.astype(str) + "Q" + df["date"].dt.quarter.astype(str)
    df["type_tenure"] = df["property_type"] + df["tenure"]
    df["log_station"] = np.log1p(df["station_m"].fillna(df["station_m"].median()))
    df["busy"] = (df["street_feel"] == "busy").astype(int)
    df["address_key"] = df["postcode"] + "|" + df["paon"].fillna("") + "|" + df["saon"].fillna("")
    df["log_price"] = np.log(df["price"])
    return df.reset_index(drop=True)


def features(df: pd.DataFrame) -> tuple[list[str], list[str]]:
    cats = ["type_tenure", "new_build", "quarter", "borough_name", "lsoa_code"]
    nums = ["log_station", "busy"]
    if "floor_area" in df and df["floor_area"].notna().mean() > 0.3:
        df["has_epc"] = df["floor_area"].notna().astype(int)
        df["log_area"] = np.log(df["floor_area"].fillna(df.groupby("type_tenure")["floor_area"].transform("median")))
        df["rooms_f"] = df["rooms"].fillna(df["rooms"].median())
        df["epc_band"] = df["energy_band"].fillna("unknown")
        cats.append("epc_band")
        nums += ["log_area", "rooms_f", "has_epc"]
        # Flats and houses are priced differently in each neighbourhood, and size matters
        # differently for flats: these two interactions tie the model to the per-m2 yardstick.
        df["is_flat"] = (df["property_type"] == "F").astype(int)
        df["lsoa_flat"] = df["lsoa_code"] + "_" + df["is_flat"].astype(str)
        df["log_area_flat"] = df["log_area"] * df["is_flat"]
        cats.append("lsoa_flat")
        nums.append("log_area_flat")
    return cats, nums


def make_model(cats, nums) -> Pipeline:
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), cats),
        ("num", "passthrough", nums),
    ])
    return Pipeline([("pre", pre), ("ridge", RidgeCV(alphas=np.logspace(-2, 2, 13)))])


def metrics(actual, predicted) -> dict:
    err = np.abs(predicted / actual - 1)
    return {"median_abs_error": round(float(np.median(err)), 4),
            "within_10pct": round(float((err <= 0.10).mean()), 4),
            "within_20pct": round(float((err <= 0.20).mean()), 4), "n": int(len(err))}


def baseline_per_m2(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    """Yardstick when floor area is known: neighbourhood median price per m2 x floor area."""
    t = train.dropna(subset=["floor_area"]).copy()
    t["ppm2"] = t["price"] / t["floor_area"]
    by_area = t.groupby(["lsoa_code", "property_type"])["ppm2"].agg(["median", "count"])
    by_borough = t.groupby(["borough_name", "property_type"])["ppm2"].median()
    out = []
    for row in test.itertuples():
        key = (row.lsoa_code, row.property_type)
        if key in by_area.index and by_area.loc[key, "count"] >= 3:
            rate = by_area.loc[key, "median"]
        else:
            rate = by_borough.get((row.borough_name, row.property_type), t["ppm2"].median())
        out.append(rate * row.floor_area)
    return np.asarray(out, dtype=float)


def baseline_predict(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    by_area = train.groupby(["lsoa_code", "property_type"])["price"].agg(["median", "count"])
    by_borough = train.groupby(["borough_name", "property_type"])["price"].median()
    out = []
    for row in test.itertuples():
        key = (row.lsoa_code, row.property_type)
        if key in by_area.index and by_area.loc[key, "count"] >= 3:
            out.append(by_area.loc[key, "median"])
        else:
            out.append(by_borough.get((row.borough_name, row.property_type), train["price"].median()))
    return np.asarray(out, dtype=float)


def contributions(model: Pipeline, X: pd.DataFrame, cats, nums) -> pd.DataFrame:
    """Per-home contribution of each feature group to log price, relative to the average home."""
    pre = model.named_steps["pre"]
    coef = model.named_steps["ridge"].coef_
    Z = pre.transform(X)
    names = pre.get_feature_names_out()
    groups = {}
    for i, name in enumerate(names):
        kind, col = name.split("__", 1)
        base = col
        if kind == "cat":
            for c in cats:
                if col.startswith(c + "_"):
                    base = c
                    break
        groups.setdefault(base, []).append(i)
    contrib = pd.DataFrame({g: Z[:, idx] @ coef[idx] for g, idx in groups.items()}, index=X.index)
    contrib.attrs["mean"] = contrib.mean().to_dict()
    centred = contrib - contrib.mean()
    centred.attrs["mean"] = contrib.attrs["mean"]
    return centred


GROUP_LABELS = {
    "type_tenure": "Type and tenure", "new_build": "New build", "quarter": "When it sold",
    "borough_name": "Borough", "lsoa_code": "Neighbourhood", "log_station": "Distance to a station",
    "busy": "On a busy main road", "log_area": "Floor area", "rooms_f": "Number of rooms",
    "lsoa_flat": "Neighbourhood", "log_area_flat": "Floor area",
    "epc_band": "Energy rating", "has_epc": "Energy certificate on record",
}


def display_label(label: str, row) -> str:
    """Name the actual feature of this home, e.g. 'Leasehold flat' rather than 'Type and tenure'."""
    if label == "Type and tenure":
        kind = TYPE_NAMES.get(row["property_type"], "Home").lower()
        return f"{TENURE_NAMES.get(row['tenure'], '')} {kind}".strip().capitalize()
    if label == "New build":
        return "New build" if row["new_build"] == "Y" else "Not a new build"
    if label == "On a busy main road":
        return "On a busy main road" if row["busy"] == 1 else "Away from busy main roads"
    if label == "Floor area" and pd.notna(row.get("floor_area")):
        return f"Floor area ({int(row['floor_area'])} m²)"
    if label == "Energy rating":
        return f"Energy rating {row['energy_band']}" if isinstance(row.get("energy_band"), str) else "No energy certificate"
    if label == "Distance to a station" and pd.notna(row.get("station_m")):
        return f"Station {int(round(row['station_m'], -1))} m away"
    if label == "Number of rooms" and pd.notna(row.get("rooms")):
        return f"{int(row['rooms'])} rooms"
    return label


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    df = load()
    cats, nums = features(df)
    X = df[cats + nums]
    print(f"{len(df)} sales with locations; features: {cats + nums}", flush=True)

    # 1. Honest test: train on the past, predict the future.
    past, future = df[df["date"] < TEST_FROM], df[df["date"] >= TEST_FROM]
    m = make_model(cats, nums).fit(past[cats + nums], past["log_price"])
    pred_future = np.exp(m.predict(future[cats + nums]))
    # Future quarters are unseen: the encoder ignores them, so add the latest known market level.
    last_q = past["quarter"].max()
    names = m.named_steps["pre"].get_feature_names_out()
    coef = m.named_steps["ridge"].coef_
    q_idx = [i for i, n in enumerate(names) if n == f"cat__quarter_{last_q}"]
    if q_idx:
        pred_future = pred_future * math.exp(coef[q_idx[0]])
    model_test = metrics(future["price"].values, pred_future)
    base_test = metrics(future["price"].values, baseline_predict(past, future))
    print(f"TEST from {TEST_FROM}: model {model_test} | baseline {base_test}", flush=True)
    base_m2_test = None
    model_known = None
    if "floor_area" in df:
        known = future["floor_area"].notna().values
        if known.sum() >= 200:
            base_m2_test = metrics(future["price"].values[known], baseline_per_m2(past, future[known]))
            model_known = metrics(future["price"].values[known], pred_future[known])
            print(f"Homes with floor area ({known.sum()}): model {model_known} | per-m2 baseline {base_m2_test}", flush=True)
    by_type = {}
    for t, name in TYPE_NAMES.items():
        mask = (future["property_type"] == t).values
        if mask.sum() >= 30:
            by_type[name] = metrics(future["price"].values[mask], pred_future[mask])
    print("By type:", by_type, flush=True)

    # 2. Out-of-fold fair values for every home (grouped by address so repeat sales don't leak).
    oof = np.zeros(len(df))
    for train_idx, test_idx in GroupKFold(n_splits=5).split(X, groups=df["address_key"]):
        fold = make_model(cats, nums).fit(X.iloc[train_idx], df["log_price"].iloc[train_idx])
        oof[test_idx] = fold.predict(X.iloc[test_idx])
    df["fair"] = np.exp(oof)
    oof_metrics = metrics(df["price"].values, df["fair"].values)
    band = round(float(np.median(np.abs(df["price"] / df["fair"] - 1))), 3)
    print(f"Out-of-fold: {oof_metrics}; fair band ±{band:.1%}", flush=True)
    diff = df["price"] / df["fair"] - 1
    df["verdict"] = np.where(diff > band, "above", np.where(diff < -band, "below", "fair"))
    print(df["verdict"].value_counts().to_string(), flush=True)

    # 3. Final model on everything, for explanations and the "check a listing" tool.
    final = make_model(cats, nums).fit(X, df["log_price"])
    contrib = contributions(final, X, cats, nums)

    nearby = pd.read_csv(PROCESSED / "nearby.csv")
    areas = pd.read_csv(PROCESSED / "areas.csv")
    places = pd.read_csv(PROCESSED / "places.csv")

    homes = []
    for i, row in df.iterrows():
        merged: dict[str, float] = {}
        for g in contrib.columns:
            if g in ("quarter", "has_epc"):
                continue
            label = display_label(GROUP_LABELS.get(g, g), row)
            merged[label] = merged.get(label, 0.0) + float(contrib.at[i, g])
        parts = sorted(merged.items(), key=lambda kv: -abs(kv[1]))
        why = [[label, round(math.exp(v) - 1, 3)] for label, v in parts[:4] if abs(v) >= 0.02]
        addr = " ".join(x for x in [row["saon"], row["paon"], row["street"]] if isinstance(x, str) and x)
        rec = {
            "id": row["transaction_id"].strip("{}").replace("-", "")[:12],
            "a": addr.title(), "pc": row["postcode"], "b": "I" if row["borough_name"] == "Islington" else "H",
            "la": round(row["lat"], 5), "lo": round(row["lon"], 5), "l": row["lsoa_code"],
            "p": int(row["price"]), "d": row["date"].strftime("%Y-%m-%d"),
            "t": row["property_type"], "te": row["tenure"], "n": 1 if row["new_build"] == "Y" else 0,
            "f": int(round(row["fair"], -3)), "v": row["verdict"], "w": why,
        }
        if "floor_area" in df and pd.notna(row.get("floor_area")):
            rec["m2"] = int(row["floor_area"])
            if pd.notna(row.get("rooms")):
                rec["r"] = int(row["rooms"])
            if isinstance(row.get("energy_band"), str):
                rec["e"] = row["energy_band"]
        homes.append(rec)
    ids = [h["id"] for h in homes]
    if len(set(ids)) != len(ids):
        raise RuntimeError(f"Home ids are not unique: {len(ids) - len(set(ids))} duplicates")
    homes.sort(key=lambda h: h["d"], reverse=True)
    (PUBLIC / "homes.json").write_text(json.dumps(homes, separators=(",", ":")))

    nb = {}
    for row in nearby.to_dict("records"):
        nb[row["postcode"]] = {k: (int(v) if isinstance(v, (int, np.integer)) or (isinstance(v, float) and v.is_integer()) else v)
                               for k, v in row.items() if k != "postcode" and pd.notna(v)}
    (PUBLIC / "nearby.json").write_text(json.dumps(nb, separators=(",", ":")))

    ps = areas["crime_personal_safety"]
    areas["safety_pct"] = ps.rank(pct=True).round(3)
    area_out = {}
    for row in areas.to_dict("records"):
        area_out[row["lsoa_code"]] = {k: (None if (isinstance(v, float) and math.isnan(v)) else v)
                                      for k, v in row.items() if k != "lsoa_code"}
    (PUBLIC / "areas.json").write_text(json.dumps(area_out, separators=(",", ":")))

    keep = places[places["kind"].isin(["station", "supermarket", "starbucks", "gym", "park", "pharmacy", "cafe"])]
    (PUBLIC / "places.json").write_text(json.dumps(
        [[r.kind, r.name, round(r.lat, 5), round(r.lon, 5)] for r in keep.itertuples()], separators=(",", ":")))

    pre = final.named_steps["pre"]
    model_json = {
        "intercept": float(final.named_steps["ridge"].intercept_),
        "alpha": float(final.named_steps["ridge"].alpha_),
        "coef": {n: float(c) for n, c in zip(pre.get_feature_names_out(), final.named_steps["ridge"].coef_)},
        "categorical": cats, "numeric": nums, "latest_quarter": df["quarter"].max(),
        "fair_band": band, "test_from": TEST_FROM,
        "test": {"model": model_test, "baseline": base_test, "baseline_per_m2": base_m2_test,
                 "model_sized": model_known, "by_type": by_type},
        "out_of_fold": oof_metrics,
        "sales": int(len(df)), "first_sale": df["date"].min().strftime("%Y-%m-%d"),
        "last_sale": df["date"].max().strftime("%Y-%m-%d"),
        "crime_months": str(areas["crime_months"].iloc[0]) if "crime_months" in areas else "",
        "places": {k: {"name": v[0], "lat": v[1], "lon": v[2]} for k, v in PLACES.items()},
        "verdicts": df["verdict"].value_counts().to_dict(),
        "epc": "log_area" in nums,
        # Average contribution of each group, so the browser can explain a listing the same way.
        "contrib_mean": (lambda means: {lab: sum(float(v) for g, v in means.items() if GROUP_LABELS.get(g, g) == lab)
                                        for lab in {GROUP_LABELS.get(g, g) for g in means}})(contrib.attrs["mean"]),
        "fill": ({
            "log_area_by_type_tenure": {k: float(v) for k, v in df.groupby("type_tenure")["log_area"].median().items()},
            "rooms_median": float(df["rooms_f"].median()),
        } if "log_area" in nums else None),
    }
    (PUBLIC / "model.json").write_text(json.dumps(model_json, indent=1))
    for f in PUBLIC.glob("*.json"):
        print(f"{f.name}: {f.stat().st_size / 1e6:.2f} MB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
