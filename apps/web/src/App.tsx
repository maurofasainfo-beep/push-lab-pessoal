import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { NotificationPreview } from "./components/NotificationPreview";
import { StatusBadge } from "./components/StatusBadge";
import { callFunction, hasApiConfig, listNotifications } from "./lib/api";
import { clearDevice, createPendingDevice, loadDevice, saveDevice } from "./lib/device";
import { prepareNotificationInput } from "./lib/notificationPayload";
import { activateWaitingServiceWorker, checkForAppUpdate, explainPwaError, getCompatibilityReport, registerServiceWorker, requestPermissionAndSubscribe } from "./lib/pwa";
import { formatUtcForDevice, getDeviceTimezone, splitUtcIntoLocalInputs } from "./lib/timezone";
import { deviceNameSchema, notificationFormSchema, type NotificationFormValues } from "./lib/validation";
import type { CompatibilityReport } from "./lib/pwa";
import type { NotificationItem, StoredDevice } from "./types/domain";

type TabKey = "home" | "activation" | "create" | "scheduled" | "history" | "device";

const defaultValues: NotificationFormValues = {
  title: "",
  body: "",
  imageUrl: "",
  iconUrl: "",
  badgeUrl: "",
  targetUrl: "/",
  tag: "",
  customData: "",
  deliveryType: "immediate",
  date: "",
  time: "",
  timezone: getDeviceTimezone()
};

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function addMinutesTimeInput(minutes: number): string {
  const date = new Date(Date.now() + minutes * 60_000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("home");
  const [device, setDevice] = useState<StoredDevice | null>(() => loadDevice());
  const [compatibility, setCompatibility] = useState<CompatibilityReport>(() => getCompatibilityReport());
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState(device?.name || "");
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const form = useForm<NotificationFormValues>({
    resolver: zodResolver(notificationFormSchema),
    defaultValues
  });

  const watched = form.watch();
  const scheduled = useMemo(() => notifications.filter((item) => ["draft", "scheduled", "processing", "failed", "partially_failed"].includes(item.status)), [notifications]);
  const history = useMemo(() => notifications.filter((item) => ["sent", "failed", "partially_failed", "cancelled"].includes(item.status)), [notifications]);

  useEffect(() => {
    registerServiceWorker()
      .then(() => setCompatibility(getCompatibilityReport()))
      .catch(() => setCompatibility(getCompatibilityReport()));

    navigator.serviceWorker?.addEventListener("controllerchange", () => {
      window.location.reload();
    });

    checkForAppUpdate().then(setUpdateAvailable).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (device) {
      refreshNotifications(device).catch((caught: unknown) => setError(String(caught instanceof Error ? caught.message : caught)));
      setDeviceName(device.name);
    }
  }, [device]);

  async function runAction(action: () => Promise<void>) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (caught) {
      setError(explainPwaError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function refreshNotifications(currentDevice = device) {
    if (!currentDevice) return;
    const items = await listNotifications(currentDevice);
    setNotifications(items);
  }

  async function setupNotifications() {
    await runAction(async () => {
      const registration = await registerServiceWorker();
      const pending = createPendingDevice(deviceName || undefined);
      const registered = await callFunction<{ public_id: string; name: string }>("register-device", {
        device_secret: pending.secret,
        name: pending.name,
        timezone: pending.timezone,
        locale: pending.locale,
        app_version: pending.appVersion,
        notifications_permission: Notification.permission,
        user_agent: navigator.userAgent
      });
      const nextDevice: StoredDevice = {
        publicId: registered.public_id,
        secret: pending.secret,
        name: registered.name,
        timezone: pending.timezone,
        locale: pending.locale,
        appVersion: pending.appVersion
      };
      saveDevice(nextDevice);
      setDevice(nextDevice);

      const subscription = await requestPermissionAndSubscribe(registration);
      await callFunction("register-push-subscription", { subscription, notifications_permission: Notification.permission }, { device: nextDevice });
      setMessage("Dispositivo registrado e notificacoes ativadas.");
      setTab("create");
      await refreshNotifications(nextDevice);
    });
  }

  async function renewSubscription() {
    if (!device) return;
    await runAction(async () => {
      const registration = await registerServiceWorker();
      const subscription = await requestPermissionAndSubscribe(registration);
      await callFunction("refresh-push-subscription", { subscription, notifications_permission: Notification.permission }, { device });
      setMessage("Inscricao Web Push renovada.");
    });
  }

  async function submitNotification(values: NotificationFormValues) {
    if (!device) {
      setError("Registre o dispositivo antes de criar notificacoes.");
      setTab("activation");
      return;
    }

    await runAction(async () => {
      const input = prepareNotificationInput(values);
      if (editingId) {
        await callFunction("update-notification", { id: editingId, ...input }, { device });
        setMessage("Notificacao atualizada.");
      } else {
        await callFunction("create-notification", input, { device });
        setMessage(input.delivery_type === "scheduled" ? "Notificacao agendada." : "Notificacao enviada para processamento.");
      }
      form.reset(defaultValues);
      setEditingId(null);
      await refreshNotifications();
      setTab(input.delivery_type === "scheduled" ? "scheduled" : "history");
    });
  }

  function editNotification(item: NotificationItem) {
    const local = splitUtcIntoLocalInputs(item.scheduled_at, device?.timezone || getDeviceTimezone());
    form.reset({
      title: item.title,
      body: item.body,
      imageUrl: item.image_url || "",
      iconUrl: item.icon_url || "",
      badgeUrl: item.badge_url || "",
      targetUrl: item.target_url || "/",
      tag: item.tag || "",
      customData: JSON.stringify(item.custom_data || {}, null, 2),
      deliveryType: item.delivery_type,
      date: local.date,
      time: local.time,
      timezone: device?.timezone || getDeviceTimezone()
    });
    setEditingId(item.id);
    setTab("create");
  }

  function duplicateNotification(item: NotificationItem) {
    form.reset({
      title: `${item.title} (copia)`,
      body: item.body,
      imageUrl: item.image_url || "",
      iconUrl: item.icon_url || "",
      badgeUrl: item.badge_url || "",
      targetUrl: item.target_url || "/",
      tag: item.tag || "",
      customData: JSON.stringify(item.custom_data || {}, null, 2),
      deliveryType: "immediate",
      date: todayInput(),
      time: addMinutesTimeInput(5),
      timezone: device?.timezone || getDeviceTimezone()
    });
    setEditingId(null);
    setTab("create");
  }

  async function cancelNotification(id: string) {
    if (!device) return;
    await runAction(async () => {
      await callFunction("cancel-notification", { id }, { device });
      setMessage("Agendamento cancelado.");
      await refreshNotifications();
    });
  }

  async function sendTest() {
    if (!device) return;
    await runAction(async () => {
      await callFunction("send-test-notification", { target_url: "/" }, { device });
      setMessage("Notificacao de teste enviada para processamento.");
      await refreshNotifications();
    });
  }

  async function updateDeviceName() {
    if (!device) return;
    await runAction(async () => {
      const name = deviceNameSchema.parse(deviceName);
      const updated = await callFunction<{ name: string }>("update-device", { name }, { device });
      const nextDevice = { ...device, name: updated.name };
      saveDevice(nextDevice);
      setDevice(nextDevice);
      setMessage("Nome do dispositivo atualizado.");
    });
  }

  async function revokeDevice(deleteRemoteData: boolean) {
    if (!device) return;
    await runAction(async () => {
      await callFunction("revoke-device", { delete_remote_data: deleteRemoteData }, { device });
      clearDevice();
      setDevice(null);
      setNotifications([]);
      setMessage(deleteRemoteData ? "Dados remotos e locais removidos." : "Dispositivo revogado e dados locais removidos.");
      setTab("home");
    });
  }

  const navItems: Array<{ key: TabKey; label: string }> = [
    { key: "home", label: "Inicio" },
    { key: "activation", label: "Ativacao" },
    { key: "create", label: "Criar" },
    { key: "scheduled", label: "Agendadas" },
    { key: "history", label: "Historico" },
    { key: "device", label: "Dispositivo" }
  ];

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">PWA pessoal</p>
          <h1>Push Lab Pessoal</h1>
          <p>Crie, teste, envie e agende Web Push para seus proprios dispositivos autorizados.</p>
        </div>
        <div className="hero-card" aria-label="Estado do app">
          <span>{device ? "Dispositivo registrado" : "Dispositivo nao registrado"}</span>
          <strong>{compatibility.isStandalone ? "Instalado como PWA" : "Aberto no navegador"}</strong>
        </div>
      </header>

      <nav className="tab-nav" aria-label="Telas principais">
        {navItems.map((item) => (
          <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)} type="button">
            {item.label}
          </button>
        ))}
      </nav>

      {updateAvailable ? (
        <section className="notice">
          <span>Atualizacao do PWA disponivel.</span>
          <button type="button" onClick={activateWaitingServiceWorker}>
            Aplicar
          </button>
        </section>
      ) : null}

      {!hasApiConfig() ? <p className="alert">Configure as variaveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY antes de usar o backend.</p> : null}
      {message ? <p className="success" role="status">{message}</p> : null}
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {loading ? <p className="loading" aria-live="polite">Processando...</p> : null}

      <main>
        {tab === "home" ? (
          <section className="panel">
            <h2>Tela inicial e instalacao</h2>
            <p>
              Este app usa a identidade fixa do proprio PWA. A previa abaixo e apenas visual; a notificacao real sera renderizada pelo sistema operacional.
            </p>
            <div className="grid two">
              <div className="card">
                <h3>Compatibilidade detectada</h3>
                <ul className="check-list">
                  <li>{compatibility.isSecureContext ? "Contexto seguro/HTTPS OK" : "HTTPS ausente"}</li>
                  <li>{compatibility.supportsServiceWorker ? "Service Worker disponivel" : "Service Worker indisponivel"}</li>
                  <li>{compatibility.supportsPush ? "Push API disponivel" : "Push API indisponivel"}</li>
                  <li>{compatibility.supportsNotifications ? "Notifications API disponivel" : "Notifications API indisponivel"}</li>
                  <li>{compatibility.isIos ? "Dispositivo iOS/iPadOS detectado" : "Nao parece iPhone/iPad"}</li>
                </ul>
              </div>
              <div className="card">
                <h3>Instalar no iPhone</h3>
                <ol>
                  <li>Abra esta URL no Safari.</li>
                  <li>Toque em Compartilhar.</li>
                  <li>Toque em Adicionar a Tela de Inicio.</li>
                  <li>Abra pelo icone instalado e ative notificacoes por botao.</li>
                </ol>
                <button type="button" onClick={() => setTab("activation")}>Iniciar configuracao</button>
              </div>
            </div>
          </section>
        ) : null}

        {tab === "activation" ? (
          <section className="panel">
            <h2>Ativacao de notificacoes</h2>
            <p>O iOS exige permissao solicitada por acao explicita. A inscricao Web Push fica vinculada a este PWA instalado e a esta origem.</p>
            {!compatibility.isSecureContext ? <p className="warning">Service Worker e Web Push exigem HTTPS. Se estiver no iPhone acessando http://IP:5173, isso nao vai funcionar; use um dominio HTTPS ou publique o app.</p> : null}
            {!compatibility.isStandalone ? <p className="warning">No iPhone, notificacoes Web Push exigem abrir o app pela tela inicial.</p> : null}
            <label>
              Nome amigavel do dispositivo
              <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Meu iPhone" />
            </label>
            <div className="actions">
              <button type="button" onClick={setupNotifications} disabled={loading || !hasApiConfig()}>
                Registrar e ativar notificacoes
              </button>
              <button type="button" onClick={renewSubscription} disabled={!device || loading}>
                Recriar inscricao
              </button>
            </div>
            <p className="muted">Permissao atual: {"Notification" in window ? Notification.permission : "indisponivel"}</p>
          </section>
        ) : null}

        {tab === "create" ? (
          <section className="panel">
            <h2>{editingId ? "Editar notificacao" : "Criar notificacao"}</h2>
            <form className="notification-form" onSubmit={form.handleSubmit(submitNotification)}>
              <label>
                Titulo
                <input {...form.register("title")} maxLength={120} />
                <span className="field-error">{form.formState.errors.title?.message}</span>
              </label>
              <label>
                Mensagem
                <textarea {...form.register("body")} maxLength={600} rows={4} />
                <span className="field-error">{form.formState.errors.body?.message}</span>
              </label>
              <label>
                Imagem opcional HTTPS
                <input {...form.register("imageUrl")} inputMode="url" />
                <span className="field-error">{form.formState.errors.imageUrl?.message}</span>
              </label>
              <label>
                URL aberta ao tocar
                <input {...form.register("targetUrl")} inputMode="url" />
                <span className="field-error">{form.formState.errors.targetUrl?.message}</span>
              </label>
              <label>
                Etiqueta opcional
                <input {...form.register("tag")} maxLength={80} />
              </label>
              <label>
                Dados adicionais JSON opcional
                <textarea {...form.register("customData")} rows={3} placeholder='{"origem":"teste"}' />
                <span className="field-error">{form.formState.errors.customData?.message}</span>
              </label>

              <fieldset>
                <legend>Modo de envio</legend>
                <label className="inline">
                  <input type="radio" value="immediate" {...form.register("deliveryType")} />
                  Enviar agora
                </label>
                <label className="inline">
                  <input type="radio" value="scheduled" {...form.register("deliveryType")} />
                  Agendar
                </label>
              </fieldset>

              {watched.deliveryType === "scheduled" ? (
                <div className="grid two">
                  <label>
                    Data
                    <input type="date" min={todayInput()} {...form.register("date")} />
                    <span className="field-error">{form.formState.errors.date?.message}</span>
                  </label>
                  <label>
                    Horario
                    <input type="time" {...form.register("time")} />
                    <span className="field-error">{form.formState.errors.time?.message}</span>
                  </label>
                </div>
              ) : null}

              <label>
                Timezone
                <input {...form.register("timezone")} />
              </label>

              <NotificationPreview appName="Push Lab Pessoal" title={watched.title} body={watched.body} imageUrl={watched.imageUrl} />
              <div className="actions">
                <button type="submit" disabled={loading || !device}>
                  {editingId ? "Salvar edicao" : "Confirmar"}
                </button>
                {editingId ? (
                  <button type="button" className="secondary" onClick={() => { setEditingId(null); form.reset(defaultValues); }}>
                    Cancelar edicao
                  </button>
                ) : null}
              </div>
            </form>
          </section>
        ) : null}

        {tab === "scheduled" ? (
          <section className="panel">
            <div className="panel-title-row">
              <h2>Notificacoes agendadas</h2>
              <button type="button" className="secondary" onClick={() => refreshNotifications()} disabled={!device}>Atualizar</button>
            </div>
            {scheduled.length === 0 ? <p className="empty">Nenhuma notificacao agendada ou pendente.</p> : null}
            <div className="list">
              {scheduled.map((item) => (
                <article className="list-item" key={item.id}>
                  <div>
                    <StatusBadge status={item.status} />
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <small>{formatUtcForDevice(item.scheduled_at, device?.timezone || getDeviceTimezone())}</small>
                  </div>
                  <div className="item-actions">
                    <button type="button" onClick={() => editNotification(item)} disabled={!["draft", "scheduled", "failed", "partially_failed"].includes(item.status)}>
                      Editar
                    </button>
                    <button type="button" onClick={() => duplicateNotification(item)}>Duplicar</button>
                    <button type="button" className="danger" onClick={() => cancelNotification(item.id)} disabled={!["draft", "scheduled", "failed", "partially_failed"].includes(item.status)}>
                      Cancelar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {tab === "history" ? (
          <section className="panel">
            <div className="panel-title-row">
              <h2>Historico</h2>
              <button type="button" className="secondary" onClick={() => refreshNotifications()} disabled={!device}>Atualizar</button>
            </div>
            {history.length === 0 ? <p className="empty">Historico vazio.</p> : null}
            <div className="list">
              {history.map((item) => (
                <article className="list-item" key={item.id}>
                  <div>
                    <StatusBadge status={item.status} />
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <small>
                      Tentativas: {item.attempt_count}
                      {item.last_error_code ? ` | Erro: ${item.last_error_code}` : ""}
                    </small>
                  </div>
                  <button type="button" onClick={() => duplicateNotification(item)}>Duplicar</button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {tab === "device" ? (
          <section className="panel">
            <h2>Dispositivo</h2>
            {device ? (
              <>
                <div className="card">
                  <p><strong>ID anonimo:</strong> {device.publicId}</p>
                  <p><strong>Timezone:</strong> {device.timezone}</p>
                  <p><strong>Locale:</strong> {device.locale}</p>
                  <p><strong>Permissao:</strong> {"Notification" in window ? Notification.permission : "indisponivel"}</p>
                </div>
                <label>
                  Nome amigavel
                  <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
                </label>
                <div className="actions">
                  <button type="button" onClick={updateDeviceName}>Salvar nome</button>
                  <button type="button" onClick={sendTest}>Enviar teste</button>
                  <button type="button" onClick={renewSubscription}>Renovar inscricao</button>
                </div>
                <div className="actions danger-zone">
                  <button type="button" className="secondary" onClick={() => { clearDevice(); setDevice(null); setNotifications([]); }}>
                    Apagar dados locais
                  </button>
                  <button type="button" className="danger" onClick={() => revokeDevice(false)}>Revogar remoto</button>
                  <button type="button" className="danger" onClick={() => revokeDevice(true)}>Apagar dados remotos</button>
                </div>
              </>
            ) : (
              <p className="empty">Nenhum dispositivo registrado neste navegador.</p>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
