# Netlify rapido

Esta versao simplificada usa:

- Netlify para frontend e backend.
- Supabase apenas como banco.
- Nenhum deploy manual de Supabase Edge Functions.

## Configuracao da Netlify

Deixe a Netlify usar o arquivo `netlify.toml` da raiz.

Se precisar preencher manualmente:

```text
Base directory: vazio
Package directory: vazio
Build command: npm --workspace @push-lab/web run build
Publish directory: apps/web/dist
```

## Variaveis de ambiente na Netlify

Cole estas variaveis em Site configuration > Environment variables:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY_DA_SUPABASE

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

Troque:

- `https://SEU-PROJETO.supabase.co`
- `SUA_SERVICE_ROLE_KEY_DA_SUPABASE`
- `https://SEU-SITE.netlify.app`

Para `VAPID_PRIVATE_KEY` e `INTERNAL_CRON_SECRET`, abra o arquivo local `.env` e copie os valores ja gerados. Nao coloque esses valores em arquivos versionados.

Importante: use URLs sem barra no final.

Use:

```text
https://pushlabpessoal.netlify.app
```

Nao use:

```text
https://pushlabpessoal.netlify.app/
```

Se aparecer `ORIGIN_NOT_ALLOWED`, a URL aberta no navegador nao bate com `ALLOWED_ORIGIN`. Copie exatamente a origem da barra do navegador, sem caminho e sem barra final. Depois faca novo deploy na Netlify.

## Supabase

No Supabase, voce so precisa executar o SQL:

1. Abra SQL Editor.
2. Copie todo `supabase_schema.sql`.
3. Cole e execute.

Nao precisa publicar Supabase Edge Functions.

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

Se isso funcionar, o frontend esta chamando backend no mesmo dominio.

