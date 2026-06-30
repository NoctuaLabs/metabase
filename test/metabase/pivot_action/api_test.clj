(ns metabase.pivot-action.api-test
  (:require
   [clj-http.client :as http]
   [clojure.test :refer :all]
   [metabase.test :as mt]))

(set! *warn-on-reflection* true)

(deftest proxy-returns-html-on-success-test
  (testing "POST /api/pivot-action/proxy forwards the payload and returns the service's HTML"
    (let [captured (atom nil)]
      (with-redefs [http/post (fn [url opts]
                                (reset! captured {:url url :opts opts})
                                {:status 200 :body "<h1>ok</h1>"})]
        (let [resp (mt/user-http-request :rasta :post 200 "pivot-action/proxy"
                                         {:url "http://example.com/predict"
                                          :payload {:row {:country "Indonesia"}
                                                    :filters {:region "APAC"}}})]
          (is (= "<h1>ok</h1>" (if (map? resp) (:body resp) resp)))
          (is (= "http://example.com/predict" (:url @captured)))
          ;; payload is JSON-encoded into the request body
          (is (re-find #"Indonesia" (get-in @captured [:opts :body]))))))))

(deftest proxy-maps-non-2xx-to-400-test
  (testing "a non-2xx response from the service becomes a 400 that echoes the upstream status and body"
    (with-redefs [http/post (fn [_ _] {:status 500 :body "boom: NullPointerException at line 42"})]
      ;; defendpoint returns the ex-message as the (string) response body for a 400.
      (let [message (mt/user-http-request :rasta :post 400 "pivot-action/proxy"
                                          {:url "http://example.com/predict"
                                           :payload {:row {}}})]
        (is (string? message))
        (is (re-find #"500" message))
        (is (re-find #"NullPointerException" message))))))

(deftest proxy-maps-connection-error-to-400-test
  (testing "a thrown connection error becomes a 400 that includes the exception message"
    (with-redefs [http/post (fn [_ _] (throw (java.net.ConnectException. "Connection refused")))]
      (let [message (mt/user-http-request :rasta :post 400 "pivot-action/proxy"
                                          {:url "http://example.com/predict"
                                           :payload {:row {}}})]
        (is (re-find #"Connection refused" message))))))

(deftest proxy-requires-url-test
  (testing "a blank url is rejected by the schema"
    (mt/user-http-request :rasta :post 400 "pivot-action/proxy"
                          {:url "" :payload {:row {}}})))

(deftest proxy-requires-auth-test
  (testing "the endpoint requires authentication"
    (is (= "Unauthenticated"
           (mt/client :post 401 "pivot-action/proxy"
                      {:url "http://example.com/predict" :payload {}})))))

;;; ------------------------------------- embed endpoint -------------------------------------
;;; Static/public embeds rewrite `/api/...` requests to `/api/embed/...`, so the proxy is also
;;; exposed (unauthenticated) under `/api/embed/pivot-action/proxy`, gated on static embedding.

(deftest embed-proxy-returns-html-when-embedding-enabled-test
  (testing "POST /api/embed/pivot-action/proxy works without auth when static embedding is enabled"
    (mt/with-temporary-setting-values [enable-embedding-static true]
      (with-redefs [http/post (fn [_ _] {:status 200 :body "<h1>ok</h1>"})]
        (let [resp (mt/client :post 200 "embed/pivot-action/proxy"
                              {:url "http://example.com/predict"
                               :payload {:row {:country "Indonesia"}}})]
          (is (= "<h1>ok</h1>" (if (map? resp) (:body resp) resp))))))))

(deftest embed-proxy-blocked-when-embedding-disabled-test
  (testing "the embed endpoint is blocked when static embedding is disabled"
    (mt/with-temporary-setting-values [enable-embedding-static false]
      (with-redefs [http/post (fn [_ _] {:status 200 :body "<h1>ok</h1>"})]
        (mt/client :post 400 "embed/pivot-action/proxy"
                   {:url "http://example.com/predict" :payload {}})))))
