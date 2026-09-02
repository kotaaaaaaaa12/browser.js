import { Container, getContainer } from "@cloudflare/containers";

const rootDomain = "what-the-fuck.men";
const browserHost = `browser.${rootDomain}`;
const wispHost = `wisp.${rootDomain}`;
const isolationSuffix = `.${rootDomain}`;

function isIsolationHostname(hostname) {
	if (!hostname.endsWith(isolationSuffix)) return false;

	const label = hostname.slice(0, -isolationSuffix.length);
	return /^bjs-[a-z0-9]{1,8}$/.test(label);
}

export class BrowserContainer extends Container {
	defaultPort = 8080;
	sleepAfter = "10m";
	envVars = {
		BROWSER_HOST: browserHost,
		WISP_HOST: wispHost,
		ISOLATION_ROOT: rootDomain,
		PORT: "8080",
	};

	onError(error) {
		console.error("Container error", error);
	}
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const hostname = url.hostname.toLowerCase();

		if (hostname.endsWith(".workers.dev")) {
			return Response.redirect(
				`https://${browserHost}${url.pathname}${url.search}`,
				302,
			);
		}

		if (
			hostname !== browserHost &&
			hostname !== wispHost &&
			!isIsolationHostname(hostname)
		) {
			return fetch(request);
		}

		return getContainer(env.BROWSER_CONTAINER, "shared").fetch(request);
	},
};
