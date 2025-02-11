import { startDevServer } from "@jsenv/core"

startDevServer({
  logLevel: "info",
  rootDirectoryUrl: new URL("./client/", import.meta.url),
  clientAutoreload: true,
  clientFiles: {
    "./*/**": true,
  },
  supervisor: false,
  clientMainFileUrl: new URL("./client/main.html", import.meta.url),
})
