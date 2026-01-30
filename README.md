# Cargo Bidding Telegram Bot

A Telegram bot for cargo owners and transporters to manage load requests and bids through @pkdouze Telegram channel.

## Overview

This bot enables transporters to place bids on cargo load requests posted by cargo owners. The bot integrates with Firebase/Firestore for data persistence and supports multi-tenant architecture.

## Features

### For Transporters
- **Phone Verification**: Verify transporter account via phone number
- **Place Bids**: Click "Place Bid" button on load request posts
- **Bid Submission**: Enter bid amount (ETB) and number of trucks
- **Bid Confirmation**: Receive confirmation after successful bid submission

### For Cargo Owners
- **Load Request Posting**: Load requests are posted to @pkdouze channel
- **Bid Management**: View and manage incoming bids from transporters
- **Bid Status Tracking**: Track bid status (Pending, Accepted, Rejected)

## Architecture

### Multi-Tenant Support
The bot supports multiple Firebase projects/environments:
- Development, Int
### Data Models

#### LoadRequest
```typescript
{
  id: string;
  displayID: string;
  userId: string;
  status: LoadRequestStatus;
  route: {
    origin: string;
    destination: string;
    routeVia?: string;
  };
  schedule: {
    pickupDate: string;
    deliveryDate: string;
  };
  contact: {
    contactPerson: string;
    phoneNumber: string;
    customBranch?: string;
    inspectionType?: string;
  };
  cargo: {
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
  };
  cargoTotals: {
    totalUnits: number;
    totalWeight: string;
    totalVolume: string;
  };
  truckRequirements: {
    truckBodyType: string;
    axleConfiguration: string;
    numberOfTrucks: string;
    equipmentRequired: string[];
    equipmentOtherDetails?: string;
  };
  carrierRequirements: {
    carrierType?: string;
    minimumRating: number;
    preferredCarriersOnly: boolean;
  };
  biddingSettings: {
    bidDeadline: string;
    maxCarriers?: string;
    bidVisibility: BidVisibility;
    selectedCarriers: SelectedCarrier[];
    selectedCarriersTrucks: Record<string, number>;
    selectedCarriersCounterOfferEnabled: Record<string, boolean>;
    selectedCarriersCounterOffers: Record<string, number>;
    carrierBidVisibility: boolean;
    autoAward: AutoAwardRule;
    startingPrice?: string;
    biddingType: BiddingType;
    procurementMode: ProcurementMode;
  };
  paymentTerms: {
    paymentMethod?: string;
    paymentTerms?: string;
    additionalIncentives?: string;
    minBudget?: string;
    maxBudget?: string;
    insuranceRequired: boolean;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
  transporterResponses?: Record<string, TransporterResponseStatus>;
  negotiationHistory?: NegotiationEntry[];
  telegramMessageId?: number;
}
```

#### Bid
```typescript
{
  id: string;
  loadRequestID: string;
  transporterId: string;
  transporterName: string;
  transporterRating?: number;
  status: BidStatus;
  isWinner: boolean;
  isAccepted: boolean;
  pricing: {
    amount: number;
    currency: string;
    includesInsurance: boolean;
    includesFuel: boolean;
    additionalCharges?: {
      description: string;
      amount: number;
    }[];
  };
  trucksProvided: number;
  proposedPickupDate?: string;
  proposedDeliveryDate?: string;
  truckDetails?: BidTruckDetails;
  driverDetails?: BidDriverDetails;
  notes?: string;
  validUntil?: Timestamp;
  offerHistory: OfferHistory[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### Transporter
```typescript
{
  id: string;
  uid: string;
  name: string;
  phoneNumber: string;
  companyName?: string;
  telegramChatID?: string;
  status: 'Active' | 'Suspended' | 'Inactive';
  createdAt: string;
  updatedAt: string;
}
```

## Bot Commands

- `/start` - Verify phone number and link transporter account
- `/help` - Show help message

## User Flow

### Transporter Bid Placement Flow

1. **Load Request Posted**: Cargo owner posts load request to @pkdouze channel
2. **Click "Place Bid"**: Transporter clicks button on Telegram post
3. **Phone Verification**: Bot verifies transporter's phone number
4. **Enter Bid Amount**: Transporter enters bid amount in ETB
5. **Enter Truck Count**: Transporter enters number of trucks available
6. **Bid Confirmation**: Bot confirms successful bid submission

### Phone Verification Flow

1. Transporter sends `/start` command
2. Bot requests phone number sharing
3. Transporter shares phone number via Telegram
4. Bot searches across all Firebase projects for matching transporter
5. If found, links Telegram chat ID to transporter account
6. Transporter can now place bids

## Project Structure

```
src/
├── bot.ts                      # Main bot implementation
├── server.ts                    # Express server
├── firebase-config.ts            # Firebase configuration
├── webhook.ts                   # Webhook handlers
├── models/                      # Data models
│   ├── load-request.ts
│   ├── bid.ts
│   ├── transporter.ts
│   └── user.ts
├── services/                    # Business logic
│   ├── bid-service.ts
│   └── transporter-service.ts
├── handlers/                    # Event handlers
│   ├── callback-handler.ts        # Button click handlers
│   └── message-handler.ts       # Message handlers
└── types/                      # TypeScript types
    └── telegram.ts
```

## Environment Variables

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
NEXT_PUBLIC_FIREBASE_ADMIN_DEVELOPMENT='{"type":"service_account",...}'
NEXT_PUBLIC_FIREBASE_ADMIN_DEV='{"type":"service_account",...}'
NEXT_PUBLIC_FIREBASE_ADMIN_INT='{"type":"service_account",...}'
# ... additional Firebase project configs
```

## Installation

```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```

## Firebase Collections

### `transporters`
Stores transporter account information
- Indexed by: `phoneNumber`, `telegramChatID`

### `loadRequests`
Stores cargo load requests
- Indexed by: `cargoOwnerId`, `status`

### `bids`
Stores bid information
- Indexed by: `loadRequestId`, `transporterId`

## API Endpoints

### GET `/health`
Health check endpoint
```json
{
  "status": "OK",
  "timestamp": "2024-01-30T13:00:00.000Z",
  "bot": {
    "token": "Set",
    "polling": "Always Enabled (Main Purpose)"
  },
  "firebase": {
    "configs": 9
  }
}
```

### POST `/webhook`
Webhook endpoint for Telegram updates (if needed)

## Security Considerations

- Phone number verification required before placing bids
- Transporter status checked (Active/Suspended/Inactive)
- Duplicate bid prevention
- Load request status validation
- Firebase security rules should be configured appropriately

## Error Handling

The bot includes comprehensive error handling:
- Database operation retries with exponential backoff
- Health checks for Firebase connections
- Graceful error messages to users
- Performance monitoring for slow queries

## Future Enhancements

- Bid history viewing
- Bid editing/cancellation
- Real-time bid status notifications
- Counter-offer handling
- Analytics dashboard
- Multi-language support

## Support

For issues or questions, please contact the development team.