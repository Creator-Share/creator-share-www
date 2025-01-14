import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

// Initialize the MSW worker with handlers
export const worker = setupWorker(...handlers);

// Add error handling for the worker
worker.events.on("request:start", ({ request }) => {
  console.log("MSW: Intercepted", request.method, request.url);
});

worker.events.on("request:match", ({ request }) => {
  console.log("MSW: Matched", request.method, request.url);
});

worker.events.on("request:unhandled", ({ request }) => {
  console.log("MSW: Unhandled", request.method, request.url);
});
