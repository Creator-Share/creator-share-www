async function initMocks() {
  if (typeof window === "undefined") {
    console.log("MSW: Skipping initialization in server environment");
    return;
  }

  try {
    const { worker } = await import("../mocks/browser");
    console.log("MSW: Starting worker...");
    await worker.start({
      onUnhandledRequest: "bypass",
    });
    console.log("MSW: Worker started successfully");
  } catch (error) {
    console.error("MSW: Failed to start service worker:", error);
  }
}

// Initialize MSW
if (process.env.NODE_ENV === "development") {
  console.log("MSW: Development mode detected, initializing...");
  initMocks();
}
