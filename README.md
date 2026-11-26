# Auth Presencia

Serviço central de identidade da Presencia, em NestJS e TypeScript. Emite tokens OIDC (authorization code com PKCE) a partir de contas do Firebase. É somente API: as telas ficam no front de login.

## Desenvolvimento

Use Node.js 24.15 ou superior na linha 24 LTS (arquivo .nvmrc) e npm.

```sh
nvm use
npm ci
cp .env.example .env      # preencha as chaves (veja abaixo)
docker compose up -d db
npm run emulators         # Firebase Emulator, em outro terminal
npm run prisma:generate
npm run db:migrate
npm run start:dev
```

`node scripts/generate-keys.mjs` imprime as chaves de assinatura, de cookies e um segredo de client. Banco, chaves, clients e Firebase são obrigatórios para a API iniciar; as variáveis estão descritas em .env.example.

O serviço escuta em http://localhost:3340. AUTH_ISSUER é a origem pública estável. Produção exige HTTPS, proxy confiável e recusa o Firebase Emulator.

## Rotas

| Rota                                   | Uso                                       |
| -------------------------------------- | ----------------------------------------- |
| `/.well-known/openid-configuration`    | Discovery                                 |
| `/jwks`, `/authorize`, `/token`, `/me` | Protocolo OIDC                            |
| `/token/revocation`, `/session/end`    | Revogação e logout                        |
| `/interaction/:uid/{details,login,…}`  | Login e recuperação de senha para o front |
| `/session/logout-details`              | Confirmação de logout para o front        |
| `/health/live`                         | 200 quando o processo HTTP responde       |
| `/health/ready`                        | Sempre 503 até a entrega da issue #15     |

A sessão dura 7 dias sem uso, renovados pelo refresh token, com teto de 14 dias desde o login.

**Ainda não publicar em produção:** não há limite de tentativas de login nem readiness (#15).

## Erros

Rotas próprias respondem `statusCode`, `code`, `message`, `error` e `correlationId`; as rotas do protocolo seguem o formato do OAuth. Falhas 5xx são gravadas em `logs/{correlationId}/entries` no Firestore, lidas pela tela de Logs do web-admin-console, sem a mensagem original do erro. O header `x-correlation-id` é aceito e devolvido.

## Estrutura

```text
src/
  main.ts, app.module.ts, bootstrap.ts
  shared/       # somente o que mais de uma camada usa
  modules/      # um diretório por módulo, com as camadas que ele usa
    <módulo>/
      model/            # entidades, regras puras, interfaces e erros
      application/      # casos de uso
      infrastructure/   # Prisma, Firebase e oidc-provider
      presentation/     # controllers, guards, middleware e validação de entrada
test/           # unidade, integração e workflows
```

A direção das dependências entre camadas é verificada pelo `npm run lint`.

## Verificação

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npx firebase emulators:exec --project demo-presencia 'npm run test:integration'
```

A integração exige `INTEGRATION_DATABASE_URL` apontando para um banco Postgres dedicado cujo nome termine em `_test`.

## Docker

```sh
docker build -t auth-presencia .
docker run --rm -p 3340:3340 --env-file .env.container auth-presencia
```

O .env.container (não versionado) precisa das variáveis do .env.example, com valores de produção e sem aspas. Aplique as migrations com `npm run db:migrate`; a API não as executa ao iniciar.

## Segurança

Não versionar .env, chaves privadas, credenciais Firebase ou tokens. Cada produto é responsável por seus planos, acessos e papéis; o auth não os guarda.

## Contribuição

Commits convencionais, um PR por issue para `develop` e merge somente pelo mantenedor. Veja `docs/repository-standards.md`.
