import { urlHotMetas } from "./import_meta_hot.js";
import { parseSrcSet, stringifySrcSet } from "@jsenv/ast/src/html/html_src_set.js";

/* eslint-env browser */
const createEventSourceConnection = (eventSourceUrl, events = {}, {
  retryMaxAttempt = Infinity,
  retryAllocatedMs = Infinity,
  lastEventId
} = {}) => {
  const {
    EventSource
  } = window;

  if (typeof EventSource !== "function") {
    return () => {};
  }

  const eventSourceOrigin = new URL(eventSourceUrl).origin;
  Object.keys(events).forEach(eventName => {
    const eventCallback = events[eventName];

    events[eventName] = e => {
      if (e.origin === eventSourceOrigin) {
        if (e.lastEventId) {
          lastEventId = e.lastEventId;
        }

        eventCallback(e);
      }
    };
  });
  const status = {
    value: "default",
    goTo: value => {
      if (value === status.value) {
        return;
      }

      status.value = value;
      status.onchange();
    },
    onchange: () => {}
  };

  let _disconnect = () => {};

  const attemptConnection = url => {
    const eventSource = new EventSource(url, {
      withCredentials: true
    });

    _disconnect = () => {
      if (status.value !== "connecting" && status.value !== "connected") {
        console.warn(`disconnect() ignored because connection is ${status.value}`);
        return;
      }

      eventSource.onerror = undefined;
      eventSource.close();
      Object.keys(events).forEach(eventName => {
        eventSource.removeEventListener(eventName, events[eventName]);
      });
      status.goTo("disconnected");
    };

    let retryCount = 0;
    let firstRetryMs = Date.now();

    eventSource.onerror = errorEvent => {
      if (errorEvent.target.readyState === EventSource.CONNECTING) {
        if (retryCount > retryMaxAttempt) {
          console.info(`could not connect after ${retryMaxAttempt} attempt`);

          _disconnect();

          return;
        }

        if (retryCount === 0) {
          firstRetryMs = Date.now();
        } else {
          const allRetryDuration = Date.now() - firstRetryMs;

          if (retryAllocatedMs && allRetryDuration > retryAllocatedMs) {
            console.info(`could not connect in less than ${retryAllocatedMs} ms`);

            _disconnect();

            return;
          }
        }

        retryCount++;
        status.goTo("connecting");
        return;
      }

      if (errorEvent.target.readyState === EventSource.CLOSED) {
        _disconnect();

        return;
      }
    };

    eventSource.onopen = () => {
      status.goTo("connected");
    };

    Object.keys(events).forEach(eventName => {
      eventSource.addEventListener(eventName, events[eventName]);
    });

    if (!events.hasOwnProperty("welcome")) {
      eventSource.addEventListener("welcome", e => {
        if (e.origin === eventSourceOrigin && e.lastEventId) {
          lastEventId = e.lastEventId;
        }
      });
    }

    status.goTo("connecting");
  };

  let connect = () => {
    attemptConnection(eventSourceUrl);

    connect = () => {
      attemptConnection(lastEventId ? addLastEventIdIntoUrlSearchParams(eventSourceUrl, lastEventId) : eventSourceUrl);
    };
  };

  const removePageUnloadListener = listenPageUnload(() => {
    if (status.value === "connecting" || status.value === "connected") {
      _disconnect();
    }
  });

  const destroy = () => {
    removePageUnloadListener();

    _disconnect();
  };

  return {
    status,
    connect,
    disconnect: () => _disconnect(),
    destroy
  };
};

const addLastEventIdIntoUrlSearchParams = (url, lastEventId) => {
  if (url.indexOf("?") === -1) {
    url += "?";
  } else {
    url += "&";
  }

  return `${url}last-event-id=${encodeURIComponent(lastEventId)}`;
}; // const listenPageMightFreeze = (callback) => {
//   const removePageHideListener = listenEvent(window, "pagehide", (pageHideEvent) => {
//     if (pageHideEvent.persisted === true) {
//       callback(pageHideEvent)
//     }
//   })
//   return removePageHideListener
// }
// const listenPageFreeze = (callback) => {
//   const removeFreezeListener = listenEvent(document, "freeze", (freezeEvent) => {
//     callback(freezeEvent)
//   })
//   return removeFreezeListener
// }
// const listenPageIsRestored = (callback) => {
//   const removeResumeListener = listenEvent(document, "resume", (resumeEvent) => {
//     removePageshowListener()
//     callback(resumeEvent)
//   })
//   const removePageshowListener = listenEvent(window, "pageshow", (pageshowEvent) => {
//     if (pageshowEvent.persisted === true) {
//       removePageshowListener()
//       removeResumeListener()
//       callback(pageshowEvent)
//     }
//   })
//   return () => {
//     removeResumeListener()
//     removePageshowListener()
//   }
// }


const listenPageUnload = callback => {
  const removePageHideListener = listenEvent(window, "pagehide", pageHideEvent => {
    if (pageHideEvent.persisted !== true) {
      callback(pageHideEvent);
    }
  });
  return removePageHideListener;
};

const listenEvent = (emitter, event, callback) => {
  emitter.addEventListener(event, callback);
  return () => {
    emitter.removeEventListener(event, callback);
  };
};

const isAutoreloadEnabled = () => {
  const value = window.localStorage.getItem("autoreload");

  if (value === "0") {
    return false;
  }

  return true;
};
const setAutoreloadPreference = value => {
  window.localStorage.setItem("autoreload", value ? "1" : "0");
};

const compareTwoUrlPaths = (url, otherUrl) => {
  if (url === otherUrl) {
    return true;
  }

  const urlObject = new URL(url);
  const otherUrlObject = new URL(otherUrl);
  return urlObject.origin === otherUrlObject.origin && urlObject.pathname === otherUrlObject.pathname;
};
const injectQuery = (url, query) => {
  const urlObject = new URL(url);
  const {
    searchParams
  } = urlObject;
  Object.keys(query).forEach(key => {
    searchParams.set(key, query[key]);
  });
  return String(urlObject);
};

const reloadHtmlPage = () => {
  window.location.reload(true);
}; // This function can consider everything as hot reloadable:
// - no need to check [hot-accept]and [hot-decline] attributes for instance
// This is because if something should full reload, we receive "full_reload"
// from server and this function is not called

const reloadDOMNodesUsingUrl = urlToReload => {
  const mutations = [];

  const shouldReloadUrl = urlCandidate => {
    return compareTwoUrlPaths(urlCandidate, urlToReload);
  };

  const visitNodeAttributeAsUrl = (node, attributeName) => {
    let attribute = node[attributeName];

    if (!attribute) {
      return;
    }

    if (SVGAnimatedString && attribute instanceof SVGAnimatedString) {
      attribute = attribute.animVal;
    }

    if (!shouldReloadUrl(attribute)) {
      return;
    }

    mutations.push(() => {
      node[attributeName] = injectQuery(attribute, {
        hmr: Date.now()
      });
    });
  };

  Array.from(document.querySelectorAll(`link[rel="stylesheet"]`)).forEach(link => {
    visitNodeAttributeAsUrl(link, "href");
  });
  Array.from(document.querySelectorAll(`link[rel="icon"]`)).forEach(link => {
    visitNodeAttributeAsUrl(link, "href");
  });
  Array.from(document.querySelector("script")).forEach(script => {
    visitNodeAttributeAsUrl(script, "src");
  }); // There is no real need to update a.href because the ressource will be fetched when clicked.
  // But in a scenario where the ressource was already visited and is in browser cache, adding
  // the dynamic query param ensure the cache is invalidated

  Array.from(document.querySelectorAll("a")).forEach(a => {
    visitNodeAttributeAsUrl(a, "href");
  }); // About iframes:
  // - By default iframe itself and everything inside trigger a parent page full-reload
  // - Adding [hot-accept] on the iframe means parent page won't reload when iframe full/hot reload
  //   In that case and if there is code in the iframe and parent doing post message communication:
  //   you must put import.meta.hot.decline() for code involved in communication.
  //   (both in parent and iframe)

  Array.from(document.querySelectorAll("img")).forEach(img => {
    visitNodeAttributeAsUrl(img, "src");
    const srcset = img.srcset;

    if (srcset) {
      const srcCandidates = parseSrcSet(srcset);
      srcCandidates.forEach(srcCandidate => {
        const url = new URL(srcCandidate.specifier, `${window.location.href}`);

        if (shouldReloadUrl(url)) {
          srcCandidate.specifier = injectQuery(url, {
            hmr: Date.now()
          });
        }
      });
      mutations.push(() => {
        img.srcset = stringifySrcSet(srcCandidates);
      });
    }
  });
  Array.from(document.querySelectorAll("source")).forEach(source => {
    visitNodeAttributeAsUrl(source, "src");
  }); // svg image tag

  Array.from(document.querySelectorAll("image")).forEach(image => {
    visitNodeAttributeAsUrl(image, "href");
  }); // svg use

  Array.from(document.querySelectorAll("use")).forEach(use => {
    visitNodeAttributeAsUrl(use, "href");
  });
  mutations.forEach(mutation => {
    mutation();
  });
};
const reloadJsImport = async url => {
  const urlWithHmr = injectQuery(url, {
    hmr: Date.now()
  });
  const namespace = await import(urlWithHmr);
  return namespace;
};

const reloadMessages = [];
const reloadMessagesSignal = {
  onchange: () => {}
};
let pendingCallbacks = [];
let running = false;

const addToHotQueue = async callback => {
  pendingCallbacks.push(callback);
  dequeue();
};

const dequeue = async () => {
  if (running) {
    return;
  }

  const callbacks = pendingCallbacks.slice();
  pendingCallbacks = [];
  running = true;

  try {
    await callbacks.reduce(async (previous, callback) => {
      await previous;
      await callback();
    }, Promise.resolve());
  } finally {
    running = false;

    if (pendingCallbacks.length) {
      dequeue();
    }
  }
};

const applyReloadMessageEffects = async () => {
  const someEffectIsFullReload = reloadMessages.some(reloadMessage => reloadMessage.type === "full");

  if (someEffectIsFullReload) {
    reloadHtmlPage();
    return;
  }

  const onApplied = reloadMessage => {
    const index = reloadMessages.indexOf(reloadMessage);
    reloadMessages.splice(index, 1);
    reloadMessagesSignal.onchange();
  };

  const setReloadMessagePromise = (reloadMessage, promise) => {
    reloadMessage.status = "pending";
    promise.then(() => {
      onApplied(reloadMessage);
    }, e => {
      // TODO: reuse error display from html supervisor
      console.error(e);
      console.error(`[hmr] Failed to reload after ${reloadMessage.reason}.
This could be due to syntax errors or importing non-existent modules (see errors above)`);
      reloadMessage.status = "failed";
      reloadMessagesSignal.onchange();
    });
  };

  reloadMessages.forEach(reloadMessage => {
    if (reloadMessage.type === "hot") {
      const promise = addToHotQueue(() => {
        return applyHotReload(reloadMessage);
      });
      setReloadMessagePromise(reloadMessage, promise);
    } else {
      setReloadMessagePromise(reloadMessage, Promise.resolve());
    }
  });
  reloadMessagesSignal.onchange(); // reload status is "pending"
};

const applyHotReload = async ({
  hotInstructions
}) => {
  await hotInstructions.reduce(async (previous, {
    type,
    boundary,
    acceptedBy
  }) => {
    await previous;
    const urlToFetch = new URL(boundary, `${window.location.origin}/`).href;
    const urlHotMeta = urlHotMetas[urlToFetch]; // TODO: we should return when there is no url hot meta because
    // it means code was not executed (code splitting with dynamic import)
    // if (!urlHotMeta) {return }

    if (type === "prune") {
      console.groupCollapsed(`[jsenv] prune: ${boundary} (inside ${acceptedBy})`);
    } else if (acceptedBy === boundary) {
      console.groupCollapsed(`[jsenv] hot reloading: ${boundary}`);
    } else {
      console.groupCollapsed(`[jsenv] hot reloading: ${acceptedBy} inside ${boundary}`);
    }

    if (urlHotMeta && urlHotMeta.disposeCallback) {
      console.log(`call dispose callback`);
      await urlHotMeta.disposeCallback();
    }

    if (type === "prune") {
      delete urlHotMetas[urlToFetch];
      console.log(`cleanup pruned url`);
      console.groupEnd();
      return null;
    }

    if (type === "js_module") {
      console.log(`importing js module`);
      const namespace = await reloadJsImport(urlToFetch);

      if (urlHotMeta && urlHotMeta.acceptCallback) {
        await urlHotMeta.acceptCallback(namespace);
      }

      console.log(`js module import done`);
      console.groupEnd();
      return namespace;
    }

    if (type === "html") {
      if (!compareTwoUrlPaths(urlToFetch, window.location.href)) {
        // we are not in that HTML page
        return null;
      }

      console.log(`reloading url`);
      const urlToReload = new URL(acceptedBy, `${window.location.origin}/`).href;
      reloadDOMNodesUsingUrl(urlToReload);
      console.log(`url reloaded`);
      console.groupEnd();
      return null;
    }

    console.warn(`unknown update type: "${type}"`);
    return null;
  }, Promise.resolve());
};

const addReloadMessage = reloadMessage => {
  reloadMessages.push(reloadMessage);

  if (isAutoreloadEnabled()) {
    applyReloadMessageEffects();
  } else {
    reloadMessagesSignal.onchange();
  }
};

const eventsourceConnection = createEventSourceConnection(document.location.href, {
  reload: ({
    data
  }) => {
    const reloadMessage = JSON.parse(data);
    addReloadMessage(reloadMessage);
  }
}, {
  retryMaxAttempt: Infinity,
  retryAllocatedMs: 20 * 1000
});
const {
  status,
  connect,
  disconnect
} = eventsourceConnection;
connect();
window.__jsenv_event_source_client__ = {
  status,
  connect,
  disconnect,
  isAutoreloadEnabled,
  setAutoreloadPreference,
  urlHotMetas,
  reloadMessages,
  reloadMessagesSignal,
  applyReloadMessageEffects,
  addReloadMessage
}; // const findHotMetaUrl = (originalFileRelativeUrl) => {
//   return Object.keys(urlHotMetas).find((compileUrl) => {
//     return (
//       parseCompiledUrl(compileUrl).fileRelativeUrl === originalFileRelativeUrl
//     )
//   })
// }
