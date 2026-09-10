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
// Label + Gericht können in einer Zeile stehen ("Optimenü:Lasagne") ODER
// die Seite trennt Label und Gericht in zwei aufeinanderfolgende Elemente
// ("Optimenü:" / "Lasagne" als separate Zeilen) - beides wird unterstützt.
const LABEL_RE = /^(Optimenü|HIB-Fit Menü|Alternativmenü|BOGA-Lunch\s*\d+)\s*:?\s*(.*)$/;

const STOP_MARKERS = [
  /^Beilagen:?$/,
  /^\[Details\]$/,
  /^Zutaten:/,
  /^Allergene:/,
  /^Nährwertangaben/,
  /^Dessert und Jause$/,
  /^BOGA-Lunch:?$/,
  /^2 Suppen zur Auswahl$/,
  /^Mittagessen/,
  /^Abendessen/,
  /^Frühstücksbuffet/,
];

function isStopLine(line) {
  return DAY_RE.test(line) || LABEL_RE.test(line) || STOP_MARKERS.some((re) => re.test(line));
}

function parseMenu(html) {
  const lines = htmlToLines(html);
  const days = [];
  let current = null;
  let section = null; // "mittag" | "abend"
  let lastItem = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

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
      i++;
      continue;
    }

    if (!current) {
      i++;
      continue;
    }

    if (line.startsWith("Frühstücksbuffet")) {
      current.fruehstueck = true;
      i++;
      continue;
    }
    if (line.startsWith("Mittagessen")) {
      section = "mittag";
      i++;
      continue;
    }
    if (line.startsWith("Abendessen")) {
      section = "abend";
      i++;
      continue;
    }

    const menuMatch = line.match(LABEL_RE);
    if (menuMatch && section) {
      const label = menuMatch[1].trim();
      let dish = menuMatch[2].trim();
      let consumedNext = false;

      if (!dish && i + 1 < lines.length && !isStopLine(lines[i + 1])) {
        dish = lines[i + 1].trim();
        consumedNext = true;
      }

      if (dish) {
        // Abgleich läuft auf dem UNVERÄNDERTEN Gerichtsnamen - die Beilage
        // wird separat gehalten, damit sie den Vergleich nicht verfälscht
        // (sonst verpasst der Duplikat-Check spätere gleiche Gerichte).
        const existing = current[section].find((it) => it.dish === dish);
        if (existing) {
          if (!existing.label.includes(label)) existing.label += " / " + label;
          lastItem = existing;
        } else {
          const item = { label, dish, side: null };
          current[section].push(item);
          lastItem = item;
        }
      }

      i += consumedNext ? 2 : 1;
      continue;
    }

    if (/^Beilagen:?$/.test(line) && lastItem) {
      let side = line.replace(/^Beilagen:?/, "").trim();
      let consumedNext = false;
      if (!side && i + 1 < lines.length && !isStopLine(lines[i + 1])) {
        side = lines[i + 1].trim();
        consumedNext = true;
      }
      if (side && !lastItem.side) lastItem.side = side;
      i += consumedNext ? 2 : 1;
      continue;
    }

    i++;
  }

  if (current) days.push(current);

  // Anzeige-Text erst jetzt zusammensetzen (Gericht + ggf. Beilage) -
  // der Duplikat-Abgleich oben lief bereits vollständig auf dem reinen
  // Gerichtsnamen.
  for (const day of days) {
    for (const section of ["mittag", "abend"]) {
      day[section] = day[section].map(({ label, dish, side }) => ({
        label,
        dish: side ? `${dish} + Beilage: ${side}` : dish,
      }));
    }
  }

  return days;
}
