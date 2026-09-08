import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Project, Host, User } from "../../../packages/shared/src/index";
import type { Telemetry } from "../../../packages/shared/src/telemetry";
import { api } from "./api";
type State = {
  projects: Project[];
  hosts: Host[];
  telemetry?: Telemetry;
  loading: boolean;
  refresh: () => Promise<void>;
  error: string;
  user: User;
};
const Context = createContext<State | null>(null);
export const useDeck = () => useContext(Context)!;
export function DeckProvider({
  user,
  children,
}: {
  user: User;
  children: ReactNode;
}) {
  const [data, setData] = useState<Omit<State, "refresh" | "user">>({
    projects: [],
    hosts: [],
    loading: true,
    error: "",
  });
  const active = useRef(true);
  const inflight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    const promise = (async () => {
      try {
        const [projects, hosts, telemetry] = await Promise.all([
          api<Project[]>("/projects"),
          api<Host[]>("/hosts"),
          api<Telemetry>("/telemetry"),
        ]);
        if (active.current)
          setData({ projects, hosts, telemetry, loading: false, error: "" });
      } catch (e) {
        if (active.current)
          setData((d) => ({
            ...d,
            loading: false,
            error: (e as Error).message,
          }));
      }
    })();
    inflight.current = promise;
    void promise.finally(() => {
      inflight.current = null;
    });
    return promise;
  }, []);
  useEffect(() => {
    active.current = true;
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  return (
    <Context.Provider value={{ ...data, refresh, user }}>
      {children}
    </Context.Provider>
  );
}
export function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const fn = () => setHash(location.hash);
    addEventListener("hashchange", fn);
    return () => removeEventListener("hashchange", fn);
  }, []);
  const [path, query] = hash.replace(/^#\/?/, "").split("?");
  return { page: path || "home", query: new URLSearchParams(query || "") };
}
export function go(path: string) {
  location.hash = "#/" + path;
}
