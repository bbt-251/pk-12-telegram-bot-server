import type { firestore } from 'firebase-admin';

export enum BidStatus {
    PENDING = "Pending",
    ACCEPTED = "Accepted",
    COUNTER_OFFER = "Counter Offer",
    REJECTED = "Rejected",
    WITHDRAWN = "Withdrawn",
    EXPIRED = "Expired",
}

export interface BidPricing {
    amount: number;
    currency: string;
    includesInsurance: boolean;
    includesFuel: boolean;
    additionalCharges?: {
        description: string;
        amount: number;
    }[];
}

export interface OfferHistory {
    id: string;
    amount: number;
    trucks: number;
    currency: string;
    status: "pending" | "accepted" | "rejected";
    offeredBy: 'transporter' | 'cargo_owner';
    offeredByName: string;
    timestamp: string;
    notes?: string;
}

export interface BidTruckDetails {
    truckId?: string;
    truckType: string;
    plateNumber?: string;
    capacity: string;
}

export interface BidDriverDetails {
    driverId?: string;
    name: string;
    phone: string;
    licenseNumber?: string;
}

// Main Bid document
export interface Bid {
    id: string;
    loadRequestID: string; // Foreign key to LoadRequest
    transporterId: string; // User ID of transporter/carrier
    transporterName: string;
    transporterRating?: number;
    status: BidStatus;
    isWinner: boolean; // Flag to identify the winning bid (can be true for multiple bids)
    isAccepted: boolean; // Flag to track all accepted bids (for multiple winners)
    pricing: BidPricing;
    trucksProvided: number; // Number of trucks transporter is providing
    proposedPickupDate?: string;
    proposedDeliveryDate?: string;
    truckDetails?: BidTruckDetails;
    driverDetails?: BidDriverDetails;
    notes?: string;
    validUntil?: firestore.Timestamp;
    offerHistory: OfferHistory[]; // History of all offers and counter-offers
    createdAt: firestore.Timestamp;
    updatedAt: firestore.Timestamp;
}

export interface CreateBidInput {
    loadRequestID: string;
    transporterId: string;
    transporterName: string;
    transporterRating?: number;
    pricing: BidPricing;
    trucksProvided: number;
    proposedPickupDate?: string;
    proposedDeliveryDate?: string;
    truckDetails?: BidTruckDetails;
    driverDetails?: BidDriverDetails;
    notes?: string;
    validUntil?: firestore.Timestamp;
    offerHistory?: OfferHistory[];
}

export interface UpdateBidInput {
    status?: BidStatus;
    isWinner?: boolean;
    isAccepted?: boolean;
    pricing?: Partial<BidPricing>;
    trucksProvided?: number;
    proposedPickupDate?: string;
    proposedDeliveryDate?: string;
    truckDetails?: Partial<BidTruckDetails>;
    driverDetails?: Partial<BidDriverDetails>;
    notes?: string;
    validUntil?: firestore.Timestamp;
    offerHistory?: OfferHistory[];
}