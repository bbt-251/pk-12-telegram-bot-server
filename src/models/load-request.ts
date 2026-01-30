import { UserRole } from './user';

export enum TransporterResponseStatus {
    PENDING = "Pending",
    ACCEPTED = "Accepted",
    DECLINED = "Declined",
    COUNTER_OFFER = "Counter Offer",
    COUNTER_OFFER_ACCEPTED = "Counter Offer Accepted",
    CARGO_OWNER_COUNTER_OFFER = "Cargo Owner Counter Offer",
}

export interface NegotiationEntry {
    id: string;
    transporterId: string;
    amount: number;
    notes: string | null;
    timestamp: string;
    type: 'initial' | 'counter_offer' | 'transporter_counter';
    userId: string;
    userRole: UserRole;
}

/**
 * Generate a load request ID in format LR-{year}{month}{day}{hour}{min}{sec}
 * @returns LoadRequestID object with displayID and firebaseId
 */
export function generateLoadRequestID(): string {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const min = now.getMinutes().toString().padStart(2, '0');
    const sec = now.getSeconds().toString().padStart(2, '0');

    const displayID = `LR-${year}-${month}-${day}-${hour}-${min}-${sec}`;

    return displayID;
}

// Enums for load request status
export enum LoadRequestStatus {
    OPEN = "Open",
    AWAITING_CONFIRMATION = "Awaiting Confirmation",
    TRANSPORT_DETAILS_SUBMITTED = "Transport Details Submitted",
    CONFIRMED = "Confirmed",
    CANCELLED = "Cancelled",
}

export enum BidVisibility {
    PUBLIC = "public",
    PRIVATE = "private",
}

export enum AutoAwardRule {
    AUTO = "auto",
    MANUAL = "manual",
}

export enum BiddingType {
    OPEN = "open",
    FIXED = "fixed",
}

// Package item within a package group
export interface LoadRequestPackageItem {
    id: string;
    containerType?: string;
    containerVariant?: string;
    length: string;
    width: string;
    height: string;
    weight: string;
    quantity: number;
}

// Package group containing multiple packages
export interface LoadRequestPackageGroup {
    id: string;
    packagingType: string;
    packages: LoadRequestPackageItem[];
    numberOfTrucks?: string;
}

// Route information
export interface LoadRequestRoute {
    origin: string;
    destination: string;
    routeVia?: string;
}

// Schedule information
export interface LoadRequestSchedule {
    pickupDate: string;
    deliveryDate: string;
}

// Contact information
export interface LoadRequestContact {
    contactPerson: string;
    phoneNumber: string;
    customBranch?: string;
    inspectionType?: string;
}

// Cargo details
export interface LoadRequestCargo {
    cargoType: string;
    fragile: boolean;
    hazardous: boolean;
    temperatureControlled: boolean;
    tempMin?: string;
    tempMax?: string;
    oversized: boolean;
    stackable?: string;
    description?: string;
    packageGroups: LoadRequestPackageGroup[];
}

// Truck requirements
export interface LoadRequestTruckRequirements {
    truckBodyType: string;
    axleConfiguration: string;
    numberOfTrucks: string;
    equipmentRequired: string[];
    equipmentOtherDetails?: string;
}

// Carrier requirements
export interface LoadRequestCarrierRequirements {
    carrierType?: string;
    minimumRating: number;
    preferredCarriersOnly: boolean;
}

// Selected carrier
export type SelectedCarrier = {
    userId: string;
    postId: string;
};

// Procurement mode
export type ProcurementMode = "bidding" | "cart";

// Bidding settings
export interface LoadRequestBiddingSettings {
    bidDeadline: string;
    maxCarriers?: string;
    bidVisibility: BidVisibility;
    selectedCarriers: SelectedCarrier[];
    selectedCarriersTrucks: Record<string, number>; // userId -> number of trucks needed
    selectedCarriersCounterOfferEnabled: Record<string, boolean>; // postId -> true if counter offer enabled
    selectedCarriersCounterOffers: Record<string, number>; // postId -> counter offer amount
    carrierBidVisibility: boolean;
    autoAward: AutoAwardRule;
    startingPrice?: string;
    biddingType: BiddingType;
    procurementMode: ProcurementMode;
}

// Payment terms
export interface LoadRequestPaymentTerms {
    paymentMethod?: string;
    paymentTerms?: string;
    additionalIncentives?: string;
    minBudget?: string;
    maxBudget?: string;
    insuranceRequired: boolean;
}

// Computed totals for cargo
export interface LoadRequestCargoTotals {
    totalUnits: number;
    totalWeight: string;
    totalVolume: string;
}

// Main Load Request document
export interface LoadRequest {
    id: string;
    displayID: string;
    userId: string;
    status: LoadRequestStatus;
    route: LoadRequestRoute;
    schedule: LoadRequestSchedule;
    contact: LoadRequestContact;
    cargo: LoadRequestCargo;
    cargoTotals: LoadRequestCargoTotals;
    truckRequirements: LoadRequestTruckRequirements;
    carrierRequirements: LoadRequestCarrierRequirements;
    biddingSettings: LoadRequestBiddingSettings;
    paymentTerms: LoadRequestPaymentTerms;
    notes?: string;
    createdAt: string;
    updatedAt: string;
    transporterResponses?: Record<string, TransporterResponseStatus>;
    negotiationHistory?: NegotiationEntry[];
    telegramMessageId?: number;
}

// Input type for creating a load request (without id and timestamps)
export interface CreateLoadRequestInput {
    userId: string;
    status?: LoadRequestStatus;
    route: LoadRequestRoute;
    schedule: LoadRequestSchedule;
    contact: LoadRequestContact;
    cargo: LoadRequestCargo;
    cargoTotals: LoadRequestCargoTotals;
    truckRequirements: LoadRequestTruckRequirements;
    carrierRequirements: LoadRequestCarrierRequirements;
    biddingSettings: LoadRequestBiddingSettings;
    paymentTerms: LoadRequestPaymentTerms;
    notes?: string;
    negotiationHistory?: NegotiationEntry[];
    telegramMessageId?: number;
}

// Input type for updating a load request
export interface UpdateLoadRequestInput {
    status?: LoadRequestStatus;
    route?: Partial<LoadRequestRoute>;
    schedule?: Partial<LoadRequestSchedule>;
    contact?: Partial<LoadRequestContact>;
    cargo?: Partial<LoadRequestCargo>;
    cargoTotals?: Partial<LoadRequestCargoTotals>;
    truckRequirements?: Partial<LoadRequestTruckRequirements>;
    carrierRequirements?: Partial<LoadRequestCarrierRequirements>;
    biddingSettings?: Partial<LoadRequestBiddingSettings>;
    paymentTerms?: Partial<LoadRequestPaymentTerms>;
    notes?: string;
    telegramMessageId?: number;
}