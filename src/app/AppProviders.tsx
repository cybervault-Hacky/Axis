import type { ReactNode } from "react";
import {
  AIProviderProvider,
  type AIProviderDependencies,
} from "../features/ai/state/AIProviderProvider";
import { CommandProvider } from "../features/command/CommandProvider";
import { NotificationProvider } from "../features/notifications/NotificationProvider";
import { UIPreferencesProvider } from "../features/preferences/UIPreferencesProvider";
import { SystemStatusProvider } from "../features/system/SystemStatusProvider";
import { ThemeProvider } from "../features/theme/ThemeProvider";

export function AppProviders({
  children,
  aiDependencies,
}: {
  children: ReactNode;
  aiDependencies?: AIProviderDependencies;
}) {
  return (
    <ThemeProvider>
      <UIPreferencesProvider>
        <NotificationProvider>
          <SystemStatusProvider>
            <AIProviderProvider dependencies={aiDependencies}>
              <CommandProvider>{children}</CommandProvider>
            </AIProviderProvider>
          </SystemStatusProvider>
        </NotificationProvider>
      </UIPreferencesProvider>
    </ThemeProvider>
  );
}
