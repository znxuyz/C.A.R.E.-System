import { useEffect, type ReactNode } from 'react';

/** 右側抽屜：審核詳情用，保留列表上下文（生教組需一件接一件處理） */
export function Drawer({
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="drawer">
        <header className="drawer__head">
          <div>
            <h2 className="card__title">{title}</h2>
            {subtitle && <div className="small muted">{subtitle}</div>}
          </div>
          <span className="spacer" />
          <button className="btn btn--ghost" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </header>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__foot">{footer}</div>}
      </div>
    </div>
  );
}
