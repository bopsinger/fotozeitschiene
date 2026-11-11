# Zeitschiene

Zeigt Fotos und Videos aus einem Ordner auf deinem PC als Erlebnisse auf einer waagrechten Zeitachse. Läuft komplett im Browser (Chrome oder Edge), ohne Server, ohne Konto und ohne Internetverbindung.

## Starten

**Ohne Installation:** Ordner entpacken und `index.html` mit Chrome öffnen (Rechtsklick, „Öffnen mit“, Google Chrome).

**Als App mit Symbol (empfohlen, sobald die App online liegt):** Seite in Chrome öffnen, in der Adressleiste auf das Symbol „App installieren“ klicken. Chrome merkt sich dann den Ordnerzugriff dauerhaft, wenn du bei der Nachfrage „Bei jedem Besuch erlauben“ wählst.

Beim ersten Start „Fotoordner wählen“ anklicken und z. B. `Bilder` auswählen. Chrome fragt, ob die Seite den Ordner ansehen darf. Danach werden die Aufnahmedaten gelesen; bei 14 000 Dateien dauert das ungefähr eine halbe bis zwei Minuten. Die Vorschaubilder entstehen anschliessend im Hintergrund (oben rechts siehst du den Fortschritt).

## Bedienung

- **Mausrad oder Pfeiltasten:** durch die Zeit fahren
- **Leiste unten:** Anzahl Dateien pro Monat; Klick springt dorthin
- **Jahreszahl auf der Achse:** ganzes Jahr ansehen
- **Karte:** Erlebnis öffnen, nach Tagen gegliedert; „Umbenennen“ ändert den Titel
- **Kachel:** Grossansicht; Pfeiltasten blättern, Esc schliesst; Videos spielen direkt ab

## Wie Erlebnisse entstehen

1. Aufnahmezeit aus den Fotodaten (EXIF), bei Videos aus der Datei, sonst aus dem Dateinamen (z. B. `IMG_20250815_...`), sonst Änderungsdatum der Datei.
2. Liegen mehr als 8 Stunden zwischen zwei Aufnahmen, beginnt ein neues Erlebnis.
3. Dein Zuhause ist die Gegend, in der an den meisten verschiedenen Tagen fotografiert wurde. Aufeinanderfolgende Tage weiter als 40 km davon entfernt gelten als eine Reise und heissen nach dem häufigsten Ort.
4. Liegen Fotos in einem sinnvoll benannten Ordner (z. B. `2024-06 Hochzeit Lea`), wird der Ordnername zum Titel.
5. Kleine Gruppen unter 12 Dateien zuhause landen gesammelt in „Alltag im Monat“.

Alle Werte lassen sich unter **Einstellungen** ändern.

## Datenschutz und Sicherheit

- Die App liest nur den gewählten Ordner und seine Unterordner, nur lesend. Das erzwingt Chrome, nicht der Code der App.
- Es gibt keine Verbindung zu fremden Servern; die Sicherheitsrichtlinie der Seite (CSP) verbietet sie sogar. Ortsnamen kommen aus einer eingebauten Liste.
- Zwischenspeicher (Verzeichnis, Vorschaubilder, eigene Titel) liegt in der Browser-Datenbank auf diesem PC, im Chrome-Profil unter `%LOCALAPPDATA%\Google\Chrome\User Data\Default\IndexedDB`. Löschen: Einstellungen, „Zwischenspeicher löschen“.
- Die Daten sind dort nicht verschlüsselt. Wer an dein Windows-Konto kommt, kann sie sehen.

## Bekannte Grenzen

- Firefox kann sich den Ordner nicht merken; dort muss er bei jedem Start neu geladen werden.
- Videos in H.265/HEVC brauchen unter Windows 10 die „HEVC-Videoerweiterungen“ aus dem Microsoft Store. AVI spielt Chrome nicht ab.
- RAW-Dateien werden nicht angezeigt.

## Technik

Reines HTML, CSS und JavaScript ohne Bibliotheken. Dateien: `js/meta.js` (Aufnahmedaten), `js/group.js` (Erlebnisse), `js/thumbs.js` (Vorschaubilder), `js/geo.js` (Ortsnamen), `js/app.js` (Oberfläche).

Ortsnamen: [GeoNames](https://www.geonames.org/) (CC BY 4.0), aufbereitet über das Paket `all-the-cities`.
