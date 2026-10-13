"""Look up book covers + publish years for the Sefer Shelf (run by .github/workflows/sefer-covers.yml).

Reads books.json ([{key, title, author, isbns}]), writes raw/<key>.<ext> and meta.json.
Tries, in order: Open Library cover by ISBN, Google Books by ISBN, then a title + author search on both.
"""
import concurrent.futures, json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
os.makedirs(RAW, exist_ok=True)
UA = {"User-Agent": "whgemachs.org cover lookup (whmedicalgemach@gmail.com)"}

def get(url, binary=False, tries=2):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=12) as r:
                data = r.read()
                return (data, r.headers.get("Content-Type", "")) if binary else json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if "googleapis" in url: print("google", e.code, flush=True)
            if e.code in (404, 400): return None
            time.sleep(1)
        except Exception:
            time.sleep(1)
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
    return data, ("png" if "png" in ct else "gif" if "gif" in ct else "webp" if "webp" in ct else "jpg")

def isbn10(isbn):
    if len(isbn) == 10: return isbn
    if len(isbn) == 13 and isbn.startswith("978"):
        core = isbn[3:12]
        tot = sum((10 - i) * int(c) for i, c in enumerate(core))
        chk = (11 - tot % 11) % 11
        return core + ("X" if chk == 10 else str(chk))
    return None

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

STORES = ["israelbookshoppublications.com", "www.menuchapublishers.com", "www.feldheim.com", "www.hachai.com", "www.eichlers.com",
          "www.judaicaplace.com", "www.artscroll.com", "www.mekorjudaica.com", "www.seforimcenter.com", "www.zaidysjudaica.com"]

def store_cover(b):
    """Jewish publishers / bookstores on Shopify: /search/suggest.json gives product titles + images."""
    q = urllib.parse.quote(b["title"])
    for host in STORES:
        d = get(f"https://{host}/search/suggest.json?q={q}&resources[type]=product&resources[limit]=5")
        prods = (((d or {}).get("resources") or {}).get("results") or {}).get("products") or []
        for pr in prods:
            if not title_ok(b["title"], pr.get("title", "")): continue
            u = pr.get("image") or (pr.get("featured_image") or {}).get("url")
            if not u: continue
            if u.startswith("//"): u = "https:" + u
            img = image(u + ("&" if "?" in u else "?") + "width=900")
            if img: return img, f'{host}: {pr.get("title")}'
    return None

books = json.load(open(os.path.join(HERE, "books.json")))
meta = {}
mp = os.path.join(HERE, "meta.json")
if os.path.exists(mp): meta = json.load(open(mp))
def one(b):
    key = b["key"]
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
        if not got and isbn10(isbn):
            img = image(f"https://images-na.ssl-images-amazon.com/images/P/{isbn10(isbn)}.01.LZZZZZZZ.jpg")
            if img: got, m["source"], m["matched"] = img, "amazon-isbn", isbn
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
    if not got:
        r = store_cover(b)
        if r: (got, m["matched"]), m["source"] = r, "store"
    if got:
        data, ext = got
        open(os.path.join(RAW, f"{key}.{ext}"), "wb").write(data)
        m["file"] = f"{key}.{ext}"
    return key, m

RETRY = set(json.load(open(os.path.join(HERE, "retry.json")))) if os.path.exists(os.path.join(HERE, "retry.json")) else set()

def alt(b):
    """Second opinion for low-res / wrong covers: Amazon by ISBN, then the store catalogs. Saved as <key>-alt."""
    got = None
    for isbn in b["isbns"]:
        if isbn10(isbn):
            img = image(f"https://images-na.ssl-images-amazon.com/images/P/{isbn10(isbn)}.01.LZZZZZZZ.jpg")
            if img: got = (img, "amazon " + isbn); break
    if not got:
        r = store_cover(b)
        if r: got = r
    if not got: return b["key"], None
    (data, ext), where = got
    open(os.path.join(RAW, f'{b["key"]}-alt.{ext}'), "wb").write(data)
    return b["key"], {"file": f'{b["key"]}-alt.{ext}', "from": where}

if RETRY and not os.environ.get("SKIP_ALT"):
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        for key, a in ex.map(alt, [b for b in books if b["key"] in RETRY]):
            if key in meta: meta[key]["alt"] = a
            print("alt", key, a, flush=True)
    json.dump(meta, open(mp, "w"), indent=1, ensure_ascii=False)
    sys.exit(0)

START = time.time()
todo = [b for b in books if not (b["key"] in meta and meta[b["key"]].get("source"))]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
    futs = [ex.submit(one, b) for b in todo]
    for i, f in enumerate(concurrent.futures.as_completed(futs)):
        try:
            key, m = f.result()
            meta[key] = m
            print(f"{i + 1}/{len(todo)} {key}: {m['source']} {m['year']}", flush=True)
        except Exception as e:
            print("error", e, flush=True)
        if i % 25 == 0: json.dump(meta, open(mp, "w"), indent=1, ensure_ascii=False)
json.dump(meta, open(mp, "w"), indent=1, ensure_ascii=False)
print("covers:", sum(1 for v in meta.values() if v.get("source")), "of", len(books))
