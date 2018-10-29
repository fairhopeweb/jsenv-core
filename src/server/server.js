import http from "http"
import https from "https"
import { processTeardown } from "./processTeardown.js"
import { createRequestFromNodeRequest } from "./createRequestFromNodeRequest.js"
import { populateNodeResponse } from "./populateNodeResponse.js"
import { createSignal } from "@dmail/signal"
import killPort from "kill-port"
import { URL } from "url"
import { cancellationNone } from "../cancel/index.js"

const REASON_CLOSING = "closing"

const getNodeServerAndAgent = ({ protocol, signature }) => {
  if (protocol === "http") {
    return {
      nodeServer: http.createServer(),
      agent: global.Agent,
    }
  }

  if (protocol === "https") {
    const { privateKey, certificate } = signature
    if (!privateKey || !certificate) {
      throw new Error(`missing signature for https server`)
    }

    return {
      nodeServer: https.createServer({
        key: privateKey,
        cert: certificate,
      }),
      agent: new https.Agent({
        rejectUnauthorized: false, // allow self signed certificate
      }),
    }
  }

  throw new Error(`unsupported protocol ${protocol}`)
}

const createContentLengthMismatchError = (message) => {
  const error = new Error(message)
  error.code = "CONTENT_LENGTH_MISMATCH"
  error.name = error.code
  return error
}

export const originAsString = ({ protocol, ip, port }) => {
  const url = new URL("https://127.0.0.1:80")
  url.protocol = protocol
  url.hostname = ip
  url.port = port
  return url.origin
}

export const open = (
  {
    cancellation = cancellationNone,
    protocol = "http",
    ip = "127.0.0.1",
    port = 0, // aasign a random available port
    forcePort = false,
    // when port is https you must provide { privateKey, certificate } under signature
    signature,
    // auto close the server when the process exits
    autoCloseOnExit = true,
    // auto close the server when an uncaughtException happens
    // false by default because evenwith my strategy to react on uncaughtException
    // stack trace is messed up and I don't like to have code executed on error
    autoCloseOnCrash = true,
    // auto close when server respond with a 500
    autoCloseOnError = true,
    requestToResponse = () => null,
    verbose = true,
  } = {},
) => {
  if (protocol !== "http" && protocol !== "https") {
    throw new Error(`protocol must be http or https, got ${protocol}`)
  }
  if (ip === "0.0.0.0" && process.platform === "win32") {
    // https://github.com/nodejs/node/issues/14900
    throw new Error(`listening ${ip} not available on window`)
  }
  if (port === 0 && forcePort) {
    throw new Error(`no need to pass forcePort when port is 0`)
  }

  const log = (...args) => {
    if (verbose) {
      console.log(...args)
    }
  }

  const { nodeServer, agent } = getNodeServerAndAgent({ protocol, signature })

  const connections = new Set()
  nodeServer.on("connection", (connection) => {
    connection.on("close", () => {
      connections.delete(connection)
    })
    connections.add(connection)
  })

  const requestHandlers = []
  const addInternalRequestHandler = (handler) => {
    requestHandlers.push(handler)
    nodeServer.on("request", handler)
    return () => {
      nodeServer.removeListener("request", handler)
    }
  }

  const clients = new Set()

  const closeClients = ({ isError, reason }) => {
    let status
    if (isError) {
      status = 500
      // reason = 'shutdown because error'
    } else {
      status = 503
      // reason = 'unavailable because closing'
    }

    return Promise.all(
      Array.from(clients).map(({ nodeResponse }) => {
        if (nodeResponse.headersSent === false) {
          nodeResponse.writeHead(status, reason)
        }

        return new Promise((resolve) => {
          if (nodeResponse.finished === false) {
            nodeResponse.on("finish", resolve)
            nodeResponse.on("error", resolve)
            nodeResponse.destroy(reason)
          } else {
            resolve()
          }
        })
      }),
    )
  }

  addInternalRequestHandler((nodeRequest, nodeResponse) => {
    const client = { nodeRequest, nodeResponse }

    clients.add(client)
    nodeResponse.on("finish", () => {
      clients.delete(client)
    })
  })

  // nodeServer.on("upgrade", (request, socket, head) => {
  //   // when being requested using a websocket
  //   // we could also answr to the request ?
  //   // socket.end([data][, encoding])

  //   console.log("upgrade", { head, request })
  //   console.log("socket", { connecting: socket.connecting, destroyed: socket.destroyed })
  // })

  let status = "opening"

  const listen = () => {
    return new Promise((resolve, reject) => {
      nodeServer.listen(port, ip, (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  const closed = createSignal()

  const open = () => {
    const killPortPromise = forcePort ? killPort(port) : Promise.resolve()

    return killPortPromise.then(() => listen()).then(() => {
      status = "opened"

      const origin = originAsString({
        protocol,
        ip,
        // in case port is 0 (randomly assign an available port)
        // https://nodejs.org/api/net.html#net_server_listen_port_host_backlog_callback
        port: nodeServer.address().port,
      })

      addInternalRequestHandler((nodeRequest, nodeResponse) => {
        const request = createRequestFromNodeRequest(nodeRequest, origin)
        log(`${request.method} ${origin}/${request.ressource}`)

        nodeRequest.on("error", (error) => {
          log("error on", request.ressource, error)
        })

        return Promise.resolve()
          .then(() => requestToResponse(request))
          .then(({ status = 501, reason = "not specified", headers = {}, body = "" }) =>
            Object.freeze({ status, reason, headers, body }),
          )
          .then((response) => {
            if (
              request.method !== "HEAD" &&
              response.headers["content-length"] > 0 &&
              response.body === ""
            ) {
              throw createContentLengthMismatchError(
                `content-length header is ${response.headers["content-length"]} but body is empty`,
              )
            }

            return response
          })
          .catch((error) => {
            return Object.freeze({
              status: 500,
              reason: "internal error",
              headers: {},
              body: error && error.stack ? error.stack : error,
            })
          })
          .then((response) => {
            log(`${response.status} ${origin}/${request.ressource}`)

            return populateNodeResponse(nodeResponse, response, {
              ignoreBody: request.method === "HEAD",
            })
          })
      })

      const closeConnections = (reason) => {
        // should we do this async ?
        // should we do this before closing the server ?
        connections.forEach((connection) => {
          connection.destroy(reason)
        })
      }

      let close = ({ isError = false, reason = REASON_CLOSING } = {}) => {
        if (status !== "opened") {
          throw new Error(`server status must be "opened" during close() (got ${status}`)
        }

        // ensure we don't try to handle request while server is closing
        requestHandlers.forEach((requestHandler) => {
          nodeServer.removeListener("request", requestHandler)
        })
        requestHandlers.length = 0

        status = "closing"

        return new Promise((resolve, reject) => {
          // closing server prevent it from accepting new connections
          // but opened connection must be shutdown before the close event is emitted
          nodeServer.once("close", (error) => {
            if (error) {
              reject(error)
            } else {
              resolve()
            }
          })
          nodeServer.close()
          closeClients({ isError, reason }).then(() => {
            closeConnections(reason)
          })
        }).then(() => {
          status = "closed"
          closed.emit()
        })
      }

      if (autoCloseOnError) {
        const removeAutoCloseOnError = addInternalRequestHandler((nodeRequest, nodeResponse) => {
          if (nodeResponse.statusCode === 500 && nodeResponse.statusMessage === "internal error") {
            close({
              isError: true,
              // we don't specify the true error object but only a string
              // identifying the error to avoid sending stacktrace to client
              // and right now there is no clean way to retrieve error from here
              reason: nodeResponse.statusMessage,
            })
          }
        })
        const wrappedClose = close
        close = (...args) => {
          removeAutoCloseOnError()
          return wrappedClose(...args)
        }
      }

      if (autoCloseOnExit) {
        const removeTeardown = processTeardown((exitReason) => {
          log(`close server because process will exit because ${exitReason}`)
          close({ reason: `server process exiting ${exitReason}` })
        })
        const wrappedClose = close
        close = (...args) => {
          removeTeardown()
          return wrappedClose(...args)
        }
      }

      if (autoCloseOnCrash) {
        // and if we do that we have to remove the listener
        // while closing to avoid closing twice in case
        // addNodeExceptionHandler((exception) => {
        //   return close({ reason: exception }).then(
        //     // to indicates exception is not handled
        //     () => false,
        //   )
        // })
      }

      cancellation.register(close)

      return {
        origin,
        nodeServer,
        agent,
        close,
        closed,
      }
    })
  }

  return cancellation.wrap(open)
}
