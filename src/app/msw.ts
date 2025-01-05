async function initMocks() {
  if (typeof window === "undefined") return;

  const { worker } = await import("../mocks/browser");
  return worker.start({
    onUnhandledRequest: "bypass",
  });
}

// Initialize MSW
if (process.env.NODE_ENV === "development") {
  initMocks();
}
