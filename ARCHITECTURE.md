# Arquitetura

## Componentes

```mermaid
flowchart LR
  User[iPhone do usuario] --> Safari[Safari]
  Safari --> PWA[PWA instalado]
  PWA --> SW[Service Worker]
  PWA --> Edge[Supabase Edge Functions]
  Edge --> DB[(PostgreSQL Supabase)]
  Edge --> Push[Web Push Service/APNs]
  Push --> SW
  Cron[Supabase Cron pg_cron] --> Net[pg_net HTTP]
  Net --> Edge
```

## Stack escolhida

- Vite + React + TypeScript: simples para PWA estático e deploy gratuito.
- CSS próprio: evita dependência visual pesada.
- React Hook Form + Zod: validação clara no frontend.
- date-fns/date-fns-tz: conversão local/UTC explícita.
- Supabase Edge Functions + Deno: backend próximo ao Supabase e adequado a endpoints pequenos.
- PostgreSQL: fonte de verdade para dispositivos, inscrições, notificações, entregas, rate limit e auditoria.
- `web-push`: biblioteca madura para VAPID e criptografia de payload Web Push.
- Supabase Cron/pg_cron + pg_net: agenda server-side sem depender do navegador aberto.

## Decisão de agendamento

Escolha: Opção A, Supabase Cron/pg_cron chamando periodicamente uma Edge Function protegida.

Motivos:

- Não depende do PWA aberto.
- Usa recurso oficial do Supabase Cron.
- Permite frequência de 1 minuto.
- Mantém lógica de envio e segredos no backend.
- O claim transacional fica no banco.
- É simples de operar em um projeto pessoal.

Alternativas rejeitadas:

- Opção B: Cron chamando apenas função PostgreSQL. Rejeitada porque a lógica Web Push precisa de VAPID private key e biblioteca de envio; melhor manter em Edge Function.
- Opção C: Cron externo. Mantida como fallback seguro quando pg_cron/pg_net/Vault não estiverem disponíveis.
- Opção D: fila externa/background worker dedicado. Rejeitada por custo/complexidade para uso pessoal.

## Registro do dispositivo

```mermaid
sequenceDiagram
  participant PWA
  participant Edge
  participant DB
  PWA->>PWA: gera device_secret criptografico
  PWA->>Edge: POST register-device com segredo via HTTPS
  Edge->>Edge: SHA-256(device_secret)
  Edge->>DB: insert devices(public_id, secret_hash)
  DB-->>Edge: public_id
  Edge-->>PWA: public_id
  PWA->>PWA: salva public_id + device_secret localmente
```

## Registro da inscrição Web Push

```mermaid
sequenceDiagram
  participant PWA
  participant SW as Service Worker
  participant Edge
  participant DB
  PWA->>SW: registra /sw.js
  PWA->>PWA: Notification.requestPermission() por botao
  PWA->>SW: pushManager.subscribe(VAPID public key)
  SW-->>PWA: PushSubscription
  PWA->>Edge: register-push-subscription + device_secret
  Edge->>DB: valida device_secret
  Edge->>DB: upsert push_subscriptions
```

## Criação de notificação

```mermaid
sequenceDiagram
  participant PWA
  participant Edge
  participant DB
  PWA->>PWA: valida titulo, mensagem, URL, data e timezone
  PWA->>Edge: create-notification
  Edge->>DB: valida dispositivo e rate limit
  Edge->>DB: insert notifications(status scheduled)
  alt envio imediato
    Edge->>DB: claim por id
    Edge->>Edge: envia Web Push
    Edge->>DB: grava delivery e status
  end
  Edge-->>PWA: resultado padronizado
```

## Envio agendado

```mermaid
sequenceDiagram
  participant Cron
  participant Edge
  participant DB
  participant Push
  Cron->>Edge: POST process-scheduled-notifications
  Edge->>Edge: valida INTERNAL_CRON_SECRET
  Edge->>DB: push_lab_claim_due_notifications()
  DB->>DB: SELECT FOR UPDATE SKIP LOCKED
  DB-->>Edge: lote claimed
  Edge->>Push: webpush.sendNotification()
  Edge->>DB: notification_deliveries + status final
```

## Retry

```mermaid
flowchart TD
  Attempt[Tentativa] --> Response{Resposta}
  Response -->|201/2xx| Sent[status sent]
  Response -->|404/410| Expire[expira inscricao]
  Response -->|429/5xx/408| Retry[retry_scheduled com backoff]
  Response -->|timeout/desconhecido| Unknown[unknown sem retry automatico]
  Retry --> Claim[claim futuro pelo cron]
```

Política:

- 404/410: permanente, inscrição expirada/revogada.
- 429/408/5xx: transitório, retry com backoff limitado.
- Timeout/estado desconhecido: não há retry automático para reduzir risco de duplicidade, porque Web Push não oferece idempotência fim a fim por provedor.
- Máximo padrão: 3 tentativas.

## Idempotência e concorrência

```mermaid
flowchart LR
  CronA[Cron A] --> Claim[push_lab_claim_due_notifications]
  CronB[Cron B] --> Claim
  Claim --> Lock[FOR UPDATE SKIP LOCKED]
  Lock --> Processing[status processing + attempt_count]
  Processing --> Send[envio]
  Send --> Final[status sent/failed/partially_failed]
```

Garantias:

- Execuções simultâneas não reivindicam a mesma notificação graças a `FOR UPDATE SKIP LOCKED`.
- `processing_started_at` permite recuperar tarefas presas.
- `attempt_count` e constraint única em `notification_deliveries` reduzem duplicação por retry.
- Exatamente uma entrega final não pode ser garantida pelo padrão Web Push em caso de timeout após envio parcial; por isso timeouts ficam como `unknown` sem retry automático.

## Revogação

```mermaid
sequenceDiagram
  participant PWA
  participant Edge
  participant DB
  PWA->>Edge: revoke-device + device_secret
  Edge->>DB: valida dispositivo
  alt revogar
    Edge->>DB: devices.status=revoked
    Edge->>DB: subscriptions.status=revoked
    Edge->>DB: cancela pendentes
  else apagar remoto
    Edge->>DB: delete devices cascade
  end
  PWA->>PWA: apaga dados locais
```

## Modelo de dados

```mermaid
erDiagram
  devices ||--o{ push_subscriptions : owns
  devices ||--o{ notifications : creates
  devices ||--o{ device_events : emits
  notifications ||--o{ notification_deliveries : attempts
  push_subscriptions ||--o{ notification_deliveries : target

  devices {
    uuid id PK
    text public_id
    text secret_hash
    text name
    text timezone
    text locale
    text app_version
    device_status status
  }

  push_subscriptions {
    uuid id PK
    uuid device_id FK
    text endpoint
    text endpoint_hash
    text p256dh
    text auth
    push_subscription_status status
  }

  notifications {
    uuid id PK
    uuid device_id FK
    text title
    text body
    delivery_type delivery_type
    timestamptz scheduled_at
    notification_status status
  }

  notification_deliveries {
    uuid id PK
    uuid notification_id FK
    uuid push_subscription_id FK
    int attempt_number
    delivery_status status
  }
```

## Timezone

- Frontend converte data/hora local para UTC antes de enviar.
- Banco usa `timestamptz`.
- Interface exibe no timezone do dispositivo.
- Testes cobrem conversão São Paulo e cenário com DST em New York.
- Não há dupla conversão: `scheduled_at` trafega em ISO UTC.

## Riscos

| Risco | Impacto | Probabilidade | Mitigação |
|---|---:|---:|---|
| pg_cron/pg_net indisponível no plano | Alto | Médio | Cron externo protegido |
| iOS ignora imagem/ações | Médio | Alto | Documentar limitação e prévia como simulação |
| Timeout de Web Push com estado desconhecido | Médio | Baixo | Não retry automático para evitar duplicidade |
| Perda de device_secret local | Médio | Médio | Registrar novo dispositivo; revogar antigo se possível |
| Má configuração de CORS/secrets | Alto | Médio | Checklist de deploy e `audit:secrets` |

