# API

Base:

```text
https://<project-ref>.supabase.co/functions/v1/<function-name>
```

Headers comuns:

```http
Content-Type: application/json
apikey: <SUPABASE_ANON_KEY>
x-app-version: 0.1.0
x-correlation-id: opcional
```

Headers para operações do dispositivo:

```http
x-device-public-id: dev_...
x-device-secret: segredo_local_opaco
```

Resposta de sucesso:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

Erro:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "DEVICE_SECRET_INVALID",
    "message": "Credencial do dispositivo invalida.",
    "correlation_id": "corr_..."
  }
}
```

## Endpoints

| Função | Método | Autenticação | Finalidade |
|---|---|---|---|
| `health-check` | GET/POST | nenhuma | Verificar disponibilidade |
| `register-device` | POST | origem permitida | Criar instalação anônima |
| `update-device` | POST | device | Editar nome amigável |
| `register-push-subscription` | POST | device | Salvar assinatura Web Push |
| `refresh-push-subscription` | POST | device | Renovar assinatura |
| `create-notification` | POST | device | Criar envio imediato/agendado |
| `update-notification` | POST | device | Editar pendente/falha |
| `cancel-notification` | POST | device | Cancelar pendente/falha |
| `list-notifications` | POST | device | Listar notificações |
| `get-notification` | POST | device | Detalhes + entregas |
| `send-test-notification` | POST | device | Criar e enviar teste |
| `revoke-device` | POST | device | Revogar/apagar dispositivo |
| `process-scheduled-notifications` | POST | cron secret | Processar fila |
| `retry-failed-notifications` | POST | cron secret | Mesmo processador para retries |

## register-device

Body:

```json
{
  "device_secret": "segredo_gerado_no_cliente",
  "name": "Meu iPhone",
  "timezone": "America/Sao_Paulo",
  "locale": "pt-BR",
  "app_version": "0.1.0",
  "notifications_permission": "default",
  "user_agent": "opcional"
}
```

Resposta:

```json
{
  "success": true,
  "data": {
    "public_id": "dev_...",
    "name": "Meu iPhone"
  },
  "error": null
}
```

Limite: 12/minuto por IP.

## update-device

Body:

```json
{ "name": "Meu iPhone 15" }
```

Resposta:

```json
{ "success": true, "data": { "name": "Meu iPhone 15" }, "error": null }
```

## register-push-subscription / refresh-push-subscription

Body:

```json
{
  "notifications_permission": "granted",
  "subscription": {
    "endpoint": "https://...",
    "expirationTime": null,
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}
```

Resposta:

```json
{ "success": true, "data": { "status": "active" }, "error": null }
```

## create-notification

Body:

```json
{
  "title": "Titulo",
  "body": "Mensagem",
  "image_url": null,
  "icon_url": null,
  "badge_url": null,
  "target_url": "/",
  "tag": "teste",
  "custom_data": { "origem": "manual" },
  "delivery_type": "scheduled",
  "scheduled_at": "2026-07-24T18:00:00.000Z",
  "timezone": "America/Sao_Paulo"
}
```

Resposta:

```json
{
  "success": true,
  "data": {
    "notification": {
      "id": "uuid",
      "status": "scheduled"
    },
    "processing": null
  },
  "error": null
}
```

Validações:

- `title`: 1-120 caracteres.
- `body`: 1-600 caracteres.
- imagens/ícones/badge: HTTPS.
- `target_url`: relativo seguro, HTTP ou HTTPS.
- agendamento: futuro.
- `custom_data`: objeto JSON até 4 KB.

## update-notification

Mesmo body de criação, mais:

```json
{ "id": "uuid" }
```

Só permite editar `draft`, `scheduled`, `failed` e `partially_failed`.

## cancel-notification

Body:

```json
{ "id": "uuid" }
```

Resposta:

```json
{ "success": true, "data": { "id": "uuid", "status": "cancelled" }, "error": null }
```

## list-notifications

Body:

```json
{
  "status": "scheduled",
  "limit": 50
}
```

`status` é opcional.

## get-notification

Body:

```json
{ "id": "uuid" }
```

Resposta contém:

- `notification`
- `deliveries`

## send-test-notification

Body opcional:

```json
{
  "title": "Teste do Push Lab Pessoal",
  "body": "Se voce recebeu esta mensagem, o Web Push esta funcionando.",
  "target_url": "/"
}
```

Cria uma notificação imediata no histórico.

## revoke-device

Body:

```json
{ "delete_remote_data": false }
```

Se `false`, revoga dispositivo e inscrições, cancela pendentes e mantém histórico.

Se `true`, apaga o dispositivo e dados relacionados via cascade.

## process-scheduled-notifications / retry-failed-notifications

Headers:

```http
Authorization: Bearer <INTERNAL_CRON_SECRET>
apikey: <SUPABASE_ANON_KEY>
```

Body:

```json
{ "source": "pg_cron" }
```

Resposta:

```json
{
  "success": true,
  "data": {
    "claimed": 1,
    "sent": 1,
    "failed": 0,
    "invalidSubscriptions": 0,
    "unknown": 0
  },
  "error": null
}
```

