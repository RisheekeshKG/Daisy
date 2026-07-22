export interface EncryptedItem {
  id: string;
  ciphertext: string; // Base64 combined IV + Encrypted Data
  isEncrypted: boolean;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string; // Plain text or Markdown
  tags: string[];
  updatedAt: string;
  category?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // YYYY-MM-DDTHH:MM
  end: string;   // YYYY-MM-DDTHH:MM
  description?: string;
  category?: "work" | "personal" | "health" | "media" | "ai";
  completed?: boolean;
  priority?: "high" | "medium" | "low";
  subtasks?: Array<{
    id: string;
    text: string;
    completed: boolean;
  }>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "jarvis";
  text: string;
  timestamp: string;
  commands?: Array<{
    type: string;
    payload: any;
  }>;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  body?: string;
}

export interface EncryptionKeys {
  salt: string;
  pbkdf2Iterations: number;
}
