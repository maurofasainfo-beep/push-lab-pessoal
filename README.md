# Push Lab Pessoal

PWA pessoal para criar, testar, enviar e agendar notificações Web Push em dispositivos próprios, com foco em iPhone instalado na tela inicial.

O projeto não tem cadastro, login, cobrança, painel administrativo nem identidade visual de terceiros. A identidade exibida pelo sistema operacional é a do próprio PWA: nome, ícone, manifest e origem.

## Funcionalidades

- Instalação como PWA mobile-first.
- Detecção de modo navegador vs PWA instalado.
- Solicitação de permissão somente por ação explícita.
- Registro anônimo por instalação com `device_id` público e `device_secret` local.
- Inscrição Web Push via Service Worker e VAPID.
- Envio de teste.
- Criação de notificações imediatas e agendadas.
- Edição/cancelamento de notificações ainda não finalizadas.
- Listagem de agendamentos e histórico.
- Registro de tentativas, falhas e inscrições expiradas.
- Revogação do dispositivo e opção de apagar dados remotos.
- SQL completo em [supabase_schema.sql](./supabase_schema.sql).
- Limpeza manual segura em [supabase_cleanup.sql](./supabase_cleanup.sql).

## Limitações técnicas confirmadas

Fontes oficiais consultadas:

- Apple Developer: <https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers>
- WebKit: <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>
- MDN Push API: <https://developer.mozilla.org/en-US/docs/Web/API/Push_API>
- MDN Service Worker API: <https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API>
- Supabase Edge Functions: <https://supabase.com/docs/guides/functions>
- Supabase Edge Function secrets: <https://supabase.com/docs/guides/functions/secrets>
- Supabase Edge Function limits: <https://supabase.com/docs/guides/functions/limits>
- Supabase Cron: <https://supabase.com/docs/guides/cron>
- Supabase pg_net: <https://supabase.com/docs/guides/database/extensions/pg_net>
- Supabase RLS: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- web-push library: <https://github.com/web-push-libs/web-push>

Limitações relevantes:

- iOS/iPadOS suportam Web Push para web apps adicionados à tela inicial a partir de 16.4.
- No iPhone, a permissão precisa ser solicitada em resposta a uma ação explícita do usuário.
- A notificação real usa a identidade do PWA instalado. O app não promete trocar livremente o nome/origem da notificação por envio.
- A prévia visual da interface é simulação; o iOS controla o layout final, som, agrupamento, foco, tela bloqueada e aparência.
- Service Workers exigem contexto seguro: HTTPS em produção; `localhost` só serve para desenvolvimento.
- Push API permite mensagens com o PWA em segundo plano/fechado porque o Service Worker é acionado pelo navegador, mas entrega final depende do sistema, permissões, foco, bateria, rede e push service.
- `delivered_at` não é preenchido como entrega ao usuário. Web Push confirma aceitação pelo serviço de push, não leitura/exibição final no iPhone.
- Ações, imagem, ícone, badge e som variam por plataforma. O sistema valida e envia campos suportados pelo padrão, mas o iOS pode ignorar parte deles.
- Supabase Cron/pg_cron e pg_net podem depender de configuração do projeto/plano. O SQL tenta configurar; se não conseguir, use o cron externo protegido descrito em [DEPLOYMENT.md](./DEPLOYMENT.md).

## Arquitetura resumida

- Frontend: React + TypeScript + Vite, PWA, Service Worker, React Hook Form, Zod, date-fns/date-fns-tz.
- Backend: Supabase Edge Functions em TypeScript/Deno.
- Banco: PostgreSQL no Supabase com RLS habilitado e sem acesso direto para `anon`/`authenticated`.
- Web Push: biblioteca `web-push`, VAPID, payload sanitizado e envio somente pelo backend.
- Agendamento: Supabase Cron/pg_cron chamando `process-scheduled-notifications` via pg_net; alternativa: cron externo chamando a mesma função.

Detalhes em [ARCHITECTURE.md](./ARCHITECTURE.md).

## Suposições usadas

Como não foram fornecidos valores definitivos, foram adotadas escolhas conservadoras:

- Nome da aplicação: Push Lab Pessoal.
- Ícone: ícone próprio gerado localmente, sem marca de terceiros.
- Domínio de produção: configurar depois em `APP_URL`/`ALLOWED_ORIGIN`.
- Hospedagem sugerida: qualquer host HTTPS estático, por exemplo Vercel, Netlify, Cloudflare Pages ou Supabase Hosting.
- iOS mínimo: 16.4.
- Cron: 1 minuto.
- Atraso aceitável: até 1 minuto mais latência de execução.
- Limite pessoal: 30 criações/minuto por dispositivo e 60 operações/minuto para outras ações.
- Retenção padrão: entregas 90 dias; notificações finalizadas 180 dias.
- Offline: apenas app shell/offline page; operações reais exigem internet.
- Idioma: português do Brasil.
- Imagens externas: HTTPS apenas.

## Instalação local

Pré-requisitos:

- Node.js 24+.
- npm 11+.
- Deno 2+.
- Supabase CLI opcional para desenvolvimento local.

No PowerShell deste ambiente, use `npm.cmd` e `npx.cmd` se `npm.ps1`/`npx.ps1` estiverem bloqueados.

```powershell
cd C:\Users\User\push-lab-pessoal
npm.cmd install
npm.cmd run generate:icons
```

Crie `apps/web/.env.local` com as variáveis públicas:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua_anon_key_publica
VITE_VAPID_PUBLIC_KEY=sua_vapid_public_key
VITE_APP_URL=https://seu-dominio
VITE_APP_VERSION=0.1.0
```

Rode o frontend:

```powershell
npm.cmd run dev
```

## Variáveis de ambiente

Use [.env.example](./.env.example) como referência.

Frontend público:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY`
- `VITE_APP_URL`
- `VITE_APP_VERSION`

Secrets das Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `ALLOWED_ORIGIN`
- `INTERNAL_CRON_SECRET`
- `APP_URL`
- `APP_VERSION`

Nunca coloque `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY` ou `INTERNAL_CRON_SECRET` em variáveis `VITE_`.

## Gerar VAPID

```powershell
npx.cmd web-push generate-vapid-keys --json
```

Use:

- `publicKey` em `VITE_VAPID_PUBLIC_KEY` e `VAPID_PUBLIC_KEY`.
- `privateKey` apenas em `VAPID_PRIVATE_KEY` nas Edge Functions.
- `VAPID_SUBJECT` como `mailto:voce@example.com` ou URL HTTPS sua. Evite `https://localhost` para Safari.

## Supabase

1. Crie um projeto Supabase.
2. Abra SQL Editor.
3. Copie todo o conteúdo de [supabase_schema.sql](./supabase_schema.sql).
4. Cole e execute uma única vez.
5. Verifique se as tabelas foram criadas e se RLS está habilitado.
6. Configure Edge Function secrets.
7. Faça deploy das Edge Functions.
8. Configure Vault secrets para o cron HTTP, se usar pg_cron/pg_net.

O frontend não acessa tabelas diretamente. Todas as operações passam por Edge Functions, que validam `device_secret`.

## Edge Functions

Funções implementadas:

- `register-device`
- `update-device`
- `register-push-subscription`
- `refresh-push-subscription`
- `create-notification`
- `update-notification`
- `cancel-notification`
- `list-notifications`
- `get-notification`
- `send-test-notification`
- `revoke-device`
- `process-scheduled-notifications`
- `retry-failed-notifications`
- `health-check`

Todas usam resposta padronizada:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

Erros:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_SCHEDULE_DATE",
    "message": "A data deve estar no futuro.",
    "correlation_id": "corr_exemplo"
  }
}
```

Contratos completos em [API.md](./API.md).

## Testes

Comandos:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
npm.cmd run check:edge
npm.cmd run lint:edge
npm.cmd run audit:secrets
```

Suíte completa:

```powershell
npm.cmd run validate
```

Checklist manual obrigatório no iPhone: [TESTING.md](./TESTING.md).

## Diagnóstico de falhas

Verifique:

- `SERVICE_WORKER_UNSUPPORTED` ou `INSECURE_CONTEXT`: no iPhone, não acesse `http://IP_DO_PC:5173`; Service Worker exige HTTPS. Publique em domínio HTTPS ou use túnel HTTPS. `localhost` só é considerado seguro no próprio dispositivo.
- Permissão do iOS em Ajustes > Notificações > Push Lab Pessoal.
- Se o app foi aberto pelo ícone da tela inicial.
- Se `VITE_VAPID_PUBLIC_KEY` corresponde a `VAPID_PRIVATE_KEY`.
- Se `ALLOWED_ORIGIN` é exatamente o domínio do frontend.
- Se as Edge Functions foram publicadas com `verify_jwt=false` e validação própria ativa.
- Se `INTERNAL_CRON_SECRET` no Vault/cron é igual ao secret da Edge Function.
- Tabela `notification_deliveries` para `provider_status_code`, `error_code` e `error_message`.
- `net._http_response`, se pg_net estiver chamando a Edge Function.

## Segurança

Resumo:

- `device_secret` gerado no dispositivo e armazenado localmente.
- Banco armazena apenas SHA-256 do segredo.
- Comparação constante no backend.
- RLS habilitado e políticas explícitas de negação para `anon`/`authenticated`.
- Service role apenas nas Edge Functions.
- CORS restritivo por `ALLOWED_ORIGIN`.
- Rate limiting em tabela própria.
- Payload limitado e validado por Zod.
- VAPID private key somente no backend.
- Logs sanitizados com `correlation_id`.

Detalhes em [SECURITY.md](./SECURITY.md).
