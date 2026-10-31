# Plano de implementação — Auth Presencia com OIDC

Data: 31/10/2026. Status: proposta para revisão; nenhuma migração executada.

## 1. Objetivo e escopo

Implementar login central em `https://auth.presencia.com.br`, com Firebase Auth como provedor de identidade upstream, Authorization Code + PKCE, sessões nos BFFs e validação local de access tokens nas APIs.

Este plano usa `Auth Presencia OIDC.md`, fornecido pelo usuário, como proposta de requisitos. As decisões marcadas como abertas no documento continuam abertas; recomendações abaixo não representam decisões já aprovadas ou funcionalidades existentes.

Entregas: serviço de identidade, persistência e operação, biblioteca de validação, integração dos BFFs, gestão de acesso, migração de identidades e retirada controlada da autenticação legada. Roles por tenant permanecem nos produtos. Mobile fica fora da primeira entrega.

## 2. O que foi confirmado no código

| Projeto               | Estado observado                                                                                                             | Trabalho necessário                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `web-presencia`       | Next.js 16; login Firebase via servidor; `session.ts` guarda ID token, refresh token e dados de sessão em cookies            | Introduzir client OIDC e sessão opaca no cookie, com tokens persistidos no servidor; manter seleção de tenant                              |
| `api-presencia`       | NestJS 11, Prisma/Postgres; `FirebaseAuthStrategy` valida Firebase, cria usuário ausente e resolve Membership/PlatformAccess | Adicionar identidade OIDC sem mudar o contrato de `request.user`; controlar provisionamento e remover criação implícita ao fim da migração |
| `web-admin-console`   | Next.js 15; `AuthAdapter` verifica Firebase e `platformRole`; repositórios permitem chamadas à api-presencia com bearer      | Migrar sessão e MFA; definir acesso delegado à api-presencia e conciliar a autoridade sobre roles de plataforma                            |
| `ouvidoria-municipal` | Next.js 16; callback atual é POST com token Firebase; sessão resolve Funcionario por Firebase UID                            | Criar callback GET OIDC e sessão no servidor; preservar resolução de Funcionario e papel local                                             |
| `payments-agendaflow` | Next.js 15; serviço emite custom tokens; checkout e ativação usam `signInWithCustomToken`; hooks usam Firestore no client    | Migrar concessão de acesso e escolher entre ponte Firebase controlada ou levar as leituras para o BFF                                      |

Referências principais, relativas à raiz do workspace:

- `web-presencia/src/lib/auth/session.ts`, `src/actions/auth.ts`, `src/api/auth.ts`.
- `api-presencia/src/shared/infrastructure/auth/firebase-auth.strategy.ts`, `src/shared/application/auth/auth.service.ts`, `prisma/schema.prisma`.
- `web-admin-console/src/lib/auth/session.ts`, `src/api/infrastructure/firebase/AuthAdapter.ts`, `src/api/infrastructure/repositories/RepositoryFactory.ts`.
- `ouvidoria-municipal/src/app/api/auth/callback/route.ts`, `src/lib/auth/session.ts`.
- `payments-agendaflow/src/api/infrastructure/firebase/firebase-auth.service.ts`, `src/app/activation/_components/ActivationClient.tsx`, `src/app/activation/_hooks/use-activation-chat.ts`, `src/app/(home)/payment/_components/checkout-form.tsx`.

A inspeção foi direcionada a autenticação; não constitui inventário completo de todas as rotas, integrações ou regras Firebase. Não foi localizado um projeto `api-agendaflow` nesta inspeção. O produto e suas APIs reais precisam ser identificados antes de registrar seu client.

## 3. Decisões técnicas antes da implementação

### Provedor e estrutura

Recomendação inicial: avaliar `oidc-provider` em serviço Node/TypeScript separado, com NestJS na camada de gestão se a integração se mostrar adequada. O nome do pacote é `oidc-provider`; `node-oidc-provider` é o nome do repositório. Usar a implementação do protocolo fornecida pela biblioteca, sem criar manualmente autorização, códigos e refresh tokens.

Fazer uma prova de conceito comparando a integração com Ory Hydra. Critérios: persistência, operação em múltiplas réplicas, política de grant na autorização e no refresh, JWT por resource, MFA, rotação de chaves e logout. Registrar a escolha em ADR e fixar versões e runtime compatíveis. Esse teste é condição para escolher a implementação, não autorização para implantar produção.

Estrutura proposta: `auth-presencia/` para o serviço e sua UI de interação; biblioteca `@presencia/auth` versionada para os projetos independentes. Definir local e publicação privada da biblioteca antes de criar um monorepo novo. Separar funções de verificação de API e funções de sessão/client OIDC do BFF em exports distintos.

### Separar client de recurso/API

`client_id` identifica quem pede tokens; `aud` identifica a API que recebe o access token. A correspondência um-para-um do artefato não cobre o admin-console chamando a api-presencia.

Recomendação: registrar clients por aplicação/ambiente e resources por API. O admin-console solicita um access token destinado à api-presencia somente quando sua política permitir. O ID token permanece destinado ao client admin-console. Usar resource indicators se suportados pela implementação escolhida; validar o fluxo na prova de conceito.

Cada API aceita somente sua audiência configurada. Não ampliar a lista de audiências da api-presencia apenas para aceitar tokens destinados a outro produto. `azp`/identidade do client não concede acesso por si só: aplicar scopes, grants e roles locais. Definir audience distinta para cada API do agendaflow que realmente existir.

### Autoridade sobre acesso

O auth controla grants por produto. Membership e Funcionario continuam sendo fontes das permissões locais. O código atual também usa PlatformAccess no Postgres e claims de plataforma no Firebase: eleger a fonte de verdade de `platform_role` e migrar seus escritores, evitando duas autoridades independentes.

Sugestão: auth passa a controlar privilégios globais; produtos mantêm apenas referências/projeções necessárias. Mudança de role global revoga refresh/sessões afetadas e exige nova avaliação. Definir quais roles podem entrar no console e quais operações continuam dependendo de roles locais.

O claim `products` é informativo e pode estar desatualizado até expirar. Não substitui `aud`, política de emissão ou autorização por tenant. Preferir omiti-lo de tokens de APIs que não precisam conhecer todos os produtos do usuário.

### Firebase no navegador

O payments confirma que a questão está presente. Inventariar coleções e regras antes de escolher:

1. Preferencial: mover leituras protegidas para o BFF, se o custo e os fluxos permitirem.
2. Alternativa: ponte autenticada no auth que verifica sessão/grant, mapeia o UID no projeto Firebase correto e emite custom token restrito à necessidade do produto.

Na alternativa 2, o browser recebe uma credencial Firebase para fazer sign-in; ela é uma exceção explícita à regra de manter credenciais somente no BFF. O logout OIDC não encerra automaticamente a sessão Firebase. Planejar sign-out, revogação e aplicação das regras também nesse caminho; não presumir revogação imediata de ID tokens Firebase já emitidos.

### Sessões e MFA

Cookie do produto contém somente identificador opaco, host-only, HttpOnly, Secure em produção e SameSite=Lax. Access/refresh tokens ficam no servidor; refresh protegido por criptografia e acesso restrito. Guardar state, nonce e verifier por transação de login, com expiração e consumo único; suportar abas simultâneas.

Proposta de tempos: access token 10 minutos; refresh até 30 dias; SSO absoluto de 14 dias e inatividade de 7 dias. Se refresh depende de SSO ativo, 30 dias é apenas teto: não mantém login após expiração do SSO. Formalizar essa regra e o comportamento da sessão local antes dos testes.

Console exige MFA verificável: definir fator, recuperação e disponibilidade no Firebase/Identity Platform ou solução escolhida. Um SSO comum sem MFA deve disparar step-up. O auth só emite `acr`/`amr` após comprovação; o console verifica os requisitos e a recência de autenticação, não apenas a presença de role.

## 4. Modelo de dados e contratos

Modelo lógico proposto, adaptado às interfaces de persistência do provedor escolhido:

- `Identity`: sub estável, status, datas; vínculo externo com chave única `(firebase_project_id, firebase_uid)`. Não unir contas automaticamente por e-mail.
- `Product`, `ProductGrant`: identidade, produto, estado, origem, motivo, versão/datas e ator. Unicidade identidade/produto.
- `OidcClient`, `Resource`, política client/resource/scopes: redirects e post-logout redirects exatos, método de autenticação, credenciais com rotação, endpoint de back-channel.
- Artefatos persistidos do provedor: interações, sessões SSO, autorizações, códigos e refresh tokens/famílias, com TTL e consumo atômico.
- `ProductSession`: client, identidade, sid do provedor, identificador local, tokens protegidos, expiração e estado de revogação. Armazenamento por produto, indexável por issuer/client/sid.
- `AuditEvent`, `OutboxEvent` e registro de idempotência: concessão/revogação, login, logout, publicação e processamento de eventos.

O banco e o cache são compartilhados entre réplicas do mesmo serviço; memória do processo não é persistência de produção. Chaves privadas em gestor de segredos/KMS ou mecanismo equivalente, sem exposição no JWKS, logs ou repositório.

Contratos a documentar em OpenAPI e exemplos OIDC:

- Discovery, authorization, token, JWKS, userinfo, revocation e end-session nos caminhos publicados pelo discovery. O artefato usa nomes ilustrativos; consumidores não devem inferir URLs.
- Gestão autenticada serviço-a-serviço para conceder/revogar grants, consultar identidade e revogar sessões. Autorizar caller por produto e operação; client de login não ganha poder de gestão automaticamente.
- BFFs: início de login, callback, logout, consulta de sessão e receptor de back-channel logout.
- Erros estáveis para sem grant, conta desativada, MFA pendente, sessão expirada e indisponibilidade. Nunca redirecionar para um callback que não foi validado.

## 5. Fases e critérios de aceite

### Fase 0 — inventário e prova de conceito

Mapear domínios reais, Firebase projects/UIDs, bancos, roles, flows de recuperação/ativação/primeiro login, jobs e integrações que usam bearer. Identificar o frontend agendaflow e suas APIs. Catalogar dependências do admin-console na api-presencia. Definir clients separados para produção, staging e desenvolvimento.

Executar prova de conceito com login Firebase, client confidencial PKCE, access JWT por resource e sessão persistida. Validar as decisões da seção 3 e estimar as fases após esses resultados.

**Aceite:** ADR, matriz client/resource/scopes, mapa de identidades e grants, contrato de sessão/MFA e decisão sobre ponte Firebase registrados. Nenhuma mudança de autenticação de produção.

### Fase 1 — serviço auth e operação

Criar `auth-presencia/`, migrations, adapters persistentes e UI de login. Vincular a interação OIDC à autenticação Firebase verificada no servidor, com proteção CSRF/Origin e contra login injection; não aceitar Firebase token solto como autorização para um client arbitrário. Validar conta desativada/revogação no login.

Implementar grant na autorização e no refresh, PKCE S256 obrigatório, allowlists exatas, código de 60 s consumido atomicamente, refresh rotativo com detecção de reuso e expiração de sessão. Configurar emissão JWT e checagem de resource/scopes explicitamente.

Adicionar gestão restrita, auditoria sem tokens/segredos, rate limits distribuídos, rotação de chaves, backups/restauração, health/readiness, métricas e alertas. Publicar discovery/JWKS em staging. Planejar disponibilidade de banco/cache e recuperação de chaves antes da produção.

**Aceite:** duas réplicas completam o mesmo fluxo sem perda de estado; reuso de código/refresh falha; refresh sem grant/SSO válido falha; rotação mantém validação dos tokens ainda válidos. Não publicar cadastro dinâmico de clients no MVP.

### Fase 2 — backfill e biblioteca

Criar backfill idempotente com dry-run, paginação, checkpoints e relatório de conflitos. Mapear contas por projeto Firebase + UID. A mera existência de User não comprova direito ao produto: derivar grants de Membership ativa, Funcionario ativo, entitlement/assinatura válida e privilégios internos elegíveis, conforme regras comerciais documentadas. Preservar acessos legítimos gratuitos, manuais e legados.

Criar `@presencia/auth` com validação de assinatura, issuer, audience, expiração, tipo de token, algoritmos permitidos, scopes e cache JWKS; rejeitar ID token como bearer de API. Limitar refresh de JWKS para `kid` desconhecido e não seguir `jku`/URL arbitrária do token.

Na transição, selecionar verificador por issuer permitido e depois validá-lo integralmente. Falha OIDC não tenta Firebase como fallback. Feature flag por API/client/coorte, com prazo de retirada. O caminho Firebase também aplica a política equivalente de elegibilidade ao produto; não pode contornar grant revogado.

**Aceite:** segunda execução do backfill não duplica contas/grants; conflitos ficam em quarentena; audience errada e JWT inválido são rejeitados; nenhum usuário perde roles locais ou IDs de registros existentes.

### Fase 3 — piloto no web-admin-console

Substituir login e `AuthAdapter`, adicionar client BFF e sessão opaca, exigir MFA/step-up, renovar tokens no servidor e obter tokens para api-presencia conforme a matriz definida. Adaptar primeiro os endpoints necessários da api-presencia com vínculo explícito `sub` → usuário local e mesmo formato de `request.user`.

Mover escritores de privilégios globais para a autoridade escolhida, incluindo provisionamento/alteração de usuários. Implementar logout local/global e recepção de back-channel com validação de assinatura, issuer, audience, `events`, tempo, sid/sub e proteção contra replay via jti. ID/access tokens comuns não valem como logout_token.

Tratar refresh concorrente com lock/versionamento atômico, evitando que requests legítimas reutilizem refresh antigo. Entregar logout por outbox com retry e idempotência; falhas de rede não podem perder o evento.

**Aceite:** piloto interno em staging e depois coorte de produção; acesso sem MFA negado; permissões internas preservadas; chamada à api-presencia funciona com audience correta; logout limpa todas as sessões locais alcançadas. Medir falhas antes de ampliar.

### Fase 4 — ouvidoria

Criar início de login e callback GET com code/state; retirar gradualmente o POST que recebe Firebase token e a página que consome token no fragmento. Resolver Funcionario por vínculo da identidade, preservando município, estado ativo e papel. Garantir que o atendimento público/anônimo continue com o comportamento atual.

**Aceite:** SSO após login no console quando elegível, sem acesso para quem não tem grant ou Funcionario ativo, separação entre municípios e logout global. Gestor mantém as regras locais; MFA adicional depende da política definida na fase 0.

### Fase 5 — agendaflow e payments

Integrar o client/resource real identificado na fase 0. Modificar ativação, provisionamento e webhooks de pagamento para solicitar grant pela API de gestão com credencial restrita. Entregar mudanças por outbox/retry e chave idempotente; conciliar eventos atrasados, duplicados ou fora de ordem com o estado comercial vigente.

Implementar a opção decidida para Firebase no browser. Separar ativação de conta, acesso ao produto e acesso ao tenant. Não retirar o fluxo de custom token antes de substituir todos os consumidores confirmados.

**Aceite:** pagamento/ativação elegível libera o produto uma única vez; falhas transitórias são reconciliadas; cancelamento segue a política comercial, incluindo carência/exceções; checkout e chat de ativação continuam funcionando.

### Fase 6 — web-presencia e migração completa da api-presencia

Trocar login/refresh por OIDC e cookies de token por sessão opaca. Preservar seleção de tenant, primeiro login, recuperação/troca de senha e ativação de convites; centralizar autenticação e operações de credenciais no auth quando aplicável.

Migrar estratégia/guards da API e endpoints de sessão/claim para identidade estável; manter IDs de User e foreign keys. Criar coluna/vínculo único de identidade externa via migration aditiva. Fazer vinculação por UID previamente verificado e mapa do backfill, sem usar e-mail informado pelo cliente. Aprovar provisionamento explícito antes de remover criação implícita.

**Aceite:** membros, profissionais, clientes, suporte e usuários de plataforma conservam acesso autorizado e isolamento por tenant; nenhum token de outro resource funciona na API. Links de ativação existentes seguem a janela de compatibilidade definida.

### Fase 7 — retirada do legado

Após medir uso por issuer e comprovar migração dos consumidores, desabilitar Firebase bearer por produto. Expirar sessões antigas com comunicação e janela definida. Remover callbacks de token, emissão legada desnecessária, custom claims de autorização substituídas e criação automática por UID válido. Firebase permanece como upstream e, se necessário, ponte para serviços Firebase.

**Aceite:** nenhum consumer legítimo depende do bearer legado durante a janela acordada; testes rejeitam Firebase nas APIs migradas; recuperação de contas e procedimentos operacionais documentados.

## 6. Validação e rollout

Executar testes unitários de políticas, integração real do provedor/persistência e E2E de navegador entre domínios de staging. Emulador Firebase ajuda nos fluxos locais; login Google/MFA, cookies entre domínios e redirects reais exigem staging apropriado.

Casos obrigatórios: state/nonce incorretos, login simultâneo em abas, redirect inválido, code expirado/reutilizado, PKCE incorreto, troca de client/resource, acesso sem grant, usuário desativado, MFA insuficiente, token expirado, ID token usado na API, escalada por tenant, rotação JWKS, refresh concorrente/reutilizado, logout repetido/falso, entrega atrasada de evento, recuperação após restart e indisponibilidade parcial do auth.

Access token emitido antes de revogação pode permanecer válido por até 10 minutos, conforme a proposta. Isso também vale para bearer copiado antes do logout; back-channel apaga sessões BFF, não revoga magicamente JWTs nas APIs. Se alguma operação exigir revogação imediata, escolher checagem adicional/estado local distribuído e registrar o custo frente à validação offline.

Começar por staging, depois contas internas/coortes pequenas e ampliar por produto. Registrar métricas de falha em login/callback/refresh, negações por audience/grant, atraso de concessão, logout pendente e proporção de tokens legados. Fixar limites de aceitação e janela de observação antes de cada corte.

Rollback: flags por produto, migrations aditivas, contratos de sessão compatíveis e biblioteca anterior disponível. Não reativar caminho legado para identidades revogadas nem permitir que rollback restaure grants removidos. Se não houver equivalência segura, interromper o rollout e corrigir antes de ampliar.

Checks por projeto na implementação: scripts existentes de typecheck/lint/build e testes pertinentes. `api-presencia`, admin-console, ouvidoria e payments têm script `test`; `web-presencia` não declara esse script no package.json inspecionado. O console declara `next lint`: verificar compatibilidade do comando durante o baseline. Este trabalho altera somente documentação; esses checks não foram executados agora.

## 7. Ordem de execução e primeira entrega

Dependências: inventário/ADR → auth persistente → backfill e biblioteca → console + endpoints necessários da API → ouvidoria → agendaflow/payments → web-presencia/API completa → retirada do legado.

A primeira entrega implementável é uma vertical em staging: auth + um client de teste com PKCE, Firebase upstream, grant persistido e API mínima com audience própria. Em seguida, completar MFA, gestão, refresh, logout e recuperação para habilitar o piloto interno. Não promover apenas discovery/JWKS como se o login central já estivesse pronto.

Esforço e calendário devem ser estimados após a fase 0, sobretudo pela indefinição do agendaflow, MFA e ponte Firebase. O plano não pressupõe equipe, infraestrutura nem prazo já acordados.

## 8. Referências técnicas

- Proposta fornecida: `/Users/cesarpisa/Downloads/Auth Presencia OIDC.md`.
- Provedor Node e funcionalidades suportadas: https://github.com/panva/node-oidc-provider .
- Validação e semântica de back-channel logout: https://openid.net/specs/openid-connect-backchannel-1_0.html .
- Emissão e consumo de custom tokens Firebase: https://firebase.google.com/docs/auth/admin/create-custom-tokens .

Referências consultadas durante a elaboração. Configuração, versões e limites específicos deverão ser conferidos novamente na prova de conceito.
