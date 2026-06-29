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

(defn- post-to-action-service
  "POSTs `payload` (a map) as JSON to `url` and returns the response body string when the service
  answers with a 2xx status. Throws a 400 ex-info otherwise."
  [url payload]
  (let [resp (try
               (http/post url {:body               (json/encode payload)
                               :content-type       :json
                               :accept             "text/html"
                               :as                 :string
                               :socket-timeout     timeout-ms
                               :connection-timeout timeout-ms
                               :throw-exceptions   false})
               (catch Throwable _
                 (throw (ex-info (tru "Custom action request failed") {:status-code 400}))))]
    (if (<= 200 (:status resp) 299)
      (:body resp)
      (throw (ex-info (tru "Custom action service returned status {0}" (:status resp))
                      {:status-code 400})))))

#_{:clj-kondo/ignore [:metabase/validate-defendpoint-has-response-schema]}
(api.macros/defendpoint :post "/proxy"
  "Proxy a pivot-table custom action: POST `payload` to `url` and return the HTML the service
  responds with. Used by the pivot table \"Custom Action\" feature so requests can reach
  non-HTTPS services without browser mixed-content / CORS issues."
  [_route-params
   _query-params
   {:keys [url payload]} :- [:map
                             [:url     ms/NonBlankString]
                             [:payload [:maybe :map]]]]
  {:status  200
   :headers {"Content-Type" "text/html; charset=utf-8"}
   :body    (post-to-action-service url (or payload {}))})
