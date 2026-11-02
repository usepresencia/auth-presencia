# Auth Presencia

Base do serviço central de identidade da Presencia, em NestJS e TypeScript.

## Estado atual

Estrutura inicial executável: validação de ambiente, health checks, testes, CI e imagem Docker. O provedor OIDC, Firebase upstream, banco, grants e login ainda serão implementados conforme o plano em [docs/implementation-plan.md](docs/implementation-plan.md). A escolha entre oidc-provider e Ory Hydra permanece pendente da prova de conceito.

## Desenvolvimento

Use Node.js 24.15 ou superior na linha 24 LTS (arquivo .nvmrc) e npm.

```sh
nvm use
npm ci
cp .env.example .env
npm run start:dev
```

O serviço escuta em http://localhost:3340 por padrão. AUTH_ISSUER é obrigatório e deve representar a origem pública estável. Produção exige HTTPS. Nenhuma credencial real é necessária nesta etapa.

- GET /health/live: 200 quando o processo HTTP responde.
- GET /health/ready: 503 enquanto provedor e persistência não estiverem implementados; não utilizar como readiness de uma implantação funcional ainda.
- Endpoints OIDC e de gestão ainda não estão publicados.

## Estrutura

```text
src/
  main.ts
  app.module.ts
  shared/config/       # configuração validada
  modules/
    health/            # liveness e readiness
    identity/          # identidade estável e vínculo Firebase
    access/            # produtos e concessões de acesso
    oidc/              # integração com o provedor escolhido
    management/        # gestão autenticada serviço-a-serviço
    audit/             # auditoria de segurança
test/                  # configuração e integração HTTP
docs/                  # plano e limites de arquitetura
```

O módulo identity possui domínio, serviço e repositório PostgreSQL; os demais aguardam seus casos de uso. Criar camadas domain/application/infrastructure/presentation dentro de cada módulo conforme os primeiros casos de uso, evitando dependências sem utilização.

## Verificação

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Depois do build, npm start inicia dist/main.js. A CI executa os mesmos checks.

Na validação inicial (31/10/2026), `npm audit --omit=dev` não apontou vulnerabilidades. Após adicionar as ferramentas padrão de contribuição, a árvore completa apresenta 18 alertas moderados em dependências de desenvolvimento, incluindo minimatch e ferramentas legadas de changelog. Reavaliar as atualizações dessas ferramentas sem aplicar downgrades ou overrides incompatíveis automaticamente.

## Docker

```sh
docker build -t auth-presencia .
docker run --rm -p 3340:3340 -e AUTH_ISSUER=https://auth.presencia.com.br auth-presencia
```

Esse comando testa apenas a base HTTP. Não configura DNS, TLS ou um provedor OIDC. O container usa Node 24 e usuário sem privilégios. Quando persistência for implementada, o health de readiness deverá verificar suas dependências reais.

## Próxima entrega

Prova de conceito de autorização PKCE com client de teste, persistência compartilhada e Firebase upstream em staging. Após a escolha do provedor: modelo de identidade/grants, gestão restrita, MFA e piloto no admin-console.

## Segurança e configuração

Não versionar .env, chaves privadas, credenciais Firebase ou tokens. .env.example contém apenas valores de desenvolvimento. Autorização de produto e assinatura de tokens serão implementadas no serviço; roles de tenant permanecem nos produtos. Nenhum bypass de autenticação faz parte desta base.

## Contribuição e backlog

Consulte [os padrões do repositório](docs/repository-standards.md) para commits, hooks, releases, templates e automações. O [backlog OIDC](docs/issue-backlog.md) lista issues por fase e repositórios afetados. A documentação de API gerada por `npm run docs` fica em `docs/api/`.

## Inventário de autenticação

O [inventário de consumidores](docs/inventory/auth-consumers.md) e seu [manifesto JSON](docs/inventory/auth-consumers.json) registram fontes de identidade, sessões, permissões, APIs chamadas e exceções a tratar na migração. Incluem AgendaFlow Flutter, Kontal e o WebSocket da Presencia. Valores reais de deploy e segredos não fazem parte desse documento.
