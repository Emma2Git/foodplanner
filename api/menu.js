// Vercel Serverless Function (Node.js Runtime)
// Lädt den Speiseplan server-seitig (kein CORS-Problem) und wandelt ihn in JSON um.

const SOURCE_URL = "https://www.boerhaavegasse.at/speiseplan/menueplan.php";

export default async function handler(req, res) {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SpeiseplanApp/1.0)" },
    });

    if (!response.ok) {
      throw new Error(`Quelle antwortete mit Status ${response.status}`);
    }

    const html = await response.text();
    const days = parseMenu(html);

    // 1 Stunde cachen, damit die Schulseite nicht bei jedem Klick neu angefragt wird
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=1800");
    res.status(200).json({ days, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({
      error: "Speiseplan konnte nicht geladen werden.",
      details: String(err && err.message ? err.message : err),
    });
  }
}

// ---- Parsing-Logik ----

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&auml;/g, "ä")
    .replace(/&Auml;/g, "Ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&uuml;/g, "ü")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/g, "ß")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToLines(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  // Block-Elemente durch Zeilenumbrüche ersetzen, dann alle übrigen Tags entfernen
  text = text.replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d|\/td)[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "\n");
  text = decodeEntities(text);
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const DAY_RE = /^(Mo|Di|Mi|Do|Fr|Sa|So)\.,\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/;
const MENU_RE = /^(Optimenü|HIB-Fit Menü|Alternativmenü|BOGA-Lunch\s*\d*)\s*:\s*(.+)$/;

function parseMenu(html) {
  const lines = htmlToLines(html);
  const days = [];
  let current = null;
  let section = null; // "mittag" | "abend"
  let lastItem = null;

  for (const line of lines) {
    const dayMatch = line.match(DAY_RE);
    if (dayMatch) {
      if (current) days.push(current);
      const [, dow, d, m, y] = dayMatch;
      current = {
        dow,
        date: `${d.padStart(2, "0")}.${m.padStart(2, "0")}.${y}`,
        iso: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
        fruehstueck: false,
        mittag: [],
        abend: [],
      };
      section = null;
      lastItem = null;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("Frühstücksbuffet")) {
      current.fruehstueck = true;
      continue;
    }
    if (line.startsWith("Mittagessen")) {
      section = "mittag";
      continue;
    }
    if (line.startsWith("Abendessen")) {
      section = "abend";
      continue;
    }

    const menuMatch = line.match(MENU_RE);
    if (menuMatch && section) {
      const label = menuMatch[1].trim();
      const dish = menuMatch[2].trim();
      const existing = current[section].find((it) => it.dish === dish);
      if (existing) {
        if (!existing.label.includes(label)) existing.label += " / " + label;
      } else {
        const item = { label, dish };
        current[section].push(item);
        lastItem = item;
      }
      continue;
    }

    if (line.startsWith("Beilagen:") && lastItem) {
      lastItem.dish += " + Beilage: " + line.replace("Beilagen:", "").trim();
      continue;
    }
  }

  if (current) days.push(current);
  return days;
}
