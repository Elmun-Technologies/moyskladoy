import type { Messenger, MessengerButton, SendResult } from '../types.js';

// ============================================================================
// TestMessenger - sinov adapteri. HAQIQIY Telegram akkauntlariga hech qayerga
// xabar yubormaydi: barcha retencioni xotiraga yozadi.
// ============================================================================

export interface SentMessage {
  kind: 'text' | 'video_note' | 'video' | 'photo' | 'contact_request';
  chatId: number;
  text?: string;
  fileId?: string;
  caption?: string;
  buttons?: MessengerButton[][];
  messageId: number;
}

export class TestMessenger implements Messenger {
  readonly sent: SentMessage[] = [];
  readonly answeredCallbacks: { id: string; text?: string }[] = [];
  /** Test kontroli: KYingi yuborish natijasini majburlash (xato simulyatsiyasi). */
  public nextResult: SendResult | null = null;
  /** Barcha chat'lar bo'yicha so'nggi xabarlar (qulay test uchun). */
  private seq = 0;

  private result(): SendResult {
    if (this.nextResult) {
      const r = this.nextResult;
      this.nextResult = null;
      return r;
    }
    return { ok: true, messageId: ++this.seq };
  }

  async sendText(chatId: number, text: string, buttons?: MessengerButton[]): Promise<SendResult> {
    const r = this.result();
    if (r.ok) {
      this.sent.push({
        kind: 'text',
        chatId,
        text,
        buttons: buttons ? [buttons] : undefined,
        messageId: r.messageId ?? ++this.seq,
      });
    }
    return r;
  }

  async sendVideoNote(chatId: number, fileId: string, buttons?: MessengerButton[]): Promise<SendResult> {
    const r = this.result();
    if (r.ok) {
      this.sent.push({ kind: 'video_note', chatId, fileId, buttons: buttons ? [buttons] : undefined, messageId: r.messageId ?? ++this.seq });
    }
    return r;
  }

  async sendVideo(chatId: number, fileId: string, buttons?: MessengerButton[]): Promise<SendResult> {
    const r = this.result();
    if (r.ok) {
      this.sent.push({ kind: 'video', chatId, fileId, buttons: buttons ? [buttons] : undefined, messageId: r.messageId ?? ++this.seq });
    }
    return r;
  }

  async sendPhoto(chatId: number, fileId: string, caption?: string, buttons?: MessengerButton[]): Promise<SendResult> {
    const r = this.result();
    if (r.ok) {
      this.sent.push({ kind: 'photo', chatId, fileId, caption, buttons: buttons ? [buttons] : undefined, messageId: r.messageId ?? ++this.seq });
    }
    return r;
  }

  async requestContact(chatId: number, text: string): Promise<SendResult> {
    const r = this.result();
    if (r.ok) {
      this.sent.push({ kind: 'contact_request', chatId, text, messageId: r.messageId ?? ++this.seq });
    }
    return r;
  }

  async answerCallback(callbackQueryId: string, text?: string): Promise<void> {
    this.answeredCallbacks.push({ id: callbackQueryId, text });
  }

  // --- Test yordamchilari ---------------------------------------------------

  /** Ma'lum chat'ga yuborilgan barcha xabarlar. */
  forChat(chatId: number): SentMessage[] {
    return this.sent.filter((m) => m.chatId === chatId);
  }

  /** Oxirgi xabar (ixtiyoriy chat filter bilan). */
  last(chatId?: number): SentMessage | undefined {
    const list = chatId === undefined ? this.sent : this.forChat(chatId);
    return list[list.length - 1];
  }

  /** Matn bo'yicha qidirish (testlar uchun). */
  findByText(substr: string, chatId?: number): SentMessage[] {
    const list = chatId === undefined ? this.sent : this.forChat(chatId);
    return list.filter((m) => (m.text ?? m.caption ?? '').includes(substr));
  }

  clear(): void {
    this.sent.length = 0;
    this.answeredCallbacks.length = 0;
  }
}
