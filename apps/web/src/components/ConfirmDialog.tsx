import { useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** May be async; the dialog shows a pending state and closes on success. */
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // caller surfaces the error (toast); keep the dialog open
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger-solid" onClick={() => void confirm()} disabled={busy}>
            {busy && <Spinner size={13} />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{message}</div>
    </Modal>
  );
}
