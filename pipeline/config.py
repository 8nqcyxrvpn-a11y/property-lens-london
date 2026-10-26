"""Shared settings for the Property Lens London data pipeline."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "pipeline" / "raw"          # large downloads, not committed
PROCESSED = ROOT / "data" / "processed"   # small, committed intermediate tables
PUBLIC = ROOT / "public" / "data"         # what the website reads

# Land Registry "District" values for the boroughs covered.
BOROUGHS = {
    "ISLINGTON": "Islington",
    "HAMMERSMITH AND FULHAM": "Hammersmith & Fulham",
}
YEARS = [2022, 2023, 2024, 2025, 2026]
PRICE_PAID_URL = "https://price-paid-data.publicdata.landregistry.gov.uk/pp-{year}.csv"

PRICE_PAID_COLUMNS = [
    "transaction_id", "price", "date", "postcode", "property_type", "new_build",
    "tenure", "paon", "saon", "street", "locality", "town", "district", "county",
    "ppd_category", "record_status",
]

# Fixed places for pre-computed travel times (name, lat, lon).
PLACES = {
    "lse": ("LSE", 51.51442, -0.11648),
    "ucl": ("UCL", 51.52456, -0.13400),
    "kcl": ("King's College London (Strand)", 51.51150, -0.11600),
    "city": ("City St George's (Northampton Square)", 51.52770, -0.10250),
    "imperial": ("Imperial College (South Kensington)", 51.49880, -0.17490),
    "soas": ("SOAS", 51.52250, -0.12900),
}

IMD_URL = ("https://assets.publishing.service.gov.uk/media/691ded56d140bbbaa59a2a7d/"
           "File_7_IoD2025_All_Ranks_Scores_Deciles_Population_Denominators.csv")

USER_AGENT = "PropertyLensLondon/1.0 (academic portfolio project; contact via GitHub 8nqcyxrvpn-a11y)"

# ONS Price Index of Private Rents: monthly average rents by local authority and bedrooms.
RENTS_PAGE = ("https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/"
              "priceindexofprivaterentsukmonthlypricestatistics")
RENTS_FALLBACK_URL = ("https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/datasets/"
                      "priceindexofprivaterentsukmonthlypricestatistics/25march2026/"
                      "priceindexofprivaterentsukmonthlypricestatistics.xlsx")
