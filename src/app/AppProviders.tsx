import type { ReactNode } from "react";
import { CommandProvider } from "../features/command/CommandProvider";
import { NotificationProvider } from "../features/notifications/NotificationProvider";
import { UIPreferencesProvider } from "../features/preferences/UIPreferencesProvider";
import { SystemStatusProvider } from "../features/system/SystemStatusProvider";
import { ThemeProvider } from "../features/theme/ThemeProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <UIPreferencesProvider>
        <NotificationProvider>
          <SystemStatusProvider>
            <CommandProvider>{children}</CommandProvider>
          </SystemStatusProvider>
        </NotificationProvider>
      </UIPreferencesProvider>
    </ThemeProvider>
  );
}
