/* global require */

const { createCancellationSource } = require("@jsenv/cancellation")
const { uneval } = require("@jsenv/uneval")

const makeProcessControllable = ({ evaluate }) => {
  const processCancellationSource = createCancellationSource()

  const EVALUATION_STATUS_OK = "evaluation-ok"
  const EVALUATION_STATUS_ERROR = "evaluation-error"

  const removeSIGTERMListener = onceSIGTERM(() => {
    // cancel will remove listener to process.on('message')
    // which is sufficient to let child process die
    // assuming nothing else keeps it alive
    processCancellationSource.cancel("process received SIGTERM")
  })

  // ensure this process does not stay alive when it is disconnected
  onceProcessDisconnect(() => {
    processCancellationSource.cancel("process disconnected")
    process.exit()
  })

  processCancellationSource.token.register(removeSIGTERMListener)
  const removeEvaluateRequestListener = onceProcessMessage("evaluate", async (expressionString) => {
    try {
      const value = await evaluate(expressionString)
      sendToParent(
        "evaluate-result",
        // here we use JSON.stringify because we should not
        // have non enumerable value (unlike there is on Error objects)
        // otherwise uneval is quite slow to turn a giant object
        // into a string (and value can be giant when using coverage)
        JSON.stringify({
          status: EVALUATION_STATUS_OK,
          value,
        }),
      )
    } catch (e) {
      sendToParent(
        "evaluate-result",
        // process.send algorithm does not send non enumerable values
        // because it works with JSON.stringify I guess so use uneval
        uneval({
          status: EVALUATION_STATUS_ERROR,
          value: e,
        }),
      )
    }
  })
  processCancellationSource.token.register(removeEvaluateRequestListener)

  const sendToParent = (type, data) => {
    // https://nodejs.org/api/process.html#process_process_connected
    // not connected anymore, cannot communicate with parent
    if (!process.connected) {
      throw new Error("cannot send response because process not connected to parent")
    }

    // this can keep process alive longer than expected
    // when source is a long string.
    // It means node process may stay alive longer than expected
    // the time to send the data to the parent.
    process.send({
      type,
      data,
    })
  }

  setTimeout(() => sendToParent("ready"))
}

const onceProcessMessage = (type, callback) => {
  const listener = (event) => {
    if (event.type === type) {
      // commenting line below keep this process alive
      removeListener()
      // eslint-disable-next-line no-eval
      callback(eval(`(${event.data})`))
    }
  }

  const removeListener = () => {
    process.removeListener("message", listener)
  }

  process.on("message", listener)
  return removeListener
}

const onceSIGTERM = (callback) => {
  process.once("SIGTERM", callback)
  return () => {
    process.removeListener("SIGTERM", callback)
  }
}

const onceProcessDisconnect = (callback) => {
  process.once("disconnect", callback)
  return () => {
    process.removeListener("disconnect", callback)
  }
}

exports.makeProcessControllable = makeProcessControllable
