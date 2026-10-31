# ADR 0001 — Fundação do auth central

Status: proposta implementável localmente; validação real de staging pendente. Relacionado a #3, #4 e #6. Data: 31/10/2026.

## Direção de implementação

Usar PostgreSQL para identidade e vínculos externos, acompanhando o stack existente de api-presencia. sub é um identificador gerado pelo auth; projeto Firebase + UID é chave externa única. E-mail é atributo, nunca chave para unir identidades de origens diferentes.

Avaliar oidc-provider como primeira opção do protocolo. É integrável ao processo Node e permite customizar as interações e adapters. Ory Hydra continua alternativa: delega login/consentimento por redirects e requer operação de outro servidor e sua API administrativa. A comparação e a prova local ficam em [provider-evaluation.md](../poc/provider-evaluation.md). Não declarar a issue #3 concluída sem validar persistência distribuída, Firebase real e staging.

## Clients e resources

- Aplicações Next.js usam clients confidenciais com BFF e sessões opacas no cookie.
- app-agendaflow é Flutter: planejar client público com PKCE, sem secret, com browser de sistema e redirects nativos exatos. A integração ainda depende de identificar seu backend.
- Clientes são separados por aplicação e ambiente; redirects de dev/staging nunca entram no client de produção.
- api-presencia é um resource próprio. Tokens do console, web-presencia e ouvidoria destinados à API carregam sua audience, com scopes permitidos por client; a API continua resolvendo permissões por tenant.
- Não criar resource para uma API AgendaFlow ainda não confirmada. Payments é um recurso separado quando sua API receber bearer OIDC.
- Kontal usa client confidencial próprio no web-kontal e resource api-kontal. Seus direitos financeiros por empresa permanecem locais; a reconciliação atual de kontalMemberships precisa de migração explícita. Inclusão confirmada pelo mantenedor.
- ID token destina-se ao client; access token destina-se à API. Não aceitar ID token no bearer das APIs.

## Acesso e sessões

Product grants pertencem ao auth. Membership e Funcionario continuam locais. A migração da autoridade de platform_role precisa importar PlatformAccess e atualizar todos os escritores antes de abandonar claims Firebase. Até então, nenhuma permissão existente será duplicada como nova fonte de verdade em produção.

Proposta de tempos do artefato mantida para os testes: access 10min; SSO absoluto 14d/ocioso 7d; refresh 30d como teto, sujeito ao estado da sessão/grant. O BFF não recebe uma sessão válida por 30d se a política exige SSO ainda ativo e este expirou. Definir detalhes finais antes do piloto.

MFA no console exige step-up e prova verificável de fator/recência. Um booleano enviado pelo browser não satisfaz esse requisito. A disponibilidade e recuperação do fator precisam de validação real antes de habilitar console OIDC.

## Limites desta entrega

O código de identidade não abre endpoint público nem aceita Firebase tokens sem verificação. O adaptador de banco é opt-in por configuração e só recebe identidades externas já verificadas. Migrations são explícitas; o serviço não altera automaticamente bancos existentes ao iniciar.

A PoC usa conta e chaves efêmeras de fixture num servidor de loopback, exclusivamente em desenvolvimento/teste. Isso demonstra protocolo, não autenticação Firebase nem SSO de produção. O serviço principal continua sem endpoints OIDC até as políticas, persistência e interações serem integradas.

## Referências

- https://github.com/panva/node-oidc-provider
- https://www.ory.com/docs/oauth2-oidc/custom-login-consent/flow
- [Inventário de consumidores](../inventory/auth-consumers.md)
