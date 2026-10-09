import { carinfoPublicProvider } from "./carinfo-public.mjs";
import { licensedStubProvider } from "./licensed-stub.mjs";
import { licensedProvider } from "./licensed-provider.mjs";
import { authenticatedProvider } from "./authenticated-provider.mjs";
import { AppError } from "../errors.mjs";

const providers = {
  [carinfoPublicProvider.id]: carinfoPublicProvider,
  [licensedProvider.id]: licensedProvider,
  // aliases
  licensed: licensedProvider,
  [licensedStubProvider.id]: licensedStubProvider,
  [authenticatedProvider.id]: authenticatedProvider,
  authenticated: authenticatedProvider,
};

export function listProviders() {
  return Object.values(
    Object.fromEntries(
      Object.values(providers).map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          ...(typeof p.getStatus === "function" ? { status: p.getStatus() } : {}),
        },
      ]),
    ),
  );
}

export function getProvider(id) {
  const key = (id || process.env.VEHICLE_PROVIDER || "carinfo-public").toLowerCase();
  const provider = providers[key];
  if (!provider) {
    throw new AppError(`Unknown provider: ${key}`, {
      status: 400,
      code: "unknown_provider",
      details: {
        available: [...new Set(Object.values(providers).map((p) => p.id))],
      },
    });
  }
  return provider;
}

export {
  carinfoPublicProvider,
  licensedProvider,
  authenticatedProvider,
  licensedStubProvider,
};
