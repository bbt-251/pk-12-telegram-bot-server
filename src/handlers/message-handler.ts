import TelegramBot from "node-telegram-bot-api";
import { sendMessage } from "../bot";
import { createBid, updateLowestBidAndTelegram } from "../services/bid-service";
import {
    clearPendingBid,
    getPendingBid,
    updatePendingBid,
    handleViewMyBidsText,
    getCounterOfferStateByChatId,
} from "./callback-handler";

interface BidState {
    step: "amount" | "trucks" | "confirm";
    loadRequestId: string;
    displayID: string;
    transporterId: string;
    transporterName: string;
    transporterPhone: string;
    projectName: string;
    bidAmount?: number;
    numberOfTrucks?: number;
    existingBidId?: string | undefined; // Track if editing existing bid
}

// In-memory storage for bid state
const bidStates = new Map<number, BidState>();

/**
 * Handle text messages from users
 */
export async function handleMessage(bot: TelegramBot, chatId: number, text: string): Promise<void> {
    console.log(`📨 Received message: "${text}" from chat ${chatId}`);

    // Handle "View My Bids" text button
    if (text === "📋 View My Bids") {
        await handleViewMyBidsText(chatId);
        return;
    }

    // Check if user is in the middle of placing a bid
    const pendingBid = getPendingBid(chatId);

    if (pendingBid) {
        await handleBidFlow(bot, chatId, text, pendingBid);
    }
}

/**
 * Handle bid placement flow (amount -> number of trucks)
 */
async function handleBidFlow(
    _bot: TelegramBot,
    chatId: number,
    text: string,
    pendingBid: {
        loadRequestId: string;
        displayID: string;
        transporterId: string;
        transporterName: string;
        transporterPhone: string;
        projectName: string;
        existingBidId?: string | undefined;
    },
): Promise<void> {
    const state = bidStates.get(chatId);

    // Step 0: Show confirmation (after entering trucks)
    if (state?.step === "confirm") {
        const trucks = parseInt(text.trim());

        if (isNaN(trucks) || trucks <= 0) {
            await sendMessage(chatId, "❌ Please enter a valid number of trucks (e.g., 2)");
            return;
        }

        // Update state with trucks
        bidStates.set(chatId, {
            ...state,
            step: "confirm",
            numberOfTrucks: trucks,
        });

        // Show confirmation
        await showBidConfirmation(
            chatId,
            state.bidAmount!,
            trucks,
            state.loadRequestId,
            state.displayID,
        );
        return;
    }

    // Step 1: Get bid amount
    if (!state || state.step === "amount") {
        const amount = parseFloat(text.trim());

        if (isNaN(amount) || amount <= 0) {
            await sendMessage(chatId, "❌ Please enter a valid bid amount (e.g., 5000)");
            return;
        }

        // Update state to trucks step
        bidStates.set(chatId, {
            step: "trucks",
            loadRequestId: pendingBid.loadRequestId,
            displayID: pendingBid.displayID,
            transporterId: pendingBid.transporterId,
            transporterName: pendingBid.transporterName,
            transporterPhone: pendingBid.transporterPhone,
            projectName: pendingBid.projectName,
            bidAmount: amount,
            existingBidId: state?.existingBidId || pendingBid.existingBidId, // Preserve existing bid ID if editing
        });

        const actionText = state?.existingBidId ? "Updated bid amount" : "Bid amount";
        await sendMessage(
            chatId,
            `✅ ${actionText}: ETB ${amount.toLocaleString()}\n\n🚛 How many trucks can you provide?`,
            {
                inline_keyboard: [
                    [
                        {
                            text: "❌ Cancel",
                            callback_data: `cancel_bid_${pendingBid.loadRequestId}`,
                        },
                    ],
                ],
            },
        );
    }
    // Step 2: Get number of trucks and show confirmation
    else if (state.step === "trucks") {
        const trucks = parseInt(text.trim());

        if (isNaN(trucks) || trucks <= 0) {
            await sendMessage(chatId, "❌ Please enter a valid number of trucks (e.g., 2)");
            return;
        }

        // Update state with trucks and move to confirm step
        bidStates.set(chatId, {
            ...state,
            step: "confirm",
            numberOfTrucks: trucks,
        });

        // Show confirmation
        await showBidConfirmation(
            chatId,
            state.bidAmount!,
            trucks,
            state.loadRequestId,
            state.displayID,
        );
    }
}

/**
 * Show bid confirmation with Confirm, Edit, Cancel buttons
 */
async function showBidConfirmation(
    chatId: number,
    bidAmount: number,
    trucks: number,
    loadRequestId: string,
    displayID: string,
): Promise<void> {
    await sendMessage(
        chatId,
        `📋 Bid Summary\n\n` +
            `📦 Load Request: #${displayID}\n` +
            `💰 Bid Amount: ETB ${bidAmount.toLocaleString()}\n` +
            `🚛 Number of Trucks: ${trucks}\n\n` +
            `Please confirm your bid:`,
        {
            inline_keyboard: [
                [
                    { text: "✅ Confirm", callback_data: `confirm_bid_${displayID}` },
                    { text: "✏️ Edit", callback_data: `edit_bid_${displayID}` },
                ],
                [{ text: "❌ Cancel", callback_data: `cancel_bid_${loadRequestId}` }],
            ],
        },
    );
}

/**
 * Confirm and submit the bid
 */
export async function confirmBid(chatId: number): Promise<void> {
    const state = bidStates.get(chatId);
    if (!state || state.step !== "confirm" || !state.numberOfTrucks) {
        return;
    }

    // Get pending bid info
    const pendingBid = getPendingBid(chatId);
    if (!pendingBid) {
        await sendMessage(chatId, "❌ Bid session expired. Please start over.");
        bidStates.delete(chatId);
        return;
    }

    // Create or update the bid
    try {
        if (state.existingBidId) {
            await sendMessage(
                chatId,
                "❌ Updating bids is not allowed. Each user can submit only one bid per load-request.",
            );
            clearPendingBid(chatId);
            bidStates.delete(chatId);
            return;
        }

        // Create new bid
        const bid = await createBid(
            pendingBid.loadRequestId,
            pendingBid.transporterId,
            pendingBid.transporterName,
            state.bidAmount!,
            state.numberOfTrucks,
            pendingBid.projectName,
        );

        // Update lowest bid and Telegram message
        try {
            await updateLowestBidAndTelegram(
                pendingBid.loadRequestId,
                state.bidAmount!,
                pendingBid.projectName,
            );
        } catch (updateError) {
            console.error("Error updating lowest bid and Telegram:", updateError);
        }

        // Clear pending bid and state
        clearPendingBid(chatId);
        bidStates.delete(chatId);

        await sendMessage(
            chatId,
            `✅ Bid placed successfully!\n\n` +
                `📦 Load Request: #${pendingBid.displayID}\n` +
                `💰 Bid Amount: ETB ${state.bidAmount!.toLocaleString()}\n` +
                `🚛 Number of Trucks: ${state.numberOfTrucks}\n\n` +
                `The cargo owner will review your bid. You will be notified if your bid is accepted.`,
            {
                inline_keyboard: [[{ text: "📋 View My Bids", callback_data: "view_my_bids" }]],
            },
        );

        console.log(`✅ Bid ${bid.id} placed successfully`);
    } catch (error) {
        console.error("Error creating bid:", error);
        await sendMessage(chatId, "❌ Failed to place your bid. Please try again.");
        clearPendingBid(chatId);
        bidStates.delete(chatId);
    }
}

/**
 * Restart the bid flow from the beginning (for edit)
 */
export async function restartBidFlow(chatId: number): Promise<void> {
    const pendingBid = getPendingBid(chatId);
    if (!pendingBid) {
        await sendMessage(chatId, "❌ Bid session expired. Please start over.");
        bidStates.delete(chatId);
        return;
    }

    // Clear the current bid state
    bidStates.delete(chatId);

    // Update pending bid to remove existing bid ID (start fresh)
    updatePendingBid(chatId, { existingBidId: undefined });

    // Also clear the bid state to restart from amount step
    bidStates.delete(chatId);

    // Restart from bid amount
    await sendMessage(chatId, "💰 Please enter your bid amount (ETB):", {
        inline_keyboard: [
            [
                {
                    text: "❌ Cancel",
                    callback_data: `cancel_bid_${pendingBid.loadRequestId}`,
                },
            ],
        ],
    });
}

/**
 * Clear bid state for a chat
 */
export function clearBidState(chatId: number): void {
    bidStates.delete(chatId);
}

/**
 * Handle counter offer amount input from user
 */
export async function handleCounterOfferAmount(
    _bot: TelegramBot,
    chatId: number,
    amountText: string,
): Promise<void> {
    const amount = parseFloat(amountText.trim());

    if (isNaN(amount) || amount <= 0) {
        await sendMessage(chatId, "❌ Please enter a valid counter-offer amount (e.g., 5000)");
        return;
    }

    // Get counter offer state
    const state = getCounterOfferStateByChatId(chatId);
    if (!state) {
        await sendMessage(chatId, "❌ Counter offer session expired. Please start over.");
        return;
    }

    // Update state with counter amount
    state.counterAmount = amount;

    // Show confirmation with buttons
    await sendMessage(
        chatId,
        `💰 Confirm your counter-offer:\n\n` +
            `📦 Load Request: #${state.loadRequestDisplayID}\n` +
            `💰 Original Bid: ETB ${state.originalBidAmount.toLocaleString()}\n` +
            `💰 Your Counter-Offer: ETB ${amount.toLocaleString()}\n\n` +
            `Do you want to proceed?`,
        {
            inline_keyboard: [
                [
                    {
                        text: "✅ Confirm",
                        callback_data: `confirm_counter_${state.bidId}_${amount}`,
                    },
                    { text: "❌ Cancel", callback_data: `cancel_counter_${state.bidId}` },
                ],
            ],
        },
    );
}

