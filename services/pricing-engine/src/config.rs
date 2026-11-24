use std::env;
use std::str::FromStr;

use rust_decimal::Decimal;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub min_margin_percent: Decimal,
}

impl Config {
    /// Reads the environment once at startup and fails fast on bad values.
    pub fn from_env() -> Result<Self, String> {
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".into())
            .parse()
            .map_err(|_| "PORT must be a number".to_string())?;
        let database_url =
            env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is required".to_string())?;
        let min_margin_percent =
            Decimal::from_str(&env::var("MIN_MARGIN_PERCENT").unwrap_or_else(|_| "10".into()))
                .map_err(|_| "MIN_MARGIN_PERCENT must be a decimal".to_string())?;
        Ok(Self {
            port,
            database_url,
            min_margin_percent,
        })
    }
}
