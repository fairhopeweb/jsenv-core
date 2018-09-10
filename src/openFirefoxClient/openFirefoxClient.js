// https://www.npmjs.com/package/selenium-webdriver

// http://seleniumhq.github.io/selenium/docs/api/javascript/module/selenium-webdriver/index_exports_WebDriver.html
import { Builder } from "selenium-webdriver"
// https://github.com/SeleniumHQ/selenium/blob/master/javascript/node/selenium-webdriver/firefox.js#L34
import firefox from "selenium-webdriver/firefox"
import { createBrowserIndexHTML } from "../createBrowserIndexHTML.js"
import { openIndexServer } from "../openIndexServer/openIndexServer.js"

const clientFunction = (file, instrument, done) => {
  if (instrument) {
    window.System.import(`${file}?instrument=true`).then(
      (value) =>
        done({
          status: "resolved",
          value: { coverage: window.__coverage__, value },
        }),
      (value) => done({ status: "rejected", value }),
    )
  } else {
    window.System.import(file).then(
      (value) => done({ status: "resolved", value }),
      (value) => done({ status: "rejected", value }),
    )
  }
}

export const openFirefoxClient = ({
  server,
  headless = true,
  runFile = ({ driver, file, instrument }) => {
    return driver
      .executeScriptAsync(`(${clientFunction.toString()}.apply(this, arguments)`, file, instrument)
      .then(({ status, value }) => {
        return status === "resolved" ? value : Promise.reject(value)
      })
  },
}) => {
  const options = new firefox.Options()
  if (headless) {
    options.headless()
  }

  return new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .build()
    .then((driver) => {
      return openIndexServer({
        indexBody: createBrowserIndexHTML({
          loaderSrc: `${server.url}node_modules/@dmail/module-loader/src/browser/index.js`,
        }),
      }).then((indexRequestHandler) => {
        const execute = ({ file, autoClean = false, instrument = false }) => {
          return driver
            .get(indexRequestHandler.url)
            .then(() => runFile({ driver, file, instrument }))
            .then(({ status, value }) => {
              if (autoClean) {
                indexRequestHandler.stop()
              }

              if (status === "resolved") {
                return value
              }
              return Promise.reject(value)
            })
        }

        const close = () => {
          return driver.quit()
        }

        return { execute, close }
      })
    })
}
