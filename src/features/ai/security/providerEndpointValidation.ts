export type ProviderEndpointValidation =
  | { valid: true; value: string }
  | { valid: false; message: string };

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127;
}

export function validateProviderBaseUrl(value: string): ProviderEndpointValidation {
  const candidate = value.trim();
  if (!candidate) return { valid: true, value: "" };
  if (candidate.length > 2048) {
    return { valid: false, message: "The endpoint URL is longer than the supported limit." };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(candidate);
  } catch {
    return { valid: false, message: "Enter a complete API base URL." };
  }

  if (endpoint.username || endpoint.password) {
    return { valid: false, message: "Credentials are not allowed in the endpoint URL." };
  }
  if (endpoint.search || endpoint.hash) {
    return { valid: false, message: "The endpoint cannot include a query or fragment." };
  }
  if (
    endpoint.protocol !== "https:" &&
    !(endpoint.protocol === "http:" && isLoopbackHost(endpoint.hostname))
  ) {
    return {
      valid: false,
      message: "Use HTTPS, or HTTP only for a loopback endpoint such as localhost.",
    };
  }

  return { valid: true, value: candidate.replace(/\/+$/, "") };
}
