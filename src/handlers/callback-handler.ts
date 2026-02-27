import TelegramBot from "node-telegram-bot-api";
import { findTransporterByChatId } from "../services/transporter-service";
import {
    getLoadRequestById,
    hasExistingBid,
    getBidsByTransporter,
    getBidById,
    acceptCounterOffer,
    transporterCounterOffer,
} from "../services/bid-service";
import { sendMessage } from "../bot";
import { confirmBid } from "./message-handler";
import { formatDate } from "../dayjs_util";
import { getExternalTransportDetailsUrl } from "../firebase-config";

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
 * Counter offer state for handling counter offer flow
 */
export interface CounterOfferState {
    bidId: string;
    transporterId: string;
    projectName: string;
    loadRequestDisplayID: string;
    counterAmount: number;
    trucks: number;
    originalBidAmount: number;
    cargoOwnerOfferAmount: number; // The cargo owner's counter offer amount
    timestamp: number;
}

// In-memory storage for counter offer states
const counterOfferStates = new Map<number, CounterOfferState>();

/**
 * Handle callback queries from Telegram inline buttons
 */
export async function handleCallbackQuery(
    bot: TelegramBot,
    callbackId: string,
    data: string,
    chatId: number,
    userId?: number,
): Promise<void> {
    console.log(`🔔 Received callback: ${data} from chat ${chatId}, user ${userId}`);

    // Parse callback data
    if (data.startsWith("place_bid_")) {
        const loadRequestId = data.replace("place_bid_", "");
        await handlePlaceBidCallback(bot, callbackId, loadRequestId, chatId, userId);
    } else if (data.startsWith("cancel_bid_")) {
        await handleCancelBidCallback(bot, callbackId, chatId, userId);
    } else if (data.startsWith("confirm_bid_")) {
        await handleConfirmBidCallback(bot, callbackId, chatId, userId);
    } else if (data.startsWith("edit_bid_")) {
        await handleEditBidCallback(bot, callbackId, data, chatId, userId);
    } else if (data === "view_my_bids") {
        await handleViewMyBidsCallback(bot, callbackId, chatId, userId);
    } else if (data.startsWith("ac:")) {
        await handleAcceptCounterCallback(bot, callbackId, data, chatId, userId);
    } else if (data.startsWith("co:")) {
        await handleCounterOfferCallback(bot, callbackId, data, chatId, userId);
    } else if (data.startsWith("confirm_counter_")) {
        await handleConfirmCounterOfferCallback(bot, callbackId, data, chatId, userId);
    } else if (data.startsWith("cancel_counter_")) {
        await handleCancelCounterOfferCallback(bot, callbackId, data, chatId, userId);
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
    userId?: number,
): Promise<void> {
    try {
        // Use userId (user's private chat ID) to find transporter, not the channel/group chatId
        const userChatId = userId || chatId;

        console.log("callbackId: ", callbackId);
        console.log("loadRequestId: ", loadRequestId);
        console.log("chatId (channel): ", chatId);
        console.log("userId (user): ", userId);
        console.log("userChatId (searching for): ", userChatId);

        // Find transporter by Telegram user ID (private chat ID)
        const result = await findTransporterByChatId(userChatId);
        console.log("result: ", result);

        if (!result) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ You must be a registered transporter to place bids. Please use /start to verify your phone number.",
                show_alert: true,
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
                text: `❌ This load request no longer exists.

---
Debug:
Load Request Data ID: ${loadRequestId}
DB: ${projectName}
---`,
                show_alert: true,
            });
            return;
        }

        // If load request has a projectId field, validate it matches
        if (loadRequest.projectId && loadRequest.projectId !== projectName) {
            console.log(
                `Project mismatch: load request project=${loadRequest.projectId}, expected=${projectName}`,
            );
            await bot.answerCallbackQuery(callbackId, {
                text: `❌ This load request is from a different project.\n\nYour account: ${projectName}\nLoad request: ${loadRequest.projectId}`,
                show_alert: true,
            });
            return;
        }

        if (loadRequest.status !== "Open") {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ This load request is no longer open for bidding.",
                show_alert: true,
            });
            return;
        }

        // Check if already bid
        const existingBid = await hasExistingBid(loadRequestId, transporter.id, projectName);

        if (existingBid) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ You have already placed a bid on this load request.",
                show_alert: true,
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
            timestamp: Date.now(),
        });

        // Answer callback to remove loading state
        await bot.answerCallbackQuery(callbackId, {
            text: "✅ Check your private chat with the bot to place your bid!",
            show_alert: true,
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

        await sendMessage(userChatId, "💰 Please enter your bid amount (ETB):", {
            inline_keyboard: [
                [{ text: "❌ Cancel", callback_data: `cancel_bid_${loadRequestId}` }],
            ],
        });

        console.log(
            `✅ Started bid flow for transporter ${transporter.id} on load ${loadRequestId}`,
        );
    } catch (error) {
        console.error("Error handling place bid callback:", error);
        await bot.answerCallbackQuery(callbackId, {
            text: "❌ An error occurred. Please try again.",
            show_alert: true,
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
    userId?: number,
): Promise<void> {
    // Use userId (user's private chat ID) to clear pending bid
    const userChatId = userId || chatId;

    // Clear pending bid
    pendingBids.delete(userChatId);

    await bot.answerCallbackQuery(callbackId);
    await sendMessage(userChatId, "❌ Bid cancelled.");
}

/**
 * Handle "Confirm Bid" button click
 */
async function handleConfirmBidCallback(
    bot: TelegramBot,
    callbackId: string,
    chatId: number,
    userId?: number,
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
    data: string,
    chatId: number,
    serId?: number,
): Promise<void> {
    console.info({
        data,
        chatId,
        serId,
    });
    // Reject edit attempts - one bid per user per load-request, no updates allowed
    await bot.answerCallbackQuery(callbackId, {
        text: "❌ Editing bids is not allowed.",
        show_alert: true,
    });
}

/**
 * Handle "View My Bids" button click (callback query)
 */
async function handleViewMyBidsCallback(
    bot: TelegramBot,
    callbackId: string,
    chatId: number,
    userId?: number,
): Promise<void> {
    // Use userId (user's private chat ID)
    const userChatId = userId || chatId;

    // Answer callback to remove loading state
    await bot.answerCallbackQuery(callbackId);

    // Display the bids
    await displayUserBids(userChatId);
}

/**
 * Handle "View My Bids" text message (keyboard button)
 */
export async function handleViewMyBidsText(chatId: number): Promise<void> {
    await displayUserBids(chatId);
}

/**
 * Display user's bids (shared logic for callback and text)
 */
async function displayUserBids(chatId: number): Promise<void> {
    // Find transporter
    const result = await findTransporterByChatId(chatId);
    if (!result) {
        await sendMessage(
            chatId,
            "❌ You must be a registered transporter to view bids. Please use /start to verify your phone number.",
        );
        return;
    }

    const { transporter, projectName } = result;

    // Get all bids by this transporter
    const bids = await getBidsByTransporter(transporter.uid, projectName);

    if (bids.length === 0) {
        await sendMessage(
            chatId,
            "📋 You haven't placed any bids yet. Browse load requests to place your first bid!",
        );
        return;
    }

    // Format status with emoji
    const statusEmoji: Record<string, string> = {
        Pending: "⏳",
        Accepted: "✅",
        Rejected: "❌",
        "Counter Offer": "💰",
        Withdrawn: "🚫",
        Expired: "⏰",
    };

    // Send individual message for each bid
    for (const bid of bids) {
        // Get load request info
        const loadRequest = await getLoadRequestById(bid.loadRequestID, projectName);
        const displayID = loadRequest?.displayID || bid.loadRequestID;

        const emoji = statusEmoji[bid.status] || "📌";

        let message = `${emoji} <b>${displayID}</b>\n`;
        message += `💰 Bid: ETB ${bid.pricing.amount.toLocaleString()}\n`;
        message += `🚛 Trucks: ${bid.trucksProvided}\n`;
        message += `📊 Status: ${bid.status}\n`;
        message += `📅 Date: ${formatDate(bid.createdAt.toDate())}\n`;

        if (loadRequest) {
            message += `📍 ${loadRequest.route.origin} → ${loadRequest.route.destination}\n`;
        }

        // Add buttons based on bid status
        if (bid.status === "Accepted" && loadRequest?.status !== "Confirmed") {
            // Show Share Transport Details button for accepted bids
            const externalUrl = getExternalTransportDetailsUrl(
                bid.id,
                transporter.uid,
                projectName,
            );
            await sendMessage(chatId, message, {
                inline_keyboard: [
                    [
                        {
                            text: "📋 Share Transport Details",
                            web_app: { url: externalUrl },
                        },
                    ],
                ],
            });
        } else {
            await sendMessage(chatId, message);
        }
    }

    await sendMessage(chatId, `Total Bids: ${bids.length}`);
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
export function setPendingBidWithExistingId(
    chatId: number,
    bid: PendingBid,
    existingBidId?: string,
): void {
    const pendingBidWithId: PendingBid = {
        ...bid,
        existingBidId: existingBidId || undefined,
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

/**
 * Handle "Accept Counter Offer" button click
 */
async function handleAcceptCounterCallback(
    bot: TelegramBot,
    callbackId: string,
    data: string,
    chatId: number,
    userId?: number,
): Promise<void> {
    const userChatId = userId || chatId;

    try {
        // Find transporter by chat ID
        const result = await findTransporterByChatId(userChatId);
        if (!result) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ You must be a registered transporter. Please use /start to verify your phone number.",
                show_alert: true,
            });
            return;
        }

        const { transporter, projectName } = result;

        // Parse bid ID from callback data
        // Callback data format: ac:<bidId>
        const bidId = data.replace("ac:", "");

        // Get the bid
        const bid = await getBidById(bidId, projectName);
        if (!bid) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ Bid not found.",
                show_alert: true,
            });
            return;
        }

        // Verify this bid belongs to the transporter
        if (bid.transporterId !== transporter.uid) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ This bid does not belong to you.",
                show_alert: true,
            });
            return;
        }

        // Accept the counter offer
        const updatedBid = await acceptCounterOffer(bidId, projectName);

        if (updatedBid) {
            await bot.answerCallbackQuery(callbackId);

            // Get load request to use display ID
            const loadRequest = await getLoadRequestById(bid.loadRequestID, projectName);

            // Send confirmation - negotiation is complete, waiting for cargo owner to allocate trucks
            await sendMessage(
                userChatId,
                `✅ Counter-offer accepted!\n\n` +
                    `📦 Load Request: #${loadRequest?.displayID || bid.loadRequestID}\n` +
                    `💰 Agreed Amount: ETB ${updatedBid.pricing.amount.toLocaleString()}\n` +
                    `🚛 Trucks: ${updatedBid.trucksProvided}\n\n` +
                    `The negotiation is complete. The cargo owner will review and allocate trucks. You will receive a notification with transport details submission deadline once they confirm.`,
            );
            console.log(`✅ Transporter ${transporter.id} accepted counter offer for bid ${bidId} - negotiation complete`);
        } else {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ Failed to accept counter offer. Please try again.",
                show_alert: true,
            });
        }
    } catch (error) {
        console.error("Error accepting counter offer:", error);
        
        // Check if error is about expired deadline
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('expired') || errorMessage.includes('deadline')) {
            await bot.answerCallbackQuery(callbackId, {
                text: "⏰ This counter-offer has expired. The deadline has passed.",
                show_alert: true,
            });
        } else {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ An error occurred. Please try again.",
                show_alert: true,
            });
        }
    }
}

/**
 * Handle "Counter Offer" button click - starts the counter offer flow
 */
async function handleCounterOfferCallback(
    bot: TelegramBot,
    callbackId: string,
    data: string,
    chatId: number,
    userId?: number,
): Promise<void> {
    const userChatId = userId || chatId;

    try {
        // Find transporter by chat ID
        const result = await findTransporterByChatId(userChatId);
        if (!result) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ You must be a registered transporter. Please use /start to verify your phone number.",
                show_alert: true,
            });
            return;
        }

        const { transporter, projectName } = result;

        // Parse bid ID from callback data
        // Callback data format: co:<bidId>
        const bidId = data.replace("co:", "");

        // Get the bid
        const bid = await getBidById(bidId, projectName);
        if (!bid) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ Bid not found.",
                show_alert: true,
            });
            return;
        }

        // Verify this bid belongs to the transporter
        if (bid.transporterId !== transporter.id) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ This bid does not belong to you.",
                show_alert: true,
            });
            return;
        }

        // Get the load request to fetch the display ID
        const loadRequest = await getLoadRequestById(bid.loadRequestID, projectName);
        const displayID = loadRequest?.displayID || bid.loadRequestID;

        // Get the latest counter offer from cargo owner (most recent offer in history)
        const latestCargoOwnerOffer = bid.offerHistory
            ?.filter(offer => offer.offeredBy === 'cargo_owner')
            ?.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

        const counterOfferAmount = latestCargoOwnerOffer?.amount || bid.pricing.amount;
        const counterOfferTrucks = latestCargoOwnerOffer?.trucks || bid.trucksProvided;

        // Store counter offer state for this user with correct display ID
        counterOfferStates.set(userChatId, {
            bidId,
            transporterId: transporter.id,
            projectName,
            loadRequestDisplayID: displayID,
            counterAmount: 0,
            trucks: 0,
            originalBidAmount: bid.pricing.amount,
            cargoOwnerOfferAmount: counterOfferAmount, // Store cargo owner's offer
            timestamp: Date.now(),
        });

        // Answer callback to remove loading state
        await bot.answerCallbackQuery(callbackId);

        // Send message asking for counter offer amount
        const trucksLine = counterOfferTrucks ? `🚛 *Trucks:* ${counterOfferTrucks}\n` : "";
        const message = `
🔄 *Counter Offer*

📦 *Load Request:* ${displayID}

💰 *Counter Offer:* ETB ${counterOfferAmount.toLocaleString()}
💰 *Your Original Bid:* ETB ${bid.pricing.amount.toLocaleString()}
${trucksLine}
👇 *Please enter your counter-offer amount (ETB):*
        `.trim();

        await sendMessage(userChatId, message);

        console.log(`✅ Started counter offer flow for bid ${bidId}`);
    } catch (error) {
        console.error("Error starting counter offer:", error);
        await bot.answerCallbackQuery(callbackId, {
            text: "❌ An error occurred. Please try again.",
            show_alert: true,
        });
    }
}

/**
 * Handle "Confirm Counter Offer" button click
 */
async function handleConfirmCounterOfferCallback(
    bot: TelegramBot,
    callbackId: string,
    _data: string,
    chatId: number,
    userId?: number,
): Promise<void> {
    const userChatId = userId || chatId;

    try {
        // Find transporter by chat ID
        const result = await findTransporterByChatId(userChatId);
        if (!result) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ You must be a registered transporter.",
                show_alert: true,
            });
            return;
        }

        const { transporter, projectName } = result;

        // Get counter offer state
        const state = getCounterOfferStateByChatId(userChatId);
        if (!state) {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ Counter offer session expired. Please start over.",
                show_alert: true,
            });
            return;
        }

        // Submit the counter offer
        const updatedBid = await transporterCounterOffer(
            state.bidId,
            state.counterAmount,
            `${transporter.firstName} ${transporter.lastName || ""}`.trim(),
            projectName,
            state.trucks,
        );

        if (updatedBid) {
            await bot.answerCallbackQuery(callbackId);
            await sendMessage(
                userChatId,
                `✅ Your counter-offer of ETB ${state.counterAmount.toLocaleString()} has been sent to the cargo owner.\n\n` +
                    `📦 Load Request: #${state.loadRequestDisplayID}\n` +
                    `💰 Your Counter-Offer: ETB ${state.counterAmount.toLocaleString()}`,
            );

            // Clear counter offer state
            clearCounterOfferStateByChatId(userChatId);
            counterOfferStates.delete(userChatId);

            console.log(
                `✅ Transporter ${transporter.firstName} ${transporter.lastName} (${transporter.uid}) submitted counter offer for bid ${state.bidId}`,
            );
        } else {
            await bot.answerCallbackQuery(callbackId, {
                text: "❌ Failed to submit counter offer. Please try again.",
                show_alert: true,
            });
        }
    } catch (error) {
        console.error("Error confirming counter offer:", error);
        await bot.answerCallbackQuery(callbackId, {
            text: "❌ An error occurred. Please try again.",
            show_alert: true,
        });
    }
}

/**
 * Handle "Cancel Counter Offer" button click
 */
async function handleCancelCounterOfferCallback(
    bot: TelegramBot,
    callbackId: string,
    _data: string,
    chatId: number,
    userId?: number,
): Promise<void> {
    const userChatId = userId || chatId;

    // Clear counter offer state
    clearCounterOfferStateByChatId(userChatId);
    counterOfferStates.delete(userChatId);

    await bot.answerCallbackQuery(callbackId);
    await sendMessage(userChatId, "❌ Counter offer cancelled.");
}

/**
 * Get counter offer state for a chat
 */
export function getCounterOfferStateByChatId(chatId: number): CounterOfferState | undefined {
    return counterOfferStates.get(chatId);
}

/**
 * Set counter offer state for a chat
 */
export function setCounterOfferStateByChatId(chatId: number, state: CounterOfferState): void {
    counterOfferStates.set(chatId, state);
}

/**
 * Clear counter offer state for a chat
 */
export function clearCounterOfferStateByChatId(chatId: number): void {
    counterOfferStates.delete(chatId);
}

/**
 * Clean up expired counter offer states (older than 10 minutes)
 */
export function cleanupExpiredCounterOfferStates(): void {
    const now = Date.now();
    const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

    for (const [chatId, state] of counterOfferStates.entries()) {
        if (now - state.timestamp > EXPIRY_MS) {
            counterOfferStates.delete(chatId);
            console.log(`Cleaned up expired counter offer state for chat ${chatId}`);
        }
    }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredCounterOfferStates, 5 * 60 * 1000);

