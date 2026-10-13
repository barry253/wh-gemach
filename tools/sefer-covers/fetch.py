"""Look up book covers + publish years for the Sefer Shelf (run by .github/workflows/sefer-covers.yml).

Reads books.json ([{key, title, author, isbns}]), writes raw/<key>.<ext> and meta.json.
Tries, in order: Open Library cover by ISBN, Google Books by ISBN, then a title + author search on both.
"""
import json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
os.makedirs(RAW, exist_ok=True)
UA = {"User-Agent": "whgemachs.org cover lookup (whmedicalgemach@gmail.com)"}

def get(url, binary=False, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=25) as r:
                data = r.read()
                return (data, r.headers.get("Content-Type", "")) if binary else json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (404, 400): return None
            time.sleep(2 * (i + 1))
        except Exception:
            time.sleep(2 * (i + 1))
    return None

norm = lambda s: re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
def title_ok(want, got):
    w, g = set(norm(want).split()) - {"the", "a", "of", "and"}, set(norm(got).split())
    return bool(w) and len(w & g) / len(w) >= 0.6

def image(url):
    r = get(url, binary=True)
    if not r: return None
    data, ct = r
    if len(data) < 2500 or not ct.startswith("image/"): return None  # placeholders / 1×1 gifs
    return data, ("png" if "png" in ct else "jpg")

def year_of(s):
    m = re.search(r"(1[89]\d\d|20\d\d)", s or "")
    return int(m.group(1)) if m else None

def google_isbn(isbn):
    d = get("https://www.googleapis.com/books/v1/volumes?q=isbn:" + isbn)
    return (d or {}).get("items", [None])[0] if d and d.get("totalItems") else None

def google_cover(item):
    links = (item or {}).get("volumeInfo", {}).get("imageLinks") or {}
    u = links.get("thumbnail") or links.get("smallThumbnail")
    if not u: return None
    u = u.replace("http://", "https://").replace("&edge=curl", "")
    for zoom in ("&zoom=0", ""):  # zoom=0 is often the larger scan
        img = image(re.sub(r"&zoom=\d", "", u) + zoom if zoom else u)
        if img: return img
    return None

books = json.load(open(os.path.join(HERE, "books.json")))
meta = {}
mp = os.path.join(HERE, "meta.json")
if os.path.exists(mp): meta = json.load(open(mp))
for n, b in enumerate(books):
    key = b["key"]
    if key in meta and meta[key].get("source"): continue
    m = {"title": b["title"], "source": None, "matched": None, "year": None}
    got = None
    for isbn in b["isbns"]:
        ol = get(f"https://openlibrary.org/isbn/{isbn}.json")
        if ol and not m["year"]: m["year"] = year_of(ol.get("publish_date"))
        gi = google_isbn(isbn)
        if gi and not m["year"]: m["year"] = year_of(gi.get("volumeInfo", {}).get("publishedDate"))
        if not got:
            img = image(f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false")
            if img: got, m["source"], m["matched"] = img, "openlibrary-isbn", isbn
        if not got and gi:
            img = google_cover(gi)
            if img: got, m["source"], m["matched"] = img, "google-isbn", gi.get("volumeInfo", {}).get("title")
        if got and m["year"]: break
    if not got:
        q = f'intitle:"{b["title"]}"' + (f' inauthor:{b["author"]}' if b["author"] else "")
        d = get("https://www.googleapis.com/books/v1/volumes?maxResults=5&q=" + urllib.parse.quote(q))
        for it in (d or {}).get("items", []):
            vi = it.get("volumeInfo", {})
            if not title_ok(b["title"], vi.get("title", "") + " " + vi.get("subtitle", "")): continue
            img = google_cover(it)
            if img:
                got, m["source"], m["matched"] = img, "google-search", f'{vi.get("title")} / {", ".join(vi.get("authors", []))}'
                m["year"] = m["year"] or year_of(vi.get("publishedDate"))
                break
    if not got:
        params = {"title": b["title"], "limit": "5"}
        if b["author"]: params["author"] = b["author"]
        d = get("https://openlibrary.org/search.json?" + urllib.parse.urlencode(params))
        for doc in (d or {}).get("docs", []):
            if not doc.get("cover_i") or not title_ok(b["title"], doc.get("title", "")): continue
            img = image(f'https://covers.openlibrary.org/b/id/{doc["cover_i"]}-L.jpg')
            if img:
                got, m["source"], m["matched"] = img, "openlibrary-search", f'{doc.get("title")} / {", ".join(doc.get("author_name", [])[:2])}'
                m["year"] = m["year"] or doc.get("first_publish_year")
                break
    if got:
        data, ext = got
        open(os.path.join(RAW, f"{key}.{ext}"), "wb").write(data)
        m["file"] = f"{key}.{ext}"
    meta[key] = m
    print(f"{n + 1}/{len(books)} {key}: {m['source']} {m['year']}", flush=True)
    if n % 20 == 0: json.dump(meta, open(mp, "w"), indent=1, ensure_ascii=False)
    time.sleep(0.3)
json.dump(meta, open(mp, "w"), indent=1, ensure_ascii=False)
print("covers:", sum(1 for v in meta.values() if v.get("source")), "of", len(books))
