# Identidade estável no PostgreSQL

Primeira parte da issue #6. O serviço recebe apenas um principal externo já verificado por um adaptador Firebase confiável. Não autentica ID tokens, não concede product grants e não expõe HTTP público nesta entrega.

## Modelo e garantias

- auth_identities mantém sub UUID independente do Firebase, status, e-mail informativo e verificação de e-mail.
- auth_firebase_identities possui chave composta (firebase_project_id, firebase_uid). Identidades de projetos distintos ou UIDs distintos nunca são unidas por e-mail.
- Criação usa transação e advisory lock por chave externa. Primeiro login simultâneo não gera identidades órfãs.
- Conta disabled é negada pelo serviço. Banco não configurado gera erro explícito; não existe fallback em memória.
- E-mail é a informação recebida na criação, sem unicidade nem autorização baseada nela. Sincronização de perfil e vinculação administrativa de contas são etapas posteriores.
- Toda entrada externa passa por validação e parâmetros SQL. Controles de produto/tenant ficam nas próximas camadas.

## Migrations explícitas

Configure DATABASE_URL em .env apontando para o banco dedicado ao auth. Nenhuma migration é executada no boot da aplicação.

```sh
npm run build
npm run db:migrate
```

As migrations em migrations/ são transacionais, serializadas por advisory lock e têm checksum. Reexecução não reaplica arquivos; edição de arquivo já aplicado falha. Evoluções futuras devem acrescentar nova migration. O runtime Docker inclui o comando e os arquivos SQL.

## Integração

INTEGRATION_DATABASE_URL deve apontar explicitamente para banco dedicado cujo nome termina em _test. Os testes criam schema aleatório e removem só esse schema ao terminar; não truncam tabelas de schemas de outros ambientes.

```sh
npm run build
INTEGRATION_DATABASE_URL=postgresql://usuario:senha@127.0.0.1:5432/presencia_auth_test npm run test:integration
```

Usar credenciais e dados sintéticos. A CI provisiona PostgreSQL 17 para essa suíte. Casos: concorrência, separação de projetos/UIDs, identidade desativada, parâmetros semelhantes a SQL, validação de entrada, rollback e integridade/idempotência das migrations.

A cobertura Vitest mede a suíte unitária/HTTP; os testes PostgreSQL e de protocolo executam separadamente via Node Test Runner e não são agregados a esse percentual.

Referências: https://node-postgres.com/features/transactions e https://www.postgresql.org/docs/17/explicit-locking.html .
