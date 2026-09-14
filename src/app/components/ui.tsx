import { Dialog as DialogPrimitive } from 'radix-ui'
import { Button as ShadcnButton } from './shadcn/button'
import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'

export function Button({
  variant = 'primary',
  busy,
  busyLabel,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  busy?: boolean
  busyLabel?: string
}) {
  return (
    <ShadcnButton
      variant={({ primary: 'default', secondary: 'outline', quiet: 'ghost', danger: 'destructive' } as const)[variant]}
      className={`app-btn app-btn-${variant} ${className}`}
      aria-busy={busy || undefined}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? (busyLabel ?? 'Working…') : children}
    </ShadcnButton>
  )
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="app-field">
      <label className="app-label" htmlFor={id}>
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>, {
            id,
            'aria-invalid': Boolean(error) || undefined,
            'aria-describedby': [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined,
          })
        : children}
      {hint ? <p className="app-meta" id={`${id}-hint`}>{hint}</p> : null}
      {error ? (
        <p className="app-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="app-empty">
      <h2 className="app-section-title">{title}</h2>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  )
}

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="app-skeleton" style={{ height: 48, marginBottom: 8 }} />
      ))}
    </div>
  )
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'done' | 'warning' | 'danger'
}) {
  return <span className={`app-status${tone === 'neutral' ? '' : ` app-status-${tone}`}`}>{children}</span>
}

export function Pagination({
  page,
  total,
  pageSize = 50,
  onPage,
}: {
  page: number
  total: number
  pageSize?: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return <p className="app-meta">{total} results</p>
  return (
    <div className="app-toolbar">
      <p className="app-meta">
        {total} results · page {page} of {pages}
      </p>
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  )
}

export function ConfirmDialog({
  title,
  body,
  actionLabel,
  pending,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string
  body: string
  actionLabel: string
  pending?: boolean
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const opener = useRef(document.activeElement as HTMLElement | null)
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open && !pending) onCancel() }}>
      <DialogPrimitive.Portal container={document.querySelector<HTMLElement>('.brie-app')}>
        <DialogPrimitive.Overlay className="app-dialog-backdrop" />
        <DialogPrimitive.Content className="app-dialog app-confirm-dialog"
          onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus() }}
          onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus() }}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }}>
          <DialogPrimitive.Title className="app-section-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="app-lede" aria-live="polite">{body}</DialogPrimitive.Description>
          <div className="app-toolbar">
            <button ref={cancelRef} className="app-btn app-btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
            <Button variant={danger ? 'danger' : 'primary'} busy={pending} onClick={onConfirm}>{actionLabel}</Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="app-toast" role="status">
      {children}
    </div>
  )
}

export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="app-banner">
      <p>{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

