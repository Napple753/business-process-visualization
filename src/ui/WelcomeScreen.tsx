import { useStore } from "../state/store";
import { NoticeBar } from "./App";

export function WelcomeScreen() {
  const openFolder = useStore((s) => s.openFolder);
  const isDemo = useStore((s) => s.fs?.kind === "demo");
  return (
    <>
      <NoticeBar />
      <div className="welcome">
        <div className="welcome-card">
          <h1>Process Workbench</h1>
          <p>
            Open the folder of your repository that contains <span className="mono">business-processes/</span>, or
            that folder itself. Flows are read from and saved to its YAML files; use Git to review and commit the
            changes.
          </p>
          {isDemo && (
            <p>Running in a browser: the bundled examples are opened and changes are kept in memory only.</p>
          )}
          <div>
            <button className="primary" onClick={() => void openFolder()}>
              Open folder…
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
