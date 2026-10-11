// Minimal safety net for assets/js: catches typos (no-undef) and dead code
// (no-unused-vars). The repo has no package.json, so this file imports nothing
// and the browser globals the scripts use are listed by hand.
//
//   npx --yes eslint@10.11.0 assets/js
//
// CI runs the same command, pinned, as an advisory job of its own with a
// read-only token (the "lint" job in .github/workflows/hugo.yml).

const readonly = (names) => Object.fromEntries(names.map((n) => [n, "readonly"]));

module.exports = [
    {
        // Third-party code is shipped as published
        ignores: ["assets/js/vendor/**"],
    },
    {
        files: ["assets/js/**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            // Every file is a classic script wrapped in its own IIFE
            sourceType: "script",
            globals: {
                ...readonly([
                    // Browser
                    "window", "document", "navigator", "location", "history", "self",
                    "console", "alert", "confirm", "fetch", "atob", "btoa", "localStorage", "sessionStorage",
                    "indexedDB", "getComputedStyle", "matchMedia", "performance",
                    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
                    "requestAnimationFrame", "cancelAnimationFrame",
                    "requestIdleCallback", "cancelIdleCallback",
                    "AbortController", "Audio", "AudioContext", "Blob", "CSS", "CustomEvent",
                    "DOMParser", "Event", "File", "FileReader", "FormData", "Image",
                    "ImageData", "IntersectionObserver", "MediaMetadata", "MutationObserver",
                    "Node", "Notification", "ResizeObserver", "TextDecoder", "TextEncoder",
                    "URL", "URLSearchParams", "WebSocket", "Worker", "crypto",
                    // Libraries loaded by their own script tags
                    "Gun", "V86", "FitAddon", "Terminal", "posthog",
                    // signature.js also exports itself for Node (scripts/)
                    "module",
                ]),
            },
        },
        rules: {
            "no-undef": "error",
            "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
        },
    },
];
