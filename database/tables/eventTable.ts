import type { TableDefinition } from '../types';

export interface EventRow {
  id: number;
  server_id: string;
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  url: string | null;
  created_by: string | null;
  created_at: string;
  image_channel_id: string | null;
  image_message_id: string | null;
  image_attachment_id: string | null;
  reminder_day_sent_at: string | null;
  reminder_soon_sent_at: string | null;
}

// starts_at / ends_at are ISO-8601 UTC strings. Operators enter Perth local time;
// conversion happens at the command boundary (utils/perthTime.parsePerthDateTime).
const eventTable: TableDefinition = {
  name: 'Event',
  columns: [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'server_id', type: 'TEXT NOT NULL' },
    { name: 'name', type: 'TEXT NOT NULL' },
    { name: 'description', type: 'TEXT' },
    { name: 'starts_at', type: 'TEXT NOT NULL' },
    { name: 'ends_at', type: 'TEXT' },
    { name: 'location', type: 'TEXT' },
    { name: 'url', type: 'TEXT' },
    { name: 'created_by', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
    // Discord message holding the event's image. Stored as ids, never as a CDN
    // URL: attachment links are signed and expire, so the URL is re-resolved by
    // fetching this message when it's needed (utils/eventImage.ts).
    { name: 'image_channel_id', type: 'TEXT' },
    { name: 'image_message_id', type: 'TEXT' },
    { name: 'image_attachment_id', type: 'TEXT' },
    // Set once each reminder has been posted, so restarts can't double-post.
    { name: 'reminder_day_sent_at', type: 'TEXT' },
    { name: 'reminder_soon_sent_at', type: 'TEXT' },
  ],
  primaryKey: ['id'],
  specialConstraints: [],
  constraints: [],
};

export default eventTable;
