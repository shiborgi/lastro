# Lastro — Especificação de Instalação (Apple Container no macOS)

Esta especificação descreve como instalar e subir a plataforma Lastro com o
Apple Container (`container` CLI) no macOS, incluindo o PostgreSQL e todos os
serviços da aplicação. Ela é o complemento operacional de
`scripts/apple-container.ts`, `Dockerfile` e `docs/runbook.md`. O caminho
legado via Docker Compose (`docker-compose.release.yml`) segue documentado no
runbook como alternativa.

## Visão geral da topologia

| Serviço | Contêiner | Porta (host) | Descrição |
|---|---|---|---|
| `postgres` | `lastro-postgres` | — | Banco de dados PostgreSQL 16, fonte de verdade |
| `migrate` | `lastro-migrate` | — | Contêiner efêmero (`--rm`): aplica o esquema Drizzle e encerra |
| `api` | `lastro-api` | `3001` | API HTTP/JSON autenticada (`/v1/books/:bookId/...`, `/health`) |
| `mcp` | `lastro-mcp` | `3002` | Adaptador MCP Streamable HTTP (`/mcp`, `/health`) |
| `worker` | `lastro-worker` | — | Jobs recorrentes PostgreSQL-first (sem porta exposta) |
| `web` | `lastro-web` | `3000` | Painel Next.js (dashboard + fluxo de despesas, servido com `next start`) |

O instalador aguarda o `postgres` aceitar conexões (`pg_isready`), aplica o
esquema via o contêiner efêmero `lastro-migrate` e só então sobe `api`, `mcp`,
`worker` e `web`. Os contêineres comunicam-se pelos nomes na rede `lastro`
(`postgres`, `api`). Nota: o painel busca os dados no navegador (client-side),
portanto a URL da API (`LASTRO_API_URL`, padrão `http://api:3001`) precisa ser
alcançável pelo navegador — em um deploy onde o navegador roda em outra
máquina, informe um endereço visível a esse navegador.

## Pré-requisitos

- Mac com Apple Silicon e macOS 26 (Tahoe) ou superior (DNS entre contêineres).
- Apple Container CLI (`container`) instalado e no `PATH`
  (`brew install container`).
- Bun instalado no host (orquestra a instalação e o backup/restore).
- Git e acesso ao repositório `shiborgi/lastro`.
- Segredos fornecidos por variável de ambiente (nunca commitados):
  - `LASTRO_DB_PASSWORD` — senha do banco (padrão: `lastro`).
  - `LASTRO_MCP_BEARER_TOKEN` — credencial Bearer para o serviço MCP.
  - `LASTRO_API_TOKEN` — credencial de sessão Bearer que o `web` envia à API
    (cabeçalho `Authorization`); sem uma credencial válida o painel mostra
    estado de erro em vez dos dados.

## Passo a passo

### 1. Obter o código-fonte

```bash
git clone git@github.com:shiborgi/lastro.git
cd lastro
git checkout main
```

### 2. Definir os segredos

Defina os segredos no shell ou em um arquivo `.env` (que está no `.gitignore`).
Atribua um valor próprio a cada variável abaixo — nunca versione valores reais:

- a variável `LASTRO_DB_PASSWORD` (senha do banco);
- a variável `LASTRO_MCP_BEARER_TOKEN` (credencial Bearer do serviço MCP).

No shell, exporte cada variável com o seu próprio valor secreto (sem espaços
ao redor do sinal de atribuição), por exemplo para a senha do banco e para a
credencial Bearer do serviço MCP. Alternativamente, crie um arquivo `.env`
local com essas duas variáveis e seus valores.

### 3. Instalar com um único comando

```bash
bun run apple-container install
```

Isso inicia o subsistema do Apple Container, constrói a imagem `lastro:release`,
cria a rede `lastro` e o volume `lastro_pgdata`, sobe o PostgreSQL, aguarda o
banco ficar pronto, aplica as migrações (contêiner efêmero `lastro-migrate`) e
sobe `api`, `mcp`, `worker` e `web`. Ao final, o próprio instalador verifica a
saúde de todos os serviços e só conclui com tudo respondendo.

### 4. Migrações (automáticas no boot)

O esquema é aplicado automaticamente a cada instalação, antes dos serviços
subirem. Para reaplicar manualmente (idempotente) sem reinstalar tudo:

```bash
container run --rm --network lastro \
  -e DATABASE_URL="postgres://lastro:SUASENHA@postgres:5432/lastro" \
  lastro:release bun packages/db/src/migrate.ts
```

Para conferir os logs da instalação:

```bash
bun run apple-container logs api
bun run apple-container ps
```

### 5. Verificar a saúde

```bash
curl -s http://127.0.0.1:3001/health   # api → {"status":"ok","database":{"status":"up"}}
curl -s http://127.0.0.1:3002/health   # mcp → {"status":"ok","database":{"status":"up"}}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/   # web → 200
```

O PostgreSQL responde em `localhost:5432` com usuário/senha/banco conforme os
segredos definidos.

## Portas publicadas e rede

- Os serviços `api`, `mcp` e `web` publicam portas no host (`3001`, `3002`,
  `3000`).
- `postgres` não expõe porta no host; o `worker` também não expõe porta.
- Todos os contêineres compartilham a rede `lastro` e comunicam-se internamente
  pelos nomes dos contêineres (`postgres`, `api`, `mcp`).

## Persistência

O volume `lastro_pgdata` persiste os dados do PostgreSQL entre execuções. Para
remover os dados (e recomeçar do zero):

```bash
bun run apple-container teardown --volumes
```

## Operação diária

- Parar (sem apagar dados): `bun run apple-container stop`
- Subir de novo: `bun run apple-container start`
- Ver logs: `bun run apple-container logs api` (ou `mcp`, `worker`, `web`,
  `postgres`; adicione `--follow`)
- Backup: `bun run apple-container backup` (gera `/tmp/lastro.dump`; o
  `pg_dump` roda dentro do contêiner, sem exigir ferramentas Postgres no host)
- Restore: `bun run apple-container restore` (restaura para um banco limpo,
  também dentro do contêiner)
- Desinstalar (mantendo dados): `bun run apple-container teardown`

## Notas e ressalvas

- A instalação e as rotinas de backup/restore são dirigidas pelo **Bun** no
  host, mas toda a carga executa no Apple Container (`container` CLI).
- Em desenvolvimento local simples, o `docker-compose.yml` (raiz) sobe apenas o
  PostgreSQL; os serviços rodam com `bun run dev`.
- Nunca versione segredos; todos os valores sensíveis entram por variável de
  ambiente.
