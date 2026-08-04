
FROM python:3.13-slim

# Install Java (needed for your preview JARs) and Tailscale (only used if
# TAILSCALE_SERVER_AUTHKEY is set at runtime — see docker-entrypoint.sh;
# harmless to have installed either way, it just won't be started). Using
# Tailscale's own install script rather than hand-pinning an apt repo to a
# Debian codename, since that codename needs to match whatever this base
# image is actually built on and would silently break on a base image bump.
RUN apt-get update && \
    apt-get install -y default-jre curl && \
    curl -fsSL https://tailscale.com/install.sh | sh && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x docker-entrypoint.sh

EXPOSE 5000

CMD ["./docker-entrypoint.sh"]
