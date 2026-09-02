# Cloudflare deployment

This overlay deploys browser.js with one Cloudflare Worker and one Container.

## Hostnames

- `browser.what-the-fuck.men`: browser UI
- `wisp.what-the-fuck.men`: Wisp WebSocket endpoint
- `bjs-<site-hash>.what-the-fuck.men`: isolated site controller

The isolation controller intentionally uses one-level subdomains so Cloudflare's
standard `*.what-the-fuck.men` edge certificate can cover them.

## Before the first deployment

Create this DNS record in the `what-the-fuck.men` zone:

| Type | Name | Content | Proxy status |
| --- | --- | --- | --- |
| A | `*` | `192.0.2.0` | Proxied |

The address is a reserved documentation address. Requests matching the Worker
route are handled by Cloudflare and do not reach it.

If the zone already has a wildcard DNS record, keep the existing record and
make sure it is proxied. Exact DNS records continue to override the wildcard.

## Workers Builds settings

Connect the fork in **Workers & Pages**, then use:

- Production branch: `main`
- Root directory: `/`
- Build command: `true`
- Deploy command: `pnpm deploy:cloudflare`

The first container image build compiles the Rust/Wasm rewriter and can take a
while. After deployment, container provisioning can take several additional
minutes.

## Access protection

Do not leave the Wisp endpoint open for public use. Configure Cloudflare Access
for the browser and Wisp hostnames before sharing the deployment. The runtime
also rejects loopback/private-network targets and only accepts browser-origin
WebSocket handshakes, but those checks are not a replacement for authentication.

## Health check

Open `https://browser.what-the-fuck.men/_health`. A healthy running container
returns `ok`.
