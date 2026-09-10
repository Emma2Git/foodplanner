# Speiseplan Boerhaavegasse

Zeigt den Essensplan von [boerhaavegasse.at/menuekarte](https://www.boerhaavegasse.at/menuekarte/)
für die **aktuelle Kalenderwoche** an – mit Wochentag und Datum. Da die Daten bei jedem
Seitenaufruf live von der Schulseite geladen werden, aktualisiert sich die App automatisch
jede Woche von selbst, ohne dass etwas manuell angepasst werden muss.

## Funktionsweise

- `api/menu.js` — eine Vercel Serverless Function, die die Original-Seite server-seitig
  abruft (dadurch kein CORS-Problem im Browser) und den HTML-Text in strukturierte
  Tages-/Menüdaten umwandelt.
- `index.html` — lädt `/api/menu`, filtert auf Montag–Sonntag der aktuellen Woche und
  stellt die Tage als Karten dar (heutiger Tag wird hervorgehoben).

## Deployment (wie bei deinen anderen Projekten)

1. Diesen Ordner in ein neues GitHub-Repo pushen.
2. Auf [vercel.com](https://vercel.com) das Repo importieren.
   - Framework Preset: **Other** (kein Build-Schritt nötig)
   - Keine Umgebungsvariablen erforderlich
3. Deploy klicken — fertig. Die Domain zeigt danach immer die aktuelle Woche.

## Bekannte Einschränkungen

- Die Schulseite veröffentlicht den Plan manchmal erst kurz vorher — falls für die
  aktuelle Woche noch nichts online ist, zeigt die App automatisch die nächsten
  verfügbaren Tage mit einem Hinweis an.
- Der Parser liest den sichtbaren Text der Seite aus (Tages-Überschriften wie
  „Do., 10. 9. 2026" und Labels wie „Optimenü:", „HIB-Fit Menü:" etc.). Ändert die
  Schule ihr Seitenlayout grundlegend, muss `api/menu.js` ggf. angepasst werden.
