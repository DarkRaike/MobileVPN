import qrcode from "qrcode-generator";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "../../db/client";
import { orders, subscriptions } from "../../db/schema";
import { decryptSubscriptionUrl } from "../../security/subscription-url";
import { listPurchaseHistory } from "../orders/orders";

export interface ActiveSubscriptionView {
  expiresAt: Date;
  planName: string;
  qrCodeDataUrl: string | null;
  startsAt: Date;
  status: "active";
  subscriptionUrl: string;
}

export interface PendingSubscriptionView {
  orderId: string;
  planName: string;
  status: "provisioning";
}

export interface FailedSubscriptionView {
  orderId: string;
  planName: string;
  status: "provisioning_failed";
}

export type SubscriptionView =
  | ActiveSubscriptionView
  | FailedSubscriptionView
  | PendingSubscriptionView
  | { status: "error" }
  | { status: "none" };

function createQrCodeDataUrl(value: string): string {
  const code = qrcode(0, "M");
  code.addData(value, "Byte");
  code.make();
  const svg = code
    .createSvgTag({ cellSize: 4, margin: 4, scalable: true })
    .replace(/fill="black"/g, 'fill="#151616"')
    .replace(/fill="white"/g, 'fill="#ffffff"');

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export async function getProfileOverview(
  database: Database,
  userId: string,
  encryptionKey: string | undefined,
  now = new Date(),
) {
  const [
    history,
    subscriptionRecords,
    provisioningRecords,
    activeOrderRecords,
  ] = await Promise.all([
    listPurchaseHistory(database, userId),
    database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1),
    database
      .select({
        id: orders.id,
        planName: orders.planNameSnapshot,
        status: orders.status,
      })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          inArray(orders.status, [
            "paid",
            "provisioning",
            "provisioning_failed",
          ]),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1),
    database
      .select({ planName: orders.planNameSnapshot })
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.status, "active")))
      .orderBy(desc(orders.provisionedAt), desc(orders.createdAt))
      .limit(1),
  ]);
  const subscription = subscriptionRecords[0];
  const provisioning = provisioningRecords[0];
  let subscriptionView: SubscriptionView = { status: "none" };

  if (
    subscription &&
    subscription.status === "active" &&
    subscription.expiresAt.getTime() > now.getTime() &&
    subscription.subscriptionUrlEncrypted &&
    encryptionKey
  ) {
    try {
      const subscriptionUrl = decryptSubscriptionUrl(
        subscription.subscriptionUrlEncrypted,
        encryptionKey,
      );
      let qrCodeDataUrl: string | null = null;

      try {
        qrCodeDataUrl = createQrCodeDataUrl(subscriptionUrl);
      } catch (error) {
        console.error(
          JSON.stringify({
            errorCode: "SUBSCRIPTION_QR_GENERATION_FAILED",
            errorType: error instanceof Error ? error.name : "UnknownError",
            level: "error",
            subscriptionId: subscription.id,
            timestamp: now.toISOString(),
          }),
        );
      }

      subscriptionView = {
        expiresAt: subscription.expiresAt,
        planName: activeOrderRecords[0]?.planName ?? "Astra VPN",
        qrCodeDataUrl,
        startsAt: subscription.startsAt,
        status: "active",
        subscriptionUrl,
      };
    } catch (error) {
      console.error(
        JSON.stringify({
          errorCode: "SUBSCRIPTION_PROFILE_DECRYPT_FAILED",
          errorType: error instanceof Error ? error.name : "UnknownError",
          level: "error",
          subscriptionId: subscription.id,
          timestamp: now.toISOString(),
        }),
      );
      subscriptionView = { status: "error" };
    }
  } else if (provisioning?.status === "provisioning_failed") {
    subscriptionView = {
      orderId: provisioning.id,
      planName: provisioning.planName,
      status: "provisioning_failed",
    };
  } else if (provisioning) {
    subscriptionView = {
      orderId: provisioning.id,
      planName: provisioning.planName,
      status: "provisioning",
    };
  }

  return {
    purchaseHistory: history,
    subscription: subscriptionView,
  };
}
