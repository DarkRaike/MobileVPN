import { describe, expect, it } from "vitest";

import {
  buildBotCommandReply,
  parseBotCommand,
} from "../../src/lib/server/integrations/telegram/commands";

function commandUpdate(text: string) {
  return { message: { chat: { id: 123456789 }, text }, update_id: 1 };
}

describe("parseBotCommand", () => {
  it("recognises the supported commands", () => {
    expect(parseBotCommand(commandUpdate("/terms"))).toEqual({
      chatId: "123456789",
      command: "terms",
    });
    expect(parseBotCommand(commandUpdate("/paysupport"))).toEqual({
      chatId: "123456789",
      command: "paysupport",
    });
  });

  it("accepts the group form with a bot mention and arguments", () => {
    expect(parseBotCommand(commandUpdate("/Terms@astra_vpn_bot now"))).toEqual({
      chatId: "123456789",
      command: "terms",
    });
  });

  it("ignores ordinary messages and payment updates", () => {
    expect(parseBotCommand(commandUpdate("привет"))).toBeNull();
    expect(
      parseBotCommand({
        message: { chat: { id: 1 }, successful_payment: { currency: "XTR" } },
        update_id: 2,
      }),
    ).toBeNull();
    expect(parseBotCommand({ pre_checkout_query: { id: "1" } })).toBeNull();
  });
});

describe("buildBotCommandReply", () => {
  it("points every reply at the configured domain", () => {
    expect(buildBotCommandReply("terms", "vpn-service.fun")).toContain(
      "https://app.vpn-service.fun/terms",
    );
    expect(buildBotCommandReply("paysupport", "vpn-service.fun")).toContain(
      "https://app.vpn-service.fun/paysupport",
    );
  });

  it("answers an unknown-but-supported command with the start text", () => {
    const reply = buildBotCommandReply("start", "vpn-service.fun");

    expect(reply).toContain("/terms");
    expect(reply).toContain("/paysupport");
  });
});
