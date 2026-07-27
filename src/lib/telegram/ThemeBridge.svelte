<script lang="ts">
  import { applyTelegramTheme } from "./theme";
  import { getTelegramWebApp } from "./web-app";

  $effect(() => {
    const webApp = getTelegramWebApp();

    if (!webApp) {
      return;
    }

    const synchronizeTheme = () => applyTelegramTheme(webApp);

    synchronizeTheme();
    webApp.onEvent("themeChanged", synchronizeTheme);
    webApp.expand();
    webApp.ready();

    return () => {
      webApp.offEvent("themeChanged", synchronizeTheme);
    };
  });
</script>
