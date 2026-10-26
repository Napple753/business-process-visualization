import { useEffect } from "react";
import { useStore } from "../state/store";
import { ListScreen } from "./ListScreen";
import { ProcessScreen } from "./ProcessScreen";
import { WelcomeScreen } from "./WelcomeScreen";

export function App() {
  const ready = useStore((s) => s.fs !== null);
  const root = useStore((s) => s.root);
  const hasCurrent = useStore((s) => s.current !== null);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  if (!ready) return null;
  return (
    <div className="app">
      {!root ? <WelcomeScreen /> : hasCurrent ? <ProcessScreen /> : <ListScreen />}
    </div>
  );
}

export function NoticeBar() {
  const notice = useStore((s) => s.notice);
  const notify = useStore((s) => s.notify);
  if (!notice) return null;
  return (
    <div className={`notice ${notice.level}`} role={notice.level === "error" ? "alert" : "status"}>
      <span>{notice.text}</span>
      <span className="spacer" />
      <button className="small" onClick={() => notify(null)}>
        Dismiss
      </button>
    </div>
  );
}
