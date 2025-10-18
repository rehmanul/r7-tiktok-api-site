"""Standalone parser helpers extracted from the main app for unit testing.

This separate module avoids importing FastAPI and other runtime dependencies so
unit tests can run in minimal environments.
"""

from typing import Dict, List
import json
import re


def parse_embedded_json(html: str) -> List[Dict]:
    """Attempt to extract embedded JSON payloads from a TikTok HTML page.

    Heuristics (in order):
    - Look for <script id="__NEXT_DATA__"> JSON </script>
    - Look for window['SIGI_STATE'] or window.SIGI_STATE assignments
    - Fallback: extract JSON objects from <script> tags and search for common keys

    Returns a list of item dicts (empty list if none found).
    """

    if not html:
        return []

    # 1) Scan <script> tags and parse JSON where appropriate (id=__NEXT_DATA__ or type=application/json)
    try:
        for m in re.finditer(r'<script([^>]*)>(.*?)</script>', html, re.DOTALL | re.IGNORECASE):
            attrs = m.group(1)
            attrs_lower = attrs.lower()
            content = m.group(2).strip()
            try:
                if '__next_data__' in attrs_lower or 'type="application/json"' in attrs_lower or "type='application/json'" in attrs_lower:
                    try:
                        data = json.loads(content)
                    except Exception:
                        # fallback: extract first {...} JSON substring
                        try:
                            start = content.index('{')
                            end = content.rindex('}')
                            data = json.loads(content[start:end+1])
                        except Exception:
                            raise
                    # common path
                    props = data.get('props') if isinstance(data, dict) else None
                    if props:
                        page_props = props.get('pageProps') or props.get('initialProps') or {}
                        items = page_props.get('items') or page_props.get('awemeList')
                        if items and isinstance(items, list):
                            return items

                    # search for ItemModule recursively
                    def find_itemmodule(obj):
                        if isinstance(obj, dict):
                            if 'ItemModule' in obj and isinstance(obj['ItemModule'], dict):
                                return list(obj['ItemModule'].values())
                            for v in obj.values():
                                found = find_itemmodule(v)
                                if found:
                                    return found
                        elif isinstance(obj, list):
                            for v in obj:
                                found = find_itemmodule(v)
                                if found:
                                    return found
                        return None

                    found = find_itemmodule(data)
                    if found:
                        return found
                    # fallback: try to extract "items" array via regex if present
                    try:
                        m_items = re.search(r'"items"\s*:\s*(\[.*?\])', content, re.DOTALL)
                        if m_items:
                            items_json = m_items.group(1)
                            items = json.loads(items_json)
                            if isinstance(items, list):
                                return items
                    except Exception:
                        pass
            except Exception:
                # continue to other scripts
                continue
    except Exception:
        pass

    # 2) SIGI_STATE
    try:
        m = re.search(r"window\[['\"]SIGI_STATE['\"]\]\s*=\s*(\{.*?\});", html, re.DOTALL)
        if not m:
            m = re.search(r"window\.SIGI_STATE\s*=\s*(\{.*?\});", html, re.DOTALL)
        if m:
            payload = m.group(1)
            try:
                data = json.loads(payload)
                item_module = data.get('ItemModule')
                if isinstance(item_module, dict):
                    return list(item_module.values())
            except Exception:
                pass
    except Exception:
        pass

    # 3) Generic scripts containing single JSON objects
    try:
        scripts = re.findall(r'<script[^>]*>(\{.*?\})</script>', html, re.DOTALL)
        for s in scripts:
            try:
                data = json.loads(s)
                if isinstance(data, dict):
                    if 'awemeList' in data and isinstance(data['awemeList'], list):
                        return data['awemeList']
                    if 'items' in data and isinstance(data['items'], list):
                        return data['items']
                    if 'ItemModule' in data and isinstance(data['ItemModule'], dict):
                        return list(data['ItemModule'].values())
            except Exception:
                continue
    except Exception:
        pass

    return []
