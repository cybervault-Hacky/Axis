import type { AxisAppInfo } from "../../shared/ipc-contract";
import type {
  AiCancelResult,
  AiImportCredentialPayload,
  AiImportCredentialResult,
  AiProviderId,
  AiProviderStatus,
  AiRemoveCredentialResult,
  AiSendRequestPayload,
  AiSendResult,
  AiStreamEvent,
  AiStreamStartResult,
  AiTestConnectionResult
} from "../../shared/ai-contract";
import type {
  ConversationGetResult,
  ConversationListResult,
  ConversationOpResult,
  ConversationRecord
} from "../../shared/conversation-contract";

export {};

declare global {
  interface Window {
    /**
     * The sole bridge exposed by the preload script. Only present when
     * running inside the real Electron app (contextIsolation + preload);
     * undefined in the plain browser dev-server preview, which the
     * renderer must treat as an honest "native bridge unavailable" state
     * rather than simulating any of these calls.
     */
    axis?: {
      getAppInfo: () => Promise<AxisAppInfo>;
      ai: {
        getStatus: (provider?: AiProviderId) => Promise<AiProviderStatus>;
        importCredential: (payload?: AiImportCredentialPayload) => Promise<AiImportCredentialResult>;
        removeCredential: (provider?: AiProviderId) => Promise<AiRemoveCredentialResult>;
        testConnection: (provider?: AiProviderId) => Promise<AiTestConnectionResult>;
        sendRequest: (payload: AiSendRequestPayload) => Promise<AiSendResult>;
        cancelRequest: (requestId: string) => Promise<AiCancelResult>;
        sendStreamingRequest: (payload: AiSendRequestPayload) => Promise<AiStreamStartResult>;
        onStreamEvent: (callback: (event: AiStreamEvent) => void) => () => void;
      };
      conversations: {
        list: () => Promise<ConversationListResult>;
        search: (query: string) => Promise<ConversationListResult>;
        get: (id: string) => Promise<ConversationGetResult>;
        save: (conversation: ConversationRecord) => Promise<ConversationOpResult>;
        rename: (id: string, title: string) => Promise<ConversationOpResult>;
        delete: (id: string) => Promise<ConversationOpResult>;
        clearAll: () => Promise<ConversationOpResult>;
        exportConversation: (id: string) => Promise<ConversationOpResult>;
        exportAllConversations: () => Promise<ConversationOpResult>;
        importConversation: () => Promise<ConversationOpResult>;
        importAllConversations: () => Promise<ConversationOpResult>;
        importConversationsFromText: (text: string) => Promise<ConversationOpResult>;
      };
    };
  }
}
