import json
import pytest

from production_parser import parse_embedded_json


def load_fixture(name: str) -> str:
    path = f"tests/fixtures/{name}"
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def test_parse_next_data(tmp_path):
    html = """
    <html><head><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"items":[{"id":"1","desc":"hello"}]}}}</script></head></html>
    """

    items = parse_embedded_json(html)
    assert isinstance(items, list)
    assert items and items[0].get('id') == '1'


def test_parse_sigi_state():
    html = """
    <script>window['SIGI_STATE'] = {"ItemModule":{"1":{"id":"1","desc":"x"}}};</script>
    """

    items = parse_embedded_json(html)
    assert isinstance(items, list)
    assert items and items[0].get('id') == '1'


def test_parse_empty():
    html = "<html><body>No relevant JSON</body></html>"
    items = parse_embedded_json(html)
    assert items == []
