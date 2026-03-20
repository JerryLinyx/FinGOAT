from __future__ import annotations

import requests

from marketdata.normalize import market_code_for_cn_ticker, normalize_cn_ticker


def fetch_quote(symbol: str, timeout: float) -> dict:
    normalized = normalize_cn_ticker(symbol)
    url = "https://push2.eastmoney.com/api/qt/stock/get"
    params = {
        "fltt": "2",
        "invt": "2",
        "fields": "f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f116,f117,f167,f168,f169,f170,f171,f22,f24,f25,f162",
        "secid": f"{market_code_for_cn_ticker(normalized)}.{normalized}",
    }
    response = requests.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()


def fetch_candles(symbol: str, period: str, start_date: str, end_date: str, timeout: float) -> dict:
    normalized = normalize_cn_ticker(symbol)
    period_map = {"daily": "101", "weekly": "102", "monthly": "103"}
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    params = {
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116",
        "ut": "7eea3edcaed734bea9cbfc24409ed989",
        "klt": period_map[period],
        "fqt": "0",
        "secid": f"{market_code_for_cn_ticker(normalized)}.{normalized}",
        "beg": start_date,
        "end": end_date,
    }
    response = requests.get(url, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()
