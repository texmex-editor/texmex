# TexMex — Produktives Deployment

Diese Anleitung beschreibt, wie ihr TexMex **außerhalb der lokalen Entwicklungsumgebung** betreibt: TLS, Reverse Proxy, Umgebungsvariablen, statisches Frontend und ASP.NET-Core-Backend. Das Standard-`docker-compose.yml` im Repository ist auf **Entwicklung** ausgelegt (Vite-Dev-Server, `ASPNETCORE_ENVIRONMENT=Development`); für Production kombiniert ihr die folgenden Bausteine.

## Zielarchitektur

Typisch laufen **drei logische Teile**:

1. **Statisches Frontend** (`client` nach `npm run build`, Ordner `client/dist/`) — ausgeliefert über Nginx, Caddy oder einen Object-Storage mit CDN.
2. **ASP.NET-Core-API** (Port 3000 im Container) — REST unter `/api/...`, WebSockets unter `/ws` (Yjs).
3. **LaTeX-Compiler** — nur **intern** erreichbar (wie im bestehenden Compose über `http://latex-compiler:9000`), nicht öffentlich exponieren.

Optional nutzt ihr einen **einzigen Hostnamen** (z. B. `https://texmex.example.com`) und leitet `/api` und `/ws` per Reverse Proxy zum Backend durch. Dann können Browser **gleiche Origin** für HTML und API nutzen — das vereinfacht CORS, Cookies und WebSockets.

## Voraussetzungen

- Docker (für Server, DB, LaTeX-Compiler) oder vergleichbare Orchestrierung.
- PostgreSQL 16 (kompatibel mit dem Projekt; Schema per EF-Migration beim Serverstart).
- TLS-Zertifikat (Let’s Encrypt oder internes PKI).
- Node.js 20+ **nur zum Bauen** des Frontends (`npm ci && npm run build` im Verzeichnis `client/`), falls ihr keinen separaten Build-Container nutzt.

## Umgebungsvariablen (Backend)

| Variable | Bedeutung | Production-Hinweis |
|----------|-----------|---------------------|
| `ALLOWED_ORIGINS` | Kommagetrennte Liste erlaubter **Browser-Origins** für CORS (Schema + Host + Port). | Exakt die Origin eurer **öffentlichen UI-URL**, z. B. `https://texmex.example.com`. Bei mehreren Einträgen kommagetrennt, ohne Leerzeichen um die Kommas oder mit — der Server trimmt Einträge. |
| `DATABASE_URL` | Npgsql-Connection-String. | Starker Passwort-Geheimniswert; nicht im Image hardcoden. |
| `LATEX_COMPILER_URL` | URL des Compiler-Services. | In Docker typisch `http://latex-compiler:9000` (Service-Name wie im Compose-Netz). |
| `DATA_DIR` | Verzeichnis für persistente Yjs-Daten. | Volume mounten (z. B. `/data`). |
| `ASPNETCORE_ENVIRONMENT` | ASP.NET-Umgebung. | **`Production`** setzen, damit u. a. Session-Cookies mit `Secure` gesetzt werden (HTTPS). |
| `URLS` / Kestrel | Bind-Adresse. | Z. B. `http://0.0.0.0:3000` im Container; nach außen nur über Proxy oder internes Netz. |

Die Datei `.env.example` im Repository fasst einen Teil davon für lokale Docker-Setups zusammen; für Production verwendet ihr dieselben Konzepte mit **euren** Domains und Geheimnissen.

## CORS und Cookies

- Das Backend nutzt **CORS mit Credentials** (`AllowCredentials` + feste Origins). Daher muss jede Origin, von der die SPA API-Aufrufe mit Cookies macht, in **`ALLOWED_ORIGINS`** stehen — **kein** `*`.
- Cookies sind `SameSite=Strict` und in Production **`Secure`**. Die UI sollte über **HTTPS** erreichbar sein.
- Wenn Frontend und API **unterschiedliche Origins** haben (z. B. `https://app.example.com` und `https://api.example.com`), müssen beide Origins in `ALLOWED_ORIGINS` stehen **oder** ihr stellt API und UI hinter **einer** Origin (empfohlen).

## Frontend bauen und ausliefern

```bash
cd client
npm ci
npm run build
```

Ausgabe: `client/dist/`. Diese Dateien statisch ausliefern (Nginx, Caddy, S3+CloudFront, …).

### Build-Zeit-Variable `VITE_API_BASE_URL`

Der generierte API-Client nutzt `import.meta.env.VITE_API_BASE_URL` mit Fallback `http://localhost:3000` (siehe `client/src/lib/session.ts`). Für Production setzt ihr beim Build z. B.:

- **Gleiche Origin, Proxy leitet `/api` weiter:** leere Basis-URL oder eure öffentliche API-URL — je nachdem, ob eure generierten Pfade mit `/api` beginnen (dann reicht oft eine leere Zeichenkette oder die volle Basis-URL eures API-Hosts). Beispiel Docker-Build:

  ```bash
  docker build --build-arg VITE_API_BASE_URL=https://texmex.example.com -t texmex-client ./client
  ```

  (Dafür müsst ihr im `client/Dockerfile` optional `ARG`/`ENV` ergänzen — das Standard-Dockerfile startet nur den Dev-Server.)

- **Getrennte API-Subdomain:** `VITE_API_BASE_URL=https://api.example.com` und entsprechende CORS-Origins.

**Hinweis:** In `vite.config.ts` wird für den **Dev-Server** `VITE_API_URL` (anderer Name!) für das Proxy-Ziel verwendet. Für Production-Builds ist primär **`VITE_API_BASE_URL`** relevant.

## WebSockets (Yjs)

Die Editor-Komponente verwendet eine fest kodierte WebSocket-Basis in `client/src/pages/editor/constants.ts` (`WS_URL` mit `ws://` und Port **3000**). Das passt zu einem lokalen Setup, bei dem die Seite über den Host und der API-Port 3000 erreichbar ist.

Für ein typisches Production-Setup (**nur 443/HTTPS**, WebSocket über denselben Host wie die Webseite, z. B. `wss://texmex.example.com/ws`) müsst ihr diese URL **an eure tatsächliche Erreichbarkeit anpassen** (Schema `wss`, kein harter `:3000`, falls der Proxy terminiert). Solange das im Code unverändert bleibt, plant ihr entweder einen erreichbaren Port 3000 am gleichen Hostnamen oder passt die Konstante bzw. führt eine konfigurierbare Variable ein.

Der Reverse Proxy muss für `/ws` **WebSocket-Upgrades** unterstützen (`Connection: upgrade`, `Upgrade: websocket`).

## Reverse Proxy: SPA-Routing und API

Die App nutzt **React Router mit `BrowserRouter`** (Pfade wie `/documents/...`). Der Webserver muss für **alle nicht statischen Routen** auf `index.html` zurückfallen, sonst liefern Deep-Links 404.

**Nginx** (vereinfachtes Muster):

```nginx
server {
    listen 443 ssl http2;
    server_name texmex.example.com;

    # ssl_certificate / ssl_certificate_key ...

    root /var/www/texmex/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

Passe `proxy_pass`-Ziele an eure Backend-Adresse an (anderer Container, interner Service-Name, Unix-Socket, …).

## Docker Compose in Production

Das mitgelieferte `docker-compose.yml` startet den Client als **Vite Dev**. Für Production üblich:

- **Services:** `db`, `latex-compiler`, `server` wie heute; optional ein Image, das nur `client/dist` nach Nginx kopiert.
- **Kein** `ASPNETCORE_ENVIRONMENT=Development` in Production.
- **Geheimnisse:** Postgres-Passwort und Connection String über Secrets / `.env` (nicht versionieren).
- **Ports:** LaTeX-Compiler **nicht** auf den Host mappen; Postgres nur intern oder durch Firewall abgeschottet.
- **Volumes:** `texmex_data` für `DATA_DIR`, Postgres-Datenvolume beibehalten.

Ihr könnt ein zweites Compose-File (z. B. `docker-compose.prod.yml`) oder Overrides (`docker compose -f docker-compose.yml -f docker-compose.prod.yml up`) nutzen — das Repository liefert bewusst kein fixes Production-Compose, weil Domain, TLS und Proxy stark von eurer Infrastruktur abhängen.

## Checkliste vor Go-Live

- [ ] `ALLOWED_ORIGINS` enthält exakt die öffentliche(n) UI-Origin(s).
- [ ] `ASPNETCORE_ENVIRONMENT=Production`, HTTPS aktiv, Zertifikate gültig.
- [ ] `DATABASE_URL` zeigt auf die richtige Instanz; Backups geplant.
- [ ] Frontend mit passendem `VITE_API_BASE_URL` gebaut und SPA-Fallback aktiv.
- [ ] `/ws` proxy mit Upgrade; Firewall erlaubt nur 80/443 nach außen wo nötig.
- [ ] WebSocket-URL im Client passt zu eurem Netzwerk (siehe Abschnitt WebSockets).
- [ ] LaTeX-Compiler nur intern; `LATEX_COMPILER_URL` im Server-Container korrekt.

## Referenz im Repository

- Architekturüberblick: `README.md`
- Lokale Variablen-Vorlage: `.env.example`
- CORS-Logik: `server/Program.cs`
- API-Basis-URL im Client: `client/src/lib/session.ts`
- WebSocket-URL: `client/src/pages/editor/constants.ts`

Bei Abweichungen zwischen Dokumentation und Code gewinnt der **Code**; nach größeren Refactorings diese Datei mitziehen.
