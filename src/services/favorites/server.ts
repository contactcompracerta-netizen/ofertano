import { criarServicoFavoritos } from "./service";
import { prismaFavoriteStore } from "./prismaStore";

export const favoritos = criarServicoFavoritos(
  prismaFavoriteStore
);
