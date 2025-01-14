import { handlers } from "./handlers";
const { setupWorker } = require("msw/browser");

// Initialize the MSW worker with handlers
export const worker = setupWorker(...handlers);
// Add error handling for the worker
worker.events.on("request:start", ({ request }: { request: Request }) => {
  console.log("MSW: Intercepted", request.method, request.url);
});

worker.events.on("request:match", ({ request }: { request: Request }) => {
  console.log("MSW: Matched", request.method, request.url);
});

worker.events.on("request:unhandled", ({ request }: { request: Request }) => {
  console.log("MSW: Unhandled", request.method, request.url);
});
