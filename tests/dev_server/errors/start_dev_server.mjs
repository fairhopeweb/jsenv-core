import { requestCertificateForLocalhost } from "@jsenv/https-local"

import { startDevServer } from "@jsenv/core"

const { certificate, privateKey } = requestCertificateForLocalhost({
  altNames: ["local"],
})
export const devServer = await startDevServer({
  logLevel: process.env.GENERATING_SNAPSHOTS ? "off" : undefined,
  omegaServerLogLevel: process.env.GENERATING_SNAPSHOTS ? "off" : undefined,
  port: 3589,
  protocol: "https",
  acceptAnyIp: true,
  certificate,
  privateKey,
  rootDirectoryUrl: new URL("./stories/", import.meta.url),
  htmlSupervisor: {
    errorBaseUrl: process.env.GENERATING_SNAPSHOTS ? "file:///" : undefined,
  },
  plugins: [
    {
      name: "plugin_throwing",
      appliesDuring: "*",
      resolveUrl: ({ parentUrl, specifier }) => {
        if (
          parentUrl.includes("plugin_error_resolve/main.js") &&
          specifier === "./file.js"
        ) {
          throw new Error("error_during_resolve")
        }
      },
      fetchUrlContent: ({ url }) => {
        if (url.includes("plugin_error_load/main.js")) {
          throw new Error("error_during_load")
        }
      },
      transformUrlContent: ({ url }) => {
        if (url.includes("plugin_error_transform/main.js")) {
          throw new Error("error_during_transform")
        }
      },
    },
  ],
  explorer: {
    groups: {
      stories: {
        "./**/*.html": true,
      },
    },
  },
})
