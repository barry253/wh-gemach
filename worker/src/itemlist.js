// Part of the Gemach Network worker (see index.js for routes and env vars).
// Items in borrower / gemach emails: one bullet per item ("• Chairs × 58"), on its own line.
// A template's {items} on a line by itself becomes that list; {items} inside a sentence (older or custom
// templates: "your {items} is ready") reads "Chairs × 58 and Tables × 6". Same rules as admin.html.

const BULLET = "• ";
/** A line that is a bullet in a message: "• x", "* x" or "- x". */
const BULLET_LINE = /^\s*(?:•|\*|-)\s+(.*)$/;

/** "A" / "A and B" / "A, B and C". */
function itemsInline(list) {
  const a = (Array.isArray(list) ? list : [list]).map(x => String(x ?? "").trim()).filter(Boolean);
  return a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a.at(-1)}` : (a[0] || "");
}

/** "• A\n• B". */
function itemsBullets(list) {
  return (Array.isArray(list) ? list : [list]).map(x => String(x ?? "").trim()).filter(Boolean).map(x => BULLET + x).join("\n");
}

/**
 * Template text with {items} given as a list: a line that is just "{items}" becomes the bullet lines (the line
 * goes away when there are none); returns { template, inline } where inline is the in-sentence wording.
 */
function expandItems(template, items) {
  const list = (Array.isArray(items) ? items : [items]).map(x => String(x ?? "").trim()).filter(Boolean);
  const lines = String(template || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    if (line.trim() !== "{items}") { out.push(line); continue; }
    if (list.length) out.push(itemsBullets(list));
  }
  return { template: out.join("\n"), inline: itemsInline(list) };
}

/** Does this template put {items} on a line by itself (so it shows as a list)? */
const itemsOnOwnLine = tpl => String(tpl || "").replace(/\r\n?/g, "\n").split("\n").some(l => l.trim() === "{items}");

export { BULLET, BULLET_LINE, itemsInline, itemsBullets, expandItems, itemsOnOwnLine };
