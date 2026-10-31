# Padrões do repositório

Referência: usepresencia/api-presencia, templates e convenções existentes em 31/10/2026.

## Contribuição

- Branches de integração: main e develop; branches de trabalho feat/, fix/, chore/ conforme a tarefa.
- Implementação OIDC segue em PR de trabalho para develop; somente o mantenedor faz merge. Não fazer push direto em main/develop, habilitar auto-merge ou fechar issues ainda não aceitas.
- Commits convencionais: feat, fix, chore, refactor, docs, test, ci, perf, build, style e revert.
- npm run commit oferece Commitizen; commitlint valida mensagens no hook commit-msg e nos PRs.
- Husky executa lint-staged no pre-commit. A validação de formatação completa fica na CI.
- PRs usam o template padrão e exigem responsável, milestone e labels. O workflow adiciona label pelo tipo do título.
- Issues seguem os templates oficiais de Task, Feature ou Bug copiados do api-presencia.
- O backlog OIDC fica centralizado neste repositório, com labels repo: <nome>, repositórios afetados no título/corpo, dependências e milestones por fase. Itens bloqueados não recebem status: ready.

## Ferramentas

Mantemos NestJS, TypeScript estrito, ESLint, Prettier com quatro espaços, Vitest, TypeDoc, Conventional Commits, Commitizen, Husky, lint-staged e standard-version. Node 24 LTS e as versões corrigidas de Nest/ESLint desta base são preservados. Ferramentas existentes não utilizadas pelo auth, como Prisma antes da decisão de persistência, não são instaladas apenas para copiar dependências.

O código continua organizado em módulos, com camadas domain/application/infrastructure/presentation introduzidas conforme casos reais, seguindo a separação do api-presencia. Documentação manual permanece em docs/; TypeDoc gera docs/api/, ignorado no Git.

## Automação

- CI valida commits de PR, formatação, lint, tipos, cobertura, build e documentação em main/develop.
- Release manual na main usa standard-version e gera changelog/tag; o commit de release inclui [skip ci].
- CD manual constrói/publica imagem no GHCR com tag SHA. Ainda não faz deploy: infraestrutura, readiness e configuração do auth fazem parte do backlog.
- Project Automation integra issues/PRs ao projeto 4 da organização quando PROJECT_TOKEN está configurado. IDs de campos/opções são descobertos, não copiados de outro projeto.
- Nenhum workflow de release/publicação/deploy é executado como parte desta padronização.

O GitHub Actions estava impedido de iniciar jobs por cobrança/limite de gastos na validação inicial. Resolver isso na organização e configurar PROJECT_TOKEN são pré-requisitos operacionais; segredos não são copiados de outro repositório.
