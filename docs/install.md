# Lastro — Especificação de Instalação (Docker no macOS)

Esta especificação descreve como instalar e subir a plataforma Lastro em um
contêiner (Docker) no macOS, incluindo o PostgreSQL e todos os serviços da
aplicação. Ela é o complemento operacional de `docker-compose.release.yml`,
`Dockerfile` e `docs/runbook.md`.

## Visão geral da topologia

| Serviço | Container | Porta (host) | Descrição |
|---|---|---|---|
| `postgres` | `lastro-postgres` | `5432` | Banco de dados PostgreSQL 16, fonte de verdade |
| `api` | `lastro-api` | `3001` | API HTTP/JSON autenticada (`/v1/books/:bookId/...`, `/health`) |
| `mcp` | `lastro-mcp` | `3002` | Adaptador MCP Streamable HTTP (`/mcp`, `/health`) |
| `worker` | `lastro-worker` | — | Jobs recorrentes PostgreSQL-first (sem porta exposta) |

Os contêineres de serviço dependem do `postgres` ficar `healthy` antes de subir.

## Pré-requisitos

- macOS (Apple Silicon ou Intel) com um motor de contêineres instalado e em
  execução. Recomendado: **Docker Desktop** ou **OrbStack**.
- `docker` e `docker compose` disponíveis no `PATH` (compose v2 ou superior).
- Git e acesso ao repositório `shiborgi/lastro`.
- Segredos fornecidos por variável de ambiente (nunca commitados):
  - `LASTRO_DB_PASSWORD` — senha do banco (padrão: `lastro`).
  - `LASTRO_MCP_BEARER_TOKEN` — credencial Bearer para o serviço MCP.

## Passo a passo

### 1. Obter o código-fonte

```bash
git clone git@github.com:shiborgi/lastro.git
cd lastro
git checkout main
```

### 2. Definir os segredos

Exporte os segredos no shell ou em um arquivo `.env` (que está no `.gitignore`):

```bash
export LASTRO_DB_PASSWORD='troque-por-uma-senha-forte'
export LASTRO_MCP_BEARER_TOKEN='credencial.mcp-secreta'
```

### 3. Subir o stack com Docker Compose

```bash
docker compose -f docker-compose.release.yml up -d --build
```

Isso constrói as imagens, inicia o PostgreSQL e, assim que o banco estiver
`healthy`, sobe `api`, `mcp` e `worker`.

### 4. Aplicar as migrações

Execute a migração dentro do contêiner do banco (ou a partir de um contêiner com
Bun):

```bash
docker compose -f docker-compose.release.yml exec postgres \
  psql -U lastro -d lastro -c "SELECT 1;"
```

Para aplicar o esquema completo, rode a migração a partir da raiz com Bun
(exige `bun` local) apontando para o PostgreSQL em `localhost:5432`:

```bash
DATABASE_URL="postgres://lastro:${LASTRO_DB_PASSWORD:-lastro}@localhost:5432/lastro" \
  bun run db:migrate
```

### 5. Verificar a saúde

```bash
curl -s http://127.0.0.1:3001/health   # api → {"status":"ok","database":{"status":"up"}}
curl -s http://127.0.0.1:3002/health   # mcp → {"status":"ok","database":{"status":"up"}}
```

O PostgreSQL responde em `localhost:5432` com usuário/senha/banco conforme os
segredos definidos.

## Portas publicadas e rede

- Os serviços `api` e `mcp` publicam portas no host (`3001`, `3002`).
- `postgres` publica `5432`; o `worker` não expõe porta.
- Todos os contêineres compartilham a rede padrão do Compose e comunicam-se
  internamente pelos nomes de serviço (`postgres`, `api`, `mcp`, `worker`).

## Persistência

O volume `lastro_pgdata` persiste os dados do PostgreSQL entre execuções. Para
remover os dados (e recomeçar do zero):

```bash
docker compose -f docker-compose.release.yml down -v
```

## Operação diária

- Parar (sem apagar dados): `docker compose -f docker-compose.release.yml stop`
- Subir de novo: `docker compose -f docker-compose.release.yml up -d`
- Ver logs: `docker compose -f docker-compose.release.yml logs -f api mcp worker`
- Backup: `bun run backup` (gera `/tmp/lastro.dump`)
- Restore: `bun run restore` (restaura para um banco limpo)

## Notas e ressalvas

- O comando `bun run db:migrate` e as rotinas de backup/restore requerem o
  runtime **Bun** no host. Para um ambiente somente-container, rode esses
  passos dentro de um contêiner com Bun.
- Em desenvolvimento local simples, o `docker-compose.yml` (raiz) sobe apenas o
  PostgreSQL; os serviços rodam com `bun run dev`.
- Nunca versione segredos; todos os valores sensíveis entram por variável de
  ambiente.
