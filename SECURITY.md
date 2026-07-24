# Segurança

## Modelo de confiança

O frontend não é confiável para operações sensíveis. Ele apenas:

- coleta entrada;
- solicita permissão;
- cria a assinatura Web Push;
- armazena o segredo local;
- chama Edge Functions.

O backend valida dispositivo, origem, payload, rate limit e autorização antes de tocar no banco ou enviar Web Push.

## Identificação sem login

Cada instalação possui:

- `public_id`: identificador técnico público.
- `device_secret`: segredo opaco local, gerado com `crypto.getRandomValues`.
- `secret_hash`: SHA-256 do segredo, armazenado no banco.

O segredo:

- não é logado;
- não entra em cache;
- não fica no banco em texto puro;
- é enviado apenas via HTTPS;
- autoriza operações daquele dispositivo;
- é invalidado por revogação/apagamento.

Estratégia escolhida: token opaco + hash no banco.

Motivo: simples, compatível com ausência de login, não exige Supabase Auth anônimo e evita expor tabelas. Supabase Auth anônimo não foi usado porque adicionaria sessão/JWT sem resolver o requisito principal de credencial por instalação.

## RLS e acesso ao banco

- RLS habilitado em todas as tabelas.
- `anon` e `authenticated` têm grants revogados.
- Políticas explícitas de negação usam `USING (false)`/`WITH CHECK (false)`.
- Não há acesso direto do frontend às tabelas.
- Edge Functions usam service role apenas no backend.

Não há políticas permissivas `USING (true)` para `anon` ou `authenticated`.

## Secrets

Nunca versionar:

- `SUPABASE_SERVICE_ROLE_KEY`
- `VAPID_PRIVATE_KEY`
- `INTERNAL_CRON_SECRET`
- `device_secret`
- `.env` real

O script `npm.cmd run audit:secrets` procura padrões realistas de vazamento.

## CORS e origem

Edge Functions validam `Origin` contra `ALLOWED_ORIGIN` para chamadas browser. Chamadas internas do cron não dependem de `Origin`; dependem de `Authorization: Bearer INTERNAL_CRON_SECRET`.

## Rate limiting

Tabela `rate_limits` por hash de chave e ação:

- `register-device`: 12/minuto por IP.
- `create-notification`: 30/minuto por dispositivo.
- demais operações: 60/minuto por dispositivo.

Os limites são conservadores para uso pessoal.

## Validação e sanitização

- Zod no frontend e backend.
- Payload máximo de 16 KB por função.
- Título: 120 caracteres.
- Mensagem: 600 caracteres.
- `custom_data`: objeto JSON.
- Imagens/ícone/badge: HTTPS.
- URL de clique: relativa segura, HTTP ou HTTPS.
- Erros enviados ao cliente não incluem stack trace.
- Erros de provider são sanitizados antes de persistir.

## Web Push

- Cliente só envia assinatura Web Push ao backend.
- Cliente não envia payload arbitrário direto para endpoint Web Push.
- VAPID private key fica nas Edge Functions.
- Endpoint, `p256dh` e `auth` são tratados como sensíveis.
- 404/410 revogam inscrição.
- Timeouts ficam como `unknown` sem retry automático para reduzir duplicidade.

## Ameaças e mitigação

| Ameaça | Mitigação |
|---|---|
| Enumeração de `public_id` | `public_id` aleatório + segredo obrigatório |
| Roubo de device_secret local | Revogar dispositivo; HTTPS; não logar segredo |
| CSRF/CORS indevido | Origin allowlist + device secret |
| Envio abusivo | Rate limit e tamanho de payload |
| Edição de outro dispositivo | Query sempre filtra `device_id` autenticado |
| Vazamento de service role | `.env` ignorado + audit script + docs |
| Inscrição expirada | 404/410 marcam `expired`/`revoked` |
| Duplicidade por concorrência | `FOR UPDATE SKIP LOCKED`, `processing`, constraints |
| Duplicidade por timeout incerto | sem retry automático para `unknown` |

## Incidentes

Se houver suspeita de vazamento:

1. Rotacione `INTERNAL_CRON_SECRET`.
2. Rotacione VAPID keys e reinscreva dispositivos.
3. Rotacione Supabase service role.
4. Execute `revoke-device` nos dispositivos afetados.
5. Revise `notification_deliveries` e logs das Edge Functions.
6. Rode `npm.cmd run audit:secrets`.

