import type { firestore } from 'firebase-admin';

export enum BidStatus {
    PENDING = "Pending",
    ACCEPTED = "Accepted",
    COUNTER_OFFER = "Counter Offer",
    REJECTED = "Rejected",
    WITHDRAWN = "Withdrawn",
    EXPIRED = "Expired",
}

export enum PackageBidStatus {
    PENDING = 'Pending',
    ACCEPTED = 'Accepted',
    REJECTED = 'Rejected',
    CO_OFFER = 'Cargo Owner Counter Offer',
    TRANS_COUNTER = 'Transporter Counter Offer',
    TRANSPORT_SHARED = 'Transport Details Shared',
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
    deadline?: string; // ISO 8601 date string for response deadline
}

export interface PackageBid {
    packageGroupId: string;
    packageGroupData: {
        id: string;
        packagingType: string;
        numberOfTrucks: string;
    };
    packageItemId: string;
    packageItemData: {
        id: string;
        length: string;
        width: string;
        height: string;
        weight: string;
        quantity: number;
        containerSize?: string;
        containerType?: string;
        containerNumber?: string;
        containerVariant?: string;
    };
    bidAmount: number;
    trucksProvided: number;
    trucksAllocated?: number;
    status?: PackageBidStatus;
    transportDetailDeadline?: string;
    extensionRequested?: boolean;
    extensionRequestedAt?: string;
    extensionStatus?: 'pending' | 'approved' | 'rejected';
    extendedDeadline?: string;
    offerHistory?: OfferHistory[]; // History of all offers and counter-offers for this package
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
    packageBids?: PackageBid[]; // Per-package bids (new for package-level bidding)
    offerHistory?: OfferHistory[]; // @deprecated History has moved to PackageBid.offerHistory
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