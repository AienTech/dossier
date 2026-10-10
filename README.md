# Dossier

Your job search, on your own server. Dossier keeps your career history in one profile, turns it into a clean resume, and, for every job you apply to, reads the posting, shows how you match and drafts a tailored resume and cover letter that only use facts from your profile. You refine them in a chat, download them as PDFs and track each application from draft to offer.

It's a single-user web app for a small server: one password, your data in your own PostgreSQL database, and an AI model of your choice. That can be a local model through Ollama, so nothing leaves your server, or a hosted one (any OpenAI-compatible API, or Anthropic).

- **Profile:** basics, skills and languages, experience, education and references, in the order you choose, with a strength meter. Start it from an existing resume (PDF, Word or Markdown) if you like.
- **Base resume:** six themes and a theme builder, previewed live and printed to PDF on the server. Duplicate themes, or share them as files.
- **Find jobs:** search postings near your city, or anywhere you choose, through JSearch (LinkedIn, Indeed and more), Adzuna or Germany's Bundesagentur für Arbeit. Save the good ones, dismiss the rest, and start an application from a posting with one click.
- **New application:** paste a posting; Dossier pulls out the details and requirements, matches them against your profile, and writes a tailored resume and cover letter in the tone you pick.
- **Refine:** ask for changes in a chat, edit or regenerate any part (every part of the cover letter too: sender, date, recipient, greeting and sign-off, written in the letter's language), undo AI changes or go back to any earlier version, keep private notes.
- **Track:** a board and a table of every application, and a dashboard with your funnel (last 30 days, 90 days or all time), a week-by-week chart and what's worth a look next, upcoming interviews included.
- **Your data:** export and import everything as one file, nightly backups, and Delete everything.

![The dashboard: your funnel, a week-by-week chart and what's worth a look next](.github/images/dashboard.png)

<table>
  <tr>
    <td width="50%"><img src=".github/images/application.png" alt="An application with its tailored resume and the chat that refines it"><br>An application: the tailored resume, and a chat to refine it</td>
    <td width="50%"><img src=".github/images/new-application.png" alt="A new application, showing how the profile matches the posting's requirements"><br>A new application: how you match the posting</td>
  </tr>
  <tr>
    <td><img src=".github/images/applications.png" alt="The applications board, with columns from draft to offer"><br>Every application on a board, from draft to offer</td>
    <td><img src=".github/images/find-jobs.png" alt="Find jobs: postings near the profile's city, with one open"><br>Find jobs and start an application from a posting</td>
  </tr>
  <tr>
    <td><img src=".github/images/resume.png" alt="The base resume next to its themes"><br>The base resume, with six themes and a theme builder</td>
    <td><img src=".github/images/profile.png" alt="The profile editor, with its sections and strength meter"><br>One profile that every resume and letter comes from</td>
  </tr>
</table>

<sub>The screenshots show the demo data: Lena Hartmann is made up.</sub>

## Install on CapRover

Dossier runs as one app on a [CapRover](https://caprover.com) server, next to a Postgres one-click app. Give the server at least 2 vCPUs and 2 GB of memory: Dossier needs about 768 MB, Postgres and CapRover the rest (see [Performance and sizing](#performance-and-sizing)).

### 1. The image

Dossier is published to GitHub's container registry as `ghcr.io/aientech/dossier`, a public image, so CapRover pulls it without signing in. Each release is tagged with its version (e.g. `v1.0.0`), and `latest` is the newest release.

### 2. Create the database

**Apps → One-Click Apps/Databases → PostgreSQL.** Name it `dossier-db`, pick version 18, and set a user, a long random password and the database name `dossier`. Other apps reach it at `srv-captain--dossier-db:5432`; leave its port unmapped, so it's not reachable from outside.

### 3. Create the app

**Apps → Create a New App**, named `dossier`, with **Has Persistent Data** ticked. Then, in the app's settings:

- **App Configs → Environment Variables:**

  ```
  DATABASE_URL=postgresql://<user>:<password>@srv-captain--dossier-db:5432/dossier
  DOSSIER_PASSWORD=<the password you'll sign in with>
  DOSSIER_SECRET=<32 or more random characters: openssl rand -base64 32>
  ```

  Optionally `TZ` (e.g. `Europe/Berlin`, so nightly backups run at 03:00 your time), `DOSSIER_AI_*` for the AI provider (you can also set it up in the app) and `DOSSIER_BACKUP_RETENTION_DAYS`. Keep `DOSSIER_SECRET` somewhere safe: saved API keys and every session depend on it.
- **App Configs → Persistent Directories:** path in app `/data`, label `dossier-data`. Nightly backups and zipped PDFs go there.
- **HTTP Settings → Container HTTP Port:** `3000`.
- **App Configs → Instance Count:** `1`. The nightly backup schedule, the AI job queue and the PDF browser live inside the app's process; two instances would run backups twice and could lose track of jobs.
- **App Configs → Service Update Override:** a memory limit that leaves room for Chromium, and updates that start the new version before stopping the old one, going back to it if the new one doesn't come up healthy (for example when a migration fails):

  ```yaml
  TaskTemplate:
    Resources:
      Limits:
        MemoryBytes: 1073741824
  UpdateConfig:
    Order: start-first
    FailureAction: rollback
  ```

Save and update.

### 4. Deploy

- **From the published image (recommended):** the app's **Deployment** tab → **Deploy via ImageName** → `ghcr.io/aientech/dossier:latest`, or a version such as `ghcr.io/aientech/dossier:v1.0.0`.
- **From a checkout:** `caprover deploy` uses `captain-definition` and builds the image on the server, which takes a while because of Chromium.

On every start the container applies database migrations and loads the built-in themes before it serves; the **Deployment** tab's app logs show each step. When it's up, `/api/health` answers `{"status":"ok", …}`.

### 5. Turn on HTTPS

In the app's **HTTP Settings**, connect a domain if you like, then **Enable HTTPS** (Let's Encrypt) and tick **Force HTTPS by redirecting all HTTP traffic to HTTPS**.

Dossier then relies on the headers CapRover's nginx sets for every request:

- `X-Forwarded-Proto: https` makes the session cookie `Secure` and adds `upgrade-insecure-requests` to the Content-Security-Policy.
- `X-Forwarded-For` gets the visitor's address appended by nginx, and Dossier takes the last entry as the client for the sign-in rate limit, so a made-up header can't dodge it.
- The `Host` header is what the origin checks on Server Actions and file routes compare against.

So never map the app's container port to the server (**Port Mapping** stays empty): requests that skip nginx could set those headers themselves.

Imports upload an export file of up to 10 MB, and nginx's default limit is 1 MB. In **HTTP Settings → Edit Default Nginx Configurations**, add this line inside the `server { … }` block, next to the other `client_max_body_size` if there is one:

```nginx
client_max_body_size 12m;
```

### 6. Optional: a local model with Ollama

With a local model, nothing you write leaves your server. Ollama can run as a second CapRover app:

1. **Apps → Create a New App** named `ollama`, with **Has Persistent Data** ticked.
2. **App Configs → Persistent Directories:** path in app `/root/.ollama`, label `ollama-models`, so models survive updates. Set **Instance Count** to `1`, and give it room with a Service Update Override (8 GB for the model below):

   ```yaml
   TaskTemplate:
     Resources:
       Limits:
         MemoryBytes: 8589934592
   ```

3. **HTTP Settings:** tick **Do not expose as web-app**. Dossier reaches it inside CapRover; nothing else should.
4. **Deployment → Deploy via ImageName:** `ollama/ollama:0.34.4`.
5. Pull a model. CapRover has no shell, so on the server run:

   ```bash
   docker exec -it $(docker ps -q -f name=srv-captain--ollama) ollama pull qwen2.5:7b
   ```

6. In Dossier, open **Settings → AI provider → Local model**, set the server address to `http://srv-captain--ollama:11434`, pick the model and press **Test connection**. Or set `DOSSIER_AI_PROVIDER=local`, `DOSSIER_AI_URL=http://srv-captain--ollama:11434` and `DOSSIER_AI_MODEL=qwen2.5:7b` on the Dossier app.

**Which model:** `qwen2.5:7b` is a good start: a 4.7 GB download that needs about 6 GB of memory with Dossier's 16k-token context. On a smaller server, `qwen2.5:3b` (2 GB, about 3 GB of memory) works, with plainer writing. These are suggestions, not yet benchmarked. On a CPU, reading a posting takes a minute or two and a whole new application several minutes, so the local timeout is 5 minutes per request (`DOSSIER_AI_TIMEOUT_SECONDS`); 4 or more cores help, a GPU much more.

**Ollama elsewhere:** on another machine in your network, use `http://<its address>:11434` and start Ollama there with `OLLAMA_HOST=0.0.0.0` so it listens beyond localhost. On the same host as a Docker install of Dossier (not CapRover), use `http://host.docker.internal:11434`. Docker Desktop provides that name; on Linux, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the app's service. Inside a container, `localhost` is the container itself, never the host.

## Install with Docker Compose

On any server with Docker, [`compose.production.yml`](compose.production.yml) runs Dossier and PostgreSQL, with Ollama as an option. Next to it, create a `.env` file:

```bash
POSTGRES_PASSWORD=<random: openssl rand -hex 24>
DOSSIER_PASSWORD=<the password you'll sign in with>
DOSSIER_SECRET=<32 or more random characters: openssl rand -base64 32>
```

Then start it, and sign in at http://localhost:3000 on the server:

```bash
docker compose -f compose.production.yml up -d
```

The app only listens on the server itself (`127.0.0.1:3000`). Before you use it from other machines, put a reverse proxy with HTTPS in front of it, such as [Caddy](https://caddyserver.com) (`reverse_proxy localhost:3000`), Traefik or nginx. The proxy has to set `X-Forwarded-Proto` and append the client's address to `X-Forwarded-For`: Caddy and Traefik do that by default, and with nginx add `proxy_set_header X-Forwarded-Proto $scheme;` and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. For a home network without HTTPS, change the app's `ports` entry to `"3000:3000"`: everything works, but the session cookie can't be marked `Secure`.

For a local model, start the Ollama service too and pull a model (see [Which model](#6-optional-a-local-model-with-ollama)):

```bash
docker compose -f compose.production.yml --profile ai up -d
docker compose -f compose.production.yml exec ollama ollama pull qwen2.5:7b
```

In **Settings → AI provider → Local model**, use the address `http://ollama:11434`.

## Configuration

Dossier is configured with environment variables; everything else is set in the app. The server doesn't start while a required variable is missing or invalid, and the log says which one and how to fix it.

| Variable | Default | What it's for |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string, `postgresql://user:password@host:5432/database`. |
| `DOSSIER_PASSWORD` | required | The password you sign in with. It's only read from here, never stored. Changing it signs every session out. |
| `DOSSIER_SECRET` | required | At least 32 random characters. Signs sessions and encrypts saved API keys; changing it signs everyone out and API keys have to be entered again. |
| `DOSSIER_DATA_DIR` | `/data` | Where nightly backups, the backups made before an import, and zipped PDFs go. Mount a volume here. |
| `DOSSIER_BACKUP_RETENTION_DAYS` | `14` | How many days of nightly backups to keep. |
| `DOSSIER_AI_PROVIDER` | none | `local` (Ollama or llama.cpp), `openai` (any OpenAI-compatible API) or `anthropic`. A default for Settings → AI provider; a choice saved there wins. |
| `DOSSIER_AI_URL` | per provider | The AI server's address, e.g. `http://srv-captain--ollama:11434`. |
| `DOSSIER_AI_MODEL` | per provider | The model to use, e.g. `qwen2.5:7b` or `claude-sonnet-5`. |
| `DOSSIER_AI_KEY` | none | The API key for a hosted provider. |
| `DOSSIER_AI_TIMEOUT_SECONDS` | `300` local, `120` hosted | How long one AI request may take. |
| `DOSSIER_JOBS_SOURCE` | off | `jsearch`, `adzuna`, `arbeitsagentur` or `off`. A default for Settings → Job search; a choice saved there wins. |
| `DOSSIER_JSEARCH_KEY` | none | A JSearch key, from OpenWeb Ninja or RapidAPI. |
| `DOSSIER_JSEARCH_HOST` | `openwebninja` | Where that key is from: `openwebninja` or `rapidapi`. |
| `DOSSIER_ADZUNA_APP_ID`, `DOSSIER_ADZUNA_KEY` | none | Adzuna's app ID and key. |
| `TZ` | `UTC` | The server's time zone, e.g. `Europe/Berlin`. Nightly backups run at 03:00 in it, and dates the server writes (a letter's date, "today") follow it. |
| `PORT` | `3000` | The port the server listens on inside the container. |

## Choosing an AI provider

Open **Settings → AI provider**, pick one, and press **Test connection**:

- **Local model:** Ollama or llama.cpp on your own hardware. Private and free, but slower; see [the Ollama guide](#6-optional-a-local-model-with-ollama) for setup and model sizes. Inside Docker, `localhost` is Dossier's own container: use the Ollama service's name (`http://ollama:11434` with Compose, `http://srv-captain--ollama:11434` on CapRover) or `http://host.docker.internal:11434` for Ollama on the host.
- **OpenAI-compatible:** OpenAI itself or any server that speaks its API (OpenRouter, vLLM, LM Studio and others). Enter its address, your API key and the model.
- **Anthropic:** Claude models with your own API key.

API keys are stored encrypted with `DOSSIER_SECRET` and never sent back to the browser. **Never invent experience** (on by default) keeps drafts to facts from your profile and flags anything it can't find there.

## Choosing a job source

Find jobs is off until you pick a source in **Settings → Job search**. LinkedIn and Indeed don't let other apps read their job listings, so Dossier searches one of these instead:

| Source | What it covers | Key and cost |
|---|---|---|
| **JSearch** | Google for Jobs: postings from LinkedIn, Indeed, Glassdoor, Stepstone and company sites, in most countries, with their whole text. | A key from [OpenWeb Ninja](https://www.openwebninja.com/api/jsearch) or [RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch). The free plan has 200 searches a month; each page of results is one. |
| **Adzuna** | Adzuna's own index in 19 countries. It only shares the start of each posting; Dossier fetches the rest from the posting's page. | A free app ID and key from [Adzuna's developer site](https://developer.adzuna.com/signup), about 250 searches a day. |
| **Bundesagentur für Arbeit** | Germany's federal job board, with whole postings. Germany only. | No key, free. It isn't an official API (it's the access the agency's own site uses), so it can change without notice. |

The search starts from your profile's city, country and current role; change the place, radius (10 to 200 km), how recent and Remote only as you like. Every search is kept with what it found until you remove it, under **Past searches**, so going back to one, or reloading, doesn't spend another search.

## Backups and restore

- **Export:** **Settings → Your data → Export** downloads everything (profile, themes, settings, applications with their documents, chat, notes and history) as one JSON file. Your API key is left out unless you tick the box.
- **Import:** importing such a file replaces all data in one step, after saving a backup of what was there to `backups` in the data directory.
- **Nightly backups** (on by default) write the same export to `DOSSIER_DATA_DIR/backups` at 03:00 server time, keeping `DOSSIER_BACKUP_RETENTION_DAYS` days of them.
- **Database dumps:** back up PostgreSQL itself too. On CapRover:

  ```bash
  docker exec $(docker ps -q -f name=srv-captain--dossier-db) pg_dump -U <user> -Fc dossier > dossier.dump
  ```

  With Compose: `docker compose -f compose.production.yml exec -T db pg_dump -U dossier -Fc dossier > dossier.dump`.

  To restore a dump, stop Dossier (on CapRover: `docker service scale srv-captain--dossier=0`, and `=1` afterwards), load the dump, and start Dossier again:

  ```bash
  docker exec -i $(docker ps -q -f name=srv-captain--dossier-db) pg_restore --clean --if-exists -U <user> -d dossier < dossier.dump
  docker compose -f compose.production.yml exec -T db pg_restore --clean --if-exists -U dossier -d dossier < dossier.dump   # with Compose
  ```

Keep `DOSSIER_SECRET` with your backups: saved API keys can't be read without it (an export with the key included carries it in plain text instead).

## Upgrading

Take a backup first (an export, or a database dump). Then:

- **CapRover:** deploy the newer image by name (**Deploy via ImageName**), e.g. `ghcr.io/aientech/dossier:v1.1.0`.
- **Compose:** `docker compose -f compose.production.yml pull && docker compose -f compose.production.yml up -d`.

The new version updates the database on start. Going back to an older version after that isn't supported: restore the backup you took instead.

## Troubleshooting

- **"Dossier didn't start: applying the database migrations failed."** The error above that line says why. `P1001` means the database isn't reachable: check `DATABASE_URL` and that PostgreSQL is running. If a migration failed halfway, the database needs repairing before the next start: restore the dump you took before upgrading, or ask for help with the log. On CapRover with the update override from step 3, the previous version keeps running meanwhile.
- **"… is not set" or "DOSSIER_SECRET is too short":** set the variable the log names and restart.
- **PDFs fail or time out:** Chromium needs memory; give the app at least 768 MB (1 GB is comfortable). Fonts are bundled with Dossier, so documents look the same everywhere; a custom document language in a script Dossier has no font for may show empty boxes.
- **The AI times out:** local models on a CPU are slow. Try a smaller model, or raise `DOSSIER_AI_TIMEOUT_SECONDS`. **Test connection** in Settings shows whether Dossier reaches the server at all; inside Docker, `localhost` isn't the host.
- **An import fails with "413" or "Request Entity Too Large":** the reverse proxy's upload limit is below 10 MB; on CapRover, see [Turn on HTTPS](#5-turn-on-https).
- **"That file is over 10 MB":** imports are capped at 10 MB, roughly 500 applications. Raising the cap means changing two settings in the code (see [Import size limit](DEVELOPMENT.md#import-size-limit)).
- **"Too many attempts":** after five wrong passwords in a minute, sign-in pauses for 30 seconds, then longer each time, up to 15 minutes. The count is kept in the database, so restarting doesn't reset it: wait it out.
- **Forgot the password:** set a new `DOSSIER_PASSWORD` and restart.
- **Is it up?** `/api/health` answers `{"status":"ok"}` when the app and its database are fine, and 503 when the database isn't reachable.

## Privacy

- Everything you enter stays in your PostgreSQL database and data directory.
- With a **local model**, nothing leaves your server. With a **hosted provider**, Dossier sends it what the task needs: the job posting, your profile without contact details (no email, phone, address, date of birth or links), what you add when you create an application, and, when you refine, the drafts and your chat messages, though never a letter's sender or signature. Importing a resume sends its text, contact details included; the import page says so first. The notes you keep on an application are never sent.
- No telemetry, analytics or tracking: Dossier loads nothing from other sites (its Content-Security-Policy forbids it), and Next.js telemetry is off in the image.
- **Check for updates** in Settings → About asks GitHub for the latest release, only when you press it, and sends nothing about you or your install.
- **Fetch** on a new application asks the job site for the posting's page from your server, only when you press it. It never requests addresses on your own network.
- **Find jobs** is off until you choose a source. Then it sends the source what you search for (keywords, place, country, radius and filters), from your server, and nothing from your profile: the profile only fills in the form. Each search is kept with what it found, until you remove it from Past searches. For a posting that came with only its start (Adzuna, sometimes the Arbeitsagentur), Dossier asks the posting's page for the rest, as Fetch does.

## Known limitations

- **Desktop only:** made for a laptop or desktop browser, not for phones.
- **Single user:** one password and one profile; there are no accounts.
- **English interface:** documents can be written in other languages, but the app itself is in English.
- **One instance:** run a single copy of the app per database.

## Performance and sizing

Measured on 28 September 2026 with the production build in a container limited to 2 vCPUs and 1 GB:

- **PDFs:** the base resume renders in about 0.25 s, or 1 s when Chromium has to start first (it closes after five idle minutes). Two render at a time and the rest queue: six requested at once are done in 1.4 s. Dossier used at most about 520 MB, Chromium included, so give the container at least 768 MB.
- **Screens:** with ten times the demo data (90 applications), the dashboard and the applications list answer in 20–90 ms, and every query takes under a millisecond. With 900 applications they take up to about 0.2 s, mostly rendering; the tables are indexed for the queries they get.
- **Interactions** (changing a status, moving a card, switching tabs, opening an editor, typing, picking a theme) respond within 32 ms, and within about 100 ms on a CPU four times slower.

## Security

What protects your data, how to run Dossier safely and how to report a problem: see [SECURITY.md](SECURITY.md).

## Development

Working on Dossier itself: see [DEVELOPMENT.md](DEVELOPMENT.md).

## License

Dossier is free software under the [GNU Affero General Public License v3.0](LICENSE). You may use, change and share it; if you run a changed version for others over a network, you must offer them its source code.
