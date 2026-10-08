export interface TgUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string; first_name?: string; language_code?: string };
    text?: string;
    contact?: { phone_number?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number } };
    from: { id: number };
  };
}
