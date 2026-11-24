// One recovery boundary for obsolete public documents, including route metadata in <Meta>.
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { createRenderErrorHandler } from "./lib/render-recovery";
import { skipWindowsWebKitHistorySnapshots } from "./components/shell/transitions";

// Capture once before hydration; this belongs to the document, not later navigation responses.
const documentRelease = document.querySelector('meta[name="aihot-release"]')?.getAttribute("content") ?? null;
const onError = createRenderErrorHandler(documentRelease);
skipWindowsWebKitHistorySnapshots();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      {/* Commit cached returns promptly, even while WebKit is running a view transition. */}
      <HydratedRouter useTransitions={false} />
    </StrictMode>,
    { onCaughtError: onError },
  );
});
