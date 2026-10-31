# Inventário de autenticação e consumidores

Data: 31/10/2026. Entrega da issue #2. Evidências: fontes locais e repositórios conectados, sem consultar credenciais, .env ou bases de produção. O [manifesto JSON](auth-consumers.json) contém os mesmos consumidores, contratos de configuração e arquivos de evidência.

## Identidades e permissões

| Consumidor              | Identidade atual                                                 | Sessão e permissões                                                                 | Destinos autenticados                                                              |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| web-presencia           | Firebase via Identity Toolkit no servidor                        | Cookies de ID/refresh token; User/Membership/PlatformAccess no Postgres             | api-presencia; transferência de token para console, ouvidoria e Kontal             |
| api-presencia           | Firebase bearer; UID → User.firebaseUid                          | request.user com memberships ativas; PlatformAccess; provisionamento implícito      | Firebase Admin, Postgres; callbacks Google e webhooks possuem autenticação própria |
| web-admin-console       | Firebase ID token e platformRole                                 | admin_session; Firebase AuthAdapter; registros administrativos no Firestore         | api-presencia para tenants, membros e privilégios; Firestore pelo Admin SDK        |
| ouvidoria-municipal     | Firebase token recebido no POST de callback                      | Cookie session; Funcionario por firebaseUid; papel gestor/funcionario e tenantId    | Firestore Admin; api-presencia para conexões WhatsApp                              |
| payments-agendaflow     | Firebase Admin e custom tokens de ativação/checkout              | Firestore users/workspaces, activation_tokens, pagamentos; billing_admin_users      | Firebase no browser; serviço de pagamentos; provisionamento/ativação               |
| web-kontal (remoto)     | Firebase token vindo do web-presencia; validação no api-kontal   | Cookie de token, seleção de empresa, consulta /auth/me por request                  | api-kontal                                                                         |
| api-kontal (remoto)     | FirebaseTokenVerifier e provisionamento de User                  | SessionUser, reconciliação de kontalMemberships, isolamento de empresa e plataforma | Firebase Admin e Postgres                                                          |
| app-agendaflow (remoto) | Fluxo Flutter de apresentação; autenticação real não demonstrada | Formulário chama callbacks; datasources API consultados são templates vazios        | Nenhum backend de agendamento confirmado; API futura precisa ser identificada      |

A ouvidoria consulta a api-presencia: a política de resources precisa contemplar tanto console quanto ouvidoria. A presença de nomes api-agendaflow em comentários/projetos Firebase não comprova a existência de um repositório/backend com esse nome.

## Evidência sobre AgendaFlow

Existe [usepresencia/app-agendaflow](https://github.com/usepresencia/app-agendaflow), com branch padrão **dev**, Flutter/Dart e aplicações Android/iOS. Em pubspec.yaml não há Firebase Auth, cliente HTTP nem biblioteca OIDC declarados. login_form.dart apenas chama onLogin; ApiAppointmentsDatasource explicita que não é usado em runtime e retorna listas vazias enquanto o backend não está disponível.

Referências: [pubspec.yaml](https://github.com/usepresencia/app-agendaflow/blob/dev/pubspec.yaml), [login_form.dart](https://github.com/usepresencia/app-agendaflow/blob/dev/lib/modules/auth/presentation/widgets/login_form.dart), [ApiAppointmentsDatasource](https://github.com/usepresencia/app-agendaflow/blob/dev/lib/modules/client/appointments/infrastructure/datasources/api_appointments_datasource.dart).

Consequência: não registrar esse app como client confidencial com secret embutido. Sua integração futura usa client público, browser de sistema, PKCE e armazenamento seguro nativo. Isso altera a suposição anterior de mobile apenas no roadmap; a integração real permanece uma tarefa própria, dependente do backend.

Também existem repositórios de site/landing page do agendaflow; isso não demonstra que sejam seu BFF. Não será criado um api-agendaflow fictício.

## Configuração e domínios

| Sistema        | Origem pública / configuração                                                                        | Firebase project                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Auth           | issuer proposto https://auth.presencia.com.br; local http://localhost:3340                           | Projetos upstream a confirmar por ambiente                                                    |
| web-presencia  | API_DOMAIN; NEXT_PUBLIC_ADMIN_DOMAIN; NEXT_PUBLIC_KONTAL_DOMAIN; origem do app por ambiente          | FIREBASE_PROJECT_ID, definido no deploy                                                       |
| admin-console  | WEB_PRESENCIA_URL; API_PRESENCIA_URL; forms público tem default forms.presencia.com.br               | .firebaserc aponta api-agendaflow para ferramentas locais; FIREBASE_PROJECT_ID define runtime |
| Ouvidoria      | API_PRESENCIA_URL; origem pública por ambiente                                                       | .firebaserc aponta api-agendaflow; runtime define FIREBASE_PROJECT_ID                         |
| Payments       | NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_PRESENCIA_URL, NEXT_PUBLIC_ACTIVATE_URL, NEXT_PUBLIC_AGENDAFLOW_URL | FIREBASE_PROJECT_ID com fallback NEXT_PUBLIC_FIREBASE_PROJECT_ID                              |
| App AgendaFlow | Redirect/app links e APIs ainda não configurados nas fontes consultadas                              | Não confirmado                                                                                |

Não copiar .env ou chaves de service account para completar esta tabela. Valores reais de staging/produção, ownership dos domínios e certificados precisam ser confirmados no provisionamento. Nenhuma URL ilustrativa será cadastrada em client de produção.

## Fluxos que precisam continuar funcionando

- Login e recuperação/troca de senha; primeiro login e ativação de contas/convites.
- Claim/redeem de ativação no web-presencia e api-presencia; provisionamento e claims no console.
- Seleção de tenant, suporte interno e papéis INTERNAL_ADMIN, INTERNAL_SUPPORT, INTERNAL_BILLING e COPYWRITE.
- Atendimento público/anônimo da ouvidoria; permissões locais de funcionários e isolamento entre municípios.
- Checkout, webhooks, ativação e chat do payments. Custom tokens e regras Firestore no client não podem ser retirados antes da substituição.
- SSE/dashboard-stream, WebSocket e chamadas server-to-server com bearer, inclusive da ouvidoria para WhatsApp na api-presencia. O WebSocket atual recebe o token no browser; precisa de tratamento explícito para atender ao BFF do fluxo final.
- OAuth Google Calendar e webhooks de provedores continuam com seus mecanismos próprios; não exigir login de usuário nessas rotas automaticamente.

## Lacunas que impedem encerrar a migração

1. Confirmar projetos Firebase e domínios reais por ambiente sem divulgar segredos.
2. Confirmar a API que servirá ao app-agendaflow; as fontes consultadas não demonstram um backend ativo.
3. Kontal incluído explicitamente pelo mantenedor: web-kontal (Next.js) e api-kontal (NestJS) confirmados. Importar kontalMemberships e preservar INTERNAL_ADMIN/INTERNAL_BILLING e memberships de empresa antes de trocar a autoridade. Repositório crm-presencia foi consultado e é outro monorepo; não é o web-kontal.
4. Funcionario não possui campo de estado ativo na interface/repositório consultados. O backfill não pode pressupor que esse campo já exista; definir regra de desativação antes de importar grants.
5. Confirmar disponibilidade de MFA no projeto/contrato Firebase e testar login real em staging.

O inventário descreve o estado das fontes, inclusive dependências ainda não demonstradas. Não representa uma auditoria do ambiente de produção. A confirmação da API AgendaFlow segue pendente; o PR da issue #2 permanece em rascunho até essa confirmação ou aceite explícito da lacuna. Cadastro de clients/redirects, backfill e piloto só podem usar valores de ambiente confirmados nas issues responsáveis.

## Kontal confirmado no escopo

[web-kontal](https://github.com/usepresencia/web-kontal) usa createSessionAction para validar o token no api-kontal e gravar cookie; logout atual limpa a sessão local e volta ao login Presencia. [api-kontal](https://github.com/usepresencia/api-kontal) usa FirebaseTokenVerifier, UserProvisioner, PlatformRoleResolver e MembershipReconciler antes de montar SessionUser. A política local admite INTERNAL_ADMIN/INTERNAL_BILLING para usuários de plataforma e memberships ativas para os demais.

Backlog específico: #33 (API e identidade), #34 (BFF/SSO) e #35 (isolamento e aceite financeiro). O rollout #30 e a retirada legada #31 incluem esses gates.

## Proveniência e limites da inspeção

| Repositório local   | Ref                                     | Commit   | Estado observado                |
| ------------------- | --------------------------------------- | -------- | ------------------------------- |
| api-presencia       | feat/platform-owner-transfer            | a54e537  | Sem alterações rastreadas       |
| web-presencia       | feat/kontal-botao-admin                 | 4cd6df2  | Há alterações locais do usuário |
| web-admin-console   | feat/clients-owner-transfer             | d2b58cd  | Sem alterações rastreadas       |
| ouvidoria-municipal | fix/audio-vision-cost-and-error-logging | ec25aed5 | Sem alterações rastreadas       |
| payments-agendaflow | feat/claim-code-single-use              | 9330384  | Há alterações locais do usuário |

As fontes desses projetos foram lidas sem checkout, stash, reset ou edição. Nos arquivos com alterações locais, o estado da árvore de trabalho pode diferir do commit indicado; esse conteúdo não deve ser tratado como código já publicado. Os repositórios app-agendaflow, web-kontal e api-kontal foram lidos pelo conector GitHub, respectivamente nas refs dev, main e main. Nenhuma branch alheia foi alterada.

## Matriz de clients e recursos a levar ao ADR

São identificadores lógicos para discussão na issue #4, não cadastros de produção. A issue #9 define clients por ambiente e aplica allowlists reais.

| Produto/consumidor  | Tipo de client esperado                                          | APIs observadas / audience lógica proposta            | Identificador a preservar                                                      |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| web-presencia       | Confidencial, BFF                                                | api-presencia                                         | User.id, User.firebaseUid e Membership.tenantId                                |
| web-admin-console   | Confidencial, BFF + MFA                                          | api-presencia; endpoints do próprio BFF               | SessionPayload.uid, registros administrativos, PlatformAccess                  |
| ouvidoria-municipal | Confidencial, BFF                                                | api-presencia para WhatsApp; operações do próprio BFF | Funcionario.id, firebaseUid e tenantId                                         |
| payments-agendaflow | Confidencial para sessões BFF; não confundir webhook com usuário | API de billing própria quando migrada                 | users/{uid}, workspaceId, ativação e direitos comerciais                       |
| app-agendaflow      | Público/nativo, PKCE, sem secret                                 | Backend ainda não confirmado nas fontes inspecionadas | A definir na integração #26; não inferir vínculo pelo nome do projeto Firebase |
| web-kontal          | Confidencial, BFF                                                | api-kontal                                            | User.id, firebaseUid, memberships.companyId e empresa selecionada              |

A sessão do auth terá sub próprio. O vínculo legado é projeto Firebase + UID, não e-mail e não o nome do produto. O admin-console e a ouvidoria chamam api-presencia com bearer; dar audience de outro produto a esses tokens impediria as chamadas atuais. Autorizar um resource também não substitui Membership/tenant/company e scopes locais.

## Contratos de ambiente conhecidos

Os nomes abaixo são contratos verificados em código; seus valores de staging/produção não foram consultados.

| Serviço             | Configuração de origem/destino                                                                       | Projeto de autenticação                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Auth futuro         | AUTH_ISSUER; proposta https://auth.presencia.com.br                                                  | Upstream a configurar na integração Firebase                     |
| web-presencia       | API_DOMAIN, NEXT_PUBLIC_API_DOMAIN, NEXT_PUBLIC_ADMIN_DOMAIN, NEXT_PUBLIC_KONTAL_DOMAIN              | FIREBASE_PROJECT_ID                                              |
| web-admin-console   | API_PRESENCIA_URL, WEB_PRESENCIA_URL, FORMS_PUBLIC_URL                                               | FIREBASE_PROJECT_ID; .firebaserc local api-agendaflow            |
| ouvidoria-municipal | API_PRESENCIA_URL                                                                                    | FIREBASE_PROJECT_ID; .firebaserc local api-agendaflow            |
| payments-agendaflow | NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_PRESENCIA_URL, NEXT_PUBLIC_ACTIVATE_URL, NEXT_PUBLIC_AGENDAFLOW_URL | FIREBASE_PROJECT_ID com fallback NEXT_PUBLIC_FIREBASE_PROJECT_ID |
| web-kontal          | KONTAL_API_URL, NEXT_PUBLIC_PRESENCIA_URL                                                            | Usa o token aceito pelo api-kontal                               |
| api-kontal          | Configuração própria de deploy da API                                                                | FIREBASE_PROJECT_ID                                              |
| app-agendaflow      | Não confirmado no código consultado                                                                  | Não confirmado                                                   |

O default forms.presencia.com.br é uma URL de formulários públicos referenciada pelo console, não evidência de um client OIDC separado. A referência api-agendaflow nos dois .firebaserc não prova que os runtimes compartilhem projeto nem que exista uma API com esse nome.

## Exceções ao modelo de tokens só no BFF

### WebSocket da Presencia

O web-presencia/src/actions/auth.ts exporta getWsTokenAction. O hook usePresenciaWebSocket chama essa ação, recebe o Firebase ID token no browser e abre o socket. O gateway da api-presencia em /ws/presencia lê token e tenantId da query e chama validateTokenAndTenantAccess.

Portanto, trocar os cookies por sessão OIDC no servidor não conclui a migração do canal em tempo real. As issues #18/#27 precisam prever um canal por BFF ou ticket opaco de uso único emitido no servidor e limitado ao WebSocket/tenant; a decisão cabe ao ADR. Não colocar access token geral da API em query/localStorage para preservar o fluxo antigo. O teste de aceite deve cobrir reconexão, tenant e expiração sem expor o bearer geral ao browser.

Evidências: web-presencia/src/actions/auth.ts, src/app/(protected)/presencia/_hooks/usePresenciaWebSocket.ts e api-presencia/src/presencia/presentation/websocket.gateway.ts.

### Firestore no payments

ActivationClient e checkout-form fazem signInWithCustomToken. use-activation-chat e use-require-platform-user consultam users/{uid} pelo Firebase SDK do browser. O segundo confere users.role igual a platform_user; isso não é a role global INTERNAL_ADMIN. O backend de billing possui ainda billing_admin_users com role billing_admin e isActive.

A issue #25 deve substituir essas leituras pelo BFF ou implementar a ponte Firebase decidida no ADR, com sessão/revogação próprias. Não retirar custom tokens nem assumir que logout OIDC desloga automaticamente o SDK Firebase. Não foi encontrado uso de Storage client nos diretórios src dos quatro produtos locais consultados; isso é um resultado dessa busca, não uma garantia sobre outros produtos ou versões.

A ouvidoria usa Admin SDK no servidor e sua firestore.rules inspecionada nega acesso direto a todos os documentos. Isso não é equivalente à dependência de request.auth no browser existente no payments.

### SSO por fragmento e claims do Kontal

Os fluxos legados de admin, ouvidoria e Kontal transferem Firebase ID token para o destino. Web-kontal valida esse token na api-kontal, grava cookies de token/empresa e usa duração de token de 55 minutos. Na API, MembershipReconciler declara kontalMemberships como fonte da verdade e reconcilia o banco a partir da claim.

Mudar o issuer sem migrar essa reconciliação poderia remover ou recriar direitos financeiros. As issues #33/#34 precisam substituir a autoridade da claim de forma explícita e preservar seleção de empresa e política INTERNAL_ADMIN/INTERNAL_BILLING.

## Recuperação, ativação e canais que não podem ser esquecidos

| Fluxo                                 | Implementação observada                                                                                                                                             | Responsável pela migração                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Senha / recuperação / códigos de ação | web-presencia/src/actions/auth.ts: changePasswordAction, verifyPasswordResetCodeAction, confirmPasswordResetAction, applyActionCodeAction e sendPasswordResetAction | #8 e #27                                                      |
| Ativação com token e com código       | activateWithTokenAction / activateWithCodeAction; claim e sessão na api-presencia; ativação/provisionamento do payments                                             | #24, #25, #27 e #28                                           |
| Refresh e seleção de tenant           | Cookies e proxy do web-presencia; Membership.isActive no backend                                                                                                    | #18, #27 e #28                                                |
| Console e privilégios globais         | AuthAdapter, writers de platformRole e PlatformAccess                                                                                                               | #20 e #21                                                     |
| Atendimento público                   | Rotas públicas da ouvidoria separadas do dashboard de funcionários                                                                                                  | #23                                                           |
| WhatsApp na ouvidoria                 | whatsappConnections.ts confere gestor e envia bearer + x-tenant-id                                                                                                  | #19 e #23                                                     |
| Dashboard e tempo real                | EventSource em /api/dashboard-stream; socket /ws/presencia                                                                                                          | #18, #27 e #29                                                |
| Empresas e financeiro                 | api-kontal SessionUser, KontalAccessPolicy e MembershipReconciler                                                                                                   | #33, #34 e #35                                                |
| Google OAuth / webhooks               | Callback Calendar e autenticação própria dos provedores                                                                                                             | #19/#28 preservam exceções; não converter em login de usuário |

## Pendências e responsáveis

| Pendência                                             | Evidência / ação necessária                                                                                | Gate de execução                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Valores de deploy, projetos upstream, redirects e TLS | Preencher a partir do ambiente autorizado antes de cadastrar clients; não copiar secrets para o inventário | #15 e #9                             |
| Backend AgendaFlow                                    | Pubspec e datasource consultados não demonstram API ativa; confirmação solicitada ao mantenedor            | #26; não registrar resource fictício |
| Desativação de Funcionario                            | Modelo consultado tem papel/setor/tenant, sem campo ativo; definir regra de elegibilidade                  | #16 e #23                            |
| MFA real do console                                   | AuthAdapter atual valida platformRole; suporte a fator e recuperação precisam ser confirmados/testados     | #13 e #20                            |
| Acesso WebSocket sem bearer geral no browser          | Escolher transporte/ticket e validar isolamento/reconexão                                                  | #4, #18, #27 e #29                   |
| Autoridade de privilégios e kontalMemberships         | Migrar todos os escritores e importar direitos antes de retirar claims                                     | #21 e #33                            |

Não executar cadastro de produção, concessão de grants, backfill ou corte de bearer com base apenas neste inventário. As lacunas ficam rastreadas nas entregas que dependem delas; o documento não afirma que o ambiente publicado foi verificado.
