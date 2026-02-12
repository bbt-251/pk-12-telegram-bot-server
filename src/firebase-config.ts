import admin from 'firebase-admin';
import type { ServiceAccount } from 'firebase-admin'
import type { firestore } from 'firebase-admin'
import crypto from 'crypto'

// Define extended ServiceAccount to include project_id since JSON has it
interface ExtendedServiceAccount extends ServiceAccount {
    [key: string]: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface FirebaseConfig {
    projectId: string
    config: ExtendedServiceAccount
    name: string
}

// External app configuration
const firebaseConfig = {
    dev: {
        apiKey: "AIzaSyBlHYQ1SfBMxyccs5HAYG9fgXTAKntx_80",
        authDomain: "pk-12-development.firebaseapp.com",
        projectId: "pk-12-development",
        storageBucket: "pk-12-development.firebasestorage.app",
        messagingSenderId: "1000739929509",
        appId: "1:1000739929509:web:7673409efee40552983c4c",
        adminEnvKey: "NEXT_PUBLIC_FIREBASE_ADMIN_DEVELOPMENT",
        // domain: "https://pk-12-dev.vercel.app"
        domain: "https://9mmjk5x1-3010.uks1.devtunnels.ms"
    },
    int: {
        apiKey: "AIzaSyDzh00Bo-FKP5GS5Tr_TDdM_wGz-DinVnE",
        authDomain: "pk-12-13035.firebaseapp.com",
        projectId: "pk-12-13035",
        storageBucket: "pk-12-13035.firebasestorage.app",
        messagingSenderId: "1001325999246",
        appId: "1:1001325999246:web:b7284725a1b72e5dd385df",
        adminEnvKey: "NEXT_PUBLIC_FIREBASE_ADMIN_INT",
        domain: "https://int.pkdouze.com"
    }
}

// Use development config by default
export const externalAppConfig = firebaseConfig.dev

/**
 * Generate auth token for external transport details form
 */
export function generateExternalAuthToken(bidID: string, userUID: string): string {
    const secret = process.env.EXTERNAL_API_SECRET
    if (!secret) {
        console.error('EXTERNAL_API_SECRET not configured')
        return ''
    }

    const timestamp = Date.now().toString()
    const data = `${bidID}${userUID}${timestamp}`
    const token = crypto
        .createHmac('sha256', secret)
        .update(data)
        .digest('hex')

    return `${timestamp}_${token}`
}

/**
 * Get external transport details URL
 */
export function getExternalTransportDetailsUrl(bidID: string, userUID: string): string {
    const authToken = generateExternalAuthToken(bidID, userUID)
    const url = `${externalAppConfig.domain}/external/${bidID}/${userUID}?authToken=${authToken}`
    return url
}

/**
 * Get external bid placement URL (for Telegram Mini App)
 */
export function getExternalBidUrl(loadRequestId: string, transporterId: string): string {
    const authToken = generateExternalAuthToken(loadRequestId, transporterId)
    const url = `${externalAppConfig.domain}/external/bid/${loadRequestId}/${transporterId}?authToken=${authToken}`
    return url
}

// Manually defined prefixes to match the .env variables
const prefixes = ['DEVELOPMENT', 'INT',]

// Store Firestore db instances
const dbInstances: Record<string, any> = {} // eslint-disable-line @typescript-eslint/no-explicit-any

// Parse and structure the Firebase Admin configs from environment variables
const firebaseConfigs: Record<string, FirebaseConfig> = {}

prefixes.forEach(prefix => {
    const envVar = `NEXT_PUBLIC_FIREBASE_ADMIN_${prefix}`
    if (process.env[envVar]) {
        const config: ExtendedServiceAccount = JSON.parse(process.env[envVar]!)
        const name = prefix.toLowerCase()
        const appName = `app-${name}`
        firebaseConfigs[name] = {
            projectId: config.project_id!,
            config,
            name
        }

        // Initialize Firebase Admin app and Firestore instance
        if (admin) {
            let app;
            if (admin.apps.some(existingApp => existingApp !== null && existingApp.name === appName)) {
                app = admin.app(appName);
            } else {
                app = admin.initializeApp({
                    credential: admin.credential.cert(config)
                }, appName);
            }

            // Initialize Firestore instance
            const firestoreDb = admin.firestore(app);
            dbInstances[name] = firestoreDb;
        }
    }
})

// Database connection health check
export async function checkDatabaseHealth(db: firestore.Firestore, projectName: string): Promise<boolean> {
    const startTime = Date.now();
    try {
        // Simple health check - try to access the root collection
        const testQuery = db.collection('_health_check').limit(1);
        await testQuery.get();
        const duration = Date.now() - startTime;
        dbPerformanceMonitor.recordQuery(projectName, duration, true);
        return true;
    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Database ${projectName} health check failed: ${errorMessage} (${duration}ms)`);
        dbPerformanceMonitor.recordQuery(projectName, duration, false, errorMessage);
        return false;
    }
}

// Get healthy database instances only
export async function getHealthyDbInstances(): Promise<Record<string, firestore.Firestore>> {
    console.log(`Checking database health for ${Object.keys(dbInstances).length} instances...`);
    const healthyInstances: Record<string, firestore.Firestore> = {};

    for (const [projectName, db] of Object.entries(dbInstances)) {
        if (await checkDatabaseHealth(db, projectName)) {
            healthyInstances[projectName] = db;
            console.log(`✅ Project ${projectName} is healthy`);
        } else {
            console.log(`❌ Project ${projectName} is not healthy`);
        }
    }

    console.log(`Found ${Object.keys(healthyInstances).length} healthy database instances`);
    return healthyInstances;
}

// Performance monitoring for database queries
interface QueryMetrics {
    projectName: string;
    duration: number;
    success: boolean;
    timestamp: number;
    error?: string;
}

class DatabasePerformanceMonitor {
    private metrics: QueryMetrics[] = [];
    private readonly maxMetrics = 1000; // Keep last 1000 metrics

    recordQuery(projectName: string, duration: number, success: boolean, error?: string): void {
        const metric: QueryMetrics = {
            projectName,
            duration,
            success,
            timestamp: Date.now()
        };

        if (error !== undefined) {
            metric.error = error;
        }

        this.metrics.push(metric);

        // Keep only the last maxMetrics entries
        if (this.metrics.length > this.maxMetrics) {
            this.metrics = this.metrics.slice(-this.maxMetrics);
        }

        // Log slow queries (> 3 seconds)
        if (duration > 3000) {
            console.warn(`Slow database query detected: ${projectName} took ${duration}ms`);
        }
    }

    getMetrics(): QueryMetrics[] {
        return [...this.metrics];
    }

    getAverageQueryTime(projectName?: string): number {
        const relevantMetrics = projectName
            ? this.metrics.filter(m => m.projectName === projectName && m.success)
            : this.metrics.filter(m => m.success);

        if (relevantMetrics.length === 0) return 0;

        const totalTime = relevantMetrics.reduce((sum, m) => sum + m.duration, 0);
        return totalTime / relevantMetrics.length;
    }

    getSlowQueries(threshold: number = 3000): QueryMetrics[] {
        return this.metrics.filter(m => m.duration > threshold);
    }

    getErrorRate(projectName?: string): number {
        const relevantMetrics = projectName
            ? this.metrics.filter(m => m.projectName === projectName)
            : this.metrics;

        if (relevantMetrics.length === 0) return 0;

        const errorCount = relevantMetrics.filter(m => !m.success).length;
        return (errorCount / relevantMetrics.length) * 100;
    }
}

// Retry mechanism for database operations
export async function retryDatabaseOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000,
    projectName?: string
): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const startTime = Date.now();
            const result = await operation();
            const duration = Date.now() - startTime;

            if (projectName) {
                dbPerformanceMonitor.recordQuery(projectName, duration, true);
            }

            return result;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown error');

            if (projectName) {
                dbPerformanceMonitor.recordQuery(projectName, 0, false, lastError.message);
            }

            // Don't retry on certain types of errors
            if (lastError.message.includes('permission-denied') ||
                lastError.message.includes('not-found') ||
                lastError.message.includes('already-exists')) {
                throw lastError;
            }

            if (attempt === maxRetries) {
                throw lastError;
            }

            // Exponential backoff delay
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.warn(`Database operation failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, lastError.message);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError!;
}

export const dbPerformanceMonitor = new DatabasePerformanceMonitor();

export { dbInstances, firebaseConfigs, firebaseConfig }
export type { FirebaseConfig }
