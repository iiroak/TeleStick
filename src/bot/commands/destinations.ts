import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { Store } from "../../db/store.js";
import { isValidChatId, normalizeChatId } from "../../hub/phone.js";

function destinationsKeyboard(store: Store): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const dest of store.listDestinations()) {
    const icon = dest.enabled ? "\u2705" : "\u2b1c";
    keyboard
      .text(`${icon} ${dest.label}`, `dest:toggle:${dest.id}`)
      .text("\ud83d\uddd1", `dest:remove:${dest.id}`)
      .row();
  }
   keyboard.text("\u2795 Add destination", "dest:add");
  return keyboard;
}

function destinationsText(store: Store): string {
  const destinations = store.listDestinations();
  if (destinations.length === 0) {
    return "No destinations are configured.";
  }
  const lines = destinations.map(
    (dest) => `${dest.enabled ? "\u2705" : "\u2b1c"} ${dest.label} -> ${dest.chatId}`,
  );
  return `Configured destinations:\n${lines.join("\n")}\n\nSelect a destination to enable/disable it, or the trash icon to remove it.`;
}

export function registerDestinationCommands(
  bot: Bot,
  store: Store,
  defaultCountryCode = "",
): void {
  bot.command("destinations", async (ctx) => {
    await ctx.reply(destinationsText(store), {
      reply_markup: destinationsKeyboard(store),
    });
  });

  bot.callbackQuery(/^dest:toggle:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const destinations = store.listDestinations();
    const dest = destinations.find((d) => d.id === id);
    if (!dest) {
      await ctx.answerCallbackQuery({ text: "Destination not found" });
      return;
    }
    store.toggleDestination(id, !dest.enabled);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(destinationsText(store), {
      reply_markup: destinationsKeyboard(store),
    });
  });

  bot.callbackQuery(/^dest:remove:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    store.removeDestination(id);
    await ctx.answerCallbackQuery({ text: "Destination removed" });
    await ctx.editMessageText(destinationsText(store), {
      reply_markup: destinationsKeyboard(store),
    });
  });

  bot.callbackQuery("dest:add", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Send a phone number and optional label, for example:\n" +
        "/add +14155550100 Home",
    );
  });

  bot.command("add", async (ctx) => {
    const text = ctx.match?.trim();
    if (!text) {
      await ctx.reply("Usage: /add <phone number or JID> [label]");
      return;
    }
    // The label is everything after the last digit-or-symbol run that looks
    // like a phone number; simplest robust split: first token(s) that are
    // digits/+/space form the number, rest is the label.
    const match = text.match(/^([+0-9][0-9+\s]*[0-9])\s*(.*)$/);
    if (!match) {
      await ctx.reply("Could not parse the number. Usage: /add <phone number or JID> [label]");
      return;
    }
    const [, rawNumber, rawLabel] = match;
    let chatId: string;
    try {
      chatId = normalizeChatId(rawNumber!.trim(), defaultCountryCode);
    } catch {
      await ctx.reply("Invalid number. Use an international number starting with + or configure a default country code.");
      return;
    }
    if (!isValidChatId(chatId)) {
      await ctx.reply("The number could not be normalized to a valid WhatsApp chat ID.");
      return;
    }
    const label = rawLabel && rawLabel.trim().length > 0 ? rawLabel.trim() : chatId;
    let destination: ReturnType<Store["addDestination"]>;
    try {
      destination = store.addDestination(label, chatId);
    } catch (error) {
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        await ctx.reply("That WhatsApp destination is already configured.");
        return;
      }
      throw error;
    }
    await ctx.reply(
      `Destination added: ${destination.label} -> ${destination.chatId}`,
      { reply_markup: destinationsKeyboard(store) },
    );
  });
}

export function formatDestinationsSummary(store: Store): string {
  return destinationsText(store);
}
