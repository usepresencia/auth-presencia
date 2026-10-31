# Limites iniciais

- Identity: sub estável, status da conta e vínculos por projeto Firebase + UID.
- Access: catálogo de produtos e grants; não resolve permissões por tenant.
- OIDC: integração do protocolo com biblioteca/servidor especializado, emissão por resource e sessões persistidas.
- Management: API autenticada para conceder/revogar acesso com autorização por caller e produto.
- Audit: eventos de login, concessão, revogação e logout sem dados secretos.
- Health: diferencia disponibilidade do processo e capacidade de autenticar.

Nesta fundação os módulos não têm controllers nem storage; somente Health publica rotas. Persistência de produção, bibliotecas de protocolo e integrações Firebase serão adicionadas na próxima etapa após a prova de conceito. Não emitir JWTs ou publicar discovery fictício para simular um provedor pronto.

Usar NestJS como base acompanha a api-presencia. A integração do provedor precisa confirmar compatibilidade de módulos ESM, runtime e adapters antes de fixar dependências.

Referências: https://docs.nestjs.com/first-steps e https://github.com/panva/node-oidc-provider .
