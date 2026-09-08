import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
const paths: Record<string, ReactNode> = {
  home: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  cube: (
    <>
      <path d="m21 8-9-5-9 5 9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8M12 13v8" />
    </>
  ),
  pulse: <path d="M3 12h5l2-6 4 12 2-6h5" />,
  log: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3m5 0h5" />
    </>
  ),
  gear: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="2.2" />
      <circle cx="15" cy="17" r="2.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  back: <path d="M21 12H5m7-7-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  play: <path d="m8 5 11 7-11 7Z" />,
  chev: <path d="m6 9 6 6 6-6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-8 16-8 16 0" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2" />
    </>
  ),
  external: <path d="M14 3h7v7m0-7L10 14m0-10H4v16h16v-6" />,
  logout: <path d="M9 4H4v16h5m4-12 4 4-4 4m-5-4h13" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m4 12 5 5L20 6" />,
};
export function Icon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.cube}
    </svg>
  );
}
export function Button({
  children,
  kind = "",
  icon,
  busy,
  mini = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: string;
  icon?: string;
  busy?: boolean;
  mini?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`${mini ? "btn" : "btn2"} ${kind} ${busy ? "spin" : ""} ${className}`}
      aria-busy={busy || undefined}
    >
      {(busy || icon) && <Icon name={busy ? "refresh" : icon!} />} {children}
    </button>
  );
}
export function Select({
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-wrap">
      <select {...props}>{children}</select>
      <Icon name="chev" />
    </span>
  );
}
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={"field " + (wide ? "wide" : "")}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className={"tg " + (!checked ? "off" : "")}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}
export function Empty({
  children = "暂无数据，等待首次采集。",
}: {
  children?: ReactNode;
}) {
  return <div className="empty">{children}</div>;
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={"notice " + (error ? "error" : "")}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Row({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="irow">
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}
export function Box({
  title,
  extra,
  children,
  className = "",
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"box " + className}>
      <div className="bh">
        <span>{title}</span>
        {extra}
      </div>
      {children}
    </section>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => {
      el.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h3>{title}</h3>
        <Button icon="close" aria-label="关闭" onClick={close} />
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
type ToastKind = "ok" | "warn" | "bad";
const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(
  () => {},
);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<
    { id: number; text: string; kind: string }[]
  >([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const seq = useRef(0);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  function toast(text: string, kind: ToastKind = "ok") {
    const id = ++seq.current;
    setItems((v) => [...v.slice(-2), { id, text, kind }]);
    timers.current.push(
      setTimeout(() => setItems((v) => v.filter((t) => t.id !== id)), 2600),
    );
  }
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div id="toast" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={"toast-item show " + t.kind}>
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
