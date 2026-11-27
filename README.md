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

| Rota                                  | Uso                                       |
| ------------------------------------- | ----------------------------------------- |
| `/.well-known/openid-configuration`   | Discovery                                 |
| `/jwks`, `/authorize`, `/token`       | Protocolo OIDC                            |
| `/token/revocation`, `/session/end`   | Revogação e logout                        |
| `/interaction/:uid/{details,login,…}` | Login e recuperação de senha para o front |
| `/session/logout-details`             | Confirmação de logout para o front        |
| `/health/live`                        | 200 quando o processo HTTP responde       |
| `/health/ready`                       | 200 com banco e migrations prontos        |

A sessão dura 7 dias sem uso, renovados pelo refresh token, com teto de 14 dias desde o login.

## Proteções

| Ação                 | Limite por 15 minutos                                   |
| -------------------- | ------------------------------------------------------- |
| Senha recusada       | 5 por e-mail e endereço, 20 por e-mail, 50 por endereço |
| Recuperação de senha | 3 por e-mail, 10 por endereço                           |
| Recusas em `/token`  | 30 por endereço                                         |

Exceder bloqueia por 1, 5, 15 e depois 60 minutos; um dia sem tentativas zera a reincidência. A resposta é 429 com `Retry-After`. O estado fica no Postgres, compartilhado entre réplicas, com e-mails e endereços gravados somente como hash. O endereço vem do proxy confiável (`AUTH_TRUST_PROXY=true`, um único proxy à frente).

## Deploy

O workflow **CD** é acionado manualmente a partir de `main`: publica a imagem, aplica as migrations, substitui o serviço na VPS, confere `https://auth.presencia.com.br/health/ready` e volta à versão anterior se falhar. Migrations não são desfeitas na volta.

Preparação única no servidor e no GitHub:

1. Segredos `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` e `GHCR_TOKEN`.
2. DNS e certificado de `auth.presencia.com.br`.
3. Em `/srv/auth`, o `docker-compose.yml` com o serviço `auth-presencia` (imagem `ghcr.io/usepresencia/auth-presencia:${AUTH_PRESENCIA_TAG}`, porta 3340, rede do Traefik), um banco Postgres dedicado e o arquivo `.env.auth-presencia`, com as variáveis de .env.example, `AUTH_PRESENCIA_TAG` e leitura restrita.
4. No Traefik global, a API recebe somente `/.well-known`, `/jwks`, `/authorize`, `/token`, `/session`, `/health` e `/interaction/{uid}/...`; `/interaction/{uid}`, `/logout`, `/logout/success` e `/error` ficam para o front. O Traefik não deve confiar em `X-Forwarded-*` vindos da internet, pois os limites dependem do endereço real.
5. Backups do banco, métricas e alertas.

## Cadastrar um produto

Cada produto é um item de `AUTH_CLIENTS`. Alterações valem após reiniciar a API.

| Campo                    | Regra                                                                |
| ------------------------ | -------------------------------------------------------------------- |
| `clientId`               | Único; letras minúsculas, números e hífen                            |
| `clientSecret`           | Mínimo de 32 caracteres, diferente em cada client                    |
| `redirectUris`           | Endereços exatos de retorno, HTTPS (HTTP só em loopback)             |
| `postLogoutRedirectUris` | Endereços exatos para depois do logout                               |
| `resource`, `audience`   | Identificam a API; um par por API, e `audience` não repete um client |
| `scope`                  | Escopos da API, separados por espaço, sem os escopos OIDC            |
| `firebaseClaims`         | Claims customizadas que o produto recebe; as padrão são reservadas   |

Gere o segredo com `node scripts/generate-keys.mjs`. O auth não guarda quem pode acessar cada produto: isso é responsabilidade da API dele.

## Rotação de chaves

A primeira chave de `AUTH_JWKS` e de `AUTH_COOKIE_KEYS` é a que assina; as demais só validam. `node scripts/key-rotation.mjs <passo>` lê as duas variáveis do ambiente e imprime os novos valores, sem gravar arquivos. Faça um deploy depois de cada passo:

1. `add`: publica a chave nova. Espere as APIs atualizarem o JWKS (pelo menos 10 minutos).
2. `promote`: a chave nova passa a assinar. Espere os tokens antigos vencerem (10 minutos); para os cookies, até 14 dias.
3. `retire`: remove as chaves antigas.

Retirar uma chave de cookie antes de 14 dias faz quem ainda a usa entrar de novo.

### Chave comprometida

1. Rode `node scripts/key-rotation.mjs replace`, atualize o ambiente e faça o deploy.
2. Todos precisam entrar de novo. As APIs recusam os tokens antigos quando atualizam o JWKS; reinicie-as para não esperar o cache.
3. Se houver suspeita de acesso ao banco, apague também `auth_oidc_artifacts`, o que invalida os refresh tokens.

As chaves ficam no ambiente do servidor: restrinja a leitura do arquivo e guarde uma cópia protegida para restauração. Sem chaves válidas a API não inicia.

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
