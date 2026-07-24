# Deploy

## Frontend

1. Configure um domínio HTTPS.
2. Configure variáveis públicas no provedor:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua_anon_key
VITE_VAPID_PUBLIC_KEY=sua_vapid_public_key
VITE_APP_URL=https://seu-dominio
VITE_APP_VERSION=0.1.0
```

3. Build:

```powershell
npm.cmd run build
```

4. Publique `apps/web/dist`.

## Supabase SQL

No Dashboard:

1. Abra o projeto.
2. Vá em SQL Editor.
3. Crie uma nova query.
4. Copie todo [supabase_schema.sql](./supabase_schema.sql).
5. Cole e execute.
6. Confirme que as tabelas existem em Table Editor.
7. Confirme que RLS está habilitado.

O arquivo é autocontido para schema, enums, tabelas, índices, triggers, RLS, funções e tentativa de cron. Ele não contém secrets reais.

## Edge Functions

O projeto usa `verify_jwt=false` porque implementa autenticação própria por dispositivo e secret interno de cron. Não desative a validação no código.

Com Supabase CLI instalado:

```powershell
supabase functions deploy register-device --no-verify-jwt
supabase functions deploy update-device --no-verify-jwt
supabase functions deploy register-push-subscription --no-verify-jwt
supabase functions deploy refresh-push-subscription --no-verify-jwt
supabase functions deploy create-notification --no-verify-jwt
supabase functions deploy update-notification --no-verify-jwt
supabase functions deploy cancel-notification --no-verify-jwt
supabase functions deploy list-notifications --no-verify-jwt
supabase functions deploy get-notification --no-verify-jwt
supabase functions deploy send-test-notification --no-verify-jwt
supabase functions deploy revoke-device --no-verify-jwt
supabase functions deploy process-scheduled-notifications --no-verify-jwt
supabase functions deploy retry-failed-notifications --no-verify-jwt
supabase functions deploy health-check --no-verify-jwt
```

## Secrets das Edge Functions

Dashboard:

1. Supabase Dashboard > Edge Functions > Secrets.
2. Adicione:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:voce@example.com
ALLOWED_ORIGIN=https://seu-dominio
INTERNAL_CRON_SECRET=...
APP_URL=https://seu-dominio
APP_VERSION=0.1.0
```

CLI:

```powershell
supabase secrets set --env-file .env.production
```

Não versione `.env.production`.

## Cron com pg_cron + pg_net

Depois de executar o SQL, configure Vault secrets no SQL Editor:

```sql
select vault.create_secret('https://SEU-PROJETO.supabase.co', 'push_lab_supabase_url');
select vault.create_secret('SUA_SUPABASE_ANON_KEY', 'push_lab_anon_key');
select vault.create_secret('SEU_INTERNAL_CRON_SECRET', 'push_lab_internal_cron_secret');
```

Depois reexecute apenas a seção final de cron do [supabase_schema.sql](./supabase_schema.sql), ou crie o job pelo Dashboard em Integrations > Cron.

Verificação:

```sql
select * from cron.job where jobname like 'push-lab-%';
select * from cron.job_run_details order by start_time desc limit 20;
select * from net._http_response order by created desc limit 20;
```

## Alternativa com cron externo

Se pg_cron/pg_net/Vault não estiverem disponíveis, use um cron HTTP gratuito:

- Método: POST
- URL: `https://<project-ref>.supabase.co/functions/v1/process-scheduled-notifications`
- Headers:

```http
Content-Type: application/json
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <INTERNAL_CRON_SECRET>
```

- Body:

```json
{ "source": "external_cron" }
```

- Frequência: 1 minuto.

## Validação pós-deploy

1. Acesse `https://seu-dominio`.
2. Verifique manifest e Service Worker no DevTools.
3. No iPhone iOS 16.4+, adicione à tela inicial.
4. Abra pelo ícone instalado.
5. Registre dispositivo.
6. Permita notificações.
7. Envie teste.
8. Agende uma notificação para 3 minutos no futuro.
9. Feche o PWA.
10. Confirme recebimento.
11. Confira `notifications` e `notification_deliveries`.

## Rollback

- Frontend: volte a versão anterior no provedor.
- Edge Functions: redeploy da versão anterior.
- Banco: execute [supabase_cleanup.sql](./supabase_cleanup.sql) somente se deseja remover o projeto e perder dados.
- Secrets: rotacione em vez de remover quando houver incidente.

