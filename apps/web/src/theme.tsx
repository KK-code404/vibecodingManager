import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Switch } from "./ui";

type Theme = "dark" | "light";
const storageKey = "control-deck-theme";
function readTheme(): Theme {
  try {
    return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#f4f6f8" : "#0a0d12");
}
const initialTheme = readTheme();
applyTheme(initialTheme);
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({ theme: initialTheme, setTheme: () => {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, update] = useState<Theme>(initialTheme);
  function setTheme(next: Theme) {
    applyTheme(next);
    update(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Switching still works when browser storage is unavailable. */
    }
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        const next = readTheme();
        applyTheme(next);
        update(next);
      }
    };
    addEventListener("storage", sync);
    return () => removeEventListener("storage", sync);
  }, []);
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeToggle() {
  const { theme, setTheme } = useContext(ThemeContext);
  return (
    <div className="theme-toggle">
      <span>白色模式</span>
      <Switch
        label="白色模式"
        checked={theme === "light"}
        onChange={(light) => setTheme(light ? "light" : "dark")}
      />
    </div>
  );
}
