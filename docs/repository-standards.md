# Padrões do repositório

Referência: usepresencia/api-presencia, templates e convenções existentes em 31/10/2026.

## Contribuição

- Branches de integração: main e develop; branches de trabalho feat/, fix/, chore/ conforme a tarefa.
- Cada issue finalizada gera um PR próprio para develop com uma linha Closes #N na descrição. Trabalhos parciais ficam em branches separadas até cumprirem seus critérios; não agrupar encerramento de várias issues em um PR.
- Apenas o mantenedor faz merge. Não fazer push direto em main/develop nem habilitar auto-merge. Issues permanecem abertas até o merge.
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

## Fechamento de issues

Como main é a branch padrão, o GitHub não interpreta nativamente Closes em PRs para develop. O workflow close-linked-issue.yml trata PR fechado com merged=true em develop, lê uma única referência Closes e fecha somente a issue existente no próprio repositório. Não executa código da branch antes do merge: usa o commit já integrado pelo mantenedor.

PR fechado sem merge, referência a PR, múltiplas referências ou repositório diferente não fecham a issue. Os testes do parser e do fluxo são executados com node --test test/workflows/*.spec.cjs. Para issues centrais referidas em PRs de outros repositórios, a integração autorizada entre repositórios precisa estar configurada antes do fechamento automático; não copiar tokens pessoais.

A automação depende de GitHub Actions operacional (#5). Seu PR de instalação deve ser integrado antes dos PRs que precisam dela; somente o mantenedor faz os merges. Referência: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue .
