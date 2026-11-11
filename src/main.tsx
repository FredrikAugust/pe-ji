import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dotgothic16/latin-400.css";
import "@fontsource/dotgothic16/japanese-400.css";
import "@fontsource/noto-sans-jp/latin-400.css";
import "@fontsource/noto-sans-jp/japanese-400.css";
import "@fontsource/noto-sans-jp/latin-700.css";
import "@fontsource/noto-sans-jp/japanese-700.css";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
