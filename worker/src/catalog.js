// Part of the Gemach Network worker (see index.js for routes and env vars).
import { AirtableError, firstLink, getOwned, linkedId, scopeF } from "./airtable.js";
import { REC_RE, T } from "./config.js";
import { nyToday } from "./dates.js";
import { json, readJson } from "./http.js";
import { generateNextItemId } from "./ids.js";
import { MAX_QTY, addonPrice, isAddonType, isQtyType, lendableQty, loadQtyBookings, qtyAvailable, wholeNum } from "./quantity.js";

// ─── Catalog — Item Types ─────────────────────────────────────────────────────

async function handleGetItemTypes({ db, g }) {
  const types = await db.listAll(T.ITEM_TYPES, { filter: scopeF(g), sort: [{ field: "Display Order", direction: "asc" }] });
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
      photoUrl: r.fields["Photo"]?.[0]?.url || null,
      r2PhotoUrl: r.fields["R2 Photo URL"] || null,
      itemCount: (r.fields["Items"] || []).length,
      categoryId: linkedId(firstLink(r.fields["Product Category"])) || null,
      tracking: isAddonType(r) ? "Add-on" : isQtyType(r) ? "Quantity" : "Units",
      price: addonPrice(r),
      quantityOwned: wholeNum(r.fields["Quantity Owned"]),
      outOfService: wholeNum(r.fields["Out of Service"]),
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
  const loans = await db.listAll(T.LOANS, { filter: `AND(${scopeF(g)},OR({Status}="Active",{Status}="Reserved"))`, fields: ["Item to Reserve", "Item"] });
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
  if (body.r2PhotoUrl) fields["R2 Photo URL"] = body.r2PhotoUrl;
  const cat = await resolveCategoryField(c.db, body.categoryId);
  if (cat.error) return json({ error: cat.error }, 400);
  if (!cat.skip && cat.value.length) fields["Product Category"] = cat.value;
  const q = await itemTypeQtyFields(c.db, c.g, body);
  if (q.error) return json({ error: q.error }, 400);
  Object.assign(fields, q.fields);
  return airtableResult(c.db.create(T.ITEM_TYPES, fields));
}

async function handleUpdateItemType(c, id) {
  const body = await readJson(c.request);
  const current = await getOwned(c.db, T.ITEM_TYPES, id, c.g);
  if (!current) return json({ error: "Not found" }, 404);
  const q = await itemTypeQtyFields(c.db, c.g, body, current);
  if (q.error) return json({ error: q.error }, 400);
  const fields = { ...q.fields };
  if (body.name !== undefined)         fields["Name"] = body.name;
  if (body.description !== undefined)  fields["Description"] = body.description;
  if (body.displayOrder !== undefined) fields["Display Order"] = body.displayOrder;
  if (body.active !== undefined)       fields["Active"] = body.active;
  if (body.r2PhotoUrl !== undefined)   fields["R2 Photo URL"] = body.r2PhotoUrl;
  const cat = await resolveCategoryField(c.db, body.categoryId);
  if (cat.error) return json({ error: cat.error }, 400);
  if (!cat.skip) fields["Product Category"] = cat.value;
  return airtableResult(c.db.update(T.ITEM_TYPES, id, fields));
}


// ─── Catalog — Items ──────────────────────────────────────────────────────────

async function handleGetCatalogItems({ db, g }) {
  const [items, itemTypes] = await Promise.all([
    db.listAll(T.ITEMS, { filter: scopeF(g), sort: [{ field: "Item ID", direction: "asc" }] }),
    db.listAll(T.ITEM_TYPES, { filter: scopeF(g), sort: [{ field: "Display Order", direction: "asc" }], fields: ["Name", "Active"] }),
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

async function handleUploadPhoto(c) {
  const { request, env, g } = c;
  const contentType = request.headers.get("Content-Type") || "";
  let fileBuffer, fileName, mimeType;
  const extFor = mt => (mt.split("/")[1] || "jpg").split(";")[0].replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "jpg";

  if (contentType.includes("application/json")) {
    const { url } = await readJson(request);
    if (!url || !/^https?:\/\//i.test(url)) return json({ error: "No URL provided" }, 400);
    const fetchRes = await fetch(url);
    if (!fetchRes.ok) return json({ error: "Could not fetch image from URL" }, 400);
    mimeType = fetchRes.headers.get("Content-Type") || "image/jpeg";
    if (!mimeType.startsWith("image/")) return json({ error: "URL does not point to an image" }, 400);
    fileBuffer = await fetchRes.arrayBuffer();
    fileName = `${g.slug}/photos/${Date.now()}-imported.${extFor(mimeType)}`;
  } else if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("photo");
    if (!file || typeof file === "string") return json({ error: "No file provided" }, 400);
    mimeType = file.type || "image/jpeg";
    if (!mimeType.startsWith("image/")) return json({ error: "File must be an image" }, 400);
    fileBuffer = await file.arrayBuffer();
    const safeName = String(file.name || `photo.${extFor(mimeType)}`).replace(/[^a-zA-Z0-9.-]/g, "-").toLowerCase().slice(0, 100);
    fileName = `${g.slug}/photos/${Date.now()}-${safeName}`;
  } else {
    return json({ error: "Unsupported content type" }, 400);
  }
  if (fileBuffer.byteLength > MAX_PHOTO_BYTES) return json({ error: "Image too large (max 10MB)" }, 413);

  await env.ASSETS_BUCKET.put(fileName, fileBuffer, { httpMetadata: { contentType: mimeType } });
  return json({ success: true, url: `${env.ASSETS_URL}/${fileName}` });
}

export { handleGetItemTypes, itemTypeQtyFields, resolveCategoryField, airtableResult, handleCreateItemType, handleUpdateItemType, handleGetCatalogItems, ITEM_CONDITIONS, badCondition, handleCreateItem, handleUpdateItem, handleDeleteItem, MAX_PHOTO_BYTES, handleUploadPhoto };
