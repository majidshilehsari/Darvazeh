FROM debian:bookworm-slim
ENV XRAY_VERSION=26.3.27
ARG TARGETARCH=amd64
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip nginx python3 python3-maxminddb tini && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in amd64) ARCH=64; SHA=23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae ;; arm64) ARCH=arm64-v8a; SHA=4d30283ae614e3057f730f67cd088a42be6fdf91f8639d82cb69e48cde80413c ;; *) exit 1 ;; esac && \
    curl -fL --retry 3 "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-${ARCH}.zip" -o /tmp/xray.zip && \
    echo "$SHA  /tmp/xray.zip" | sha256sum -c - && \
    unzip /tmp/xray.zip -d /opt/xray && ln -s /opt/xray/xray /usr/local/bin/xray && rm /tmp/xray.zip
ENV XRAY_LOCATION_ASSET=/opt/xray
WORKDIR /app
COPY app/ /app/
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh && mkdir -p /data && chmod 700 /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=3)" || exit 1
ENTRYPOINT ["/usr/bin/tini","-g","--","/app/start.sh"]
