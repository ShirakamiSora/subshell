import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Modal({ title, description, onClose, children, footer, width = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6 "
      onMouseDown={onClose}
    >
      <div
        className={cn('panel fade-in flex max-h-[86vh] w-full flex-col shadow-2xl shadow-black/50', width)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text)]">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-[var(--muted)]">{description}</p>}
          </div>
          <button className="btn btn-ghost -mr-1 h-7 w-7 !p-0" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </header>
        <div className="scroll-area flex-1 px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmText = '确认',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width="max-w-md"
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button className={cn('btn', danger ? 'btn-danger' : 'btn-primary')} onClick={onConfirm}>
            {confirmText}
          </button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-[var(--muted)]">{message}</p>
    </Modal>
  );
}
