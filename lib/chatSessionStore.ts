import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: StoredMessage[];
  model: string;
  createdAt: number;
  updatedAt: number;
}

interface ChatSessionState {
  sessions: ChatSession[];
  preferredModel: string;
  setPreferredModel: (model: string) => void;
  createSession: (model: string, title: string) => string;
  upsertSession: (id: string, messages: StoredMessage[], model: string) => void;
  deleteSession: (id: string) => void;
  clearSessions: () => void;
}

export const useChatSessionStore = create<ChatSessionState>()(
  persist(
    (set) => ({
      sessions: [],
      preferredModel: "claude-sonnet-4-6",

      setPreferredModel: (model) => set({ preferredModel: model }),

      createSession: (model, title) => {
        const id = crypto.randomUUID();
        const now = Date.now();
        set(s => ({
          sessions: [
            { id, title, messages: [], model, createdAt: now, updatedAt: now },
            ...s.sessions,
          ],
        }));
        return id;
      },

      upsertSession: (id, messages, model) => {
        const updatedAt = Date.now();
        set(s => ({
          sessions: s.sessions.map(sess =>
            sess.id === id ? { ...sess, messages, model, updatedAt } : sess
          ),
        }));
      },

      deleteSession: (id) => {
        set(s => ({ sessions: s.sessions.filter(sess => sess.id !== id) }));
      },

      clearSessions: () => set({ sessions: [] }),
    }),
    {
      name: "heliosgen-chats-guest",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
