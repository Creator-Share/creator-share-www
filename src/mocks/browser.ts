import { handlers } from "./handlers";
import { setupWorker } from "msw/browser";

// Initialize the MSW worker with handlers
export const worker = setupWorker(...handlers);
// Add error handling for the worker
worker.events.on("request:start", (req) => {
  if (req.request) {
    console.log("MSW: Intercepted", req.request.method, req.request.url);
  }
});

worker.events.on("request:match", (req) => {
  if (req.request) {
    console.log("MSW: Matched", req.request.method, req.request.url);
  }
});

worker.events.on("request:unhandled", (req) => {
  if (req.request) {
    console.log("MSW: Unhandled", req.request.method, req.request.url);
  }
});
