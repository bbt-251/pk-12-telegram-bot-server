import TelegramBot from 'node-telegram-bot-api';
import { findTransporterByChatId } from '../services/transporter-service';
import { getLoadRequestById, hasExistingBid } from '../services/bid-service';
import { sendMessage } from '../bot';
import { confirmBid, restartBidFlow } from './message-handler';

interface PendingBid {
    loadRequestId: string;
    displayID: string; // Human-readable display ID
    transporterId: string;
    transporterName: string;
    transporterPhone: string;
    projectName: string;
    timestamp: number;
    existingBidId?: string | undefined; // Track if editing existing bid
}

// In-memory storage for pending bids (could use Redis in production)
const pendingBids = new Map<number, PendingBid>();

/**
 * Handle callback queries from Telegram inline buttons
 */
export async function handleCallbackQuery(
    bot: TelegramBot,
    callbackId: string,
    data: string,
    chatId: number,
    userId?: number
): Promise<void> {
    console.log(`🔔 Received callback: ${data} from chat ${chatId}, user ${userId}`);

    // Parse callback data
    if (data.startsWith('place_bid_')) {
        const loadRequestId = data.replace('place_bid_', '');
        await handlePlaceBidCallback(bot, callbackId, loadRequestId, chatId, userId);
    } else if (data.startsWith('cancel_bid_')) {
        await handleCancelBidCallback(bot, callbackId, chatId, userId);
    } else if (data.startsWith('confirm_bid_')) {
        await handleConfirmBidCallback(bot, callbackId, chatId, userId);
    } else if (data.startsWith('edit_bid_')) {
        await handleEditBidCallback(bot, callbackId, chatId, userId);
    } else {
        // Answer callback to remove loading state
        await bot.answerCallbackQuery(callbackId);
    }
}

/**
 * Handle "Place Bid" button click
 */
async function handlePlaceBidCallback(
    bot: TelegramBot,
    callbackId: string,
    loadRequestId: string,
    chatId: number,
    userId?: number
): Promise<void> {
    try {
        // Use userId (user's private chat ID) to find transporter, not the channel/group chatId
        const userChatId = userId || chatId;

        console.log("callbackId: ", callbackId)
        console.log("loadRequestId: ", loadRequestId)
        console.log("chatId (channel): ", chatId)
        console.log("userId (user): ", userId)
        console.log("userChatId (searching for): ", userChatId)

        // Find transporter by Telegram user ID (private chat ID)
        const result = await findTransporterByChatId(userChatId);
        console.log("result: ", result)

        if (!result) {
            await bot.answerCallbackQuery(callbackId, {
                text: '❌ You must be a registered transporter to place bids. Please use /start to verify your phone number.',
                show_alert: true
            });
            return;
        }

        const { transporter, projectName } = result;

        // Check if transporter is active
        // if (transporter.status !== 'Active') {
        //     await bot.answerCallbackQuery(callbackId, {
        //         text: '❌ Your account is not active. Please contact support.',
        //         show_alert: true
        //     });
        //     return;
        // }

        // Check if load request exists and is open
        const loadRequest = await getLoadRequestById(loadRequestId, projectName);

        if (!loadRequest) {
            await bot.answerCallbackQuery(callbackId, {
                text: '❌ This load request no longer exists.',
                show_alert: true
            });
            return;
        }

        if (loadRequest.status !== 'Open') {
            await bot.answerCallbackQuery(callbackId, {
                text: '❌ This load request is no longer open for bidding.',
                show_alert: true
            });
            return;
        }

        // Check if already bid
        const existingBid = await hasExistingBid(loadRequestId, transporter.id, projectName);

        if (existingBid) {
            await bot.answerCallbackQuery(callbackId, {
                text: '❌ You have already placed a bid on this load request.',
                show_alert: true
            });
            return;
        }

        // Store pending bid state using user's private chat ID
        pendingBids.set(userChatId, {
            loadRequestId,
            displayID: loadRequest.displayID,
            transporterId: transporter.id,
            transporterName: transporter.firstName,
            transporterPhone: transporter.phone,
            projectName,
            timestamp: Date.now()
        });

        // Answer callback to remove loading state
        await bot.answerCallbackQuery(callbackId, {
            text: '✅ Check your private chat with the bot to place your bid!',
            show_alert: true
        });

        // Send bid form message to user's private chat
        const loadInfo = `
📦 Load Request #${loadRequest.displayID}

📍 From: ${loadRequest.route.origin}
📍 To: ${loadRequest.route.destination}
🚚 Cargo: ${loadRequest.cargo.cargoType}
⚖️ Weight: ${loadRequest.cargoTotals.totalWeight}
📅 Pickup: ${loadRequest.schedule.pickupDate}
📅 Delivery: ${loadRequest.schedule.deliveryDate}
    `.trim();

        await sendMessage(userChatId, loadInfo);

        await sendMessage(
            userChatId,
            '💰 Please enter your bid amount (ETB):',
            {
                inline_keyboard: [
                    [{ text: '❌ Cancel', callback_data: `cancel_bid_${loadRequestId}` }]
                ]
            }
        );

        console.log(`✅ Started bid flow for transporter ${transporter.id} on load ${loadRequestId}`);
    } catch (error) {
        console.error('Error handling place bid callback:', error);
        await bot.answerCallbackQuery(callbackId, {
            text: '❌ An error occurred. Please try again.',
            show_alert: true
        });
    }
}

/**
 * Handle "Cancel Bid" button click
 */
async function handleCancelBidCallback(
    bot: TelegramBot,
    callbackId: string,
    chatId: number,
    userId?: number
): Promise<void> {
    // Use userId (user's private chat ID) to clear pending bid
    const userChatId = userId || chatId;

    // Clear pending bid
    pendingBids.delete(userChatId);

    await bot.answerCallbackQuery(callbackId);
    await sendMessage(userChatId, '❌ Bid cancelled.');
}

/**
 * Handle "Confirm Bid" button click
 */
async function handleConfirmBidCallback(
    bot: TelegramBot,
    callbackId: string,
    chatId: number,
    userId?: number
): Promise<void> {
    // Use userId (user's private chat ID)
    const userChatId = userId || chatId;

    await bot.sendMessage(userChatId, "⌛ Please wait while we process your bid...");

    // Answer callback to remove loading state
    await bot.answerCallbackQuery(callbackId);

    // Confirm and submit the bid
    await confirmBid(userChatId);
}

/**
 * Handle "Edit Bid" button click
 */
async function handleEditBidCallback(
    bot: TelegramBot,
    callbackId: string,
    chatId: number,
    userId?: number
): Promise<void> {
    // Use userId (user's private chat ID)
    const userChatId = userId || chatId;

    // Answer callback to remove loading state
    await bot.answerCallbackQuery(callbackId);

    // Restart the bid flow
    await restartBidFlow(userChatId);
}

/**
 * Get pending bid for a chat
 */
export function getPendingBid(chatId: number): PendingBid | undefined {
    return pendingBids.get(chatId);
}

/**
 * Set pending bid for a chat
 */
export function setPendingBid(chatId: number, bid: PendingBid): void {
    pendingBids.set(chatId, bid);
}

/**
 * Set pending bid for a chat with existing bid ID (for editing)
 */
export function setPendingBidWithExistingId(chatId: number, bid: PendingBid, existingBidId?: string): void {
    const pendingBidWithId: PendingBid = {
        ...bid,
        existingBidId: existingBidId || undefined
    };
    pendingBids.set(chatId, pendingBidWithId);
}

/**
 * Clear pending bid for a chat
 */
export function clearPendingBid(chatId: number): void {
    pendingBids.delete(chatId);
}

/**
 * Update pending bid for a chat (e.g., to remove existingBidId)
 */
export function updatePendingBid(chatId: number, updates: Partial<PendingBid>): void {
    const existing = pendingBids.get(chatId);
    if (existing) {
        pendingBids.set(chatId, { ...existing, ...updates });
    }
}

/**
 * Clean up expired pending bids (older than 10 minutes)
 */
export function cleanupExpiredBids(): void {
    const now = Date.now();
    const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

    for (const [chatId, bid] of pendingBids.entries()) {
        if (now - bid.timestamp > EXPIRY_MS) {
            pendingBids.delete(chatId);
            console.log(`Cleaned up expired bid for chat ${chatId}`);
        }
    }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredBids, 5 * 60 * 1000);