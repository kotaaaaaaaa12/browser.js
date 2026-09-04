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

	onStart() {
		console.log("Browser container started");
	}

	onStop(stopParams) {
		console.log("Browser container stopped", {
			exitCode: stopParams.exitCode,
			reason: stopParams.reason,
		});
	}

	async onActivityExpired() {
		try {
			const response = await this.containerFetch(
				"http://localhost/_activity",
			);

			if (!response.ok) {
				throw new Error(`Activity endpoint returned ${response.status}`);
			}

			const activity = await response.json();
			const activeWispConnections = Number(
				activity.activeWispConnections ?? 0,
			);

			if (activeWispConnections > 0) {
				console.log(
					"Browser container still has active Wisp connections",
					{ activeWispConnections },
				);
				this.renewActivityTimeout();
				return;
			}
		} catch (error) {
			console.error(
				"Failed to inspect browser container activity; keeping it alive",
				error,
			);
			this.renewActivityTimeout();
			return;
		}

		console.log(
			"Browser container idle timeout expired with no active Wisp connections; stopping instance",
		);
		await this.stop();
	}

	onError(error) {
		console.error("Container error", error);
		throw error;
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
