# Build stage: compile a release binary. Dependencies are built in their own layer,
# so changing the code doesn't rebuild them.
FROM rust:1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && echo "" > src/lib.rs \
 && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs src/lib.rs && cargo build --release

# Runtime stage: only the binary, no compiler, runs as a non-root user.
FROM debian:bookworm-slim
RUN useradd --system --uid 10001 app
COPY --from=build /app/target/release/pricing-engine /usr/local/bin/pricing-engine
USER app
ENV PORT=8080
EXPOSE 8080
CMD ["pricing-engine"]
