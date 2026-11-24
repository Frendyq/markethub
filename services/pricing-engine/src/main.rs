use std::time::Duration;

use pricing_engine::{AppState, app, config::Config};
use sqlx::postgres::PgPoolOptions;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(message) => {
            eprintln!("invalid configuration: {message}");
            std::process::exit(1);
        }
    };

    // Lazy pool: the service starts even if PostgreSQL is still booting; /ready tells when it can serve.
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(3))
        .connect_lazy(&config.database_url)
        .expect("DATABASE_URL is not a valid PostgreSQL URL");

    let state = AppState {
        pool,
        min_margin_percent: config.min_margin_percent,
    };
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port))
        .await
        .expect("port is busy");
    tracing::info!(port = config.port, "pricing-engine listening");

    axum::serve(listener, app(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}

/// Finish in-flight requests on Ctrl+C or SIGTERM (docker stop) before exiting.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("cannot listen for Ctrl+C");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("cannot listen for SIGTERM")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutting down");
}
