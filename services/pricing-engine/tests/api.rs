//! HTTP tests of the router. Most need no database: the pool is lazy and these routes never touch it.
//! The price test needs PostgreSQL with the MarketHub schema: set PRICING_TEST_DATABASE_URL to run it.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use pricing_engine::{AppState, app};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

fn state(url: &str) -> AppState {
    let pool = PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(500))
        .connect_lazy(url)
        .unwrap();
    AppState {
        pool,
        min_margin_percent: Decimal::TEN,
    }
}

fn offline() -> AppState {
    state("postgres://nobody:nothing@127.0.0.1:1/none")
}

async fn send(state: AppState, request: Request<Body>) -> (StatusCode, Value) {
    let response = app(state).oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

fn post_json(uri: &str, body: Value) -> Request<Body> {
    Request::post(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn health_answers_without_the_database() {
    let (status, body) = send(
        offline(),
        Request::get("/health").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "status": "ok" }));
}

#[tokio::test]
async fn ready_reports_a_missing_database() {
    let (status, body) = send(
        offline(),
        Request::get("/ready").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["database"], "down");
}

#[tokio::test]
async fn validates_a_price_list_over_http() {
    let csv = "sku,title,category,cost_price,base_price,weight_kg,width_cm,height_cm,depth_cm\n\
               TAB-A,Table,tables,100,200,20,120,75,70\n\
               TAB-B,,tables,100,50,20,120,75,70\n";
    let request = Request::post("/feeds/validate")
        .header("content-type", "text/csv")
        .body(Body::from(csv))
        .unwrap();
    let (status, body) = send(offline(), request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["totalRows"], 2);
    assert_eq!(body["validRows"], 1);
    assert_eq!(body["rows"][0]["basePrice"], "200.00");
    assert_eq!(body["errors"][0]["line"], 3);
}

#[tokio::test]
async fn rejects_a_price_list_without_required_columns() {
    let request = Request::post("/feeds/validate")
        .body(Body::from("sku,title\nA,B\n"))
        .unwrap();
    let (status, body) = send(offline(), request).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Bad Request");
}

#[tokio::test]
async fn rejects_an_empty_batch_before_touching_the_database() {
    let (status, body) = send(
        offline(),
        post_json(
            "/prices/calculate",
            json!({ "marketplace": "otto", "items": [] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["message"].as_str().unwrap().contains("items"));
}

#[tokio::test]
async fn hides_database_errors_from_the_client() {
    let items = json!([{ "sku": "A", "basePrice": "10", "costPrice": "5" }]);
    let (status, body) = send(
        offline(),
        post_json(
            "/prices/calculate",
            json!({ "marketplace": "otto", "items": items }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["message"], "Internal server error");
}

#[tokio::test]
async fn calculates_prices_from_the_marketplace_terms_in_the_database() {
    let Ok(url) = std::env::var("PRICING_TEST_DATABASE_URL") else {
        eprintln!("skipped: PRICING_TEST_DATABASE_URL is not set");
        return;
    };
    let items = json!([{ "sku": "SOF-OSLO-GRY", "basePrice": "899.00", "costPrice": "410.00" }]);
    let (status, body) = send(
        state(&url),
        post_json(
            "/prices/calculate",
            json!({ "marketplace": "ebay", "items": items }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["currency"], "USD");
    assert_eq!(body["items"][0]["sku"], "SOF-OSLO-GRY");

    let (status, _) = send(
        state(&url),
        post_json(
            "/prices/calculate",
            json!({ "marketplace": "nope", "items": items }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
