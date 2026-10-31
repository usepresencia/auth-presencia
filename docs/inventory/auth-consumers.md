# Inventário de autenticação e consumidores

Data: 31/10/2026. Relacionado a #2, #4 e #26. Evidências: fontes locais e repositórios conectados, sem consultar credenciais ou bases de produção.

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
- SSE/dashboard-stream e chamadas server-to-server com bearer, inclusive da ouvidoria para WhatsApp na api-presencia.
- OAuth Google Calendar e webhooks de provedores continuam com seus mecanismos próprios; não exigir login de usuário nessas rotas automaticamente.

## Lacunas que impedem encerrar a migração

1. Confirmar projetos Firebase e domínios reais por ambiente sem divulgar segredos.
2. Confirmar a API que servirá ao app-agendaflow; as fontes consultadas não demonstram um backend ativo.
3. Kontal incluído explicitamente pelo mantenedor: web-kontal (Next.js) e api-kontal (NestJS) confirmados. Importar kontalMemberships e preservar INTERNAL_ADMIN/INTERNAL_BILLING e memberships de empresa antes de trocar a autoridade. Repositório crm-presencia foi consultado e é outro monorepo; não é o web-kontal.
4. Funcionario não possui campo de estado ativo na interface/repositório consultados. O backfill não pode pressupor que esse campo já exista; definir regra de desativação antes de importar grants.
5. Confirmar disponibilidade de MFA no projeto/contrato Firebase e testar login real em staging.

O inventário de código está produzido; confirmação operacional e consumidores adicionais permanecem explícitos. A issue #2 só poderá ser considerada integralmente aceita após tratar essas lacunas.

## Kontal confirmado no escopo

[web-kontal](https://github.com/usepresencia/web-kontal) usa createSessionAction para validar o token no api-kontal e gravar cookie; logout atual limpa a sessão local e volta ao login Presencia. [api-kontal](https://github.com/usepresencia/api-kontal) usa FirebaseTokenVerifier, UserProvisioner, PlatformRoleResolver e MembershipReconciler antes de montar SessionUser. A política local admite INTERNAL_ADMIN/INTERNAL_BILLING para usuários de plataforma e memberships ativas para os demais.

Backlog específico: #33 (API e identidade), #34 (BFF/SSO) e #35 (isolamento e aceite financeiro). O rollout #30 e a retirada legada #31 incluem esses gates.
