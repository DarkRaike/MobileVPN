<script lang="ts">
  type IconName =
    | "arrow"
    | "check"
    | "clock"
    | "copy"
    | "devices"
    | "download"
    | "headset"
    | "home"
    | "lock"
    | "profile"
    | "shield"
    | "spark"
    | "support";

  let {
    name,
    size = 24,
  }: {
    name: IconName;
    size?: number;
  } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-linecap="round"
  stroke-linejoin="round"
  stroke-width="1.8"
  aria-hidden="true"
>
  {#if name === "arrow"}
    <path d="m9 18 6-6-6-6"></path>
  {:else if name === "check"}
    <path d="m5 12 4 4L19 6"></path>
  {:else if name === "clock"}
    <circle cx="12" cy="12" r="9"></circle>
    <path d="M12 7v5l3 2"></path>
  {:else if name === "copy"}
    <rect x="8" y="8" width="11" height="11" rx="2"></rect>
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
  {:else if name === "devices"}
    <rect x="3" y="5" width="13" height="10" rx="2"></rect>
    <path d="M8 19h11a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1"></path>
    <path d="M8 15v3"></path>
  {:else if name === "download"}
    <path d="M12 3v11"></path>
    <path d="m8 10 4 4 4-4"></path>
    <path d="M5 20h14"></path>
  {:else if name === "headset" || name === "support"}
    <path d="M4 13v-2a8 8 0 0 1 16 0v2"></path>
    <path d="M6 17H5a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h1v5Z"></path>
    <path d="M18 17h1a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2h-1v5Z"></path>
    {#if name === "headset"}
      <path d="M18 17c0 2-2 3-4 3"></path>
    {/if}
  {:else if name === "home"}
    <path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z"
    ></path>
  {:else if name === "lock"}
    <rect x="5" y="10" width="14" height="11" rx="3"></rect>
    <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
  {:else if name === "profile"}
    <circle cx="12" cy="8" r="4"></circle>
    <path d="M4 21a8 8 0 0 1 16 0"></path>
  {:else if name === "shield"}
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path>
    <path d="m9 12 2 2 4-4"></path>
  {:else if name === "spark"}
    <path
      d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"
    ></path>
    <path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z"
    ></path>
  {/if}
</svg>
