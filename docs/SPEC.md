# The Token Town — Spec V1 (rev. 6 — final pra execução)

> "Strava pra vibe coding." Uma cidade 3D compartilhada onde cada dev é um prédio.
> Altura = quanto construiu com IA nos últimos 90 dias. Luz acesa = sincronizou nos últimos 30 min.
> Atualiza sozinho via hooks das ferramentas.
>
> Domínio **thetokentown.dev** · npm **thetokentown** · X **@thetokentown** · GitHub **thetokentown/thetokentown**
> **Regra de string:** `thetokentown` é a única forma. A string `tokentown` sozinha nunca aparece em comando, slug, env var, pasta, nome de arquivo, cópia ou tuíte — pertence ao NORTOWN no npm.
> Projeto pessoal de Santiago (não SMF). Hospedagem: Vercel Pro (conta pessoal) + Neon.
> **Open source:** repo público `thetokentown/thetokentown` (MIT) com `packages/cli`, `packages/core`, `packages/sources`, `fixtures/`; `apps/web` fica em repo privado. NOTICE com atribuição ao ccusage.
> **Promessa pública (em /how, nos dois idiomas):** "Sem redes de anúncio. Sem rastreadores. Nunca." Não prometer "0 ads" — patrocínio in-world (dirigíveis, outdoors) é V3 e é um objeto na cidade, não um script no browser. Rodapé: Buy Me a Coffee.

Público-alvo do documento: Claude Code em modo agente. Instruções são imperativas.
Prazo: um fim de semana (12–13/set). Cortes da seção 13 são obrigatórios.

---

## 0. Estado em 06/09/2026 e o que muda na rev. 6

### 0.1 Bloqueio aberto — resolver ANTES de qualquer código

Auditado em 06/09/2026:

- `npm view thetokentown` → **404**. O nome está solto.
- `thetokentown.dev` → **disponível**. Não foi comprado.

Oito dias pro lançamento, e a rev. 5 nasceu exatamente de perder um nome no npm. **Publicar o placeholder `0.0.1` e comprar o domínio é a tarefa 0 da seção 12** e exige o Santiago (npm login e cartão). Enquanto os dois não estiverem no nome dele, todo o resto é construção sobre nome de terceiro.

**Regra permanente:** nunca um nome de comando vai pro tuíte sem `npm view <nome>` retornar 404 no mesmo dia.

### 0.2 O que existe hoje (sessão do Codex, 06/09)

Dois repos locais, feitos contra uma versão antiga da spec:

- `~/tokentown` → `github.com/ssssantiago/thetokentown`, público, MIT. CLI de 248 linhas em um `.mjs`. Fontes claude/codex/cursor, sem grok. Payload só de tokens totais (schema v1), sem custo, sem modelo, sem machineId. 3 testes passando. Claim por fragmento de URL. **Fica e cresce.**
- `~/tokentown-web` → local, sem remote. Next via `vinext` beta em Cloudflare Workers + D1, hospedado no ChatGPT Sites. Auth por SSO do ChatGPT (handle auto-declarado, não verificado). Uma tabela. Sem i18n. **Refaz da spec em Vercel + Neon.**

**Decisão (B): fica o CLI, o web se refaz.** Zero usuários e zero dados hoje (`/api/buildings` devolve `[]`, o D1 local não tem nem tabela criada) — é a janela mais barata que vai existir pra trocar fundação.

**Salvar do web antigo, não jogar fora:**
- `app/globals.css` inteiro — a identidade visual (verde-escuro `#040807`, ácido `#d8ff45`, creme `#f5e4b5`, scanlines, vinheta, CRT). É a parte que leva mais tempo pra reencontrar.
- `app/CityExperience.tsx` — 180 linhas de react-three-fiber, base do renderer da seção 10.
- O desenho do card SVG de `app/api/card/[handle]/route.ts` — vira a base do embed da seção 11.

### 0.3 Bugs achados na auditoria — não repetir

1. **Sufixo `.svg` 404** — a rota do card validava `^[a-z0-9-]{1,39}$` contra o param, então `handle.svg` reprovava antes de tocar o banco. Isso matava o embed de README, o link "add to your GitHub profile" e a imagem de OG ao mesmo tempo. **A rota do embed aceita o sufixo `.svg` opcional e o remove antes de validar.**
2. **OG em SVG não renderiza** — X e Discord não aceitam `image/svg+xml` em card. **A OG é PNG via `@vercel/og`.** O embed de README é SVG (GitHub aceita); são dois endpoints com o mesmo desenho, formatos diferentes.
3. **Handles de pessoas reais como enfeite** — o web antigo plantou torres de preview com `samuelrizzondev` e `ryoppippi` marcadas acesas, e a busca sugeria os dois pelo nome. São exatamente as pessoas da seção 15. **Nenhum handle de pessoa real aparece em dado de preview, fixture, seed ou placeholder. Cidade fake usa handles obviamente fictícios (`builder-01`…).**
4. **Teste que não testa** — o único teste do web fazia regex em arquivo-fonte. Teste de rota exercita rota.

### 0.4 Concorrente direto: NORTOWN (nort.works)

`tokentown@0.3.0` no npm. Lê `~/.claude/projects` e `~/.codex/sessions` (+ OpenCode), mesma promessa de privacidade, pixel city com leaderboard de temporada, atualização por `schedule` a cada 10 min.

- **Nada muda no escopo.** Tudo que diferencia já está aqui: cidade viva por hooks, 90 dias com idade e rachaduras, três degraus, embed de README, i18n, citizen_no.
- **Não ler o repo dele.** Decisão do Santiago (06/09): o risco de contaminação de código de terceiro não compensa. `~/.opencode` entra na lista de V2 como fonte 5, escrita do zero.
- **Não citar, não comparar, não mencionar** no lançamento. Se alguém perguntar: "não conhecia; conceito óbvio, execução diferente".

---

## 1. Regras invioláveis

1. **Compartilhar é flex, não confissão.** Copy fala "construiu", nunca "gastou". Custo em dólar é privado por padrão.
2. **Zero fricção.** `npx thetokentown` → login no browser → prédio em < 60 s. O primeiro prédio não exige token, não exige device flow, não exige digitar código.
3. **Nada de conteúdo sai da máquina.** Só agregados numéricos por dia × fonte × modelo. Nunca prompts, código, paths, nomes de projeto. E-mail vem do GitHub (scope `user:email`, primário verificado), nunca digitado; usado só pra (a) aviso único de "prédio rachando" aos 30 dias sem sync, (b) anúncios manuais raros, (c) recuperação de conta. Opt-in separado e desmarcado pra (a) e (b). Nunca exposto em API, card ou embed. Provedor: Resend.
4. **Hook nunca quebra a ferramenta hospedeira.** `exit 0` sempre; nada de rede no caminho síncrono.
5. **Sem parser próprio onde já existe um bom.** Loaders vendorados do ccusage (MIT) para Claude, Codex e Grok. Cursor é o único código nosso.
6. **Cidade bonita vazia.** Com 5 prédios tem que parecer cidade.
7. **Bilíngue desde o dia 1.** Site em `en` e `pt-BR`, i18n no primeiro commit do web — retrofitar i18n depois é o gap mais caro que a auditoria achou. CLI só em inglês.
8. **Dólar é "valor construído", nunca "gasto".** A maioria está em plano fixo (Max, Plus, Cursor Pro); o número em USD é tokens × preço de API, rotulado em toda superfície como *valor construído (preço de API)* / *value built (API pricing)*. Tokens brutos sempre visíveis ao lado.
9. **Identidade é do GitHub, nunca auto-declarada.** Handle = handle do GitHub, não editável. Handle digitado por quem entra é land-grab garantido no dia 1 de um lançamento que mira QT oficial.

## 2. Escopo V1

**Entra:** CLI (TS, Node ≥ 20); fontes Claude Code, Codex CLI, Grok CLI, Cursor; claim por fragmento; auto-update via hooks + carona; cidade única global; prédio por pessoa **ou** por máquina; janela de 90 dias para altura; idade do prédio visível de outro jeito; luzes por sync; rachaduras por abandono; `/b/<handle>`; OG PNG; embed SVG; i18n en/pt-BR; GitHub OAuth + device flow (só pro token de hook); perfil (cidade, link, mostrar custo); número de cidadão sequencial.

**Embed SVG para README** (`GET /e/<handle>[/<slug>][.svg]`, 600×200, cache 1 h, tema dark, mostra prédio + andares + citizen_no + luz). É o loop de crescimento passivo — GitCity ganha 300 usuários/dia por causa disso.

**Não entra (V2):** bairros por país/linguagem, comparação lado a lado, cidade por empresa, ranking paginado, **`~/.opencode` como fonte 5**, Gemini/Windsurf/outros, newsletter, tema claro.

## 3. Repositório

Monorepo pnpm. **Renomear as pastas locais no início da tarefa 1:** `~/tokentown` → `~/thetokentown`, `~/tokentown-web` → `~/thetokentown-web`. Renomear `test/tokentown.test.mjs` junto. O redirect 301 de `ssssantiago/tokentown` **fica** — aponta pra nós.

```
thetokentown/
  apps/web/          Next.js 15 App Router + next-intl, Vercel   (repo privado)
  packages/cli/      thetokentown CLI (tsup, bin: thetokentown)
  packages/core/     tipos, zod, agregação, andares, pricing
  packages/sources/  claude/ codex/ grok/ cursor/
  fixtures/          sessões reais anonimizadas por fonte + fixtures do ccusage
```

## 4. Modelo de dados

### 4.1 Snapshot (CLI ou browser → servidor)

```ts
type Provider = "claude" | "codex" | "grok" | "cursor";
type SnapshotSource = "cli" | "claim" | "browser";

interface DailyUsage {
  day: string;        // YYYY-MM-DD, tz local
  provider: Provider;
  model: string;      // normalizado
  input: number; output: number; cacheRead: number; cacheWrite: number;
  costUsd: number | null;   // null = fonte não fornece nem tokens nem turnos
  costEstimated: boolean;   // true = custo derivado (Cursor), mostra asterisco
  turns: number; sessions: number;
}

interface Snapshot {
  version: 2;
  cliVersion: string;
  generatedAt: string;
  machineId: string;        // uuid do install em ~/.thetokentown/config.json;
                            // "browser-<random>" nos degraus 0 e 1
  source: SnapshotSource;
  building: string;         // slug do prédio destino ("main" por padrão)
  daily: DailyUsage[];      // histórico completo agregado (não delta)
  undedupedLines: number;   // linhas contabilizadas sem chave de dedup (ver §6, claude)
}
```

Sempre histórico completo; servidor faz upsert `MAX` por `(building, machine, day, provider, model)`. Sem cursor sync entre cliente e servidor.

### 4.2 Prédio por pessoa ou por máquina

No `install`, se o usuário já tem ≥ 1 prédio, o CLI pergunta:

```
Este computador alimenta:
  [1] seu prédio existente "@santiago" (padrão)
  [2] um prédio novo (ex: "work")  →  @santiago/work
```

- `buildings (id, user_id, slug, created_at)`; slug `main` é implícito e renderiza como `@handle`; outros renderizam `@handle/slug`.
- `usage_daily` tem `building_id` e `machine_id`. Somar por building ignora machine; machine existe só pra o `MAX` não colidir entre duas máquinas do mesmo prédio.
- `/me` permite mover uma máquina entre prédios (recalcula), renomear slug, e mesclar prédios (soma, mantém `first_day` mais antigo).

### 4.3 Banco (Neon)

```sql
users        (id, citizen_no serial unique, github_id unique, handle unique, avatar_url,
              email, email_opt_in bool default false, decay_email_sent_at null,
              country_code null, city, x_handle null, link, show_cost bool, locale, created_at, updated_at)
             -- citizen_no: sequencial, imutável, PERTENCE AO USUÁRIO, não ao prédio.
             --   Todos os prédios da pessoa mostram o mesmo "Citizen #0042 · since 2026".
             --   Quando o usuário tem n > 1 prédios, o card/OG/embed acrescenta "building i of n".
             -- register = OAuth GitHub (read:user user:email) → citizen_no atribuído no insert → uma tela de perfil, tudo opcional:
             --   país (dropdown ISO, pré-selecionado por x-vercel-ip-country), cidade (pré-preenchida do location do GitHub),
             --   handle no X, link (pré-preenchido do blog), idioma (do browser), show_cost (off), email_opt_in (off).
             --   Handle NÃO é editável e NÃO é digitado: vem do GitHub. Sem senha, sem nome real, sem login com X.
             -- /me tem "apagar minha conta" (hard delete de users + usage; lote vira praça). LGPD: linha em /how, unsubscribe em todo e-mail.
buildings    (id, user_id, slug, created_at, unique(user_id, slug))
machines     (id, user_id, label, created_at, last_seen_at)
cli_tokens   (token_hash pk, user_id, machine_id, created_at, last_used_at)   -- só pra hook
device_codes (device_code pk, user_code unique, user_id null, expires_at)
usage_daily  (building_id, machine_id, day, provider, model,
              input, output, cache_read, cache_write, cost_usd null, cost_estimated bool,
              turns, sessions, updated_at,
              pk(building_id, machine_id, day, provider, model))
building_stats (building_id pk,
              cost_90d, output_90d, turns_90d, floors, cost_estimated bool,
              first_day, last_day, streak_days, age_days,
              cost_by_provider_90d jsonb, dominant_provider, dominant_model,
              last_sync_at, lights_on bool, decay_level int,
              grid_x, grid_y, recalculated_at)
```

`building_stats` recalculado: (a) na linha do prédio após cada snapshot; (b) cron diário 00:10 UTC pra todos (a janela de 90 dias desliza, `decay_level` e `lights_on` mudam sem novo snapshot). `lights_on` também é derivado no `/api/city` a partir de `last_sync_at` pra não depender do cron.

## 5. Métricas visuais

| Métrica | Fórmula | Onde aparece |
|---|---|---|
| **Andares** | `round(10 * log2(1 + cost_90d))`, mín 1 — **para todas as fontes, sem exceção** | Altura do prédio |
| **Idade** | `age_days = hoje − first_day` (histórico completo, não 90d) | Fachada: 0–30d andaimes, 31–180d vidro moderno, 181–365d concreto, 365d+ pedra/art déco. Placa "fundado em <mês/ano>" no card |
| **Luzes** | `lights_on = last_sync_at > now − 30 min` | Janelas acesas (emissive) vs apagadas |
| **Rachaduras** | `decay_level = clamp(floor((dias sem sync − 30) / 15), 0, 4)` — 0 até 30 dias; máx 4 aos 90 | Textura de fissuras progressiva; nível 4 = escurecido, sem luz, vegetação no topo |
| **Camadas** | share de `cost_90d` por provider | Andares empilhados por cor |
| **Em construção** | `last_sync_at` nos últimos 10 min | Guindaste no topo + pulse |

Consequência natural: quem parou há 90 dias tem `cost_90d = 0` → 1 andar rachado com mato em cima. Não precisa deletar ninguém.

Cores: claude `#D97757`, codex `#10A37F`, grok `#111111` (aresta clara), cursor `#3B82F6`.

### 5.1 Luz = sync, e só sync

`lights_on` mede **frescor de dado**, não teclado quente. O degrau 2 (hooks) faz os dois coincidirem de graça: o hook só dispara quando a sessão termina, então sincronizar É atividade. Consequências, aceitas:

- **Degrau 1 (arrastar) tem `lights_on` sempre false.** Não há sync contínuo pra medir; a luz seria mentira.
- **Degrau 0 (reservar) não tem prédio**, logo não tem luz.
- Quem instalou o hook e parou de programar apaga em 30 min, porque o hook parou de disparar. É o comportamento certo.

### 5.2 Rachadura = frescor de dado, e isso é de propósito

`decay_level` conta de `last_sync_at` **para todos os degraus**, inclusive quem arrastou arquivos. Sim: quem fez upload manual e sumiu racha em 30 dias sem ter feito nada errado. É intencional — a cidade mostra dado velho como dado velho. O e-mail de decay (§8) diz, nos dois idiomas: **"reenvie seus arquivos ou instale o CLI"** / *"re-upload or install"*, nunca só "instale".

### 5.3 Cursor: custo estimado, mesma fórmula de altura

Não existe mais fórmula alternativa de andares. Cursor entra em USD como todo mundo, com uma taxa combinada e um asterisco:

- **Taxa combinada** (`blendedRate`): derivada da linha do Sonnet em `pricing.json` — `(inputPrice + outputPrice) / 2` por token. Vive em `pricing.json` sob `_blended.default` pra poder ser corrigida sem release do CLI.
- **Cursor com tokens:** `costUsd = tokens × blendedRate`, `costEstimated = true`.
- **Cursor só com turnos:** `costUsd = turns × 20_000 × blendedRate`, `costEstimated = true`. (20k tokens/turno é o chute declarado; documentar em `NOTES.md`.)
- **Cursor sem tokens e sem turnos:** `costUsd = null`, a fonte não conta.

Onde `cost_estimated` é true, toda superfície que mostra o número mostra `*` e a nota **"estimated" / "estimado"** — card, OG, embed, `/b/<handle>`, `/me`. Um prédio com qualquer camada estimada carrega o asterisco.

Motivo: `log2` de turnos dava ~10 andares contra ~70 de quem tem custo real; um prédio 100% Cursor virava barraco ao lado de todo mundo. Estimativa rotulada é mais honesta que escala incomparável.

## 5b. Formas de entrar na Town (três degraus)

Cada degrau tem aparência distinta na cidade; o visual é o upsell, não há tabela de planos.

| Degrau | Tempo | Como | O que aparece | Limitações |
|---|---|---|---|---|
| **0 · Reservar** | 30 s | Login GitHub em `/join`. Zero dado. | Lote vazio na espiral com placa "reservado por @handle · Citizen #N" | Não entra em ranking nem contadores de prédio; embed mostra a placa |
| **1 · Reivindicar** | 60 s | `npx thetokentown` → abre `/claim#<snapshot>` → login GitHub → pronto | Prédio real, altura e idade reais | **Estático** até instalar hooks: `lights_on` false, sem guindaste; decay conta do último claim |
| **1b · Arrastar** | 2 min | `/build`: arrastar `~/.claude/projects`, `~/.codex/sessions`, `~/.grok/sessions`. Parse **no browser** (Web Worker). | Igual ao 1 | Igual ao 1. Cursor não suportado neste degrau |
| **2 · Instalar** | 5 min | `thetokentown install` → device flow → hooks | Prédio vivo: luzes, guindaste, decay zerado a cada sync | — |

Regras:
- Um usuário sobe de degrau sem perder nada: reserva → reivindica (mesmo lote, mesmo `citizen_no`) → instala (`machine_id` novo faz `MAX` com o que já subiu).
- **`/build` exige sessão GitHub antes de a drop zone renderizar.** Não há caminho anônimo em degrau nenhum.
- `/build` diz em destaque, nos dois idiomas: "Seus arquivos são lidos aqui no navegador e nunca enviados. Só números agregados sobem." Link pro código do worker.
- Implementação: `packages/sources` expõe cada loader com uma interface de leitura abstrata (`list(dir)`, `read(path)`) com dois adaptadores — `fs` (CLI) e `File[]`/`FileSystemDirectoryHandle` (browser). Chrome: `showDirectoryPicker()`; outros: `<input webkitdirectory>` + drop zone. Worker recebe os `File`s, devolve o `Snapshot`.
- **Rejeitado:** auto-declaração de gasto (prédio inventado polui a cidade); leitura de screenshot por visão (custo, erro, abuso).

### 5b.1 Claim por fragmento — o caminho de entrada

Adotado no lugar do device flow para o primeiro prédio. O CLI monta o `Snapshot`, comprime e abre no browser:

```
https://thetokentown.dev/claim#<base64url(gzip(JSON.stringify(snapshot)))>
```

Por que é melhor que o device flow aqui:
- **O fragmento nunca vira request.** Não existe janela em que o dado transite antes de haver sessão.
- **O CLI não precisa de token, nem de rede.** O que o `--json` mostra é literalmente o que sobe.
- **Sem `user_code`, sem polling de 3 s.** A pessoa autentica onde já tem sessão.
- Tira `device_codes` e `cli_tokens` do caminho crítico do primeiro dia.

Mecânica obrigatória:
1. `/claim` lê `window.location.hash`, grava em `sessionStorage` sob `thetokentown.claim`, e **limpa o hash** (`history.replaceState`) pra não vazar em screenshot ou histórico.
2. Redireciona pro OAuth do GitHub se não houver sessão. O `sessionStorage` é o que sobrevive ao redirect.
3. Volta, descomprime, mostra o preview do prédio, e faz `POST /api/snapshot` **com cookie de sessão**.
4. Handle vem do GitHub. A tela não pede handle nenhum.

**Limite de tamanho:** 90 dias × 4 providers × N modelos pode passar de 100 KB em JSON. Gzip resolve na prática (~10×). Se o fragmento codificado passar de **512 KB**, o CLI não abre o browser: imprime `thetokentown login` e manda usar `publish` com token. Testar com a pasta real do autor antes de considerar fechado.

**O device flow continua existindo, e só serve pro token de hook** (§6, §8).

## 6. CLI

| Comando | Faz |
|---|---|
| `thetokentown` | `install` se não instalado, senão `status` |
| `thetokentown scan` | Varre fontes, imprime tabela local. Não envia. |
| `thetokentown claim` | scan + abre `/claim#<snapshot>`. Sem token, sem rede. Caminho do primeiro prédio. |
| `thetokentown login` | Device flow; token de hook em `~/.thetokentown/config.json` (0600) |
| `thetokentown publish [--yes]` | scan + preview + confirmação + `POST /api/snapshot` com Bearer |
| `thetokentown install` | `claim` → `login` → escolha de prédio (4.2) → hooks (§7) com **preview do diff exato e confirmação por ferramenta** → link |
| `thetokentown sync --hook [--flush]` | chamado pelos hooks; incremental; throttle 10 min; POST em background; exit 0 sempre |
| `thetokentown uninstall [--purge]` | remove só nossas entradas de hook; `--purge` apaga `~/.thetokentown` |
| `thetokentown status` | fontes, hooks, último sync, link |

Flags globais: `--json`, `--no-open`, `--since <days>` (default 90), `--site <url>`, `--demo`.

Interface `Source { id, detect(), scan(state), installHook(), uninstallHook() }`. Estado em `~/.thetokentown/state.json`; corrompido → scan completo, nunca falha.

**Adaptadores:**
- **claude** — loader ccusage. `~/.claude/projects/`, `~/.config/claude/projects/`, `CLAUDE_CONFIG_DIR`. `type: "assistant"` com `message.usage`; dedup por `message.id + requestId`. **Quando não dá pra montar a chave (falta `message.id` ou falta `requestId`), a linha é processada uma vez, sem dedup** — igual ao ccusage. Nunca cair pra uma chave sintética tipo `arquivo:linha`: ela é única por construção e faz o dedup virar no-op em silêncio, que é pior que não deduplicar de forma declarada. A contagem dessas linhas é exposta como `undedupedLines` no `--json` e no `Snapshot`, pra transparência.
- **codex** — loader `@ccusage/codex`. `~/.codex/sessions/`, `~/.codex/archived_sessions/`, `CODEX_HOME`. Delta de `total_token_usage` cumulativo (o CLI antigo já faz isso e está certo).
- **grok** — loader ccusage. `~/.grok/sessions/<cwd>/<uuid>/updates.jsonl`, só `turn_completed` com usage; custo `costUsdTicks / 1e10`. **Sem dado real do autor**: fixtures do ccusage; README marca "community-tested".
- **cursor** — próprio, melhor esforço, dois caminhos: (a) `~/.cursor/token-usage/usage.jsonl` se existir (formato de stop hook — só conta depois de instalado, sem backfill); (b) copiar `state.vscdb` pra tmp e abrir read-only via `node:sqlite`, investigando chaves de composer/chat. Documentar o que for achado em `NOTES.md`. Custo sempre estimado (§5.3).

**Pricing:** `pricing.json` embutido + fetch `thetokentown.dev/pricing.json` (cache 24 h). Match exato → sem sufixo de data → prefixo. Desconhecido: custo 0 + warning uma vez. Chave `_blended.default` pra taxa do Cursor.

## 7. Auto-update (hooks)

**Instalação automática com consentimento explícito e reversível.** O `install` mostra, por ferramenta, o diff exato que vai aplicar (antes/depois em 5 linhas), pede `[y/N]` por ferramenta, faz backup, e o `uninstall` restaura.

| Ferramenta | Arquivo | Entrada |
|---|---|---|
| Claude Code | `~/.claude/settings.json` → `hooks` | `Stop`, `SessionEnd`: `{ "type":"command", "command":"<abs>/thetokentown sync --hook", "async":true, "timeout":10 }` (`--flush` no SessionEnd) |
| Codex CLI | `~/.codex/config.toml` → `notify` | `notify = ["<abs>/thetokentown","sync","--hook"]`; se já existe notify, wrapper `~/.thetokentown/bin/codex-notify.sh` chama ambos |
| Cursor | `~/.cursor/hooks.json` → `stop`, `sessionEnd` | `{ "command": "<abs>/thetokentown sync --hook" }` |
| Grok CLI | sem hook confirmado | `launchd`/`cron` 15 min **só se** Grok é a única fonte; senão carona |

Regras: path absoluto (nunca `npx` em hook); merge cirúrgico identificando nossas entradas por substring `thetokentown sync`; backup `*.bak.thetokentown`; arquivo que não parseia → não tocar, avisar; `sync --hook` lê stdin com timeout 200 ms, respeita `stop_hook_active`, throttle em `~/.thetokentown/last-sync`, `AbortSignal.timeout(3000)`, falha → `queue.json`, log rotativo 1 MB. Mensagem final: "reinicie Claude Code / Cursor (ou `/hooks`)".

## 8. API

| Rota | Auth | Faz |
|---|---|---|
| `GET /api/auth/github` + callback | — | OAuth, scopes `read:user user:email`. Sessão em cookie. |
| `POST /api/device/start` · `POST /api/device/poll` · `GET /device` | — / — / sessão | Device flow **só pro token de hook** (user_code 8 chars sem 0/O/1/I, 10 min, poll 3 s, token 32 bytes, só hash no banco) |
| `POST /api/snapshot` | **Bearer (CLI) OU cookie de sessão (browser)** | valida (§9) → upsert → recalcula stats → `{ url, floors, lightsOn, citizenNo }`. 60/h por token, 60/h por sessão. |
| `GET /api/city` | — | prédios públicos + `grid_x/grid_y` + `lightsOn` derivado. `s-maxage=60, swr=300` |
| `GET /api/buildings/:handle[/:slug]` | — | detalhe público; `costUsd` só se `show_cost` |
| `GET /api/og/:handle[/:slug]` | — | **PNG** 1200×630 via `@vercel/og` |
| `GET /e/:handle[/:slug][.svg]` | — | **SVG** 600×200, cache 1 h. Sufixo `.svg` opcional, removido antes de validar o handle |
| `PATCH /api/me` · `POST /api/me/buildings/*` | sessão | perfil, mover máquina, renomear, mesclar |
| `GET /pricing.json` | — | estático |
| `GET /api/cron/recalc` | header secreto | Vercel Cron diário: recalcula stats; envia o e-mail "seu prédio começou a rachar" (Resend) pra quem tem `email_opt_in`, `decay_level` acabou de virar 1 e `decay_email_sent_at` é null — um por prédio, nunca repete. Copy: "reenvie seus arquivos ou instale o CLI" |

Moderação de texto livre (`city`, `x_handle`, `link`): máx 40 chars; sem URLs em `city`/`x_handle`; emoji só bandeiras; `link` só `https://`; botão *report* no card manda e-mail pro autor com handle e campo; resolução manual.

Campos públicos: `handle, slug, avatarUrl, citizenNo, buildingIndex, buildingCount, city, link, floors, costEstimated, ageDays, firstDay, streakDays, dominantProvider, dominantModel, providerShares, lightsOn, decayLevel, underConstruction, costUsd?`.

## 9. Validação

Rejeitar: `day` futuro ou < 2025-01-01; métrica negativa; `input+output > 50M`/dia/provider; `costUsd > 2000`/dia/provider; `daily.length > 10_000`; `building` slug fora de `^[a-z0-9-]{1,20}$`; `version !== 2`; `provider` fora do enum. Honor system no resto.

## 10. Cidade (render)

Three.js, ortográfica isométrica, `InstancedMesh` por (provider, tier de fachada, decay). Meta: 10k prédios a 60 fps em MacBook Air. Base: `CityExperience.tsx` do web antigo, trocando a câmera perspectiva + OrbitControls por ortográfica.

- **Posição:** **servidor**, determinística, gravada em `building_stats.grid_x/grid_y`. Espiral do centro por `first_day` crescente, `handle` desempata. Lotes 1×1, ruas a cada 4. Prédio novo pega o próximo lote livre; lotes nunca são realocados (mesclar prédios libera lote → fica praça). O web antigo posicionava no cliente por índice do array, o que fazia a cidade se remexer a cada sync de qualquer pessoa.
- **Prédio:** altura `floors * 0.25`; camadas por provider em ordem de custo; fachada por idade; janelas emissive se `lightsOn`; textura de rachadura por `decayLevel`; guindaste se `underConstruction`.
- **Cidade vazia:** terreno, ruas, monumento central (obelisco com a fórmula), água nas bordas, névoa. Handles fictícios só (`builder-01`…), nunca pessoas reais.
- **Interação:** hover tooltip; click painel lateral; `/` busca por handle → câmera anima; `?b=handle` abre focado.
- **Hora do dia:** iluminação global segue UTC real (dia/noite) — de noite as luzes acesas contam a história sozinhas. Barato e é o GIF.
- Um tema, dark. Paleta e chrome (scanlines, vinheta, CRT) vêm de `globals.css` do web antigo.

## 11. Site e i18n

`next-intl`, rotas `/{locale}`, detecção por `Accept-Language`, fallback `en`. Strings em `messages/en.json` e `messages/pt-BR.json`. Todas as strings — inclusive card, OG, embed e `/how` — passam por i18n **desde o primeiro commit**; nada hardcoded.

- `/` cidade + header (logo, contador, "Add my building" / "Adicionar meu prédio" → modal com `npx thetokentown`).
- `/b/<handle>` e `/b/<handle>/<slug>` — cidade focada + `generateMetadata` apontando pra `/api/og/...` (PNG).
- `/api/og/<handle>[/<slug>]` — `@vercel/og`, PNG 1200×630, prédio isométrico 2D (camadas, fachada, luzes), handle, andares, idade, `Citizen #N`, `building i of n` se n > 1, asterisco se `costEstimated`. Idioma pelo `locale` do dono.
- `/e/<handle>[/<slug>][.svg]` — SVG 600×200, mesmo desenho, base no card do web antigo.
- `/claim` (§5b.1) · `/join` · `/build` · `/device` · `/me` (perfil, prédios, máquinas, custo privado por fonte/modelo, toggle show_cost, uninstall) · `/how` (fórmulas, lista exata do que é enviado e do que nunca é, como remover, crédito ao ccusage e ao GitCity).

## 12. Ordem de execução

**Tarefa 0 — hoje, exige o Santiago.** `npm publish` do placeholder `0.0.1` de `thetokentown` + comprar `thetokentown.dev`. Enquanto isso não estiver feito, nada abaixo tem nome garantido.

**Sábado**

| # | Tarefa | Est. |
|---|---|---|
| 1 | Monorepo pnpm; renomear `~/tokentown` → `~/thetokentown` e `~/tokentown-web` → `~/thetokentown-web`; mover CLI pra `packages/cli`; renomear `test/tokentown.test.mjs`; CI | 1,5 h |
| 2 | `packages/core`: tipos v2, zod, `pricing.json` (+ `_blended`), agregação 90d, andares, idade, decay, custo estimado do Cursor. Testes | 2,5 h |
| 3 | Refatorar os scanners atuais pra `packages/sources` com a interface `list/read` abstrata (destrava o `/build` de graça) | 2 h |
| 4 | claude + codex emitindo `DailyUsage` por provider × model × dia com custo; grok com fixtures do ccusage | 2,5 h |
| 5 | `apps/web` novo: Next 15 + next-intl (en/pt-BR no primeiro commit), transplantar `globals.css` + `CityExperience.tsx`, câmera ortográfica, `/api/city` fake com 60 prédios variados | 3 h |
| 6 | OG PNG (`@vercel/og`) + embed SVG com o sufixo `.svg` tratado; testar preview real no X e no Discord | 2 h |

**Domingo**

| # | Tarefa | Est. |
|---|---|---|
| 7 | Neon + schema §4.3 + GitHub OAuth + sessão + `citizen_no` | 2,5 h |
| 8 | `POST /api/snapshot` (Bearer OU cookie) + `/claim` com fragmento gzip end-to-end, com o prédio do autor | 2 h |
| 8b | `/join` (reserva + citizen_no) e `/build` (sessão obrigatória → drop zone → worker → snapshot); Chrome e Safari | 2 h |
| 9 | Device flow **só** pro token de hook | 1,5 h |
| 10 | Hooks Claude/Codex/Cursor com diff + confirmação, `sync --hook`, `uninstall`. Testar reiniciando as três e vendo a luz acender | 3 h |
| 11 | `/me`, `/how`, `/b/*`, Vercel Cron, pt-BR completo | 2,5 h |
| 12 | Deploy, domínio, npm publish real. Dois amigos publicam. GIF noturno | 1,5 h |

## 13. Cortes obrigatórios

- **Dom 16h** `/build` não fecha → lança com `/join` + `claim` por CLI; `/build` vira "soon". O claim por fragmento já cobre o caminho principal.
- **Dom 17h** Cursor não fecha → `detect(): false` + "soon" no `/how`. (Hoje a fonte cursor já é decorativa: nada instala o stop hook que ela lê.)
- **Dom 18h** device flow não fecha → sem hooks no lançamento; `/me` mostra token pra `thetokentown login --token`. O produto ainda funciona, só não fica vivo.
- **Dom 19h** OG feia → texto grande + cor sólida do provider dominante.
- **Dom 19h** escolha de prédio por máquina complica → todos em `main`, feature fica em `/me` na terça.
- Render lento com 10k → cap 2k mais recentes.

## 14. Critérios de aceite

- [ ] `npx thetokentown` em máquina limpa com Claude Code → prédio no ar em < 60 s (excluindo OAuth).
- [ ] Fragmento do claim: hash limpo da URL depois de lido; payload real do autor cabe em < 512 KB comprimido.
- [ ] Hook do Claude: < 50 ms síncrono no `Stop`.
- [ ] Rede desligada → `sync --hook` exit 0, snapshot enfileirado, reenviado depois.
- [ ] `uninstall` deixa os 3 arquivos de config equivalentes ao pré-install, com hooks de terceiros preservados.
- [ ] Teste automatizado: snapshot serializado não contém `/`, `~`, `Users`, `home`, `@`.
- [ ] `GET /e/<handle>.svg` **e** `GET /e/<handle>` devolvem 200 com o mesmo SVG.
- [ ] OG é PNG e renderiza no X e no Discord, nos dois idiomas.
- [ ] Prédio com camada de Cursor mostra `*` e "estimated" em card, OG, embed e `/b/`.
- [ ] Usuário com 2 prédios: mesmo `Citizen #N` nos dois, com "building 1 of 2" e "building 2 of 2".
- [ ] Cidade com 0, 1, 5, 60, 5000 prédios parece intencional. Nenhum handle de pessoa real em dado fake.
- [ ] Prédio com 2 máquinas no mesmo slug não dobra tokens.
- [ ] Prédio sem sync há 45 dias mostra rachaduras nível 1 e luz apagada — inclusive se entrou por `/build`.
- [ ] Site inteiro em pt-BR sem nenhuma string em inglês sobrando (grep nos componentes por literais).
- [ ] `grep -rn "tokentown" --exclude-dir=node_modules` não acha nenhuma ocorrência sem "the" na frente, em conteúdo **ou** nome de arquivo ou pasta.

## 15. Lançamento e meta

**Meta: 5.000 prédios (piso), 20.000 (se der QT oficial).** Referência: GitCity (Samuel Rizzon, BR) tem 87k prédios e ~300 novos/dia; o evento que fez isso foi o QT da conta oficial do GitHub. The Token Town pede instalação de CLI, então divide por 5–10 — o teto é definido por quem dá QT, não pelo produto.

**Antes de lançar (semana de 07/set):**
- DM pro Samuel Rizzon (@samuelrizzondev): apresentar como "versão de tokens de IA do que você fez pra commits", pedir olhada, oferecer crédito no `/how`. Antes do tuíte, nunca depois. **Ele não aparece na cidade até responder.**
- Preparar 3 GIFs noturnos de 8 s: (a) luzes acendendo em ondas conforme a hora do dia, (b) guindastes em prédios em construção, (c) zoom num prédio de camadas Claude+Codex. Cada um em en e pt-BR.

**Seg 14/set — lançamento, construído pra provocar QT oficial:**
- Tuíte principal **da conta pessoal do Santiago** (@thetokentown só dá RT e responde) em inglês marcando @claudeai / @cursor_ai / @OpenAIDevs com o GIF (a). Texto: "Every dev is a building. Height = what you built with AI in the last 90 days. Lights on = coding right now. `npx thetokentown`". Um tuíte, três contas marcadas, sem thread.
- Versão pt-BR 30 min depois, marcando o Samuel (com a DM já respondida ou não).
- Reddit r/ClaudeAI, r/cursor, r/codex; Discord do Claude Code.
- Reply próprio no tuíte com o embed do README: "add your building to your GitHub profile" + snippet apontando pra `/e/<handle>.svg`.

**Ter:** Product Hunt. Post agradecendo @ryoppippi (ccusage) — o CLI vendora os loaders dele; crédito público é honesto e o público dele é o seu.
**Qua–Sex:** responder tudo, consertar, postar "a cidade 72 h depois" com contador e o GIF (b).
**Semana 2:** se passou de 1k, bairros por país (gatilho viral BR) e cidade por empresa (gatilho B2B, se algum dia importar).
**V3 (só se passar de 10k):** "Advertise in the Town" — dirigíveis e outdoors in-world por faixa de valor; banner em prédio só com opt-in do dono (com revenue share); prédio abandonado = decay 4 **e** conta apagada ou opt-in prévio.

Se em 7 dias tiver < 300 prédios, a ideia não pegou; mantém no ar, para de mexer, volta pro Excelentíssimo.
