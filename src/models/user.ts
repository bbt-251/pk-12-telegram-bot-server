import type { firestore } from 'firebase-admin';

export enum UserRole {
    CARGO_OWNER = "cargo_owner",
    TRANSPORTER = "transporter",
    ADMIN = "admin",
}

export interface UserModel {
    id: string;
    uid: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    role: UserRole;
    profilePicture: string | null;
    carrierType?: string | null; // Carrier type for transporters, null for cargo owners
    rating?: number; // Rating out of 5, optional for backward compatibility
    companyName?: string | null; // Optional: Only for Cargo Owners
    tin?: string | null; // Optional: For Cargo Owners and Transporters
    createdAt: firestore.Timestamp;
    updatedAt: firestore.Timestamp;
    telegramChatID: string | null
}