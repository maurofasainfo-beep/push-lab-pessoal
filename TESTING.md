# Testes

## Automatizados

Comandos validados localmente:

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

Cobertura implementada:

- Validação de formulário e URLs.
- Conversão timezone local/UTC.
- Geração e hash de segredo de dispositivo.
- Transições de status.
- Política de retry.
- Preparação de payload.
- Contrato estático do SQL: tabelas, RLS, `FOR UPDATE SKIP LOCKED`, ausência de secrets.
- Typecheck do frontend.
- `deno check` e `deno lint` das Edge Functions.
- Build do PWA.

## Integração

Sem credenciais reais de Supabase neste ambiente, os testes de integração reais contra banco remoto não foram executados. Para executar em um projeto real:

1. Aplique [supabase_schema.sql](./supabase_schema.sql).
2. Configure secrets.
3. Faça deploy das funções.
4. Use o PWA ou chamadas HTTP para testar:
   - registro de dispositivo;
   - inscrição;
   - criação;
   - atualização;
   - cancelamento;
   - claim por cron;
   - retry;
   - expiração 404/410 com mock de endpoint;
   - revogação.

## Checklist manual no iPhone

Preencha durante validação real:

| Item | Resultado |
|---|---|
| Modelo do iPhone | A confirmar |
| Versão do iOS | A confirmar |
| iOS >= 16.4 | A confirmar |
| Site abre em HTTPS | A confirmar |
| Adicionado à tela inicial | A confirmar |
| Aberto pelo ícone PWA | A confirmar |
| Detecta modo standalone | A confirmar |
| Botão solicita permissão | A confirmar |
| Permissão concedida | A confirmar |
| Permissão negada mostra orientação | A confirmar |
| Inscrição criada | A confirmar |
| Teste recebido com PWA aberto | A confirmar |
| Teste recebido em segundo plano | A confirmar |
| Teste recebido com PWA fechado | A confirmar |
| Teste recebido com tela bloqueada | A confirmar |
| Modo Foco documentado | A confirmar |
| Wi-Fi | A confirmar |
| Rede móvel | A confirmar |
| Dispositivo offline durante agendamento | A confirmar |
| Mudança de timezone | A confirmar |
| Inscrição recriada | A confirmar |
| Dispositivo revogado | A confirmar |
| Dados locais apagados | A confirmar |
| Dados remotos apagados | A confirmar |
| Sem identidade/marca de terceiros | A confirmar |

## Cenários E2E recomendados

1. Instalar PWA no iPhone.
2. Ativar notificações por botão.
3. Enviar teste.
4. Criar notificação imediata.
5. Agendar notificação futura.
6. Cancelar agendamento.
7. Editar agendamento ainda pendente.
8. Duplicar notificação do histórico.
9. Fechar PWA e aguardar cron.
10. Ver histórico com sucesso/falha.
11. Simular falha removendo inscrição.
12. Revogar dispositivo.

## Limitações dos testes locais

- Não validam APNs/iOS real.
- Não validam Supabase remoto sem credenciais.
- Não validam pg_cron/pg_net em projeto real.
- Não garantem layout final da notificação no iOS.

