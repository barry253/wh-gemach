// Part of the Gemach Network worker (see index.js for routes and env vars).
import { AirtableError, Q, firstLink, getOwned, linkedId } from "./airtable.js";
import { parseItemAttrs, validateItemAttrs } from "./attributes.js";
import { typeExtraFields, typeExtras } from "./extras.js";
import { gemachFromRecord, getGemachRecord } from "./gemachs.js";
import { allowedPhotoUrl, parseMorePhotos, validateMorePhotos } from "./photos.js";
import { sniffImageType } from "./settings.js";
import { REC_RE, T } from "./config.js";
import { nyToday } from "./dates.js";
import { json, readJson } from "./http.js";
import { generateNextItemId } from "./ids.js";
import { MAX_QTY, addonPrice, isAddonType, isQtyType, lendableQty, loadQtyBookings, maxPerRequest, packageFields, packageSize, packageUnit, qtyAvailable, wholeNum, TYPE_ADMIN_FIELDS } from "./quantity.js";

// ─── Catalog — Item Types ─────────────────────────────────────────────────────

async function handleGetItemTypes({ db, g }) {
  const types = await db.listAll(T.ITEM_TYPES, { scope: g, sort: [{ field: "Display Order", direction: "asc" }], fields: TYPE_ADMIN_FIELDS });
  const qtyIds = types.filter(isQtyType).map(t => t.id);
  const bookings = qtyIds.length ? await loadQtyBookings(db, g, qtyIds) : {};
  const t = nyToday();
  return json(types.map(r => {
    const out = {
      id: r.id,
      name: r.fields["Name"] || "",
      description: r.fields["Description"] || "",
      displayOrder: r.fields["Display Order"] || 0,
      active: r.fields["Active"] || false,
      photoUrl: null, // (was the Airtable attachment; every photo now lives in R2 — kept so older admin pages still work)
      r2PhotoUrl: r.fields["R2 Photo URL"] || null,
      morePhotos: parseMorePhotos(r.fields["More Photos"]),
      itemCount: (r.fields["Items"] || []).length,
      categoryId: linkedId(firstLink(r.fields["Product Category"])) || null,
      tracking: isAddonType(r) ? "Add-on" : isQtyType(r) ? "Quantity" : "Units",
      price: addonPrice(r),
      quantityOwned: wholeNum(r.fields["Quantity Owned"]),
      outOfService: wholeNum(r.fields["Out of Service"]),
      attributes: parseItemAttrs(r.fields["Attributes"]),
      packageSize: packageSize(r),
      packageUnit: packageUnit(r),
      maxPerRequest: maxPerRequest(r) || null,
      ...typeExtras(r),
    };
    if (isQtyType(r)) {
      // Counts for the inventory card: out now, reserved ahead, free today.
      const list = bookings[r.id] || [];
      out.outNow = list.filter(b => b.status === "Active").reduce((n, b) => n + b.qty, 0);
      out.reservedAhead = list.filter(b => b.status === "Reserved").reduce((n, b) => n + b.qty, 0);
      out.availableToday = qtyAvailable(lendableQty(r), list, t, t);
    }
    return out;
  }));
}

/**
 * Tracking / counts from a create or update body. Switching to Quantity needs the type to have no unit
 * records; switching back to Units needs no open quantity loans. Returns { fields } or { error }.
 */
async function itemTypeQtyFields(db, g, body, current = null) {
  const fields = {};
  const wasQty = current ? isQtyType(current) : false;
  const wasAddon = current ? isAddonType(current) : false;
  let nowQty = wasQty;
  if (body.tracking !== undefined) {
    if (!["Units", "Quantity", "Add-on"].includes(body.tracking)) return { error: "Tracking must be Units, Quantity or Add-on." };
    nowQty = body.tracking === "Quantity";
    const nowAddon = body.tracking === "Add-on";
    fields["Tracking"] = body.tracking;
    if (current && (nowQty || nowAddon) && !wasQty && !wasAddon) {
      const n = (current.fields["Items"] || []).length;
      if (n) return { error: `This item type still has ${n === 1 ? "1 numbered unit" : `${n} numbered units`} listed under it. Delete ${n === 1 ? "it" : "them"} first (Edit → Delete), then switch to ${nowAddon ? "an add-on" : "counting by quantity"}.` };
    }
    if (current && (wasQty || wasAddon) && body.tracking !== selTracking(current)) {
      const open = await loadOpenLoansFor(db, g, current.id);
      if (open) return { error: `This item type has open ${wasAddon ? "add-on orders" : "loans or reservations"}. Close them before changing how it's tracked.` };
    }
  }
  if (body.price !== undefined) {
    if (body.price === "" || body.price === null) fields["Price"] = null;
    else {
      const p = Number(body.price);
      if (!Number.isFinite(p) || p < 0 || p > 100000) return { error: "Price must be a number (e.g. 40 or 12.50)." };
      fields["Price"] = Math.round(p * 100) / 100;
    }
  }
  const num = (v, label) => {
    const n = Number(v);
    if (v === "" || v === null) return 0;
    if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) throw new Error(`${label} must be a whole number from 0 to ${MAX_QTY}.`);
    return n;
  };
  try {
    if (body.quantityOwned !== undefined) fields["Quantity Owned"] = num(body.quantityOwned, "How many you own");
    if (body.outOfService !== undefined) fields["Out of Service"] = num(body.outOfService, "Out of service");
  } catch (e) { return { error: e.message }; }
  const owned = fields["Quantity Owned"] ?? wholeNum(current?.fields?.["Quantity Owned"]);
  const oos = fields["Out of Service"] ?? wholeNum(current?.fields?.["Out of Service"]);
  if (nowQty && oos > owned) return { error: "Out of service can't be more than how many you own." };
  return { fields };
}

const selTracking = rec => (isAddonType(rec) ? "Add-on" : isQtyType(rec) ? "Quantity" : "Units");
/** Whether an item type has any open (Reserved/Active) loans that link it as "Item to Reserve". */
async function loadOpenLoansFor(db, g, typeId) {
  const loans = await db.listAll(T.LOANS, { scope: g, where: [Q.in("Status", ["Active", "Reserved"])], fields: ["Item to Reserve", "Item"] });
  return loans.some(l => linkedId(firstLink(l.fields["Item to Reserve"])) === typeId && !(l.fields["Item"] || []).length);
}

/** categoryId from a body: undefined = untouched, "" / null = clear, else must be an existing ACTIVE category. */
async function resolveCategoryField(db, categoryId) {
  if (categoryId === undefined) return { skip: true };
  if (categoryId === "" || categoryId === null) return { value: [] };
  if (typeof categoryId !== "string" || !REC_RE.test(categoryId)) return { error: "Unknown browse category." };
  const cat = await db.get(T.PRODUCT_CATEGORIES, categoryId);
  if (!cat || !cat.fields?.Active) return { error: "Unknown browse category." };
  return { value: [categoryId] };
}

/** body.attributes → { skip } | { value } | { error }, checked against the gemach's current filters (read fresh). */
async function resolveAttributesField(db, g, attributes) {
  if (attributes === undefined) return { skip: true };
  let defs = g.itemAttributes || [];
  if (attributes && typeof attributes === "object" && Object.keys(attributes).length) {
    const rec = await getGemachRecord(db, g.id); // Settings may have just changed; the gemach memo can be up to 60s old
    if (rec) defs = gemachFromRecord(rec).itemAttributes;
  }
  return validateItemAttrs(attributes, defs);
}

async function airtableResult(promise) {
  try { return json(await promise); }
  catch (e) {
    if (e instanceof AirtableError) return json(e.detail || { error: e.message }, 500);
    throw e;
  }
}

async function handleCreateItemType(c) {
  const body = await readJson(c.request);
  if (!body.name) return json({ error: "Name required" }, 400);
  const fields = {
    "Name": body.name,
    "Description": body.description || "",
    "Display Order": body.displayOrder || 99,
    "Active": body.active !== false,
    "Gemach": [c.g.id],
  };
  if (body.r2PhotoUrl) {
    if (!allowedPhotoUrl(c.env, body.r2PhotoUrl)) return json({ error: "The photo must be one uploaded here." }, 400);
    fields["R2 Photo URL"] = body.r2PhotoUrl;
  }
  const more = validateMorePhotos(c.env, body.morePhotos, body.r2PhotoUrl || null);
  if (more.error) return json({ error: more.error }, 400);
  if (!more.skip && more.value) fields["More Photos"] = more.value;
  const cat = await resolveCategoryField(c.db, body.categoryId);
  if (cat.error) return json({ error: cat.error }, 400);
  if (!cat.skip && cat.value.length) fields["Product Category"] = cat.value;
  const attrs = await resolveAttributesField(c.db, c.g, body.attributes);
  if (attrs.error) return json({ error: attrs.error }, 400);
  if (!attrs.skip && attrs.value) fields["Attributes"] = attrs.value;
  const q = await itemTypeQtyFields(c.db, c.g, body);
  if (q.error) return json({ error: q.error }, 400);
  Object.assign(fields, q.fields);
  const pk = packageFields(body);
  if (pk.error) return json({ error: pk.error }, 400);
  for (const [k, v] of Object.entries(pk.fields)) if (v != null) fields[k] = v;
  const x = typeExtraFields(body);
  if (x.error) return json({ error: x.error }, 400);
  for (const [k, v] of Object.entries(x.fields)) if (v != null && v !== false) fields[k] = v;
  return airtableResult(c.db.create(T.ITEM_TYPES, fields));
}

async function handleUpdateItemType(c, id) {
  const body = await readJson(c.request);
  const current = await getOwned(c.db, T.ITEM_TYPES, id, c.g);
  if (!current) return json({ error: "Not found" }, 404);
  const q = await itemTypeQtyFields(c.db, c.g, body, current);
  if (q.error) return json({ error: q.error }, 400);
  const pk = packageFields(body);
  if (pk.error) return json({ error: pk.error }, 400);
  const x = typeExtraFields(body);
  if (x.error) return json({ error: x.error }, 400);
  const fields = { ...q.fields, ...pk.fields, ...x.fields };
  if (body.name !== undefined)         fields["Name"] = body.name;
  if (body.description !== undefined)  fields["Description"] = body.description;
  if (body.displayOrder !== undefined) fields["Display Order"] = body.displayOrder;
  if (body.active !== undefined)       fields["Active"] = body.active;
  if (body.r2PhotoUrl !== undefined) {
    // A new cover must be one of our own uploads (an unchanged older one is kept as is).
    if (body.r2PhotoUrl && body.r2PhotoUrl !== current.fields["R2 Photo URL"] && !allowedPhotoUrl(c.env, body.r2PhotoUrl)) return json({ error: "The photo must be one uploaded here." }, 400);
    fields["R2 Photo URL"] = body.r2PhotoUrl || null;
  }
  const more = validateMorePhotos(c.env, body.morePhotos, body.r2PhotoUrl !== undefined ? body.r2PhotoUrl : current.fields["R2 Photo URL"] || null);
  if (more.error) return json({ error: more.error }, 400);
  if (!more.skip) fields["More Photos"] = more.value;
  const cat = await resolveCategoryField(c.db, body.categoryId);
  if (cat.error) return json({ error: cat.error }, 400);
  if (!cat.skip) fields["Product Category"] = cat.value;
  const attrs = await resolveAttributesField(c.db, c.g, body.attributes);
  if (attrs.error) return json({ error: attrs.error }, 400);
  if (!attrs.skip) fields["Attributes"] = attrs.value;
  return airtableResult(c.db.update(T.ITEM_TYPES, id, fields));
}


// ─── Catalog — Items ──────────────────────────────────────────────────────────

async function handleGetCatalogItems({ db, g }) {
  const [items, itemTypes] = await Promise.all([
    db.listAll(T.ITEMS, { scope: g, sort: [{ field: "Item ID", direction: "asc" }], fields: ["Item ID", "Item Type", "Condition", "Active", "Status", "Notes"] }),
    db.listAll(T.ITEM_TYPES, { scope: g, sort: [{ field: "Display Order", direction: "asc" }], fields: ["Name", "Active"] }),
  ]);
  const itemTypeMap = Object.fromEntries(itemTypes.map(r => [r.id, { name: r.fields["Name"] }]));
  const records = items.map(r => {
    const itemTypeId = linkedId(firstLink(r.fields["Item Type"]));
    return {
      id: r.id,
      itemId: r.fields["Item ID"] || "",
      itemTypeId,
      itemTypeName: itemTypeMap[itemTypeId]?.name || "Unknown",
      condition: r.fields["Condition"] || "Good",
      active: r.fields["Active"] || false,
      status: r.fields["Status"] || "Unknown",
      notes: r.fields["Notes"] || "",
    };
  });
  const types = itemTypes.filter(r => r.fields["Active"]).map(r => ({ id: r.id, name: r.fields["Name"] }));
  return json({ items: records, itemTypes: types });
}

const ITEM_CONDITIONS = ["Good", "Needs Repair"]; // Items.Condition single-select choices
const badCondition = v => v !== undefined && v !== null && v !== "" && !ITEM_CONDITIONS.includes(v);

async function handleCreateItem(c) {
  const { db, g } = c;
  const body = await readJson(c.request);
  if (!body.itemTypeId) return json({ error: "itemTypeId required" }, 400);
  if (badCondition(body.condition)) return json({ error: `Condition must be one of: ${ITEM_CONDITIONS.join(", ")}.` }, 400);
  const typeRec = await getOwned(db, T.ITEM_TYPES, body.itemTypeId, g);
  if (!typeRec) return json({ error: "Item type not found" }, 404);
  if (isQtyType(typeRec)) return json({ error: `${typeRec.fields.Name || "This item type"} is counted by quantity — change "How many you own" instead of adding units.` }, 400);
  if (isAddonType(typeRec)) return json({ error: `${typeRec.fields.Name || "This item"} is an add-on (made to order) — it doesn't have numbered units.` }, 400);

  const itemId = body.itemId || await generateNextItemId(db, g, typeRec);
  const fields = {
    "Item ID": itemId,
    "Item Type": [body.itemTypeId],
    "Condition": body.condition || "Good",
    "Active": body.active !== false,
    "Notes": body.notes || "",
    "Gemach": [g.id],
  };
  try {
    const data = await db.create(T.ITEMS, fields);
    return json({ ...data, generatedId: itemId });
  } catch (e) {
    if (e instanceof AirtableError) return json({ ...(e.detail || {}), generatedId: itemId }, 500);
    throw e;
  }
}

async function handleUpdateItem(c, id) {
  const { db, g } = c;
  const body = await readJson(c.request);
  if (body.condition !== undefined && !ITEM_CONDITIONS.includes(body.condition)) {
    return json({ error: `Condition must be one of: ${ITEM_CONDITIONS.join(", ")}.` }, 400);
  }
  const [item, typeRec] = await Promise.all([
    getOwned(db, T.ITEMS, id, g),
    body.itemTypeId !== undefined ? getOwned(db, T.ITEM_TYPES, body.itemTypeId, g) : Promise.resolve(true),
  ]);
  if (!item) return json({ error: "Not found" }, 404);
  if (!typeRec) return json({ error: "Item type not found" }, 404);
  const fields = {};
  if (body.itemId !== undefined)     fields["Item ID"] = body.itemId;
  if (body.itemTypeId !== undefined) fields["Item Type"] = [body.itemTypeId];
  if (body.condition !== undefined)  fields["Condition"] = body.condition;
  if (body.active !== undefined)     fields["Active"] = body.active;
  if (body.notes !== undefined)      fields["Notes"] = body.notes;
  return airtableResult(db.update(T.ITEMS, id, fields));
}

async function handleDeleteItem(c, id) {
  if (!(await getOwned(c.db, T.ITEMS, id, c.g))) return json({ error: "Not found" }, 404);
  try {
    await c.db.del(T.ITEMS, id);
  } catch (e) {
    if (e instanceof AirtableError) return json({ error: e.message || "Delete failed" }, 500);
    throw e;
  }
  return json({ deleted: true });
}


// ─── Photo upload to R2 (keys prefixed by gemach slug) ────────────────────────

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const PHOTO_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Item photo upload (multipart, field "photo"): JPEG, PNG or WebP only, checked by the file's first bytes
 * (not the name or the browser's label), stored with that type. Anything else — SVG, HTML, a renamed file —
 * is refused, so nothing that could run as a page ever lands in the public photo bucket. Photos from a web
 * address come through handleFetchPhoto (below) and are then uploaded here by the browser.
 */
async function handleUploadPhoto(c) {
  const { request, env, g } = c;
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) return json({ error: "Upload the photo as a file." }, 400);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_PHOTO_BYTES + 64 * 1024) return json({ error: "Image too large (max 10MB)" }, 413);
  let file;
  try { file = (await request.formData()).get("photo"); } catch { return json({ error: "Could not read the upload." }, 400); }
  if (!file || typeof file === "string") return json({ error: "No file provided" }, 400);
  if (file.size > MAX_PHOTO_BYTES) return json({ error: "Image too large (max 10MB)" }, 413);
  const fileBuffer = await file.arrayBuffer();
  if (fileBuffer.byteLength > MAX_PHOTO_BYTES) return json({ error: "Image too large (max 10MB)" }, 413);
  const mimeType = sniffImageType(fileBuffer);
  if (!mimeType) return json({ error: "Please upload a JPG, PNG or WebP photo." }, 400);
  const base = String(file.name || "photo").replace(/\.[^.]*$/, "").replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase().slice(0, 80) || "photo";
  const fileName = `${g.slug}/photos/${Date.now()}-${base}.${PHOTO_EXT[mimeType]}`;
  await env.ASSETS_BUCKET.put(fileName, fileBuffer, { httpMetadata: { contentType: mimeType } });
  return json({ success: true, url: `${env.ASSETS_URL}/${fileName}` });
}

/**
 * Fetch a photo from a web address for admin's "Add from a link" box and hand the bytes back to the
 * browser, which then shrinks it and uploads it through handleUploadPhoto like any file (nothing is
 * stored here). Guarded so it can only ever bring back a JPEG / PNG / WebP picture: http(s) on the
 * default port, no bare IP addresses or local names, each redirect re-checked (max 4), 10 s limit,
 * 10 MB cap read as it streams, type decided by the bytes.
 */
const FETCH_PHOTO_TIMEOUT_MS = 10000;

function photoLinkProblem(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return "That doesn't look like a web address."; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "Use a link that starts with https://";
  if (u.username || u.password || u.port) return "That link can't be used.";
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[") ||
      /(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host)) return "That link can't be used.";
  return null;
}

async function readCapped(res, max) {
  const len = Number(res.headers.get("Content-Length") || 0);
  if (len > max) return null;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    parts.push(value);
  }
  const out = new Uint8Array(total); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

async function handleFetchPhoto(c) {
  let body;
  try { body = await c.request.json(); } catch { return json({ error: "No link given." }, 400); }
  let url = String(body?.url || "").trim();
  const bad = photoLinkProblem(url);
  if (bad) return json({ error: bad }, 400);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_PHOTO_TIMEOUT_MS);
  try {
    let res;
    for (let hop = 0; ; hop++) {
      res = await fetch(url, {
        redirect: "manual", signal: ac.signal,
        headers: { "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8", "User-Agent": "Mozilla/5.0 (compatible; whgemachs.org photo import)" },
      });
      if (res.status < 300 || res.status >= 400) break;
      const next = res.headers.get("Location");
      if (!next || hop >= 4) return json({ error: "That link keeps redirecting — try the image's own address." }, 400);
      url = new URL(next, url).toString();
      const nextBad = photoLinkProblem(url);
      if (nextBad) return json({ error: nextBad }, 400);
    }
    if (!res.ok) return json({ error: `That site answered ${res.status} — it may not allow downloads. Save the photo and upload it instead.` }, 400);
    const bytes = await readCapped(res, MAX_PHOTO_BYTES);
    if (!bytes) return json({ error: "Image too large (max 10MB)" }, 413);
    const mimeType = sniffImageType(bytes.buffer);
    if (!mimeType) {
      const isPage = /text\/html/i.test(res.headers.get("Content-Type") || "");
      return json({ error: isPage
        ? "That link is a web page, not the picture itself. Right-click (or long-press) the photo and choose “Copy image address”, then paste that."
        : "That link isn't a JPG, PNG or WebP picture." }, 400);
    }
    return new Response(bytes, { headers: { "Content-Type": mimeType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    return json({ error: ac.signal.aborted ? "That site took too long to answer." : "Couldn't reach that link." }, 400);
  } finally { clearTimeout(timer); }
}

export { handleFetchPhoto, photoLinkProblem };
export { handleGetItemTypes, itemTypeQtyFields, resolveCategoryField, airtableResult, handleCreateItemType, handleUpdateItemType, handleGetCatalogItems, ITEM_CONDITIONS, badCondition, handleCreateItem, handleUpdateItem, handleDeleteItem, MAX_PHOTO_BYTES, handleUploadPhoto };
