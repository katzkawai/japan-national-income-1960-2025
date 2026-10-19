#!/usr/bin/env python3
"""日本の国民所得（GDP / GNI）関連データを World Bank API から取得し data/data.json を生成する。

使い方:
    python3 scripts/fetch_data.py

外部依存なし（標準ライブラリのみ）。再現性のため取得日時と API の lastupdated を記録する。
"""

from __future__ import annotations

import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://api.worldbank.org/v2"
UA = "japan-national-income-dashboard/1.0"
START, END = 1960, 2025

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "data.json"
CACHE = ROOT / "data" / "cache"
USE_CACHE = "--no-cache" not in sys.argv

# 日本について取得する指標
JAPAN_INDICATORS = {
    "gdp_usd": "NY.GDP.MKTP.CD",          # 名目GDP（USドル）
    "gdp_const_usd": "NY.GDP.MKTP.KD",    # 実質GDP（2015年価格USドル）
    "gdp_pc_usd": "NY.GDP.PCAP.CD",       # 一人当たり名目GDP
    "gdp_pc_const_usd": "NY.GDP.PCAP.KD", # 一人当たり実質GDP
    "gni_usd": "NY.GNP.MKTP.CD",          # 名目GNI（USドル）
    "gni_pc_usd": "NY.GNP.PCAP.CD",       # 一人当たり名目GNI
    "gni_pc_ppp": "NY.GNP.PCAP.PP.CD",    # 一人当たりGNI（購買力平価）
    "gdp_pc_ppp": "NY.GDP.PCAP.PP.CD",    # 一人当たりGDP（購買力平価）
    "fx_jpy_usd": "PA.NUS.FCRF",          # 為替レート（円/USドル、期間平均）
    "consumption_share": "NE.CON.PRVT.ZS",  # 家計最終消費支出（GDP比）
    "capital_share": "NE.GDI.TOTL.ZS",    # 総資本形成（GDP比）
    "population": "SP.POP.TOTL",          # 人口
    "deflator_inflation": "NY.GDP.DEFL.KD.ZG",  # GDPデフレーター上昇率
}

# 世界GDPに占めるシェアの比較対象
COMPARE_COUNTRIES = ["JPN", "USA", "CHN", "DEU", "GBR", "FRA", "ITA", "CAN", "KOR", "IND"]
# 1人当たりGDP（購買力平価）の比較対象
COMPARE_PC_PPP = ["USA", "DEU", "KOR"]

# 一人当たりGNI の順位計算に使う比較対象（OECD 加盟国）
OECD = {
    "AUS", "AUT", "BEL", "CAN", "CHL", "COL", "CRI", "CZE", "DNK", "EST",
    "FIN", "FRA", "DEU", "GRC", "HUN", "ISL", "IRL", "ISR", "ITA", "JPN",
    "KOR", "LVA", "LTU", "LUX", "MEX", "NLD", "NZL", "NOR", "POL", "PRT",
    "SVK", "SVN", "ESP", "SWE", "CHE", "TUR", "GBR", "USA",
}

RANK_YEARS = [1970, 1980, 1990, 1995, 2000, 2005, 2010, 2015, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
DECADES = [
    ("1960年代", 1961, 1969), ("1970年代", 1970, 1979), ("1980年代", 1980, 1989),
    ("1990年代", 1990, 1999), ("2000年代", 2000, 2009), ("2010年代", 2010, 2019),
    ("2020年代", 2020, 2025),
]


def fetch_json(url: str, retries: int = 4):
    """URL を取得して JSON を返す。生レスポンスは data/cache/ に保存し再実行を速くする。"""
    import hashlib

    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(url.encode()).hexdigest()[:20]
    cached = CACHE / f"{key}.json"
    if USE_CACHE and cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))

    payload = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as res:
                payload = json.loads(res.read().decode("utf-8"))
            break
        except Exception as exc:  # noqa: BLE001 - ネットワークは再試行で吸収する
            if attempt == retries - 1:
                raise RuntimeError(f"取得に失敗しました: {url}: {exc}") from exc
            time.sleep(1.5 * (attempt + 1))

    cached.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload


def get(indicator: str, country: str, start: int = START, end: int = END):
    """World Bank API から 1 指標を取得し (meta, {year: value}) を返す。ページングに対応。"""
    query = urllib.parse.urlencode(
        {"format": "json", "per_page": 20000, "date": f"{start}:{end}"}
    )
    url = f"{API}/country/{country}/indicator/{indicator}?{query}"
    payload = fetch_json(url)
    if not isinstance(payload, list) or len(payload) < 2:
        raise RuntimeError(f"想定外のレスポンス: {indicator} ({country}): {str(payload)[:200]}")

    meta = payload[0]
    rows = list(payload[1] or [])
    for page in range(2, int(meta.get("pages") or 1) + 1):
        extra = fetch_json(f"{url}&page={page}")
        rows.extend(extra[1] or [])

    series = {}
    for row in rows:
        value = row.get("value")
        series[int(row["date"])] = None if value is None else float(value)
    return meta, series


def country_codes() -> set[str]:
    """実体国の ISO3 コード集合（世界銀行の地域集計を除外するため）。"""
    query = urllib.parse.urlencode({"format": "json", "per_page": 400})
    payload = fetch_json(f"{API}/country?{query}")
    codes = set()
    for row in payload[1] or []:
        # 集計値（World, 地域, 所得階層など）は region.id == "NA"
        if (row.get("region") or {}).get("id") == "NA":
            continue
        codes.add(row["id"])
    return codes


def align(series: dict[int, float | None], years: list[int]) -> list[float | None]:
    return [series.get(y) for y in years]


def fetch_rank_table(years: list[int], valid: set[str]):
    """全経済の一人当たり名目GNI を年ごとに取得し、順位表を作る。

    速報年は報告国が少なく順位が上振れするため、カバレッジ（国数）が最大年から
    10 か国以上少ない年は比較対象から除外する。
    """
    query = urllib.parse.urlencode(
        {"format": "json", "per_page": 20000, "date": f"{min(years)}:{max(years)}"}
    )
    url = f"{API}/country/all/indicator/NY.GNP.PCAP.CD?{query}"
    payload = fetch_json(url)
    rows = list(payload[1] or [])
    for page in range(2, int(payload[0].get("pages") or 1) + 1):
        rows.extend((fetch_json(f"{url}&page={page}")[1]) or [])

    by_year: dict[int, list[tuple[float, str]]] = {y: [] for y in years}
    for row in rows:
        year = int(row["date"])
        if year not in by_year:
            continue
        code = row.get("countryiso3code") or ""
        value = row.get("value")
        if code not in valid or value is None:
            continue
        by_year[year].append((float(value), code))

    coverage = {y: len(by_year[y]) for y in years}
    # 速報年は報告国が揃わず順位が上振れするため、直前の年より 3% 以上カバレッジが
    # 落ちる末尾の年は比較対象から外す（過去年のカバレッジ増加はそのまま残す）。
    usable = list(years)
    while len(usable) >= 2 and coverage[usable[-1]] < 0.97 * coverage[usable[-2]]:
        usable.pop()

    table: dict[int, list[dict]] = {}
    rank_all: dict[int, int | None] = {}
    rank_oecd: dict[int, int | None] = {}
    for year in usable:
        entries = sorted(by_year[year], key=lambda item: -item[0])
        ranked = [
            {"code": code, "value": value, "rank": i + 1}
            for i, (value, code) in enumerate(entries)
        ]
        oecd_entries = [e for e in ranked if e["code"] in OECD]
        rank_all[year] = next((e["rank"] for e in ranked if e["code"] == "JPN"), None)
        rank_oecd[year] = next(
            (i + 1 for i, e in enumerate(oecd_entries) if e["code"] == "JPN"), None
        )
        top = ranked[:12]
        if not any(e["code"] == "JPN" for e in top):
            top = top + [e for e in ranked if e["code"] == "JPN"]
        table[year] = top
    return table, rank_all, rank_oecd, usable, coverage


def pct_change(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or a == 0:
        return None
    return (b / a - 1.0) * 100.0


def main() -> int:
    print("World Bank API からデータを取得しています…", file=sys.stderr)
    valid_codes = country_codes()

    japan: dict[str, dict[int, float | None]] = {}
    last_updated = None
    for key, indicator in JAPAN_INDICATORS.items():
        meta, series = get(indicator, "JPN")
        japan[key] = series
        last_updated = last_updated or meta.get("lastupdated")
        print(f"  ✓ {key:22s} {indicator}", file=sys.stderr)
        time.sleep(0.2)

    # 名目GDP（円建て）= 名目GDP（ドル）× 為替レート
    gdp_jpy: dict[int, float | None] = {}
    for year, usd in japan["gdp_usd"].items():
        fx = japan["fx_jpy_usd"].get(year)
        gdp_jpy[year] = None if (usd is None or fx is None) else usd * fx
    japan["gdp_jpy"] = gdp_jpy

    # 実質GDP成長率
    growth: dict[int, float | None] = {}
    const = japan["gdp_const_usd"]
    for year in range(START + 1, END + 1):
        growth[year] = pct_change(const.get(year - 1), const.get(year))
    japan["growth_real"] = growth

    # 比較国（名目GDP）
    compare_series: dict[str, dict[int, float | None]] = {}
    for code in COMPARE_COUNTRIES:
        _, series = get("NY.GDP.MKTP.CD", code)
        compare_series[code] = series
        print(f"  ✓ {code} GDP", file=sys.stderr)
        time.sleep(0.15)

    # 比較国（1人当たりGDP・購買力平価）
    compare_pc_ppp: dict[str, dict[int, float | None]] = {}
    for code in COMPARE_PC_PPP:
        _, series = get("NY.GDP.PCAP.PP.CD", code)
        compare_pc_ppp[code] = series
        print(f"  ✓ {code} GDP/人 PPP", file=sys.stderr)
        time.sleep(0.15)

    # 世界GDP・世界シェア
    world_gdp = compare_series.get("WLD") or get("NY.GDP.MKTP.CD", "WLD")[1]
    share_world = {
        year: (None if (world_gdp.get(year) in (None, 0) or compare_series["JPN"].get(year) is None)
               else compare_series["JPN"][year] / world_gdp[year] * 100.0)
        for year in range(START, END + 1)
    }

    # 順位
    rank_table, rank_all, rank_oecd, rank_years, rank_coverage = fetch_rank_table(
        RANK_YEARS, valid_codes
    )
    rank_latest = max(rank_years)
    print(f"  ✓ 一人当たりGNI 順位（比較可能な最新年: {rank_latest}）", file=sys.stderr)

    # 分析用の年次範囲（データが揃っている年に限定）
    years = list(range(START, END + 1))

    # 10年ごとの平均実質成長率
    decades = []
    for label, first, last in DECADES:
        values = [growth[y] for y in range(first, last + 1) if growth.get(y) is not None]
        decades.append({
            "label": label,
            "avg_growth": round(sum(values) / len(values), 2) if values else None,
            "years": len(values),
        })

    def latest(series: dict[int, float | None]):
        for year in range(END, START - 1, -1):
            if series.get(year) is not None:
                return year, series[year]
        return None, None

    def peak(series: dict[int, float | None]):
        items = [(y, v) for y, v in series.items() if v is not None]
        if not items:
            return None, None
        return max(items, key=lambda item: item[1])

    latest_year, latest_share = latest(share_world)
    peak_share_year, peak_share = peak(share_world)
    peak_gni_year, peak_gni = peak(japan["gni_pc_usd"])
    latest_gni_year, latest_gni = latest(japan["gni_pc_usd"])
    latest_gni_ppp_year, latest_gni_ppp = latest(japan["gni_pc_ppp"])
    peak_usd_year, peak_usd = peak(japan["gdp_usd"])
    peak_jpy_year, peak_jpy = peak(japan["gdp_jpy"])
    latest_jpy_year, latest_jpy = latest(japan["gdp_jpy"])
    latest_const_year, latest_const = latest(japan["gdp_const_usd"])
    base_year = next(y for y in years if japan["gdp_const_usd"].get(y) is not None)

    stats = {
        "gni_pc_usd_peak_year": peak_gni_year,
        "gni_pc_usd_peak": peak_gni,
        "gni_pc_usd_latest_year": latest_gni_year,
        "gni_pc_usd_latest": latest_gni,
        "gni_pc_ppp_latest_year": latest_gni_ppp_year,
        "gni_pc_ppp_latest": latest_gni_ppp,
        "share_world_peak_year": peak_share_year,
        "share_world_peak": peak_share,
        "share_world_latest_year": latest_year,
        "share_world_latest": latest_share,
        "gdp_usd_peak_year": peak_usd_year,
        "gdp_usd_peak": peak_usd,
        "gdp_usd_latest_year": latest(japan["gdp_usd"])[0],
        "gdp_usd_latest": latest(japan["gdp_usd"])[1],
        "gdp_jpy_peak_year": peak_jpy_year,
        "gdp_jpy_peak": peak_jpy,
        "gdp_jpy_latest_year": latest_jpy_year,
        "gdp_jpy_latest": latest_jpy,
        "gdp_const_base_year": base_year,
        "gdp_const_latest_year": latest_const_year,
        "gdp_const_latest": latest_const,
        "gdp_const_multiple": latest_const / japan["gdp_const_usd"][base_year] if latest_const else None,
        "rank_latest_year": rank_latest,
        "rank_all_today": rank_all.get(rank_latest),
        "rank_oecd_today": rank_oecd.get(rank_latest),
        "rank_all_1990": rank_all.get(1990),
        "rank_oecd_1990": rank_oecd.get(1990),
        "population_latest_year": latest(japan["population"])[0],
        "population_latest": latest(japan["population"])[1],
        "population_peak_year": peak(japan["population"])[0],
        "population_peak": peak(japan["population"])[1],
    }

    data = {
        "meta": {
            "title": "日本の国民所得の推移",
            "source": "World Bank Open Data (World Development Indicators)",
            "source_url": "https://data.worldbank.org/country/japan",
            "api": "https://api.worldbank.org/v2",
            "retrieved_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "api_last_updated": last_updated,
            "license": "CC BY 4.0",
            "notes": [
                "GNI（国民総所得）はかつての「国民所得」に相当する分配面の指標。GDP に海外からの純要素所得を加えたもの。",
                "名目値は米ドル建て。円建ては期間平均為替レート（PA.NUS.FCRF）で換算した参考値。",
                "実質値は 2015 年価格の米ドル建て。",
                "購買力平価（PPP）は 2021 年国際比較プログラム基準の国際ドル。",
            ],
        },
        "years": years,
        "series": {key: align(value, years) for key, value in japan.items()},
        "world": {
            "gdp_usd": align(world_gdp, years),
            "japan_share_pct": align(share_world, years),
        },
        "compare": {
            "years": years,
            "gdp_usd": {code: align(series, years) for code, series in compare_series.items()},
            "gdp_pc_ppp": {code: align(series, years) for code, series in compare_pc_ppp.items()},
        },
        "rank": {
            "years": rank_years,
            "all": [rank_all.get(y) for y in rank_years],
            "oecd": [rank_oecd.get(y) for y in rank_years],
            "coverage": [rank_coverage[y] for y in rank_years],
            "top": {str(y): rank_table.get(y, []) for y in rank_years},
        },
        "decades": decades,
        "stats": stats,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    # ブラウザから file:// でも読めるよう、同じ内容を JS 変数としても書き出す
    web_out = OUT.with_name("data.js")
    web_out.write_text(
        "/* 自動生成ファイル — scripts/fetch_data.py を実行して再生成してください */\n"
        "window.NATIONAL_INCOME_DATA = "
        + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    size = OUT.stat().st_size / 1024
    print(f"\n書き出し: {OUT} ({size:.1f} KB) / {web_out.name}", file=sys.stderr)
    print(f"対象期間: {base_year}-{latest_const_year} / 取得: {data['meta']['retrieved_utc']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
