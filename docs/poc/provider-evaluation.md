# Avaliação do provedor OIDC

Relacionado a #3 e ADR 0001. Avaliação local de 31/10/2026.

| Critério             | oidc-provider 9.13.3                                                        | Ory Hydra                                                                            |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Integração no stack  | Biblioteca Node ESM; prova HTTP executada em processo separado de Nest      | Servidor independente e API administrativa; aplicação própria de login/consentimento |
| Firebase upstream    | Interação customizada deve verificar Firebase antes de resolver accountId   | Aplicação login/consentimento verifica Firebase e aceita o challenge no Hydra        |
| Persistência         | Adapter deve ser implementado/operado; memória default é apenas quick start | Persistência e migrations operadas pelo servidor; exige configuração/infra próprias  |
| Resource/audience    | Provado localmente com audience da API diferente do client                  | Avaliar a configuração equivalente numa PoC executável antes de alegar paridade      |
| PKCE, code e refresh | Testes reproduzíveis descritos abaixo                                       | Não executado nesta entrega                                                          |
| Custo operacional    | Pode compartilhar operação Node e PostgreSQL já usados pelo time            | Acrescenta serviço e contratos login/consent/admin à operação                        |

A direção inicial é oidc-provider por alinhamento de stack e prova local bem-sucedida. Esta é uma recomendação técnica para revisão no PR: a comparação com Hydra é documental, não uma execução equivalente. A decisão final exige validar o adapter persistente, Firebase real, MFA, logout e múltiplas réplicas em staging. A issue #3 permanece aberta.

## Reprodução

Com Node 24 LTS e npm ci:

```sh
npm run test:poc
```

O comando inicia servidor de loopback com porta efêmera e encerra ao finalizar os testes. Usa chaves aleatórias, client secret aleatório, identidade fictícia e memória só dentro da suíte. Nada é conectado à aplicação Nest ou publicado em produção. O alerta do provedor sobre adapter em memória é esperado nesta PoC.

Verificações: code + PKCE, nonce, state, audiência separada de ID/access token, access token de até 10min, rejeição de code repetido, verifier errado, redirect não cadastrado, resource desconhecido e refresh rotativo com revogação de família após replay.

## O que ainda não foi comprovado

- Autenticação Firebase real e recuperação de conta no domínio de staging.
- Persistência dos artefatos OIDC entre réplicas e após reinício.
- Product grants na autorização/refresh, MFA e logout global.
- Operação equivalente no Hydra.
- Conformidade/certificação da configuração final da Presencia.

Referências primárias: https://github.com/panva/node-oidc-provider e https://www.ory.com/docs/oauth2-oidc/custom-login-consent/flow .
