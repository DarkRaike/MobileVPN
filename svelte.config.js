import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csp: {
      directives: {
        "base-uri": ["none"],
        "connect-src": ["self"],
        "default-src": ["self"],
        "font-src": ["self"],
        "form-action": ["self"],
        "frame-ancestors": ["self", "https://web.telegram.org"],
        "frame-src": ["none"],
        "img-src": ["self", "data:", "https:"],
        "manifest-src": ["self"],
        "media-src": ["none"],
        "object-src": ["none"],
        "script-src": ["self", "https://telegram.org"],
        "style-src": ["self", "unsafe-inline"],
        "worker-src": ["self"],
      },
      mode: "auto",
    },
    csrf: {
      trustedOrigins: [],
    },
  },
};

export default config;
