import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const dateFormat: string = "MMMM DD, YYYY";
export const timestampFormat: string = "MMMM DD, YYYY hh:mm A";

export const monthNames: string[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const getCurrentMonthName = () => monthNames[dayjs().month()];

// Env-configurable default timezone (fallback)
export const DEFAULT_TZ = process.env.DEFAULT_TZ || "Africa/Nairobi";

// UTC timestamp for storage
export const getUTCTimestamp = () => dayjs.utc().toISOString();

// Timezone-aware formatting for display
export const formatHour = (ts: string, tz?: string): string => dayjs.tz(ts, tz || DEFAULT_TZ).format("h:mm A");
export const formatTimestamp = (ts: string, tz?: string): string => dayjs.tz(ts, tz || DEFAULT_TZ).format("MMMM DD, YYYY hh:mm A");

// Get user's timezone from browser
export const getUserTimezone = (): string => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (error) {
        console.warn("Could not detect user timezone, using default:", error);
        return DEFAULT_TZ;
    }
};

export const getTimestamp = () => dayjs().format(timestampFormat);
export const getDate = () => dayjs().format(dateFormat);

export const formatDate = (date: Date | string | dayjs.Dayjs) => dayjs(date).format(dateFormat);
export const formatTimestampLegacy = (timestamp: Date | string | dayjs.Dayjs) => dayjs(timestamp).format(timestampFormat);