import { ApplicationError } from "../../application-error";
import type { RuntimeConfig } from "../../config/schema";
import { MarzbanAdapter, type Marzban } from "./marzban";

let marzbanAdapter: Marzban | undefined;

export function getMarzban(config: RuntimeConfig): Marzban {
  if (!config.liveOperationsEnabled || !config.marzban) {
    throw new ApplicationError(
      "LIVE_OPERATIONS_DISABLED",
      "Выдача VPN-доступа временно отключена.",
    );
  }

  marzbanAdapter ??= new MarzbanAdapter({
    baseUrl: config.marzban.baseUrl,
    inboundTag: config.marzban.vlessInboundTag,
    password: config.marzban.password,
    username: config.marzban.username,
  });

  return marzbanAdapter;
}
