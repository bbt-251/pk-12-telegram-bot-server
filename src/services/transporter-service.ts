import { getHealthyDbInstances, retryDatabaseOperation } from '../firebase-config';
import { UserModel } from '../models/user';

/**
 * Find transporter by phone number
 */
export async function findTransporterByPhoneNumber(
    phoneNumber: string
): Promise<{ transporter: UserModel; projectName: string } | null> {
    const healthyDbs = await getHealthyDbInstances();
    console.log(`Searching for transporter with phone ${phoneNumber} across ${Object.keys(healthyDbs).length} Firebase projects`);

    for (const [projectName, db] of Object.entries(healthyDbs)) {
        try {
            const transportersRef = db.collection('users');
            const query = await retryDatabaseOperation(async () => {
                return await transportersRef
                    .where('phone', '==', phoneNumber)
                    .limit(1)
                    .get();
            }, 2, 1000, projectName);

            if (!query.empty) {
                const doc = query.docs[0];
                if (doc && doc.exists) {
                    const transporter = { id: doc.id, uid: doc.data().uid, ...doc.data() } as UserModel;
                    console.log(`Found transporter ${transporter.id} (UID: ${transporter.uid}) in project ${projectName}`);
                    return { transporter, projectName };
                }
            }
        } catch (error) {
            console.error(`Error searching ${projectName}:`, error);
            continue;
        }
    }

    console.log(`Transporter with phone ${phoneNumber} not found in any project`);
    return null;
}

/**
 * Find transporter by Telegram chat ID
 */
export async function findTransporterByChatId(
    chatId: number
): Promise<{ transporter: UserModel; projectName: string } | null> {
    const healthyDbs = await getHealthyDbInstances();

    for (const [projectName, db] of Object.entries(healthyDbs)) {
        try {
            const transportersRef = db.collection('users');
            const query = await retryDatabaseOperation(async () => {
                return await transportersRef
                    .where('telegramChatID', '==', chatId.toString())
                    .limit(1)
                    .get();
            }, 2, 1000, projectName);

            if (!query.empty) {
                const doc = query.docs[0];
                if (doc && doc.exists) {
                    const transporter = { id: doc.id, uid: doc.data().uid, ...doc.data() } as UserModel;
                    return { transporter, projectName };
                }
            }
        } catch (error) {
            console.error(`Error searching by chatId in ${projectName}:`, error);
            continue;
        }
    }
    return null;
}

/**
 * Update transporter's Telegram chat ID
 */
export async function updateTransporterChatId(
    transporterId: string,
    chatId: number,
    projectName: string
): Promise<boolean> {
    const db = (await getHealthyDbInstances())[projectName];
    if (!db) {
        throw new Error(`Database for project ${projectName} is not healthy`);
    }

    try {
        await retryDatabaseOperation(async () => {
            return await db.collection('users').doc(transporterId).update({
                telegramChatID: chatId.toString(),
                updatedAt: new Date().toISOString()
            });
        }, 2, 1000, projectName);

        console.log(`Updated telegramChatID for transporter ${transporterId} in ${projectName}`);
        return true;
    } catch (error) {
        console.error(`Failed to update telegramChatID for transporter ${transporterId}:`, error);
        return false;
    }
}