# Netlify rapido

Esta versao simplificada usa:

- Netlify para frontend e backend.
- Supabase apenas como banco.
- Nenhum deploy manual de Supabase Edge Functions.

## Configuracao da Netlify

Deixe a Netlify usar o arquivo `netlify.toml` da raiz.

Nas configurações do site:

```text
Base directory: vazio
Package directory: vazio
Build command: vazio ou npm --workspace @push-lab/web run build
Publish directory: vazio ou apps/web/dist
```

Se a Netlify preencher algo errado, use:

```text
Build command: npm --workspace @push-lab/web run build
Publish directory: apps/web/dist
```

## Variaveis de ambiente na Netlify

Cole estas variaveis em Site configuration > Environment variables:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY

VAPID_PUBLIC_KEY=BCXbYnOKC7kDNZUANDpVYaxP2rNjUYUGyw56zAjGxCEubbyLa_Y3EcmuohhUAVLY9eXRnsqQbCkHFMIXHtRuTo4
VAPID_PRIVATE_KEY=COPIE_DO_ARQUIVO_.env_LOCAL
VAPID_SUBJECT=mailto:push-lab-pessoal@example.com

VITE_API_BASE_URL=/api
VITE_VAPID_PUBLIC_KEY=BCXbYnOKC7kDNZUANDpVYaxP2rNjUYUGyw56zAjGxCEubbyLa_Y3EcmuohhUAVLY9eXRnsqQbCkHFMIXHtRuTo4
VITE_APP_URL=https://SEU-SITE.netlify.app
VITE_APP_VERSION=0.1.0

ALLOWED_ORIGIN=https://SEU-SITE.netlify.app
INTERNAL_CRON_SECRET=COPIE_DO_ARQUIVO_.env_LOCAL
APP_URL=https://SEU-SITE.netlify.app
APP_VERSION=0.1.0
```

Troque apenas:

- `https://SEU-PROJETO.supabase.co`
- `SUA_SERVICE_ROLE_KEY`
- `https://SEU-SITE.netlify.app`

Para `VAPID_PRIVATE_KEY` e `INTERNAL_CRON_SECRET`, abra o arquivo local `.env` e copie os valores ja gerados. Nao coloque esses valores em arquivos versionados.

## Supabase

No Supabase, você só precisa executar o SQL:

1. Abra SQL Editor.
2. Copie todo `supabase_schema.sql`.
3. Cole e execute.

Não precisa publicar Supabase Edge Functions.

## Como testar se a API subiu

Depois do deploy, abra:

```text
https://SEU-SITE.netlify.app/api/health-check
```

Tem que retornar JSON com:

```json
{
  "success": true
}
```

Se isso funcionar, o frontend está chamando backend no mesmo domínio e o erro `Load failed` por Supabase Edge Function desaparece.
