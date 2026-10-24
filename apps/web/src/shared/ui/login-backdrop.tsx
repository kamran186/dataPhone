import { useMediaQuery } from "@mui/material";
import { useEffect, useState } from "react";
import { NetworkGlobe } from "./module-background";

type DataConnection = EventTarget & { saveData?: boolean };
export function LoginBackdrop() {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const reducedData = useMediaQuery("(prefers-reduced-data: reduce)");
  const [saveData, setSaveData] = useState(true);
  const [visible, setVisible] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const connection = (
      navigator as Navigator & { connection?: DataConnection }
    ).connection;
    const update = () => setSaveData(Boolean(connection?.saveData));
    const visibility = () => setVisible(!document.hidden);
    update();
    visibility();
    connection?.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      connection?.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  // Only bundled same-origin media is accepted. The application ships with SVG artwork.
  const source = import.meta.env.VITE_LOGIN_VIDEO_URL as string | undefined;
  const allowedSource =
    source?.startsWith("/media/") && !source.includes("..")
      ? source
      : undefined;
  return (
    <>
      <div className="login-globe">
        <NetworkGlobe />
      </div>
      {allowedSource &&
        !failed &&
        !saveData &&
        !reducedData &&
        !reducedMotion &&
        visible && (
          <video
            aria-hidden="true"
            className="login-video"
            src={allowedSource}
            poster="/media/network-poster.svg"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
          />
        )}
    </>
  );
}
