import {
    getHealthyDbInstances,
    retryDatabaseOperation,
    getExternalBidUrl,
} from '../firebase-config';
import { Bid, BidStatus, OfferHistory, PackageBid, PackageBidStatus } from '../models/bid';
import { LoadRequest, LowestBidInfo } from '../models/load-request';
import admin from 'firebase-admin';

/**
 * Create a new bid for a load request
 */
export async function createBid(
    loadRequestId: string,
    transporterId: string,
    transporterName: string,
    bidAmount: number,
    numberOfTrucks: number,
    projectName: string,
): Promise<Bid> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    // Strip Firebase project ID prefix from load request ID if present
    const { firebaseConfigs } = await import('../firebase-config');
    const firebaseProjectId = firebaseConfigs[projectName]?.projectId;
    let actualLoadRequestId = loadRequestId;
    if (firebaseProjectId && loadRequestId.startsWith(`${firebaseProjectId}_`)) {
        actualLoadRequestId = loadRequestId.replace(`${firebaseProjectId}_`, '');
    }

    const now = new Date().toISOString();
    const bidRef = db.collection('bids').doc();
    const bidId = bidRef.id;

    // Fetch the load request to initialize packageBids
    const loadRequest = await getLoadRequestById(actualLoadRequestId, projectName);

    const initialOffer: OfferHistory = {
        id: `offer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        amount: bidAmount,
        currency: 'ETB',
        status: 'pending',
        trucks: numberOfTrucks,
        offeredBy: 'transporter',
        offeredByName: transporterName,
        timestamp: now,
    };

    // Initialize packageBids from loadRequest
    const packageBids: PackageBid[] = [];
    if (loadRequest?.cargo?.packageGroups) {
        loadRequest.cargo.packageGroups.forEach((group: any) => {
            group.packages.forEach((pkg: any) => {
                packageBids.push({
                    packageGroupId: group.id,
                    packageGroupData: {
                        id: group.id,
                        packagingType: group.packagingType,
                        numberOfTrucks: group.numberOfTrucks || '1',
                    },
                    packageItemId: pkg.id,
                    packageItemData: {
                        id: pkg.id,
                        length: pkg.length,
                        width: pkg.width,
                        height: pkg.height,
                        weight: pkg.weight,
                        quantity: pkg.quantity,
                        containerSize: pkg.containerSize,
                        containerType: pkg.containerType,
                        containerNumber: pkg.containerNumber,
                        containerVariant: pkg.containerVariant,
                    },
                    bidAmount: bidAmount,
                    trucksProvided: numberOfTrucks,
                    status: PackageBidStatus.PENDING,
                    offerHistory: [initialOffer],
                } as PackageBid);
            });
        });
    }

    const bid: Bid = {
        id: bidId,
        loadRequestID: actualLoadRequestId,
        transporterId,
        transporterName,
        pricing: {
            amount: bidAmount,
            currency: 'ETB',
            includesInsurance: false,
            includesFuel: true,
        },
        trucksProvided: numberOfTrucks,
        status: BidStatus.PENDING,
        isWinner: false,
        isAccepted: false,
        ...(packageBids.length > 0 ? { packageBids } : {}),
        offerHistory: [initialOffer],
        createdAt: admin.firestore.Timestamp.fromDate(new Date(now)),
        updatedAt: admin.firestore.Timestamp.fromDate(new Date(now)),
    };

    await retryDatabaseOperation(
        async () => {
            await bidRef.set(bid);
        },
        2,
        1000,
        projectName,
    );

    console.log(
        `✅ Created bid ${bidId} for load ${actualLoadRequestId} by transporter ${transporterId}`,
    );
    return bid;
}

/**
 * Check if transporter has already bid on a load request
 * Returns the bid if it exists and is not accepted, null otherwise
 */
export async function hasExistingBid(
    loadRequestId: string,
    transporterId: string,
    projectName: string,
): Promise<boolean> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    // Strip Firebase project ID prefix if present
    const { firebaseConfigs } = await import('../firebase-config');
    const firebaseProjectId = firebaseConfigs[projectName]?.projectId;
    let actualLoadRequestId = loadRequestId;
    if (firebaseProjectId && loadRequestId.startsWith(`${firebaseProjectId}_`)) {
        actualLoadRequestId = loadRequestId.replace(`${firebaseProjectId}_`, '');
    }

    const query = await retryDatabaseOperation(
        async () => {
            return await db
                .collection('bids')
                .where('loadRequestID', '==', actualLoadRequestId)
                .where('transporterId', '==', transporterId)
                .limit(1)
                .get();
        },
        2,
        1000,
        projectName,
    );

    return !query.empty;
}

/**
 * Get existing bid by transporter and load request
 * Returns the bid if it exists, null otherwise
 */
export async function getExistingBid(
    loadRequestId: string,
    transporterId: string,
    projectName: string,
): Promise<{ bid: Bid } | null> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    // Strip Firebase project ID prefix if present
    const { firebaseConfigs } = await import('../firebase-config');
    const firebaseProjectId = firebaseConfigs[projectName]?.projectId;
    let actualLoadRequestId = loadRequestId;
    if (firebaseProjectId && loadRequestId.startsWith(`${firebaseProjectId}_`)) {
        actualLoadRequestId = loadRequestId.replace(`${firebaseProjectId}_`, '');
    }

    const query = await retryDatabaseOperation(
        async () => {
            return await db
                .collection('bids')
                .where('loadRequestID', '==', actualLoadRequestId)
                .where('transporterId', '==', transporterId)
                .limit(1)
                .get();
        },
        2,
        1000,
        projectName,
    );

    if (query.empty) {
        return null;
    }

    const doc = query.docs[0];
    if (!doc) {
        return null;
    }

    const bid = { id: doc.id, ...doc.data() } as Bid;

    return { bid };
}

/**
 * Update an existing bid
 */
export async function updateBid(
    bidId: string,
    updates: {
        bidAmount?: number;
        numberOfTrucks?: number;
    },
    projectName: string,
): Promise<Bid> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const docRef = db.collection('bids').doc(bidId);
    const bidDoc = await docRef.get();
    if (!bidDoc.exists) {
        throw new Error('Bid not found');
    }
    const existingBid = { id: bidDoc.id, ...bidDoc.data() } as Bid;

    const now = new Date().toISOString();
    const updateData: any = {
        updatedAt: admin.firestore.Timestamp.fromDate(new Date(now)),
    };

    const newBidAmount = updates.bidAmount ?? existingBid.pricing.amount;
    const newTrucks = updates.numberOfTrucks ?? existingBid.trucksProvided;

    const initialOffer: OfferHistory = {
        id: `offer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        amount: newBidAmount,
        currency: existingBid.pricing.currency,
        status: 'pending',
        trucks: newTrucks,
        offeredBy: 'transporter',
        offeredByName: 'Transporter',
        timestamp: now,
    };

    if (updates.bidAmount !== undefined) {
        updateData['pricing.amount'] = updates.bidAmount;
    }

    if (updates.numberOfTrucks !== undefined) {
        updateData['trucksProvided'] = updates.numberOfTrucks;
    }

    // Mirror updates in packageBids if they exist
    if (existingBid.packageBids && existingBid.packageBids.length > 0) {
        updateData.packageBids = existingBid.packageBids.map(pkgBid => ({
            ...pkgBid,
            bidAmount: updates.bidAmount ?? pkgBid.bidAmount,
            trucksProvided: updates.numberOfTrucks ?? pkgBid.trucksProvided,
            offerHistory: [...(pkgBid.offerHistory || []), initialOffer],
        }));
    }

    // Still update top-level offerHistory for now
    updateData.offerHistory = admin.firestore.FieldValue.arrayUnion(initialOffer);

    await retryDatabaseOperation(
        async () => {
            await docRef.update(updateData);
        },
        2,
        1000,
        projectName,
    );

    // Fetch and return updated bid
    const doc = await retryDatabaseOperation(
        async () => {
            return await db.collection('bids').doc(bidId).get();
        },
        2,
        1000,
        projectName,
    );

    return { id: doc.id, ...doc.data() } as Bid;
}

/**
 * Get a load request by ID
 */
export async function getLoadRequestById(
    loadRequestId: string,
    projectName: string,
): Promise<LoadRequest | null> {
    const healthyDbs = await getHealthyDbInstances();
    const db = healthyDbs[projectName];
    if (!db) {
        console.log(`Database for project ${projectName} is not available`);
        return null;
    }

    // Get the Firebase project ID for this project
    const { firebaseConfigs } = await import('../firebase-config');
    const firebaseProjectId = firebaseConfigs[projectName]?.projectId;

    // Strip Firebase project ID prefix if present (e.g., pk-12-development_xxx)
    let docId = loadRequestId;
    if (firebaseProjectId && loadRequestId.startsWith(`${firebaseProjectId}_`)) {
        docId = loadRequestId.replace(`${firebaseProjectId}_`, '');
    }

    // Fetch the document
    const doc = await retryDatabaseOperation(
        async () => {
            return await db.collection('loadRequests').doc(docId).get();
        },
        2,
        1000,
        projectName,
    );

    if (!doc.exists) {
        return null;
    }

    const loadRequest = { id: doc.id, ...doc.data() } as LoadRequest;

    // If load request has a projectId field, validate it matches the expected project
    if (loadRequest.projectId && loadRequest.projectId !== projectName) {
        console.log(
            `Warning: Load request ${loadRequestId} has projectId=${loadRequest.projectId} but was queried from ${projectName}`,
        );
        return null;
    }

    return loadRequest;
}

/**
 * Get all bids by a specific transporter
 */
export async function getBidsByTransporter(
    transporterId: string,
    projectName: string,
): Promise<Bid[]> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const query = await retryDatabaseOperation(
        async () => {
            return await db
                .collection('bids')
                .where('transporterId', '==', transporterId)
                .orderBy('createdAt', 'desc')
                .get();
        },
        2,
        1000,
        projectName,
    );

    return query.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Bid);
}

/**
 * Get all bids for a load request
 */
export async function getBidsForLoadRequest(
    loadRequestId: string,
    projectName: string,
): Promise<Bid[]> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    // Strip Firebase project ID prefix if present
    const { firebaseConfigs } = await import('../firebase-config');
    const firebaseProjectId = firebaseConfigs[projectName]?.projectId;
    let actualLoadRequestId = loadRequestId;
    if (firebaseProjectId && loadRequestId.startsWith(`${firebaseProjectId}_`)) {
        actualLoadRequestId = loadRequestId.replace(`${firebaseProjectId}_`, '');
    }

    const query = await retryDatabaseOperation(
        async () => {
            return await db
                .collection('bids')
                .where('loadRequestID', '==', actualLoadRequestId)
                .get();
        },
        2,
        1000,
        projectName,
    );

    return query.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Bid);
}

/**
 * Get the lowest bid for a load request
 */
export async function getLowestBid(
    loadRequestId: string,
    projectName: string,
): Promise<Bid | null> {
    const bids = await getBidsForLoadRequest(loadRequestId, projectName);

    if (bids.length === 0) {
        return null;
    }

    // Find the bid with the lowest amount
    let lowestBid: Bid | null = null;
    for (const bid of bids) {
        if (!lowestBid || bid.pricing.amount < lowestBid.pricing.amount) {
            lowestBid = bid;
        }
    }

    return lowestBid;
}

/**
 * Update lowest bid and Telegram message for a load request
 * This function can be called when a bid is created or updated
 * It finds the lowest bid from all bids and updates the load request if the new bid is lower
 */
export async function updateLowestBidAndTelegram(
    loadRequestId: string,
    newBidAmount: number,
    projectName: string,
): Promise<void> {
    try {
        // Get load request
        const loadRequest = await getLoadRequestById(loadRequestId, projectName);
        if (!loadRequest) {
            console.error(`Load request ${loadRequestId} not found`);
            return;
        }

        // Only update if procurement mode is bidding and carrierBidVisibility is true
        if (
            loadRequest.biddingSettings?.procurementMode !== 'bidding' ||
            !loadRequest.biddingSettings?.carrierBidVisibility
        ) {
            return;
        }

        const currentLowestBid: number = loadRequest.lowestBid?.amount || newBidAmount;

        const shouldUpdate: boolean = Number(newBidAmount) <= Number(currentLowestBid);

        console.log(`📊 Bid comparison for load ${loadRequestId}:`);
        console.log(`   New bid: ETB ${newBidAmount.toLocaleString()}`);
        console.log(
            `   lowest bid amount (from load request data): ETB ${currentLowestBid?.toLocaleString() || 'N/A'}`,
        );
        console.log(`   new bid amount to compare: ETB ${newBidAmount.toLocaleString()}`);
        console.log(`   Should update (new < actual)? ${shouldUpdate}`);

        // Only update if the new bid is strictly lower than the current lowest
        if (!shouldUpdate) {
            console.log(`✅ New bid is not lower than lowest bid, skipping telegram update`);
            return;
        }

        // Import Firestore functions
        const db = (await getHealthyDbInstances())[projectName];
        if (!db) {
            throw new Error(`Database for project ${projectName} is not available`);
        }

        // Update load request with new lowest bid
        const now = new Date().toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });

        const lowestBidData: LowestBidInfo = {
            amount: newBidAmount,
            currency: 'ETB',
            updatedAt: now,
        };

        // Use the actual document ID from the fetched load request (may be different from input if prefix was stripped)
        const actualLoadRequestId = loadRequest.id;

        await retryDatabaseOperation(
            async () => {
                await db.collection('loadRequests').doc(actualLoadRequestId).update({
                    lowestBid: lowestBidData,
                    updatedAt: now,
                });
            },
            2,
            1000,
            projectName,
        );

        console.log(
            `✅ Updated lowest bid for load request ${actualLoadRequestId}: ETB ${newBidAmount.toLocaleString()}`,
        );

        // Update Telegram message if it exists
        if (loadRequest.telegramMessageId) {
            try {
                await editTelegramMessage(loadRequestId, lowestBidData, projectName);
                console.log(
                    `✅ Telegram message updated with new lowest bid for load request ${loadRequestId}`,
                );
            } catch (telegramError) {
                console.error('Failed to update Telegram message with lowest bid:', telegramError);
                // Don't fail operation if Telegram fails
            }
        }
    } catch (error) {
        console.error('Error updating lowest bid and Telegram:', error);
        throw error;
    }
}

/**
 * Edit Telegram message with updated lowest bid info (using main platform format)
 */
async function editTelegramMessage(
    loadRequestId: string,
    lowestBid: LowestBidInfo,
    projectName: string,
): Promise<void> {
    // Get the load request to find the telegram message ID
    const loadRequest = await getLoadRequestById(loadRequestId, projectName);
    if (!loadRequest || !loadRequest.telegramMessageId) {
        console.log(`📝 No Telegram message ID for load ${loadRequestId}, skipping message edit`);
        return;
    }

    // Get the chat ID from environment variables
    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    if (!channelId) {
        console.error('TELEGRAM_CHANNEL_ID environment variable not set');
        return;
    }

    // Ensure channel ID has correct format
    if (!channelId.startsWith('@') && !channelId.startsWith('-100')) {
        console.warn(
            `⚠️ Channel ID "${channelId}" may be invalid. Expected format: @channelname or -100xxxxxxxxxx`,
        );
    }

    // Format the new message with lowest bid (using main platform format)
    const messageText = await formatLoadRequestMessageWithLowestBid(loadRequest, lowestBid);

    // Build inline keyboard with "Place Bid" button using Telegram Mini App web_app
    // Use 'public' as transporterId for unauthenticated access (auth handled via token)
    // Use the projectName from the load request to determine the correct environment
    const replyMarkup = {
        inline_keyboard: [
            [
                {
                    text: '💰 Place Bid',
                    web_app: {
                        url: getExternalBidUrl(loadRequest.id, 'public', projectName),
                    },
                },
            ],
        ],
    };

    // Import bot from bot.ts (using dynamic import to avoid circular dependency)
    const { bot } = await import('../bot');

    // Edit the message with inline keyboard - but don't retry if MESSAGE_ID_INVALID
    try {
        await bot.editMessageText(messageText, {
            chat_id: channelId,
            message_id: loadRequest.telegramMessageId,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup,
        });
        console.log(`✅ Telegram message updated successfully`);
    } catch (error: unknown) {
        const telegramError = error as {
            code?: string;
            response?: { body?: { description?: string } };
        };
        if (
            telegramError.code === 'ETELEGRAM' &&
            telegramError.response?.body?.description?.includes('MESSAGE_ID_INVALID')
        ) {
            console.warn(
                `⚠️ Message ID ${loadRequest.telegramMessageId} not accessible in channel ${channelId}. Skipping edit.`,
            );
            console.warn(
                `   This is expected if: 1) message was deleted, 2) bot isn't admin, 3) message was posted by another bot`,
            );
        } else {
            throw error; // Re-throw other errors
        }
    }
}

/**
 * Format load request message with lowest bid info for Telegram (main platform format)
 */
async function formatLoadRequestMessageWithLowestBid(
    loadRequest: LoadRequest,
    lowestBid: LowestBidInfo,
): Promise<string> {
    const {
        displayID,
        route,
        schedule,
        cargo,
        cargoTotals,
        truckRequirements,
        paymentTerms,
        status,
        createdAt,
        biddingSettings,
    } = loadRequest;

    // Format dates
    const formatDate = (dateStr?: string): string => {
        if (!dateStr) return 'N/A';
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return dateStr;
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = String(d.getFullYear()).slice(-2);
        return `${day}/${month}/${year}`;
    };

    // Format budget
    const formatBudget = (budget?: string): string => {
        if (!budget || budget === 'N/A') return 'N/A';
        const numeric = Number(String(budget).replace(/,/g, ''));
        if (Number.isNaN(numeric)) return budget;
        return `ETB ${Number(numeric).toLocaleString()}`;
    };

    // Get package types
    const packageTypes =
        cargo.packageGroups
            ?.map(pg => (pg as { packagingType?: string }).packagingType)
            .filter(Boolean)
            .join(', ') || 'N/A';

    // Format container info for containerized packages
    const containerInfoLines: string[] = [];
    cargo.packageGroups?.forEach(pg => {
        const packageGroup = pg as {
            packagingType?: string;
            packages?: Array<{
                containerType?: string;
                containerVariant?: string;
                quantity?: number;
            }>;
        };
        if (packageGroup.packagingType === 'Containerized' && packageGroup.packages) {
            packageGroup.packages.forEach(pkg => {
                if (pkg.containerType || pkg.containerVariant) {
                    const quantity = pkg.quantity || 1;
                    const containerSize = pkg.containerType || 'N/A';
                    const containerType = pkg.containerVariant || 'N/A';
                    containerInfoLines.push(`${quantity} x ${containerSize}(${containerType})`);
                }
            });
        }
    });

    // Format special requirements
    const specialRequirements: string[] = [];
    if (cargo.fragile) specialRequirements.push('Fragile');
    if (cargo.hazardous) specialRequirements.push('Hazardous');
    if (cargo.temperatureControlled) specialRequirements.push('Temp Controlled');
    if (cargo.oversized) specialRequirements.push('Oversized');

    // Format budget range
    const minBudget = paymentTerms.minBudget ? formatBudget(paymentTerms.minBudget) : 'N/A';
    const maxBudget = paymentTerms.maxBudget ? formatBudget(paymentTerms.maxBudget) : 'N/A';
    const budgetDisplay =
        minBudget !== 'N/A' && maxBudget !== 'N/A'
            ? `${minBudget} – ${maxBudget}`
            : minBudget !== 'N/A'
                ? minBudget
                : maxBudget !== 'N/A'
                    ? maxBudget
                    : 'N/A';

    // Format lowest bid
    const lowestBidDisplay = lowestBid
        ? `💎 *Lowest Bid:* ${lowestBid.currency} ${lowestBid.amount.toLocaleString()}\n`
        : '';

    const message = `
🚛 *Load Request - ${displayID}*

📍 *Route:* ${route.origin} → ${route.destination}
📌 *Via:* ${route.routeVia ? 'See route details' : 'N/A'}
📅 *Pickup:* ${formatDate(schedule.pickupDate)}
📅 *Delivery:* ${formatDate(schedule.deliveryDate)}

📦 *Cargo:* ${cargo.cargoType}
📦 *Package Types:* ${packageTypes}
${containerInfoLines.length > 0 ? `📦 *Container Info:*\n${containerInfoLines.map(info => `   ${info}`).join('\n')}\n` : ''}
⚖️ *Weight:* ${cargoTotals.totalWeight} KG
📏 *Volume:* ${cargoTotals.totalVolume} m³
⚠️ *Special:* ${specialRequirements.join(', ')}\n
📝 *Description:* ${cargo.description || 'N/A'}
🚛 *Truck Type:* ${truckRequirements.truckBodyType}
🔢 *Trucks Needed:* ${truckRequirements.numberOfTrucks}
⏰ *Bid Deadline:* ${formatDate(biddingSettings?.bidDeadline)}
💰 *Budget:* ${budgetDisplay}
${lowestBidDisplay}
📊 *Status:* ${status}
🕒 *Posted:* ${formatDate(createdAt)}
   `.trim();

    return message;
}

/**
 * Accept a counter offer - only updates offerHistory, does NOT change bid status to Accepted
 * The bid status will be changed to Accepted later when cargo owner allocates trucks
 */
export async function acceptCounterOffer(bidId: string, projectName: string): Promise<Bid | null> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const docRef = db.collection('bids').doc(bidId);
    const doc = await retryDatabaseOperation(
        async () => {
            return await docRef.get();
        },
        2,
        1000,
        projectName,
    );

    if (!doc.exists) {
        console.log(`Bid ${bidId} not found`);
        return null;
    }

    const existingBid = { id: doc.id, ...doc.data() } as Bid;

    // Use the first package's history as the master if top-level is empty or missing
    // In our new model, we should probably prefer packageBids[0].offerHistory
    const masterHistory = (existingBid.packageBids && existingBid.packageBids[0]?.offerHistory)
        || existingBid.offerHistory || [];

    // Find the latest cargo owner counter-offer
    const latestCargoOwnerOffer = masterHistory
        .slice()
        .reverse()
        .find(offer => offer.offeredBy === 'cargo_owner' && offer.status === 'pending');

    // Check if the counter-offer has expired
    if (latestCargoOwnerOffer?.deadline) {
        const deadlineDate = new Date(latestCargoOwnerOffer.deadline);
        const now = new Date();

        if (now > deadlineDate) {
            console.log(`❌ Counter-offer for bid ${bidId} has expired. Deadline was ${latestCargoOwnerOffer.deadline}`);
            throw new Error('Counter-offer has expired. The deadline has passed.');
        }
    }

    // Determine final values from the accepted offer
    const finalAmount = latestCargoOwnerOffer?.amount || existingBid.pricing.amount;
    const finalTrucks = latestCargoOwnerOffer?.trucks || existingBid.trucksProvided;

    // Prepare update data
    const updateData: Record<string, unknown> = {
        updatedAt: admin.firestore.Timestamp.now(),
    };

    // Update only the targeted package bid
    if (existingBid.packageBids && existingBid.packageBids.length > 0) {
        const packageBids = [...existingBid.packageBids];

        // Find which package has the offer we are accepting
        let targetIndex = -1;
        if (latestCargoOwnerOffer) {
            targetIndex = packageBids.findIndex(pb =>
                (pb.offerHistory || []).some(o => o.id === latestCargoOwnerOffer?.id)
            );
        }

        // Fallback to first package for legacy data/safety
        if (targetIndex === -1) targetIndex = 0;

        const pkgBid = packageBids[targetIndex];
        if (pkgBid) {
            const pkgHistory = pkgBid.offerHistory || [];
            const updatedPkgHistory = pkgHistory.map((offer) => {
                if (
                    latestCargoOwnerOffer &&
                    offer.id === latestCargoOwnerOffer.id
                ) {
                    return { ...offer, status: 'accepted' as const };
                }
                return offer;
            });

            packageBids[targetIndex] = {
                ...pkgBid,
                status: PackageBidStatus.PENDING,
                bidAmount: finalAmount,
                trucksProvided: finalTrucks,
                offerHistory: updatedPkgHistory
            } as any;
            updateData.packageBids = packageBids;

            // Also update top-level status to Pending if agreement reached
            updateData.status = BidStatus.PENDING;
            updateData['pricing.amount'] = finalAmount;
            updateData.trucksProvided = finalTrucks;
        }
    }

    // Still update top-level offerHistory for deprecated compatibility
    if (existingBid.offerHistory && existingBid.offerHistory.length > 0) {
        const updatedHistory = existingBid.offerHistory.map((offer, index) => {
            if (
                offer.offeredBy === 'cargo_owner' &&
                offer.status === 'pending' &&
                index === existingBid.offerHistory!.length - 1
            ) {
                return { ...offer, status: 'accepted' as const };
            }
            return offer;
        });
        updateData.offerHistory = updatedHistory;
    }

    // Update ONLY the offerHistory and packageBids - DO NOT change bid status to Accepted
    await retryDatabaseOperation(
        async () => {
            await docRef.update(updateData);
        },
        2,
        1000,
        projectName,
    );

    console.log(`✅ Counter offer accepted in offerHistory for bid ${bidId} - waiting for cargo owner to allocate trucks`);

    // Return updated bid
    const updatedDoc = await retryDatabaseOperation(
        async () => {
            return await docRef.get();
        },
        2,
        1000,
        projectName,
    );

    return { id: updatedDoc.id, ...updatedDoc.data() } as Bid;
}

/**
 * Transporter counters a counter offer - adds a new counter offer to the history
 */
export async function transporterCounterOffer(
    bidId: string,
    amount: number,
    transporterName: string,
    projectName: string,
    trucksToAllocate: number,
    packageItemId?: string,
    packageGroupId?: string,
): Promise<Bid | null> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const docRef = db.collection('bids').doc(bidId);
    const doc = await retryDatabaseOperation(
        async () => {
            return await docRef.get();
        },
        2,
        1000,
        projectName,
    );

    if (!doc.exists) {
        console.log(`Bid ${bidId} not found`);
        return null;
    }

    const existingBid = { id: doc.id, ...doc.data() } as Bid;

    const now = new Date().toISOString();

    // Add transporter counter offer to history
    const counterOffer: OfferHistory = {
        id: `offer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        amount,
        currency: existingBid.pricing.currency,
        status: 'pending',
        trucks: trucksToAllocate,
        offeredBy: 'transporter',
        offeredByName: transporterName,
        timestamp: now,
    };

    // Prepare update data - update status and mirrored offerHistory
    const updateData: Record<string, unknown> = {
        status: BidStatus.PENDING as BidStatus,
        updatedAt: admin.firestore.Timestamp.now(),
    };

    // Update only the targeted package with the counter offer
    if (existingBid.packageBids && existingBid.packageBids.length > 0) {
        const packageBids = [...existingBid.packageBids];

        // Heuristic: target the package the transporter is likely responding to
        const latestCOOffer = (existingBid.offerHistory || [])
            .filter(o => o.offeredBy === 'cargo_owner')
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

        let targetIndex = -1;
        if (packageItemId) {
            targetIndex = packageBids.findIndex(pb =>
                pb.packageItemId === packageItemId &&
                (!packageGroupId || pb.packageGroupId === packageGroupId)
            );
        }

        if (targetIndex === -1 && latestCOOffer) {
            targetIndex = packageBids.findIndex(pb =>
                (pb.offerHistory || []).some(o => o.id === latestCOOffer.id)
            );
        }

        // Fallback to first if still unknown
        if (targetIndex === -1) targetIndex = 0;

        const pkgBid = packageBids[targetIndex];
        if (pkgBid) {
            packageBids[targetIndex] = {
                ...pkgBid,
                status: PackageBidStatus.TRANS_COUNTER,
                // bidAmount and trucksProvided stay fixed during negotiation
                offerHistory: [...(pkgBid.offerHistory || []), counterOffer],
            } as any;
            updateData.packageBids = packageBids;
        }

        // Also update top-level status to signal negotiation
        updateData.status = BidStatus.COUNTER_OFFER;
    }

    // Still update top-level offerHistory for now
    updateData.offerHistory = [...(existingBid.offerHistory || []), counterOffer];

    await retryDatabaseOperation(
        async () => {
            await docRef.update(updateData);
        },
        2,
        1000,
        projectName,
    );

    console.log(
        `✅ Transporter counter offer added for bid ${bidId}: ETB ${amount.toLocaleString()} with ${trucksToAllocate} trucks - status set to Pending`,
    );

    // Return updated bid
    const updatedDoc = await retryDatabaseOperation(
        async () => {
            return await docRef.get();
        },
        2,
        1000,
        projectName,
    );

    return { id: updatedDoc.id, ...updatedDoc.data() } as Bid;
}

/**
 * Get a bid by ID
 */
export async function getBidById(bidId: string, projectName: string): Promise<Bid | null> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const doc = await retryDatabaseOperation(
        async () => {
            return await db.collection('bids').doc(bidId).get();
        },
        2,
        1000,
        projectName,
    );

    if (!doc.exists) {
        return null;
    }

    return { id: doc.id, ...doc.data() } as Bid;
}

