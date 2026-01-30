// Webhook handlers for Telegram Bot (separate from polling)

// Webhook message handler
export function handleWebhookUpdate(): void {
    try {
        // For webhook updates, we need to emit the update to trigger handlers
        // The bot handlers are already set up in bot.ts
        console.log('Webhook update received');
    } catch (error) {
        console.error('Webhook update handling error:', error);
        throw error;
    }
}

// Webhook health check
export function validateWebhookSecret(receivedSecret: string | undefined): boolean {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expectedSecret) {
        console.error('TELEGRAM_WEBHOOK_SECRET not configured');
        return false;
    }

    if (!receivedSecret) {
        console.error('No secret provided in webhook request');
        return false;
    }

    return receivedSecret === expectedSecret;
}

// Manual polling implementation for telegram-bot-kit
export class PollingManager {
    private intervalId?: NodeJS.Timeout | undefined;
    private isPolling = false;

    start(intervalMs: number = 30000): void {
        if (this.isPolling) {
            console.log('Polling already active');
            return;
        }

        console.log(`Starting manual polling with ${intervalMs}ms interval`);
        this.isPolling = true;

        // Note: telegram-bot-kit doesn't have built-in polling
        // This is a placeholder for manual polling implementation
        // For production polling, consider switching to node-telegram-bot-api

        this.intervalId = setInterval(() => {
            // Manual polling would go here if implemented
            console.log('Polling interval tick (manual polling not implemented in telegram-bot-kit)');
        }, intervalMs);
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        this.isPolling = false;
        console.log('Polling stopped');
    }

    isActive(): boolean {
        return this.isPolling;
    }
}

export const pollingManager = new PollingManager();