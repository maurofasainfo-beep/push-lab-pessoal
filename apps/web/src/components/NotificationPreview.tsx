interface NotificationPreviewProps {
  appName: string;
  title: string;
  body: string;
  imageUrl?: string;
}

export function NotificationPreview({ appName, title, body, imageUrl }: NotificationPreviewProps) {
  return (
    <section className="preview-card" aria-label="Previa visual simulada da notificacao">
      <div className="preview-meta">
        <div className="preview-app-icon" aria-hidden="true">
          PL
        </div>
        <div>
          <p className="preview-app-name">{appName}</p>
          <p className="preview-disclaimer">Simulacao visual. O iOS renderiza a notificacao real.</p>
        </div>
      </div>
      <div className="preview-content">
        <strong>{title || "Titulo da notificacao"}</strong>
        <p>{body || "Mensagem que sera enviada para o dispositivo autorizado."}</p>
      </div>
      {imageUrl ? (
        <img className="preview-image" src={imageUrl} alt="Imagem configurada para a notificacao" />
      ) : (
        <div className="preview-image-fallback">Imagem opcional</div>
      )}
    </section>
  );
}

