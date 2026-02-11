// Telegram Bot for Cargo Bidding System
import TelegramBot from 'node-telegram-bot-api';
import { handleCallbackQuery, setPendingBid, setPendingBidWithExistingId, getCounterOfferStateByChatId } from './handlers/callback-handler';
import { handleMessage, handleCounterOfferAmount } from './handlers/message-handler';
import { getExistingBid, getLoadRequestById } from './services/bid-service';
import { findTransporterByChatId, findUserByPhoneNumber, updateTransporterChatId } from './services/transporter-service';
import { Contact, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, TelegramMessage } from './types/telegram';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required but not set');
}

// Create bot with polling configuration
const bot = new TelegramBot(BOT_TOKEN, {
    polling: {
        interval: 3000,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// Handle all incoming messages
bot.on('message', (msg: TelegramMessage) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    console.log('📨 Received message:', text, 'from chat:', chatId);

    // Handle contact sharing
    if (msg.contact) {
        const contact = msg.contact as Contact;
        handleContactShare(chatId, contact);
    }
    // Handle phone number as text
    else if (text && (/^[+]?[0-9\s\-()]{10,15}$/).test(text)) {
        const cleanPhone = text.replace(/[\s\-()]/g, '');
        const normalizedPhone = cleanPhone.startsWith('+') ? cleanPhone : '+' + cleanPhone;
        handleContactShare(chatId, {
            phone_number: normalizedPhone,
            first_name: msg.from?.first_name || 'User'
        });
    }
    // Handle other text messages
    else {
        // Check if user is in counter offer flow
        const counterOfferState = getCounterOfferStateByChatId(chatId);
        if (counterOfferState && counterOfferState.counterAmount === 0) {
            handleCounterOfferAmount(bot, chatId, text);
        } else {
            handleMessage(bot, chatId, text);
        }
    }
});

// Handle callback queries (inline button clicks)
bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const callbackId = query.id;
    const data = query.data;
    const userId = query.from?.id;

    if (!chatId || !callbackId || !data) {
        return;
    }

    await handleCallbackQuery(bot, callbackId, data, chatId, userId);
});

// Handle /start command with deep link support
bot.onText(/\/start (.*)/, async (msg: TelegramMessage, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const payload = match && match[1] ? match[1].trim() : '';
    console.log(`🔔 RECEIVED /start command from chat ${chatId} with payload: ${payload}`);

    // Check if this is a deep link for placing a bid
    if (payload.startsWith('bid_')) {
        const loadRequestId = payload.replace('bid_', '');
        console.log(`📦 Deep link detected for load request: ${loadRequestId}`);
        await handleBidDeepLink(chatId, loadRequestId);
    } else {
        // Regular /start - request phone verification for transporters/brokers
        sendContactRequest(chatId);
    }
});

// Handle /start without parameters
bot.onText(/^\/start$/, (msg: TelegramMessage) => {
    const chatId = msg.chat.id;
    console.log(`🔔 RECEIVED /start command from chat ${chatId}`);
    sendContactRequest(chatId);
});

/**
 * Handle deep link for placing a bid
 */
async function handleBidDeepLink(chatId: number, loadRequestId: string): Promise<void> {
    try {
        // Find transporter by chat ID
        const result = await findTransporterByChatId(chatId);

        if (!result) {
            await sendMessage(chatId, '❌ You must be a registered transporter or broker to place bids. Please use /start to verify your phone number.');
            return;
        }

        const { transporter, projectName } = result;

        // Check if transporter is active
        // if (transporter.status !== 'Active') {
        //     await sendMessage(chatId, '❌ Your account is not active. Please contact support.');
        //     return;
        // }

        // Check if load request exists and is open
        const loadRequest = await getLoadRequestById(loadRequestId, projectName);

        if (!loadRequest) {
            console.log(`checking for load request ${loadRequestId} on project ${projectName} and res: `, loadRequest)
            await sendMessage(chatId, '❌ This load request no longer exists.');
            return;
        }

        if (loadRequest.status !== 'Open') {
            await sendMessage(chatId, '❌ This load request is no longer open for bidding.');
            return;
        }

        // Check if already bid and if it can be edited
        const existingBidResult = await getExistingBid(loadRequestId, transporter.uid, projectName);

        if (existingBidResult) {
            const { bid, canEdit } = existingBidResult;

            if (canEdit) {
                // Allow editing existing bid
                await sendMessage(
                    chatId,
                    `📝 You already have a bid on this load request.\n\n` +
                    `Current bid: ETB ${bid.pricing.amount.toLocaleString()}\n` +
                    `Trucks: ${bid.trucksProvided}\n\n` +
                    `Please enter your new bid amount (ETB):`,
                    {
                        inline_keyboard: [
                            [{ text: '❌ Cancel', callback_data: `cancel_bid_${loadRequestId}` }]
                        ]
                    }
                );

                // Store pending bid with existing bid ID for editing
                setPendingBidWithExistingId(chatId, {
                    loadRequestId,
                    displayID: loadRequest.displayID,
                    transporterId: transporter.id,
                    transporterName: transporter.firstName,
                    transporterPhone: transporter.phone,
                    projectName,
                    timestamp: Date.now()
                }, bid.id);
            } else {
                // Bid is accepted, cannot edit
                await sendMessage(chatId, '❌ Your bid on this load request has been accepted and cannot be modified.');
            }
            return;
        }

        // Check bid deadline
        const bidDeadline = loadRequest.biddingSettings?.bidDeadline;
        if (bidDeadline) {
            const deadline = new Date(bidDeadline);
            const now = new Date();

            if (now > deadline) {
                await sendMessage(chatId, `❌ The bidding deadline for this load request has passed.\n\nDeadline: ${deadline.toLocaleString()}`);
                return;
            }
        }

        // Store pending bid state
        setPendingBid(chatId, {
            loadRequestId,
            displayID: loadRequest.displayID,
            transporterId: transporter.id,
            transporterName: transporter.firstName,
            transporterPhone: transporter.phone,
            projectName,
            timestamp: Date.now()
        });

        // Send load info
        const loadInfo = `
📦 Load Request #${loadRequest.displayID}

📍 From: ${loadRequest.route.origin}
📍 To: ${loadRequest.route.destination}
🚚 Cargo: ${loadRequest.cargo.cargoType}
⚖️ Weight: ${loadRequest.cargoTotals.totalWeight}
📅 Pickup: ${loadRequest.schedule.pickupDate}
📅 Delivery: ${loadRequest.schedule.deliveryDate}
    `.trim();

        await sendMessage(chatId, loadInfo);

        await sendMessage(
            chatId,
            '💰 Please enter your bid amount (ETB):',
            {
                inline_keyboard: [
                    [{ text: '❌ Cancel', callback_data: `cancel_bid_${loadRequestId}` }]
                ]
            }
        );

        console.log(`✅ Started bid flow for transporter ${transporter.id} on load ${loadRequestId}`);
    } catch (error) {
        console.error('Error handling bid deep link:', error);
        await sendMessage(chatId, '❌ An error occurred. Please try again.');
    }
}

// Handle /help command
bot.onText(/\/help/, (msg: TelegramMessage) => {
    const chatId = msg.chat.id;
    const helpText = `
🚛 Cargo Bidding Bot Help

/start - Verify your phone number
/help - Show this help message

How to place a bid:
1. Click "Place Bid" on a load request post in @pkdouze channel
2. Verify your phone number if not already verified
3. Enter your bid amount (ETB)
4. Enter number of trucks you can provide
5. Your bid will be submitted to cargo owner

Need help? Contact support.
  `.trim();

    sendMessage(chatId, helpText);
});

console.log('🤖 Bot initialized successfully');
console.log('🔧 Bot token is valid and working');
console.log('🚀 Starting polling with node-telegram-bot-api...');
console.log('✅ Polling started successfully');
console.log('📡 Bot is now listening for messages...');

// Keyboard markup for phone number request
function createContactKeyboard() {
    return {
        keyboard: [
            [{ text: '📱 Share Phone Number', request_contact: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    };
}

// Keyboard markup for authenticated users with View My Bids button
function createAuthenticatedKeyboard() {
    return {
        keyboard: [
            [{ text: '📋 View My Bids' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

// Send message with optional keyboard
export async function sendMessage(
    chatId: number,
    text: string,
    keyboard?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove
): Promise<TelegramBot.Message> {
    const messageText = text && text.trim() ? text : '.';
    const options: { parse_mode: 'HTML'; reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove } = { parse_mode: 'HTML' };
    if (keyboard) {
        options.reply_markup = keyboard;
    }
    return bot.sendMessage(chatId, messageText, options);
}

// Remove keyboard
export async function removeKeyboard(chatId: number): Promise<TelegramBot.Message> {
    return bot.sendMessage(chatId, '.', { reply_markup: { remove_keyboard: true } });
}

// Send contact request message
async function sendContactRequest(chatId: number): Promise<TelegramBot.Message> {
    const keyboard = createContactKeyboard();
    return sendMessage(
        chatId,
        '👋 Welcome to Cargo Bidding Bot!\n\nTo place bids on load requests, please share your phone number so we can verify your transporter or broker account.',
        keyboard
    );
}

// Handle contact sharing
async function handleContactShare(chatId: number, contact: Contact): Promise<void> {
    const phoneNumber = contact.phone_number;
    // Normalize phone number
    const cleanPhone = phoneNumber.replace(/[\s\-()]/g, '');
    const normalizedPhone = cleanPhone.startsWith('+') ? cleanPhone : '+' + cleanPhone;

    console.log(`Processing contact share for chat ${chatId}, phone: ${normalizedPhone}`);

    try {
        // Send initial verification message
        await sendMessage(chatId, '⏳ Please wait while we verify your phone number...');

        // Search for transporter/broker across all Firebase projects
        const result = await findUserByPhoneNumber(normalizedPhone);

        if (result) {
            const { transporter, projectName } = result;

            // Update transporter's telegramChatID
            const updateSuccess = await updateTransporterChatId(transporter.id, chatId, projectName);

            if (updateSuccess) {
                // Send success message with authenticated keyboard
                await sendMessage(
                    chatId,
                    `✅ Phone verified successfully!\n\n` +
                    `👤 Name: ${transporter.firstName} ${transporter.lastName}\n` +
                    `📱 Phone: ${normalizedPhone}\n` +
                    `🏢 Company: ${transporter.companyName || 'N/A'}\n\n` +
                    `You can now place bids on load requests.`,
                    createAuthenticatedKeyboard()
                );
                console.log(`Successfully linked transporter ${transporter.id} to chat ${chatId}`);
            } else {
                await sendMessage(chatId, '❌ Failed to link your account. Please try again or contact support.');
            }
        } else {
            // User not found or not a transporter/broker
            await sendMessage(
                chatId,
                '❌ Account not found.\n\n' +
                'Only transporters and brokers can use this bot. ' +
                'Please ensure you are sharing the same phone number registered in the system, or contact your administrator for assistance.',
                { remove_keyboard: true }
            );
        }
    } catch (error) {
        console.error('Error processing contact:', error);
        await sendMessage(
            chatId,
            '❌ An error occurred while processing your request. Please try again later.',
            { remove_keyboard: true }
        );
    }
}

// Export bot instance for use in other modules
export { bot };
