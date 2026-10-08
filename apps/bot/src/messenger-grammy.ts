// ============================================================================
// Messenger'ning production implementatsiyasi - grammY Bot API chaqiruvlari.
// E'tibor: "yetkazib berish" kafolatlanmaydi - xatolar SendResult'ga yoziladi,
// qayta urinish siyosati outbox/worker tomonida.
// ============================================================================
import { Bot } from 'grammy';
import type { Messenger, MessengerButton, SendResult } from '@app/shared';

type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] };

function kb(buttons: MessengerButton[] | undefined): InlineKeyboard | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  // Telegram cheklovi: satrda 8 tagacha, jami 100 tagacha tugma.
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(
      buttons.slice(i, i + 2).map((b) => ({
        text: b.label.slice(0, 64),
        callback_data: b.action.slice(0, 64),
      })),
    );
  }
  return { inline_keyboard: rows.slice(0, 12) };
}

function err(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // Token'li URL xato matnida qolmasin:
  return m.slice(0, 200).replace(/[0-9]{8,}:[A-Za-z0-9_-]{30,}/g, '***');
}

export class GrammyMessenger implements Messenger {
  constructor(private readonly bot: Bot) {}

  async sendText(chatId: number, text: string, buttons?: MessengerButton[]): Promise<SendResult> {
    try {
      const m = await this.bot.api.sendMessage(chatId, text.slice(0, 3900), {
        reply_markup: kb(buttons),
        link_preview_options: { is_disabled: true },
      });
      return { ok: true, messageId: m.message_id };
    } catch (e) {
      return { ok: false, error: err(e), ambiguous: true };
    }
  }

  async sendVideoNote(chatId: number, fileId: string, buttons?: MessengerButton[]): Promise<SendResult> {
    try {
      const m = await this.bot.api.sendVideoNote(chatId, fileId, { reply_markup: kb(buttons) });
      return { ok: true, messageId: m.message_id };
    } catch (e) {
      return { ok: false, error: err(e), ambiguous: true };
    }
  }

  async sendVideo(chatId: number, fileId: string, buttons?: MessengerButton[]): Promise<SendResult> {
    try {
      const m = await this.bot.api.sendVideo(chatId, fileId, { reply_markup: kb(buttons) });
      return { ok: true, messageId: m.message_id };
    } catch (e) {
      return { ok: false, error: err(e), ambiguous: true };
    }
  }

  async sendPhoto(chatId: number, fileId: string, caption?: string, buttons?: MessengerButton[]): Promise<SendResult> {
    try {
      const m = await this.bot.api.sendPhoto(chatId, fileId, { caption: caption?.slice(0, 1000), reply_markup: kb(buttons) });
      return { ok: true, messageId: m.message_id };
    } catch (e) {
      return { ok: false, error: err(e), ambiguous: true };
    }
  }

  async requestContact(chatId: number, text: string): Promise<SendResult> {
    try {
      const m = await this.bot.api.sendMessage(chatId, text, {
        reply_markup: {
          keyboard: [[{ text: 'Telefonimni ulashish', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      return { ok: true, messageId: m.message_id };
    } catch (e) {
      return { ok: false, error: err(e), ambiguous: true };
    }
  }

  async answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await this.bot.api.answerCallbackQuery(callbackQueryId, text ? { text } : undefined);
    } catch {
      /* callback javobi ixtiyoriy */
    }
  }
}
