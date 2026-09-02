FROM node:24-bookworm AS builder

ARG WASM_BINDGEN_VERSION=0.2.105
ARG BINARYEN_VERSION=version_124

ENV CI=1
ENV PATH=/root/.cargo/bin:/opt/binaryen/bin:${PATH}

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential \
		ca-certificates \
		curl \
		git \
		pkg-config \
		libssl-dev \
		xz-utils \
	&& rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
	| sh -s -- -y --profile minimal --default-toolchain nightly \
	&& rustup component add rust-src --toolchain nightly \
	&& rustup target add wasm32-unknown-unknown --toolchain nightly

RUN cargo install wasm-bindgen-cli \
		--version "${WASM_BINDGEN_VERSION}" \
		--locked \
	&& cargo install \
		--git https://github.com/r58playz/wasm-snip

RUN curl -fsSL \
		"https://github.com/WebAssembly/binaryen/releases/download/${BINARYEN_VERSION}/binaryen-${BINARYEN_VERSION}-x86_64-linux.tar.gz" \
		-o /tmp/binaryen.tar.gz \
	&& mkdir -p /opt/binaryen \
	&& tar -xzf /tmp/binaryen.tar.gz \
		--strip-components=1 \
		-C /opt/binaryen \
	&& rm /tmp/binaryen.tar.gz

COPY . .

# Workers Builds may check out git submodules as empty directories.
RUN if [ ! -f external/dreamlandjs/package.json ]; then \
		rm -rf external/dreamlandjs; \
		git clone https://github.com/MercuryWorkshop/dreamlandjs external/dreamlandjs; \
		git -C external/dreamlandjs checkout 44f8a9033a1244606ae3d4eb9400386c3c3b3cda; \
	fi

RUN corepack enable \
	&& corepack prepare pnpm@10.12.1 --activate \
	&& pnpm install --frozen-lockfile

RUN pnpm build:dreamland
RUN RELEASE=1 pnpm rewriter:build
RUN pnpm build \
	&& SKIP_CORE=1 pnpm build
RUN node cloudflare/patch-source.mjs
RUN VITE_WISP_URL="wss://wisp.what-the-fuck.men/" \
	VITE_ISOLATION_ORIGIN="https://what-the-fuck.men" \
	pnpm build:chrome

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080
ENV BROWSER_HOST=browser.what-the-fuck.men
ENV WISP_HOST=wisp.what-the-fuck.men
ENV ISOLATION_ROOT=what-the-fuck.men

WORKDIR /app

COPY cloudflare/package.json ./package.json
COPY cloudflare/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --no-audit --no-fund \
	&& npm cache clean --force

COPY --from=builder /app/packages/chrome/dist ./public/browser
COPY --from=builder /app/packages/sandbox ./public/sandbox
COPY cloudflare/server.mjs ./server.mjs

USER node

EXPOSE 8080

CMD ["node", "server.mjs"]
