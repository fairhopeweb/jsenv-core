import { startDevServer } from "@jsenv/core"
import { plugins } from "./jsenv_config.mjs"

startDevServer({
  port: 5678,
  rootDirectoryUrl: new URL("./client/", import.meta.url),
  plugins,
  sourcemaps: "file",
  clientFiles: {
    "./": true,
    "./.jsenv/": false,
  },
  clientMainFileUrl: new URL("./client/main.html", import.meta.url),
})
