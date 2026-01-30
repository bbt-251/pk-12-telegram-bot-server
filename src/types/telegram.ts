// Re-export types from node-telegram-bot-api for consistency
import type {
    Message,
    User,
    Chat,
    Contact,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    ReplyKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardRemove,
    CallbackQuery,
} from 'node-telegram-bot-api';

export type TelegramMessage = Message;
export type {
    User,
    Chat,
    Contact,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    ReplyKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardRemove,
    CallbackQuery,
};

export interface SendMessageOptions {
    parse_mode?: string;
    disable_web_page_preview?: boolean;
    disable_notification?: boolean;
    reply_to_message_id?: number;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;
}

export interface TelegramResponse {
    ok: boolean;
    result?: unknown;
    description?: string;
}

export interface SendMessageOptions {
    parse_mode?: string;
    disable_web_page_preview?: boolean;
    disable_notification?: boolean;
    reply_to_message_id?: number;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;
}