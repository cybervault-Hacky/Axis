import { Badge } from "../../../components/ui/Badge";
import type { AIConnectionStatus } from "../domain/types";
import { connectionStatusPresentation } from "./providerStatusPresentation";

export function ProviderStatus({ status }: { status: AIConnectionStatus }) {
  const presentation = connectionStatusPresentation[status];
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}
