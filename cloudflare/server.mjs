import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const browserHost = (
	process.env.BROWSER_HOST ?? "browser.what-the-fuck.men"
).toLowerCase();
const wispHost = (
	process.env.WISP_HOST ?? "wisp.what-the-fuck.men"
).toLowerCase();
const isolationRoot = (
	process.env.ISOLATION_ROOT ?? "what-the-fuck.men"
).toLowerCase();
const browserOrigin = `https://${browserHost}`;

const browserRoot = resolve(process.env.BROWSER_ROOT ?? "./public/browser");
const sandboxRoot = resolve(process.env.SANDBOX_ROOT ?? "./public/sandbox");

let activeWispConnections = 0;
let nextWispConnectionId = 1;

wisp.options.allow_loopback_ips = false;
wisp.options.allow_private_ips = false;

const mimeTypes = new Map([
	[".css", "text/css; charset=utf-8"],
	[".gif", "image/gif"],
	[".html", "text/html; charset=utf-8"],
	[".ico", "image/x-icon"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".js", "application/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".map", "application/json; charset=utf-8"],
	[".mjs", "application/javascript; charset=utf-8"],
	[".png", "image/png"],
	[".svg", "image/svg+xml"],
	[".txt", "text/plain; charset=utf-8"],
	[".wasm", "application/wasm"],
	[".webp", "image/webp"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
]);

function getHostname(request) {
	return (request.headers.host ?? "").split(":", 1)[0].toLowerCase();
}

function isIsolationHostname(hostname) {
	const suffix = `.${isolationRoot}`;
	if (!hostname.endsWith(suffix)) return false;

	const label = hostname.slice(0, -suffix.length);
	return /^bjs-[a-z0-9]{1,8}$/.test(label);
}

function sendText(response, statusCode, body, extraHeaders = {}) {
	response.writeHead(statusCode, {
		"Cache-Control": "no-store",
		"Content-Type": "text/plain; charset=utf-8",
		"X-Content-Type-Options": "nosniff",
		...extraHeaders,
	});
	response.end(body);
}

function sendJson(response, statusCode, value) {
	const body = JSON.stringify(value);
	response.writeHead(statusCode, {
		"Cache-Control": "no-store",
		"Content-Length": String(Buffer.byteLength(body)),
		"Content-Type": "application/json; charset=utf-8",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(body);
}

function safePath(root, pathname) {
	let decoded;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}

	if (decoded.includes("\0")) return null;

	const filePath = resolve(root, `.${decoded}`);
	if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return null;
	return filePath;
}

async function findFile(root, pathname, spaFallback) {
	const candidate = safePath(root, pathname);
	if (!candidate) return null;

	try {
		const candidateStat = await stat(candidate);
		if (candidateStat.isFile()) return { path: candidate, stat: candidateStat };
		if (candidateStat.isDirectory()) {
			const indexPath = resolve(candidate, "index.html");
			const indexStat = await stat(indexPath);
			if (indexStat.isFile()) return { path: indexPath, stat: indexStat };
		}
	} catch {
		// The optional SPA fallback below handles browser routes.
	}

	if (!spaFallback) return null;

	try {
		const indexPath = resolve(root, "index.html");
		const indexStat = await stat(indexPath);
		return indexStat.isFile() ? { path: indexPath, stat: indexStat } : null;
	} catch {
		return null;
	}
}

async function serveStatic(request, response, root, options = {}) {
	const method = request.method ?? "GET";
	if (method !== "GET" && method !== "HEAD") {
		sendText(response, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
		return;
	}

	const requestUrl = new URL(request.url ?? "/", "http://container.local");
	const acceptsHtml = (request.headers.accept ?? "").includes("text/html");
	const file = await findFile(
		root,
		requestUrl.pathname,
		Boolean(options.spaFallback && acceptsHtml),
	);

	if (!file) {
		sendText(response, 404, "Not Found\n");
		return;
	}

	const extension = extname(file.path).toLowerCase();
	const etag = `W/"${file.stat.size.toString(16)}-${Math.trunc(
		file.stat.mtimeMs,
	).toString(16)}"`;
	const isServiceWorker =
		file.path.endsWith("/sw.js") || file.path.endsWith("/controller.sw.js");
	const isHtml = extension === ".html";

	if (request.headers["if-none-match"] === etag) {
		response.writeHead(304, { ETag: etag });
		response.end();
		return;
	}

	const headers = {
		"Cache-Control":
			isHtml || isServiceWorker
				? "no-cache"
				: "public, max-age=31536000, immutable",
		"Content-Length": String(file.stat.size),
		"Content-Type":
			mimeTypes.get(extension) ?? "application/octet-stream",
		ETag: etag,
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
	};

	if (isServiceWorker) headers["Service-Worker-Allowed"] = "/";
	if (options.sandbox) headers["Cache-Control"] = "no-cache";

	response.writeHead(200, headers);
	if (method === "HEAD") {
		response.end();
		return;
	}

	const stream = createReadStream(file.path);
	stream.on("error", () => {
		if (!response.headersSent) {
			sendText(response, 500, "Internal Server Error\n");
		} else {
			response.destroy();
		}
	});
	stream.pipe(response);
}

const server = createServer((request, response) => {
	void (async () => {
		const hostname = getHostname(request);
		const pathname = new URL(
			request.url ?? "/",
			"http://container.local",
		).pathname;

		if (pathname === "/_health") {
			sendText(response, 200, "ok\n");
			return;
		}

		if (pathname === "/_activity") {
			sendJson(response, 200, { activeWispConnections });
			return;
		}

		if (hostname === browserHost) {
			await serveStatic(request, response, browserRoot, {
				spaFallback: true,
			});
			return;
		}

		if (hostname === wispHost) {
			sendText(response, 426, "WebSocket endpoint\n", {
				Upgrade: "websocket",
			});
			return;
		}

		if (isIsolationHostname(hostname)) {
			await serveStatic(request, response, sandboxRoot, { sandbox: true });
			return;
		}

		sendText(response, 421, "Unknown Host\n");
	})().catch((error) => {
		console.error("Request failed", error);
		if (!response.headersSent) {
			sendText(response, 500, "Internal Server Error\n");
		} else {
			response.destroy();
		}
	});
});

server.on("upgrade", (request, socket, head) => {
	const hostname = getHostname(request);
	const origin = request.headers.origin;

	if (hostname !== wispHost || origin !== browserOrigin) {
		socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
		socket.destroy();
		return;
	}

	const connectionId = nextWispConnectionId;
	nextWispConnectionId += 1;
	activeWispConnections += 1;

	socket.setKeepAlive(true, 30_000);
	socket.setNoDelay(true);

	console.log("Wisp connection opened", {
		connectionId,
		activeWispConnections,
	});

	let released = false;
	const releaseConnection = () => {
		if (released) return;
		released = true;
		activeWispConnections = Math.max(0, activeWispConnections - 1);
		console.log("Wisp connection closed", {
			connectionId,
			activeWispConnections,
		});
	};

	socket.once("close", releaseConnection);
	socket.once("error", releaseConnection);

	try {
		wisp.routeRequest(request, socket, head);
	} catch (error) {
		releaseConnection();
		console.error("Failed to route Wisp connection", {
			connectionId,
			error,
		});
		socket.destroy();
	}
});

server.on("clientError", (_error, socket) => {
	socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.listen(port, "0.0.0.0", () => {
	console.log(`browser.js container listening on port ${port}`);
});
