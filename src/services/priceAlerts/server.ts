import { criarServicoPriceAlerts } from "./service";
import { prismaPriceAlertStore } from "./prismaStore";

export const priceAlerts = criarServicoPriceAlerts(
  prismaPriceAlertStore
);

export async function avaliarAlertasAtivos() {
  return priceAlerts.avaliarAlertasAtivos();
}
