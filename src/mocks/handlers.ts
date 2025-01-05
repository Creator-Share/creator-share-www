import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/hello", () => {
    return HttpResponse.json({
      message: "Hello from MSW!",
    });
  }),
];
