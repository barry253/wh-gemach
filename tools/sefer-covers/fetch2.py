"""Round 2 for the Sefer Shelf books still without a cover (missing.json).

Tries Eichlers / Feldheim / Hachai site search (Magento), Amazon product page by ISBN-10 and
Goodreads by ISBN. Keeps every candidate (raw2/<key>--<source>.<ext>) for review; meta2.json lists them.
"""
import concurrent.futures, html, json, os, re, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw2"); os.makedirs(RAW, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html,application/xhtml+xml,image/*,*/*;q=0.8"}

def get(url, binary=False):
    for _ in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
                data = r.read()
                return (data, r.headers.get("Content-Type", "")) if binary else data.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            print("http", e.code, url[:90], flush=True)
            if e.code in (400, 403, 404, 410): return None
        except Exception as e:
            print("err", type(e).__name__, url[:90], flush=True)
        time.sleep(1.5)
    return None

norm = lambda s: re.sub(r"[^a-z0-9]+", " ", html.unescape(s or "").lower()).strip()
def title_ok(want, got):
    w, g = set(norm(want).split()) - {"the", "a", "of", "and", "s"}, set(norm(got).split())
    return bool(w) and len(w & g) / len(w) >= 0.75

def image(url):
    r = get(url, binary=True)
    if not r: return None
    data, ct = r
    if len(data) < 4000 or not ct.startswith("image/"): return None
    return data, ("png" if "png" in ct else "webp" if "webp" in ct else "jpg")

def isbn10(i):
    if len(i) == 10: return i
    if len(i) == 13 and i.startswith("978"):
        core = i[3:12]; chk = (11 - sum((10 - n) * int(c) for n, c in enumerate(core)) % 11) % 11
        return core + ("X" if chk == 10 else str(chk))

def magento(host, b):
    page = get(f"https://{host}/catalogsearch/result/?q=" + urllib.parse.quote(b["title"]))
    if not page: return []
    out = []
    for block in re.split(r'class="[^"]*product-item-info', page)[1:8]:
        name = re.search(r'class="product-item-link"[^>]*>\s*([^<]+)', block)
        img = re.search(r'class="product-image-photo[^"]*"[^>]*?(?:data-src|src)="([^"]+)"', block) or \
              re.search(r'<img[^>]+(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"', block)
        if name and img and title_ok(b["title"], name.group(1)):
            u = html.unescape(img.group(1))
            u = re.sub(r"/cache/[0-9a-f]{20,}/", "/", u)  # Magento resized cache -> original upload
            out.append((u, name.group(1).strip()))
    return out[:2]

def amazon(b):
    out = []
    for i in b["isbns"]:
        i10 = isbn10(i)
        if not i10: continue
        page = get(f"https://www.amazon.com/dp/{i10}")
        if not page: continue
        m = re.search(r'"hiRes":"(https://[^"]+)"', page) or re.search(r'data-old-hires="(https://[^"]+)"', page) \
            or re.search(r'id="(?:landingImage|imgBlkFront|ebooksImgBlkFront)"[^>]+src="(https://[^"]+)"', page)
        t = re.search(r'id="productTitle"[^>]*>\s*([^<]+)', page)
        if m: out.append((m.group(1), "amazon " + i10 + " " + (t.group(1).strip() if t else ""))); break
    return out

def goodreads(b):
    for i in b["isbns"]:
        page = get(f"https://www.goodreads.com/book/isbn/{i}")
        if not page: continue
        m = re.search(r'<meta property="og:image" content="([^"]+)"', page)
        t = re.search(r'<meta property="og:title" content="([^"]+)"', page)
        if m and "nophoto" not in m.group(1): return [(m.group(1), "goodreads " + i + " " + (t.group(1) if t else ""))]
    return []

def one(b):
    cands = []
    for host in ("www.eichlers.com", "www.feldheim.com", "www.hachai.com"):
        cands += [(u, host + ": " + n) for u, n in magento(host, b)]
    cands += amazon(b) + goodreads(b)
    saved = []
    for n, (u, where) in enumerate(cands):
        img = image(u)
        if not img: continue
        src = where.split(":")[0].split(" ")[0].replace("www.", "").split(".")[0]
        fn = f'{b["key"]}--{src}{n}.{img[1]}'
        open(os.path.join(RAW, fn), "wb").write(img[0])
        saved.append({"file": fn, "from": where, "url": u})
    return b["key"], {"title": b["title"], "found": saved}

books = json.load(open(os.path.join(HERE, "missing.json")))
meta = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
    for i, (k, m) in enumerate(ex.map(one, books)):
        meta[k] = m
        print(i + 1, k, [f["from"] for f in m["found"]], flush=True)
        if i % 10 == 0: json.dump(meta, open(os.path.join(HERE, "meta2.json"), "w"), indent=1, ensure_ascii=False)
json.dump(meta, open(os.path.join(HERE, "meta2.json"), "w"), indent=1, ensure_ascii=False)
print("with a candidate:", sum(1 for m in meta.values() if m["found"]), "of", len(books))
