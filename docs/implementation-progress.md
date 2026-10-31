# Progresso da implementação OIDC

Branch de trabalho: feat/oidc-implementation. Destino do PR: develop. O merge é exclusivo do mantenedor; não habilitar auto-merge nem fazer push direto nas branches de integração.

## Primeira entrega no PR

| Item                   | Implementado localmente                                                                               | Ainda necessário para aceite completo                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| #2 — inventário        | Consumidores, fontes de identidade, roles e fluxos mapeados; app Flutter e Kontal confirmados         | Domínios/projetos reais por ambiente, API AgendaFlow e política de desativação de Funcionario                |
| #3 — prova do provedor | Oito testes locais oidc-provider com PKCE, code, audiences e refresh; reprodução no Node 24           | Adapter persistente, Firebase real, staging e avaliação executável equivalente do Hydra                      |
| #4 — decisões          | ADR inicial com clients/resources, sessões, native PKCE e escopo Kontal                               | Validar MFA, autoridade de roles e políticas operacionais antes do piloto                                    |
| #6 — identidade        | Migration PostgreSQL, sub UUID, vínculo projeto+UID, concorrência, rollback e bloqueio de desativados | Integração com o verificador Firebase confiável e backfill controlado; nenhum endpoint de login foi liberado |

As quatro issues permanecem abertas. A prova de protocolo utiliza fixture e memória restritas ao teste; a identidade PostgreSQL é código real separado, mas os artefatos do provedor ainda não usam esse banco. Não classificar a integração completa OIDC como pronta.

## Verificações

- 25 testes unitários/HTTP via Vitest.
- Oito testes de protocolo via Node Test Runner; execução também com Node 24 LTS.
- Sete testes de integração em PostgreSQL 17 descartável, com schema exclusivo.
- Formatação, lint, tipos, build e TypeDoc; build Docker com migrations e dependências de produção.
- CI atualizada para as três suítes, com serviço PostgreSQL próprio e credenciais sintéticas.

A cobertura Vitest não agrega as suítes Node/SQL. Não usar seu percentual para alegar cobertura dos testes de integração.

## Escopo acrescentado após inventário

- app-agendaflow é Flutter, com branch dev; integração por client público e API ainda não confirmada (#26).
- Kontal incluído por confirmação do mantenedor: api-kontal (#33), web-kontal/SSO (#34), aceite financeiro (#35).
- Backfill, biblioteca, BFF, logout, E2E, rollout e retirada do legado incluem os consumidores novos quando aplicável.

## Próximas entregas

Adapter persistente de artefatos do provedor (#7), verificação Firebase e interação vinculada (#8), configuração de clients/resources e grants (#9/#10). O piloto exige MFA real, operação de staging e gates de aceite do plano.

Cobrança/limites de GitHub Actions e PROJECT_TOKEN são pendências operacionais registradas em #5. Nenhum deploy, migration de produção ou alteração de login dos produtos foi executado nesta entrega.
