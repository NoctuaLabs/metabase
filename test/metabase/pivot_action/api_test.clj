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
  (testing "a non-2xx response from the service becomes a 400"
    (with-redefs [http/post (fn [_ _] {:status 502 :body "bad gateway"})]
      (mt/user-http-request :rasta :post 400 "pivot-action/proxy"
                            {:url "http://example.com/predict"
                             :payload {:row {}}}))))

(deftest proxy-maps-connection-error-to-400-test
  (testing "a thrown connection error becomes a 400"
    (with-redefs [http/post (fn [_ _] (throw (java.net.ConnectException. "refused")))]
      (mt/user-http-request :rasta :post 400 "pivot-action/proxy"
                            {:url "http://example.com/predict"
                             :payload {:row {}}}))))

(deftest proxy-requires-url-test
  (testing "a blank url is rejected by the schema"
    (mt/user-http-request :rasta :post 400 "pivot-action/proxy"
                          {:url "" :payload {:row {}}})))

(deftest proxy-requires-auth-test
  (testing "the endpoint requires authentication"
    (is (= "Unauthenticated"
           (mt/client :post 401 "pivot-action/proxy"
                      {:url "http://example.com/predict" :payload {}})))))
