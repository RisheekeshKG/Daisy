import { GmailMessage } from "../types";

export async function fetchGmailInbox(accessToken: string): Promise<GmailMessage[]> {
  try {
    // 1. Fetch message list
    const listRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    if (!listRes.ok) {
      throw new Error(`Failed to fetch Gmail list: ${listRes.statusText}`);
    }
    
    const listData = await listRes.json();
    if (!listData.messages || listData.messages.length === 0) {
      return [];
    }
    
    // 2. Fetch full details of each message in parallel
    const detailsPromises = listData.messages.map(async (msg: { id: string }) => {
      const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!detailRes.ok) return null;
      
      const detailData = await detailRes.json();
      
      // Extract headers
      const headers = detailData.payload?.headers || [];
      const subject = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value || "No Subject";
      const from = headers.find((h: any) => h.name.toLowerCase() === "from")?.value || "Unknown Sender";
      const date = headers.find((h: any) => h.name.toLowerCase() === "date")?.value || "No Date";
      
      return {
        id: detailData.id,
        threadId: detailData.threadId,
        from,
        subject,
        date,
        snippet: detailData.snippet || "",
      } as GmailMessage;
    });
    
    const results = await Promise.all(detailsPromises);
    return results.filter((r): r is GmailMessage => r !== null);
  } catch (error) {
    console.error("Error fetching real Gmail inbox:", error);
    throw error;
  }
}

export async function sendGmailMessage(
  accessToken: string,
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  try {
    // Construct a simple MIME email format
    const emailLines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "MIME-Version: 1.0",
      "",
      body,
    ];
    
    const emailStr = emailLines.join("\r\n");
    // Base64Url encode
    const base64Encoded = btoa(unescape(encodeURIComponent(emailStr)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
      
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Encoded }),
    });
    
    return res.ok;
  } catch (error) {
    console.error("Error sending Gmail message:", error);
    return false;
  }
}

// Highly elegant realistic sandbox emails for pre-authorization or testing state
export const SANDBOX_EMAILS: GmailMessage[] = [
  {
    id: "gmail_1",
    threadId: "t1",
    from: "Daisy Agent <daisy@daisy.ai>",
    subject: "Welcome to your new daisy-powered Workspace! 🌸",
    date: "09:12 AM",
    snippet: "Hello Daisy, I have successfully updated the neural boundary interface. Your custom-styled flower is fully loaded on my head chassis, keeping me focused and cheerful!",
  },
  {
    id: "gmail_2",
    threadId: "t2",
    from: "Spotify Labs <partnership@spotify.com>",
    subject: "Acoustic audio wave oscillator API enabled",
    date: "08:45 AM",
    snippet: "Hi there! Your developer dashboard is synchronized. Your custom real-time audio visualizer is receiving ambient soundscapes flawlessly.",
  },
  {
    id: "gmail_3",
    threadId: "t3",
    from: "Notion Team <workspace@notion.so>",
    subject: "System tasks & database sync completed",
    date: "Yesterday",
    snippet: "Your offline local database is successfully compiled in RAM. Daily study boundaries and Quantum Spec-Sheets are fully active.",
  }
];
