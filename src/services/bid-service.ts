import { getHealthyDbInstances, retryDatabaseOperation } from '../firebase-config';
import { Bid, BidStatus } from '../models/bid';
import { LoadRequest } from '../models/load-request';
import admin from 'firebase-admin';

/**
 * Create a new bid for a load request
 */
export async function createBid(
    loadRequestId: string,
    transporterId: string,
    transporterName: string,
    transporterPhone: string,
    bidAmount: number,
    numberOfTrucks: number,
    projectName: string
): Promise<Bid> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const now = new Date().toISOString();
    const bidRef = db.collection('bids').doc();
    const bidId = bidRef.id;

    const bid: Bid = {
        id: bidId,
        loadRequestID: loadRequestId,
        transporterId,
        transporterName,
        pricing: {
            amount: bidAmount,
            currency: 'ETB',
            includesInsurance: false,
            includesFuel: true
        },
        trucksProvided: numberOfTrucks,
        status: BidStatus.PENDING,
        isWinner: false,
        isAccepted: false,
        offerHistory: [{
            id: crypto.randomUUID(),
            amount: bidAmount,
            currency: 'ETB',
            type: 'initial',
            offeredBy: 'transporter',
            offeredByName: transporterName,
            timestamp: now
        }],
        createdAt: admin.firestore.Timestamp.fromDate(new Date(now)),
        updatedAt: admin.firestore.Timestamp.fromDate(new Date(now))
    };

    await retryDatabaseOperation(async () => {
        await bidRef.set(bid);
    }, 2, 1000, projectName);

    console.log(`✅ Created bid ${bidId} for load ${loadRequestId} by transporter ${transporterId}`);
    return bid;
}

/**
 * Check if transporter has already bid on a load request
 * Returns the bid if it exists and is not accepted, null otherwise
 */
export async function hasExistingBid(
    loadRequestId: string,
    transporterId: string,
    projectName: string
): Promise<boolean> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const query = await retryDatabaseOperation(async () => {
        return await db.collection('bids')
            .where('loadRequestId', '==', loadRequestId)
            .where('transporterId', '==', transporterId)
            .limit(1)
            .get();
    }, 2, 1000, projectName);

    return !query.empty;
}

/**
 * Get existing bid by transporter and load request
 * Returns the bid if it exists, null otherwise
 */
export async function getExistingBid(
    loadRequestId: string,
    transporterId: string,
    projectName: string
): Promise<{ bid: Bid; canEdit: boolean } | null> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const query = await retryDatabaseOperation(async () => {
        return await db.collection('bids')
            .where('loadRequestId', '==', loadRequestId)
            .where('transporterId', '==', transporterId)
            .limit(1)
            .get();
    }, 2, 1000, projectName);

    if (query.empty) {
        return null;
    }

    const doc = query.docs[0];
    if (!doc) {
        return null;
    }

    const bid = { id: doc.id, ...doc.data() } as Bid;
    
    // Can edit if bid is not accepted
    const canEdit = bid.status !== BidStatus.ACCEPTED;
    
    return { bid, canEdit };
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
    projectName: string
): Promise<Bid> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
        updatedAt: admin.firestore.Timestamp.fromDate(new Date(now))
    };

    if (updates.bidAmount !== undefined) {
        updateData['pricing.amount'] = updates.bidAmount;
        // Add to offer history
        updateData['offerHistory'] = admin.firestore.FieldValue.arrayUnion({
            id: crypto.randomUUID(),
            amount: updates.bidAmount,
            currency: 'ETB',
            type: 'initial',
            offeredBy: 'transporter',
            offeredByName: 'Transporter',
            timestamp: now
        });
    }

    if (updates.numberOfTrucks !== undefined) {
        updateData['trucksProvided'] = updates.numberOfTrucks;
    }

    await retryDatabaseOperation(async () => {
        await db.collection('bids').doc(bidId).update(updateData);
    }, 2, 1000, projectName);

    // Fetch and return updated bid
    const doc = await retryDatabaseOperation(async () => {
        return await db.collection('bids').doc(bidId).get();
    }, 2, 1000, projectName);

    return { id: doc.id, ...doc.data() } as Bid;
}

/**
 * Get a load request by ID
 */
export async function getLoadRequestById(
    loadRequestId: string,
    projectName: string
): Promise<LoadRequest | null> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not available`);
    }

    const doc = await retryDatabaseOperation(async () => {
        return await db.collection('loadRequests').doc(loadRequestId).get();
    }, 2, 1000, projectName);

    if (!doc.exists) {
        return null;
    }

    return { id: doc.id, ...doc.data() } as LoadRequest;
}