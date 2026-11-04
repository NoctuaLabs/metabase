(ns metabase.pivot-action.api
  "Proxy endpoint for pivot-table \"Custom Action\" buttons. The pivot table viz lets a user
  configure an action (e.g. \"Predict\") with a POST URL; right-clicking a row sends that row's
  data here, and we forward it to the configured service. The request is proxied through the
  backend (rather than `fetch`ed directly from the browser) because the target service may be
  plain HTTP, which a browser on an HTTPS Metabase page would block as mixed content, and to
  avoid CORS restrictions. The service is expected to return an HTML fragment which we pass back
  to the frontend to render."
  (:require
   [clj-http.client :as http]
   [metabase.api.macros :as api.macros]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.json :as json]
   [metabase.util.malli.schema :as ms]))

(set! *warn-on-reflection* true)

(def ^:private timeout-ms 15000)

(def ^:private max-error-body-length
  "Cap on how much of the upstream error body we echo back, to avoid returning an
  unbounded response in an error message."
  4000)

(defn post-to-action-service
  "POSTs `payload` (a map) as JSON to `url` and returns the response body string when the service
  answers with a 2xx status. On a non-2xx response or a connection failure, throws a 400 ex-info
  whose message includes the upstream status and (truncated) response body / exception message, so
  the frontend can surface the raw error from the service. Shared by the authenticated `/api` and
  the embed `/api/embed` proxy endpoints."
  [url payload]
  (let [resp (try
               (http/post url {:body               (json/encode payload)
                               :content-type       :json
                               :accept             "text/html"
                               :as                 :string
                               :socket-timeout     timeout-ms
                               :connection-timeout timeout-ms
                               :throw-exceptions   false})
               (catch Throwable e
                 (throw (ex-info (tru "Custom action request failed: {0}" (ex-message e))
                                 {:status-code 400}))))]
    (if (<= 200 (:status resp) 299)
      (:body resp)
      (let [body (some-> (:body resp) str (subs 0 (min max-error-body-length (count (str (:body resp))))))]
        (throw (ex-info (tru "Custom action service returned status {0}: {1}"
                             (:status resp)
                             (or (not-empty body) (tru "(no response body)")))
                        {:status-code 400}))))))

(def request-schema
  "Malli schema for the proxy request body. Shared with the embed endpoint."
  [:map
   [:url     ms/NonBlankString]
   [:payload [:maybe :map]]])

(defn proxy-response
  "Builds the Ring response for a custom-action proxy request: POST `payload` to `url` and return
  the service's response as `text/html`. Shared by the authenticated and embed endpoints."
  [url payload]
  {:status  200
   :headers {"Content-Type" "text/html; charset=utf-8"}
   :body    (post-to-action-service url (or payload {}))})

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :post "/proxy"
  "Proxy a pivot-table custom action: POST `payload` to `url` and return the HTML the service
  responds with. Used by the pivot table \"Custom Action\" feature so requests can reach
  non-HTTPS services without browser mixed-content / CORS issues."
  [_route-params
   _query-params
   {:keys [url payload]} :- request-schema]
  (proxy-response url payload))
