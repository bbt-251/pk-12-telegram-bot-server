import TelegramBot from 'node-telegram-bot-api';
import { getPendingBid, clearPendingBid } from './callback-handler';
import { createBid } from '../services/bid-service';
import { sendMessage } from '../bot';

interface BidState {
  step: 'amount' | 'trucks';
  loadRequestId: string;
  transporterId: string;
  transporterName: string;
  transporterPhone: string;
  projectName: string;
  bidAmount?: number;
}

// In-memory storage for bid state
const bidStates = new Map<number, BidState>();

/**
 * Handle text messages from users
 */
export async function handleMessage(
  bot: TelegramBot,
  chatId: number,
  text: string
): Promise<void> {
  console.log(`📨 Received message: "${text}" from chat ${chatId}`);

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
  bot: TelegramBot,
  chatId: number,
  text: string,
  pendingBid: {
    loadRequestId: string;
    transporterId: string;
    transporterName: string;
    transporterPhone: string;
    projectName: string;
  }
): Promise<void> {
  const state = bidStates.get(chatId);

  // Step 1: Get bid amount
  if (!state || state.step === 'amount') {
    const amount = parseFloat(text.trim());

    if (isNaN(amount) || amount <= 0) {
      await sendMessage(chatId, '❌ Please enter a valid bid amount (e.g., 5000)');
      return;
    }

    // Update state to trucks step
    bidStates.set(chatId, {
      step: 'trucks',
      loadRequestId: pendingBid.loadRequestId,
      transporterId: pendingBid.transporterId,
      transporterName: pendingBid.transporterName,
      transporterPhone: pendingBid.transporterPhone,
      projectName: pendingBid.projectName,
      bidAmount: amount
    });

    await sendMessage(
      chatId,
      `✅ Bid amount: ETB ${amount.toLocaleString()}\n\n🚛 How many trucks can you provide?`,
      {
        inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: `cancel_bid_${pendingBid.loadRequestId}` }]
        ]
      }
    );
  }
  // Step 2: Get number of trucks and create bid
  else if (state.step === 'trucks') {
    const trucks = parseInt(text.trim());

    if (isNaN(trucks) || trucks <= 0) {
      await sendMessage(chatId, '❌ Please enter a valid number of trucks (e.g., 2)');
      return;
    }

    // Create the bid
    try {
      const bid = await createBid(
        pendingBid.loadRequestId,
        pendingBid.transporterId,
        pendingBid.transporterName,
        pendingBid.transporterPhone,
        state.bidAmount!,
        trucks,
        pendingBid.projectName
      );

      // Clear pending bid and state
      clearPendingBid(chatId);
      bidStates.delete(chatId);

      // Send confirmation
      await sendMessage(
        chatId,
        `✅ Bid placed successfully!\n\n` +
        `📦 Load Request: #${pendingBid.loadRequestId}\n` +
        `💰 Bid Amount: ETB ${state.bidAmount!.toLocaleString()}\n` +
        `🚛 Number of Trucks: ${trucks}\n\n` +
        `The cargo owner will review your bid. You will be notified if your bid is accepted.`,
        {
          inline_keyboard: [
            [{ text: '📋 View My Bids', callback_data: 'view_my_bids' }]
          ]
        }
      );

      console.log(`✅ Bid ${bid.id} created successfully`);
    } catch (error) {
      console.error('Error creating bid:', error);
      await sendMessage(chatId, '❌ Failed to place your bid. Please try again.');
      clearPendingBid(chatId);
      bidStates.delete(chatId);
    }
  }
}

/**
 * Clear bid state for a chat
 */
export function clearBidState(chatId: number): void {
  bidStates.delete(chatId);
}